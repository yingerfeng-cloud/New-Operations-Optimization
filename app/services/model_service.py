from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.builders.generic_linear_builder import GenericLinearBuilder
from app.generic_formula_compiler import UNSUPPORTED_FORMULA_MESSAGE, compile_generic_formula_spec
from app.model_components.formula_components import load_library_component, validate_component_definition
from app.model_draft import finalize_model_draft, normalize_component_model_package, normalize_generic_model_package
from app.problem_type_diagnosis import (
    infer_problem_type_from_component_spec,
    infer_problem_type_from_draft,
    validate_problem_type_override,
)
from app.schemas.model import AssetPackage, AssetView, ModelPackage, ModelView
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.function_asset_service import get_function_asset, validate_function_asset
from app.services.model_time_dimension_service import normalize_model_time_dimension_contract, validate_model_time_dimension_contract
from app.services.model_set_reference_validator import validate_set_references
from app.services.model_version_service import model_version_service
from app.solvers.solver_router import solver_router
from app.storage.memory_store import STORE
from app.templates.power_templates import power_template_library
from app.utils import has_pyomo, now_text, require_pyomo_for_publish


CALLABLE_STATUSES = {"published", "trial", "tested", "已发布", "试运行", "已测试"}
PUBLISHED_STATUSES = {"published", "已发布"}
LOGGER = logging.getLogger(__name__)


class ModelService:
    def create_model(self, model: ModelPackage) -> ModelView:
        model = self._normalize_component_model(model)
        model = self._normalize_generic_formula_model(model)
        model = self._apply_generalized_top_level_fields(model)
        model = self._normalize_time_dimension_contract(model)
        model_id = model.id or f"MODEL-{uuid.uuid4().hex[:8].upper()}"
        with STORE.lock:
            if model.id and model.id in STORE.models:
                raise HTTPException(status_code=409, detail=f"Model id already exists: {model.id}")
        model = self._prepare_version_identity(model)
        model = model.model_copy(update={"content_hash": self._content_hash(model)})
        warnings, dry_run_result = self._validate_model_package(model, require_publish_ready=model.status in CALLABLE_STATUSES)
        timestamp = now_text()
        view = ModelView(**model.model_dump(exclude={"id", "created_at", "updated_at", "validation_warnings", "dry_run_result"}), id=model_id, validation_warnings=warnings, dry_run_result=dry_run_result, created_at=model.created_at or timestamp, updated_at=model.updated_at or timestamp)
        with STORE.lock:
            self._validate_version_uniqueness_locked(view)
            STORE.models[model_id] = view
            self._record_model_version_locked(view)
            STORE.save_runtime()
        return view

    def list_models(self) -> list[ModelView]:
        with STORE.lock:
            return sorted(STORE.models.values(), key=lambda item: item.created_at, reverse=True)

    def list_model_versions(self, model_id: str) -> list[ModelView]:
        return model_version_service.list_versions(self.get_model(model_id))

    def create_model_version(self, model_id: str, overrides: dict[str, Any] | None = None) -> ModelView:
        with STORE.lock:
            source = self.get_model(model_id)
            package = model_version_service.new_version_package(source, overrides, STORE.models.values())
            return self.create_model(package)

    def get_model(self, model_id: str) -> ModelView:
        with STORE.lock:
            model = STORE.models.get(model_id)
        if not model:
            raise HTTPException(status_code=404, detail="Model not found")
        return model

    def update_model(self, model_id: str, model: ModelPackage) -> ModelView:
        existing = self.get_model(model_id)
        if existing.status in PUBLISHED_STATUSES:
            raise HTTPException(status_code=409, detail="Published model must be copied or taken offline before editing")
        model = self._normalize_component_model(model)
        model = self._normalize_generic_formula_model(model)
        model = self._apply_generalized_top_level_fields(model)
        model = self._normalize_time_dimension_contract(model)
        content_hash = self._content_hash(model)
        existing_hash = existing.content_hash or self._content_hash(ModelPackage.model_validate(existing.model_dump()))
        content_changed = content_hash != existing_hash
        warnings, dry_run_result = self._validate_model_package(model, require_publish_ready=model.status in CALLABLE_STATUSES)
        updated = ModelView(**model.model_dump(exclude={"id", "created_at", "updated_at", "published_at", "validation_warnings", "dry_run_result", "model_family_id", "supersedes_model_id", "is_active_version", "content_hash", "tested_content_hash", "tested_model_id", "tested_at", "status"}), id=model_id, model_family_id=existing.model_family_id, supersedes_model_id=existing.supersedes_model_id, is_active_version=existing.is_active_version, status="developing" if content_changed else existing.status, content_hash=content_hash, tested_content_hash=existing.tested_content_hash, tested_model_id=existing.tested_model_id, tested_at=existing.tested_at, validation_warnings=warnings, dry_run_result=dry_run_result if content_changed else existing.dry_run_result, created_at=existing.created_at, updated_at=now_text(), published_at=existing.published_at)
        with STORE.lock:
            STORE.models[model_id] = updated
            self._record_model_version_locked(updated)
            STORE.save_runtime()
        return updated

    def publish_model(self, model_id: str) -> ModelView:
        model = self.get_model(model_id)
        current_hash = self._content_hash(ModelPackage.model_validate(model.model_dump()))
        self._validate_publish_code_ownership(model)
        normalized_model = self._normalize_component_model(ModelPackage(**model.model_dump()))
        normalized_model = self._normalize_generic_formula_model(normalized_model)
        normalized_model = self._apply_generalized_top_level_fields(normalized_model)
        normalized_model = self._normalize_time_dimension_contract(normalized_model)
        diagnosis = self._diagnose_problem_type(normalized_model)
        if not diagnosis.get("publish_valid", True):
            problem_errors, _ = validate_problem_type_override(diagnosis)
            failed = model.model_copy(update={"status": "publish_failed", "updated_at": now_text()})
            with STORE.lock:
                STORE.models[model_id] = failed
                STORE.save_runtime()
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "problem type diagnosis does not allow publish",
                    "errors": problem_errors or [
                        {
                            "field": "problem_type_diagnosis",
                            "error": "publish_valid=false",
                            "actual": diagnosis.get("requested_problem_type"),
                            "expected": diagnosis.get("recommended_problem_type") or diagnosis.get("inferred_problem_type"),
                            "suggestion": "; ".join(diagnosis.get("warnings") or []) or "use the final backend diagnosis before publishing",
                        }
                    ],
                    "problem_type_diagnosis": diagnosis,
                },
            )
        semantic_content = {
            key: value
            for key, value in (normalized_model.semantic_spec or {}).items()
            if key not in {"ui_metadata", "time_dimension"} and value not in (None, {}, [], "")
        }
        draft_content = {
            key: value
            for key, value in (normalized_model.model_draft or {}).items()
            if key != "time_dimension" and value not in (None, {}, [], "")
        }
        has_model_definition = any(
            (
                semantic_content,
                normalized_model.generic_spec,
                normalized_model.component_spec,
                draft_content,
                normalized_model.mathematical_expansion,
            )
        )
        if has_model_definition:
            try:
                # Structural and semantic errors are intrinsic to a populated
                # model and must be reported before lifecycle state such as
                # "not tested".  This pass deliberately avoids the solver.
                self._validate_model_package(normalized_model, require_publish_ready=True, run_solver=False)
            except HTTPException:
                failed = model.model_copy(update={"status": "publish_failed", "updated_at": now_text()})
                with STORE.lock:
                    STORE.models[model_id] = failed
                    STORE.save_runtime()
                raise
        if model.tested_model_id and model.tested_model_id != model.id:
            raise HTTPException(status_code=409, detail={"code": "MODEL_TEST_MISMATCH", "message": "测试资产与发布资产不一致，请重新测试当前模型。"})
        if not model.tested_model_id or not model.tested_content_hash:
            raise HTTPException(status_code=409, detail={"code": "MODEL_NOT_TESTED", "message": "模型尚未通过测试，请先测试后再发布。"})
        if model.tested_content_hash != current_hash or model.status != "tested":
            raise HTTPException(status_code=409, detail={"code": "MODEL_TEST_OUTDATED", "message": "模型在测试通过后发生了修改，请重新测试后再发布。"})
        require_publish_ready = True
        try:
            warnings, dry_run_result = self._validate_model_package(normalized_model, require_publish_ready=require_publish_ready)
        except HTTPException as exc:
            failed = model.model_copy(update={"status": "publish_failed", "updated_at": now_text()})
            with STORE.lock:
                STORE.models[model_id] = failed
                STORE.save_runtime()
            raise
        published_at = now_text()
        published_draft = deepcopy(normalized_model.model_draft or {})
        published_formula_versions: dict[str, dict[str, Any]] = {}
        for formula in published_draft.get("formulas") or []:
            if not isinstance(formula, dict):
                continue
            state = deepcopy(formula.get("version_state") or {})
            revision = state.get("applied_revision") or state.get("current_revision") or 1
            state["published_revision"] = revision
            formula["version_state"] = state
            source_snapshot = deepcopy(formula.get("applied_version") or formula.get("last_compiled_version") or formula.get("last_saved_version") or {})
            source_snapshot.update({"revision": revision, "saved_at": published_at})
            formula["published_version"] = source_snapshot
            published_formula_versions[str(formula.get("formula_id") or formula.get("name") or len(published_formula_versions))] = state
        published_generic_spec = deepcopy(normalized_model.generic_spec or {})
        for artifact in published_generic_spec.get("formula_artifacts") or []:
            if not isinstance(artifact, dict):
                continue
            version = published_formula_versions.get(str(artifact.get("formula_id")))
            if version:
                artifact["version_state"] = deepcopy(version)
        updated = model.model_copy(
            update={
                **normalized_model.model_dump(exclude={"id", "created_at", "updated_at", "published_at", "status", "validation_warnings", "dry_run_result"}),
                "model_draft": published_draft,
                "generic_spec": published_generic_spec,
                "status": "published",
                "is_active_version": True,
                "published_by": normalized_model.published_by or (normalized_model.ui_metadata or {}).get("published_by") or "system",
                "published_at": published_at,
                "updated_at": published_at,
                "solver": diagnosis.get("recommended_solver") or normalized_model.solver,
                "problem_type": (dry_run_result.get("solver_check") or {}).get("problem_type") or normalized_model.problem_type,
                "model_problem_type": (dry_run_result.get("solver_check") or {}).get("problem_type") or normalized_model.model_problem_type,
                "validation_warnings": warnings,
                "dry_run_result": dry_run_result,
                "ui_metadata": {
                    **(normalized_model.ui_metadata or {}),
                    "publish_info": {
                        "status": "published",
                        "published_at": published_at,
                        "dry_run_status": dry_run_result.get("structure_check", {}).get("status", "passed"),
                    },
                    "version_info": self._model_version_info(normalized_model, dry_run_result),
                    "formula_versions": published_formula_versions,
                },
            }
        )
        with STORE.lock:
            for candidate_id, candidate in list(STORE.models.items()):
                if candidate_id == model_id or self._model_code(candidate) != self._model_code(updated):
                    continue
                if candidate.is_active_version:
                    inactive = candidate.model_copy(update={"is_active_version": False, "updated_at": now_text()})
                    STORE.models[candidate_id] = inactive
                    if candidate.model_family_id and STORE.active_model_versions.get(candidate.model_family_id) == candidate_id:
                        STORE.active_model_versions.pop(candidate.model_family_id, None)
                    self._record_model_version_locked(inactive)
            STORE.models[model_id] = updated
            STORE.active_model_versions[str(updated.model_family_id)] = model_id
            self._record_model_version_locked(updated)
            STORE.save_runtime()
        return updated

    def offline_model(self, model_id: str) -> ModelView:
        model = self.get_model(model_id)
        updated = model.model_copy(update={"status": "offline", "is_active_version": False, "updated_at": now_text()})
        with STORE.lock:
            STORE.models[model_id] = updated
            if updated.model_family_id and STORE.active_model_versions.get(updated.model_family_id) == model_id:
                STORE.active_model_versions.pop(updated.model_family_id, None)
            self._record_model_version_locked(updated)
            STORE.save_runtime()
        return updated

    def delete_model(self, model_id: str) -> dict[str, str]:
        model = self.get_model(model_id)
        if model.published_at:
            raise HTTPException(status_code=409, detail="Published model versions are historical records and cannot be deleted")
        with STORE.lock:
            if model_id not in STORE.models:
                raise HTTPException(status_code=404, detail="Model not found")
            removed = STORE.models.pop(model_id)
            family_id = str(removed.model_family_id or "")
            if family_id and STORE.active_model_versions.get(family_id) == model_id:
                STORE.active_model_versions.pop(family_id, None)
            if family_id:
                STORE.model_versions[family_id] = [item for item in STORE.model_versions.get(family_id, []) if item.get("model_id") != model_id]
            STORE.save_runtime()
        return {"id": model_id, "status": "deleted"}

    def copy_model(self, model_id: str) -> ModelView:
        model = self.get_model(model_id)
        copied = ModelPackage(**model.model_dump(exclude={
            "id", "created_at", "updated_at", "published_at", "model_family_id",
            "supersedes_model_id", "is_active_version", "published_by", "tested_at",
            "content_hash", "tested_content_hash", "tested_model_id", "validation_warnings",
            "dry_run_result",
        }))
        new_code = self._custom_model_code(model)
        copied.name = f"{model.name}-copy"
        copied.version = f"{model.version}-copy"
        copied.status = "developing"
        copied.tested_at = None
        copied.content_hash = None
        copied.tested_content_hash = None
        copied.tested_model_id = None
        copied.validation_warnings = []
        copied.dry_run_result = {}
        copied.ui_metadata = {
            key: value
            for key, value in (copied.ui_metadata or {}).items()
            if key not in {
                "supersedes_model_id", "model_family_id", "publish_info", "version_info",
                "managed_default_template", "managed_template_version",
            }
        }
        copied.template_id = new_code
        self._replace_model_code(copied.semantic_spec, new_code)
        self._replace_model_code(copied.component_spec, new_code)
        nested_component = (copied.semantic_spec or {}).get("component_spec")
        if isinstance(nested_component, dict):
            self._replace_model_code(nested_component, new_code)
        draft_basic = (copied.model_draft or {}).get("basic_info")
        if isinstance(draft_basic, dict):
            draft_basic["model_code"] = new_code
        draft_advanced_component = ((copied.model_draft or {}).get("advanced") or {}).get("component_spec")
        if isinstance(draft_advanced_component, dict):
            self._replace_model_code(draft_advanced_component, new_code)
        return self.create_model(copied)

    def find_model_by_code(self, model_code: str) -> ModelView:
        return self.resolve_model(model_code=model_code)

    def resolve_model(self, model_id: str | None = None, model_code: str | None = None, require_published: bool = True) -> ModelView:
        if model_id:
            model = self.get_model(model_id)
            if require_published and model.status not in CALLABLE_STATUSES:
                raise HTTPException(status_code=409, detail=f"Model is not callable in status: {model.status}")
            return model
        if not model_code:
            raise HTTPException(status_code=422, detail="model_id or model_code is required")
        candidates = self.find_models_by_code(model_code)
        if require_published:
            candidates = [model for model in candidates if model.status in CALLABLE_STATUSES]
        if not candidates:
            raise HTTPException(status_code=404, detail=f"Model code not found: {model_code}")
        return self._choose_model_for_code(model_code, candidates)

    def find_models_by_code(self, model_code: str) -> list[ModelView]:
        with STORE.lock:
            models = list(STORE.models.values())
        return [
            model
            for model in models
            if model.template_id == model_code
            or (model.semantic_spec or {}).get("model_code") == model_code
            or (model.component_spec or {}).get("model_code") == model_code
        ]

    def model_code_resolution_warning(self, model_code: str, resolved_model: ModelView) -> str | None:
        candidates = self.find_models_by_code(model_code)
        if len(candidates) <= 1:
            return None
        return (
            f"存在多个 model_code={model_code} 的模型，当前优先调用 {resolved_model.id}。"
            "建议生产调用显式传入 model_id。"
        )

    def _is_template_backed_model(self, model: ModelPackage | ModelView) -> bool:
        semantic = model.semantic_spec or {}
        template_id = model.template_id or semantic.get("model_code") or semantic.get("code")
        return bool(template_id and template_id in power_template_library() and not model.generic_spec)

    def _is_known_template_model(self, model: ModelPackage | ModelView) -> bool:
        semantic = model.semantic_spec or {}
        template_id = model.template_id or semantic.get("model_code") or semantic.get("code")
        return bool(template_id and template_id in power_template_library())

    def _is_component_based_model(self, model: ModelPackage | ModelView) -> bool:
        semantic = model.semantic_spec or {}
        component_spec = model.component_spec or semantic.get("component_spec") or {}
        return bool(
            model.build_mode == "component_based"
            or semantic.get("build_mode") == "component_based"
            or component_spec.get("build_mode") == "component_based"
            or component_spec.get("components")
        )

    def _normalize_component_model(self, model: ModelPackage) -> ModelPackage:
        if not self._is_component_based_model(model):
            return ModelPackage(**normalize_generic_model_package(model.model_dump()))
        data = normalize_component_model_package(model.model_dump())
        model = ModelPackage(**data)
        semantic = deepcopy(model.semantic_spec or {})
        component_spec = deepcopy(model.component_spec or semantic.get("component_spec") or {})
        semantic["build_mode"] = "component_based"
        if component_spec:
            component_spec["build_mode"] = "component_based"
            semantic["component_spec"] = component_spec
        return model.model_copy(update={"build_mode": "component_based", "semantic_spec": semantic, "component_spec": component_spec})

    def _normalize_generic_formula_model(self, model: ModelPackage) -> ModelPackage:
        if self._is_component_based_model(model) or not model.generic_spec:
            return model
        generic_spec = compile_generic_formula_spec(model.generic_spec, model.semantic_spec or {})
        semantic = deepcopy(model.semantic_spec or {})
        semantic["generic_spec"] = deepcopy(generic_spec)
        return model.model_copy(update={"generic_spec": generic_spec, "semantic_spec": semantic})

    def _apply_generalized_top_level_fields(self, model: ModelPackage) -> ModelPackage:
        draft = model.model_draft or {}
        component_spec = model.component_spec or (model.semantic_spec or {}).get("component_spec") or {}
        strategy = draft.get("objective_strategy") or component_spec.get("objective_strategy") or {}
        objective = model.objective
        ui_metadata = deepcopy(model.ui_metadata or {})
        if strategy.get("summary") and strategy.get("status") == "generated":
            objective = strategy["summary"]
        elif objective == "total_cost_min":
            ui_metadata["legacy_objective_code"] = objective
            objective = None
        time_granularity = model.time_granularity
        if not self._model_has_time_set(model):
            if time_granularity:
                ui_metadata.setdefault("template_hint", {})["time_granularity"] = time_granularity
            time_granularity = None
        parameter_bindings = self._collect_parameter_bindings(model)
        parameter_schema = deepcopy(model.parameter_schema or {})
        input_contract = deepcopy(model.input_contract or {})
        if parameter_bindings:
            parameter_schema["parameter_bindings"] = deepcopy(parameter_bindings)
            input_contract["parameter_bindings"] = [
                {"parameter": item.get("parameter") or item.get("parameter_code") or item.get("code"), "required": bool(item.get("required", False))}
                for item in parameter_bindings
            ]
        return model.model_copy(update={"objective": objective, "time_granularity": time_granularity, "ui_metadata": ui_metadata, "parameter_bindings": parameter_bindings, "parameter_schema": parameter_schema, "input_contract": input_contract})

    def _normalize_time_dimension_contract(self, model: ModelPackage) -> ModelPackage:
        return normalize_model_time_dimension_contract(model)

    def _collect_parameter_bindings(self, model: ModelPackage | ModelView) -> list[dict[str, Any]]:
        rows = []
        for source in (
            model.parameter_bindings,
            (model.component_spec or {}).get("parameter_bindings"),
            (model.semantic_spec or {}).get("parameter_bindings"),
            ((model.semantic_spec or {}).get("component_spec") or {}).get("parameter_bindings"),
        ):
            for item in source or []:
                if isinstance(item, dict):
                    rows.append(deepcopy(item))
        return rows

    def _model_has_time_set(self, model: ModelPackage | ModelView) -> bool:
        candidates = []
        semantic = model.semantic_spec or {}
        component_spec = model.component_spec or semantic.get("component_spec") or {}
        draft = model.model_draft or {}
        candidates.extend(semantic.get("sets") or [])
        candidates.extend(component_spec.get("sets") or [])
        candidates.extend(((draft.get("semantic") or {}).get("sets") or []))
        for item in candidates:
            code = str(item.get("code") or item.get("key") or "")
            if code == "time" or item.get("type") in {"time_period", "state_time"}:
                return True
        return False

    def _choose_model_for_code(self, model_code: str, candidates: list[ModelView]) -> ModelView:
        def score(model: ModelView) -> tuple[int, int, int, str, str]:
            active_score = 1 if model.is_active_version or STORE.active_model_versions.get(str(model.model_family_id)) == model.id else 0
            user_score = 0 if self._is_managed_default(model) else 1
            status_score = {"published": 4, "tested": 3, "trial": 2, "developing": 1}.get(str(model.status), 0)
            return (active_score, user_score, status_score, str(model.published_at or model.updated_at or model.created_at or ""), model.id)

        return sorted(candidates, key=score, reverse=True)[0]

    def _prepare_version_identity(self, model: ModelPackage) -> ModelPackage:
        metadata = model.ui_metadata or {}
        supersedes_id = model.supersedes_model_id or metadata.get("supersedes_model_id")
        source = None
        if supersedes_id:
            source = self.get_model(str(supersedes_id))
            if self._model_code(source) != self._model_code(model):
                raise HTTPException(status_code=409, detail="New version must preserve model_code")
        with STORE.lock:
            family_models = list(STORE.models.values())
        return model_version_service.prepare_identity(model, source, family_models)

    def _validate_version_uniqueness_locked(self, model: ModelView) -> None:
        family_id = str(model.model_family_id or f"legacy-{model.id}")
        for candidate in STORE.models.values():
            candidate_family = str(candidate.model_family_id or f"legacy-{candidate.id}")
            if candidate.id != model.id and candidate_family == family_id and candidate.version == model.version:
                raise HTTPException(status_code=409, detail={"code": "MODEL_VERSION_CONFLICT", "message": "同一模型家族中版本号必须唯一。"})

    def _content_hash(self, model: ModelPackage | ModelView) -> str:
        payload = model.model_dump(
            mode="json",
            exclude={
                "id", "status", "model_family_id", "supersedes_model_id", "is_active_version",
                "published_by", "published_at", "tested_at", "created_at", "updated_at",
                "validation_warnings", "dry_run_result", "content_hash", "tested_content_hash", "tested_model_id",
            },
        )
        metadata = deepcopy(payload.get("ui_metadata") or {})
        for key in ("publish_info", "test_result", "version_info"):
            metadata.pop(key, None)
        payload["ui_metadata"] = metadata
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _validate_publish_code_ownership(self, model: ModelView) -> None:
        model_version_service.validate_publish_code_ownership(
            model,
            self.find_models_by_code(self._model_code(model)),
            is_builtin=self._is_managed_default,
        )

    def _record_model_version_locked(self, model: ModelView) -> None:
        model_version_service.record_locked(model, self._model_code(model))

    def _model_code(self, model: ModelPackage | ModelView) -> str:
        semantic = model.semantic_spec or {}
        component = model.component_spec or {}
        return str(semantic.get("model_code") or semantic.get("code") or component.get("model_code") or model.template_id or model.id or "")

    def _is_managed_default(self, model: ModelPackage | ModelView) -> bool:
        return bool((model.ui_metadata or {}).get("managed_default_template"))

    def _custom_model_code(self, model: ModelView) -> str:
        semantic = model.semantic_spec or {}
        component = model.component_spec or {}
        base = str(semantic.get("model_code") or component.get("model_code") or model.template_id or model.id)
        if "_custom_" in base:
            base = base.split("_custom_", 1)[0]
        return f"{base}_custom_{uuid.uuid4().hex[:4]}"

    def _replace_model_code(self, spec: dict[str, Any], new_code: str) -> None:
        if not spec:
            return
        spec["model_code"] = new_code
        if "code" in spec:
            spec["code"] = new_code

    def schema(self, model_id: str) -> dict[str, Any]:
        model = self.get_model(model_id)
        return {
            "model_id": model.id,
            "template_id": model.template_id,
            "problem_type": model.problem_type,
            "build_mode": model.build_mode,
            "model_problem_type": model.model_problem_type,
            "required_solver_capabilities": model.required_solver_capabilities,
            "inferred_problem_type": (model.model_draft or {}).get("inferred_problem_type") or (model.component_spec or {}).get("inferred_problem_type"),
            "problem_type_diagnosis": (model.model_draft or {}).get("problem_type_diagnosis") or (model.component_spec or {}).get("problem_type_diagnosis") or {},
            "component_schema": model.component_schema,
            "ui_metadata": model.ui_metadata,
            "semantic_schema": model.semantic_spec,
            "parameter_schema": model.parameter_schema,
            "input_contract": model.input_contract,
            "output_contract": model.output_contract,
        }

    def asset_detail(self, model_id: str) -> dict[str, Any]:
        model = self.get_model(model_id)
        invocations = []
        with STORE.lock:
            records = list(STORE.invocations.values())
            tasks = list(STORE.tasks.values())
        for record in records:
            if record.get("model_id") == model_id:
                invocations.append(record)
        recent_tasks = [
            {
                "task_id": task.id,
                "status": task.status,
                "objective_value": (task.result or {}).get("objective_value") if task.result else None,
                "duration_seconds": task.duration_seconds,
                "error": task.error,
                "created_at": task.created_at,
                "finished_at": task.finished_at,
                "logs": task.logs[-20:],
                "source": "API/Skill/Agent",
            }
            for task in tasks
            if task.request.model_id == model_id
        ]
        skill_name = f"run_{str(model.template_id or model.id).lower().replace('-', '_').replace(' ', '_')}"
        return {
            "basic_info": {
                "id": model.id,
                "name": model.name,
                "scene": model.scene,
                "version": model.version,
                "status": model.status,
                "solver": model.solver,
                "build_mode": model.build_mode,
                "problem_type": model.problem_type,
            },
            "semantic_spec": model.semantic_spec,
            "model_draft": model.model_draft,
            "component_spec": model.component_spec,
            "generic_spec": model.generic_spec,
            "constraints": model.draft_constraints or model.constraints,
            "objective": model.objective_config or {"code": model.objective},
            "mathematical_expansion": model.mathematical_expansion,
            "parameters": model.parameters,
            "parameter_schema": model.parameter_schema,
            "component_schema": model.component_schema,
            "ui_metadata": model.ui_metadata,
            "publish_info": {
                "status": model.status,
                "published_at": model.published_at,
                "tested_at": model.tested_at,
                "dry_run_result": model.dry_run_result,
                **((model.ui_metadata or {}).get("publish_info") or {}),
            },
            "skill_info": {
                "skill_name": skill_name,
                "model_id": model.id,
                "model_version": model.version,
                "mathematical_expansion": model.mathematical_expansion,
            },
            "test_result": model.dry_run_result,
            "version_info": (model.ui_metadata or {}).get("version_info") or self._model_version_info(model, model.dry_run_result),
            "recent_invocations": sorted(invocations, key=lambda item: str(item.get("created_at", "")), reverse=True)[:10],
            "recent_tasks": sorted(recent_tasks, key=lambda item: str(item.get("created_at", "")), reverse=True)[:10],
        }

    def create_asset(self, asset: AssetPackage) -> AssetView:
        asset_id = asset.id or f"ASSET-{uuid.uuid4().hex[:8].upper()}"
        view = AssetView(**asset.model_dump(exclude={"id", "created_at"}), id=asset_id, created_at=asset.created_at or now_text())
        with STORE.lock:
            STORE.assets[asset_id] = view
            STORE.save_runtime()
        return view

    def list_assets(self) -> list[AssetView]:
        with STORE.lock:
            return sorted(STORE.assets.values(), key=lambda item: item.created_at, reverse=True)

    def run_model_test_case(self, model_id: str, test_case: dict[str, Any]) -> ModelView:
        model = self.get_model(model_id)
        params = test_case.get("parameters") if "parameters" in test_case else test_case
        if not isinstance(params, dict) or not params:
            params = self._default_test_parameters(model)
        if not isinstance(params, dict) or not params:
            raise HTTPException(status_code=422, detail={"message": "test_case.parameters is required", "errors": [{"field": "test_case.parameters", "error": "missing"}]})
        dry_run_result = self._dry_run_model(model, test_parameters=params, run_solver=True)
        if dry_run_result["structure_check"]["status"] != "passed" or dry_run_result["solver_check"]["status"] != "passed":
            raise HTTPException(status_code=422, detail={"message": "模型测试用例执行失败", **dry_run_result})
        content_hash = self._content_hash(ModelPackage.model_validate(model.model_dump()))
        updated = model.model_copy(update={"status": "tested", "content_hash": content_hash, "tested_content_hash": content_hash, "tested_model_id": model.id, "updated_at": now_text(), "tested_at": now_text(), "dry_run_result": dry_run_result, "validation_warnings": dry_run_result["solver_check"].get("warnings", [])})
        with STORE.lock:
            STORE.models[model_id] = updated
            self._record_model_version_locked(updated)
            STORE.save_runtime()
        return updated

    def _default_test_parameters(self, model: ModelPackage | ModelView) -> dict[str, Any]:
        semantic = deepcopy(model.semantic_spec or {})
        draft = deepcopy(model.model_draft or {})
        component_spec = deepcopy(model.component_spec or semantic.get("component_spec") or {})
        parameters = {
            **(semantic.get("sample_runtime_parameters") or {}),
            **((draft.get("runtime_parameters") or {}) if isinstance(draft, dict) else {}),
            **(model.parameters or {}),
        }
        if component_spec:
            parameters["semantic_spec"] = {
                **semantic,
                "build_mode": "component_based",
                "component_spec": component_spec,
            }
            self._fill_component_dry_parameters(parameters, component_spec)
            self._normalize_component_dry_parameters(parameters, str(component_spec.get("model_code") or semantic.get("model_code") or ""))
            parameters.pop("semantic_spec", None)
        return parameters

    def _validate_model_package(
        self,
        model: ModelPackage,
        require_publish_ready: bool = False,
        *,
        run_solver: bool | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        solver_required = require_publish_ready if run_solver is None else run_solver
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        dry_run_result: dict[str, Any] = {}
        semantic_spec = model.semantic_spec or {}
        generic_spec = model.generic_spec or {}
        is_component_model = self._is_component_based_model(model)
        time_errors, time_warnings = validate_model_time_dimension_contract(model, require_publish_ready)
        errors.extend(time_errors)
        warnings.extend(time_warnings)
        errors.extend(validate_set_references(
            semantic_spec=semantic_spec,
            component_spec=model.component_spec or semantic_spec.get("component_spec") or {},
            generic_spec=generic_spec or semantic_spec.get("generic_spec") or {},
            model_draft=model.model_draft,
            parameter_schema=model.parameter_schema,
            input_contract=model.input_contract,
            output_contract=model.output_contract,
        ))
        if (semantic_spec or generic_spec) and not is_component_model:
            errors.extend(RuntimeParameterValidator().validate_semantic_and_generic(semantic_spec, generic_spec))
        component_spec_for_objective = model.component_spec or semantic_spec.get("component_spec") or {}
        errors.extend(self._validate_component_objective_terms(component_spec_for_objective))
        diagnosis = self._diagnose_problem_type(model)
        problem_errors, problem_warnings = validate_problem_type_override(diagnosis)
        if require_publish_ready:
            errors.extend(problem_errors)
            errors.extend(self._validate_nonlinear_publish_readiness(diagnosis))
        warnings.extend(problem_warnings)
        if require_publish_ready:
            component_spec = model.component_spec or semantic_spec.get("component_spec") or {}
            is_component_based = self._is_component_based_model(model)
            is_template_backed = self._is_known_template_model(model)
            has_function_binding_errors = False
            if not any(semantic_spec.get(section) for section in ("sets", "parameters", "variables", "constraints", "objectives")):
                errors.append({"field": "semantic_spec", "error": "semantic_spec is required before publish"})
            errors.extend(self._validate_required_parameter_bindings(model))
            if is_component_based and not component_spec:
                errors.append({"field": "component_spec", "error": "component_spec is required before publish"})
            if is_component_based:
                errors.extend(self._validate_component_sets(model))
                function_errors, function_warnings = self._validate_function_asset_bindings(component_spec)
                has_function_binding_errors = bool(function_errors)
                errors.extend(function_errors)
                warnings.extend(function_warnings)
                if not (component_spec.get("variables") or []):
                    errors.append({"field": "component_spec.variables", "error": "variables are required before publish"})
                if not (component_spec.get("components") or []):
                    errors.append({"field": "component_spec.components", "error": "组件清单为空", "suggestion": "请先加载或配置组件清单"})
                if not ((component_spec.get("objective") or {}).get("terms") or []):
                    errors.append({"field": "component_spec.objective.terms", "error": "目标函数为空", "suggestion": "请至少启用一个已实现目标项"})
                objective_mode_error = self._validate_component_objective_publish_mode(component_spec, model)
                if objective_mode_error:
                    errors.append(objective_mode_error)
                if not model.mathematical_expansion:
                    errors.append({"field": "mathematical_expansion", "error": "数学展开未生成", "suggestion": "请从 Model Draft 重新生成数学展开"})
                errors.extend(self._validate_component_library_references(component_spec))
                errors.extend(self._validate_component_dependency_integrity(component_spec))
            errors.extend(self._validate_generic_formula_compile_status(generic_spec))
            if not is_component_based and not is_template_backed and not generic_spec:
                errors.append({"field": "generic_spec", "error": "generic_spec is required before publish"})
            if not is_component_based and not is_template_backed and not (generic_spec.get("variables") or []):
                errors.append({"field": "generic_spec.variables", "error": "variables are required before publish"})
            if not is_component_based and not is_template_backed and not ((generic_spec.get("objective") or {}).get("terms") or []):
                errors.append({"field": "generic_spec.objective.terms", "error": "objective terms are required before publish"})
            if not has_function_binding_errors:
                dry_run_result = self._dry_run_model(model, run_solver=solver_required)
                dry_run_result["problem_type_diagnosis"] = diagnosis
                if dry_run_result["structure_check"]["status"] == "failed":
                    errors.extend(dry_run_result["structure_check"].get("errors", []))
                if solver_required and dry_run_result["solver_check"]["status"] != "passed":
                    solver_warnings = dry_run_result["solver_check"].get("warnings", [])
                    errors.extend(solver_warnings or [{"field": "solver_check", "error": "solver dry-run did not pass", "actual": dry_run_result["solver_check"].get("status")}])
                warnings.extend(dry_run_result["solver_check"].get("warnings", []))
        if errors:
            raise HTTPException(status_code=422, detail={"message": "模型发布失败" if require_publish_ready else "模型校验失败", "errors": self._structured_publish_errors(errors), "warnings": warnings, "dry_run_result": dry_run_result})
        return warnings, dry_run_result

    def _validate_required_parameter_bindings(self, model: ModelPackage | ModelView) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        for index, binding in enumerate(self._collect_parameter_bindings(model)):
            if binding.get("required") is not True:
                continue
            target = binding.get("source") or binding.get("source_path") or binding.get("runtime_key") or binding.get("value")
            if target in (None, "", []):
                errors.append(
                    {
                        "field": f"parameter_bindings[{index}]",
                        "error": "required parameter binding is missing",
                        "parameter": binding.get("parameter") or binding.get("parameter_code") or binding.get("code"),
                        "suggestion": "bind all required component parameters before publishing",
                    }
                )
        return errors

    def _validate_nonlinear_publish_readiness(self, diagnosis: dict[str, Any]) -> list[dict[str, Any]]:
        report = diagnosis.get("nonlinear_diagnostics") or {}
        errors: list[dict[str, Any]] = []
        inferred = str(diagnosis.get("inferred_problem_type") or "").upper()
        solver_name = str(diagnosis.get("recommended_solver") or diagnosis.get("solver") or "")
        if inferred == "NLP" and solver_name.lower() == "ipopt":
            from app.solvers.nlp_adapter import NLPSolverAdapter

            if NLPSolverAdapter().available():
                return []
            return [
                {
                    "field": "solver.ipopt",
                    "error": "Ipopt executable not found. NLP solving is unavailable.",
                    "actual": "unavailable",
                    "expected": "Pyomo SolverFactory('ipopt').available() == true",
                    "suggestion": "请安装 Ipopt，或使用 McCormick、1D/2D PWL 等线性化策略。",
                }
            ]
        for index, item in enumerate(report.get("blocking_items") or []):
            errors.append(
                {
                    "field": item.get("source") or f"nonlinear_diagnostics.relationships[{index}]",
                    "error": item.get("message") or "unconverted nonlinear expression blocks publish",
                    "actual": item.get("expression"),
                    "expected": ", ".join(item.get("recommended_strategy") or []),
                    "suggestion": "请选择 McCormick 松弛、1D/2D PWL，或标记为 NLP/MINLP 预留；不要交给 HiGHS 静默求解。",
                    "nonlinear_type": item.get("nonlinear_type"),
                    "involved_variables": item.get("involved_variables"),
                }
            )
        for index, item in enumerate(report.get("relationships") or []):
            if item.get("nonlinear_type") == "bilinear" and not item.get("supported_by_current_solver") and item.get("converted") is False:
                continue
            if item.get("nonlinear_type") == "bilinear" and item.get("converted") is False and "mccormick" in " ".join(item.get("recommended_strategy") or []):
                errors.append(
                    {
                        "field": item.get("source") or f"nonlinear_diagnostics.relationships[{index}]",
                        "error": "McCormick relaxation requires finite lower/upper bounds for x and y",
                        "actual": item.get("expression"),
                        "suggestion": "补齐 x_lower/x_upper/y_lower/y_upper 后再发布。",
                    }
                )
        return errors

    def _validate_generic_formula_compile_status(self, generic_spec: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        if not generic_spec:
            return errors
        for index, constraint in enumerate(generic_spec.get("constraints") or []):
            if constraint.get("compile_status") in {"unsupported", "compile_failed"}:
                errors.append({"field": f"generic_spec.constraints[{index}].formula", "error": UNSUPPORTED_FORMULA_MESSAGE, "actual": constraint.get("compile_error")})
        for index, term in enumerate((generic_spec.get("objective") or {}).get("terms") or []):
            if term.get("compile_status") in {"unsupported", "compile_failed"}:
                errors.append({"field": f"generic_spec.objective.terms[{index}].formula", "error": UNSUPPORTED_FORMULA_MESSAGE, "actual": term.get("compile_error")})
        objective = generic_spec.get("objective") or {}
        if (objective.get("terms") or []) and str(objective.get("sense") or generic_spec.get("sense") or "") not in {"minimize", "maximize"}:
            errors.append({"field": "generic_spec.objective.sense", "error": "参与求解的目标方向必须显式配置为 minimize 或 maximize", "actual": objective.get("sense") or generic_spec.get("sense")})
        return errors

    def _diagnose_problem_type(self, model: ModelPackage | ModelView) -> dict[str, Any]:
        draft = deepcopy(model.model_draft or {})
        if draft:
            basic = draft.setdefault("basic_info", {})
            basic.setdefault("solver", model.solver)
            basic.setdefault("problem_type", model.model_problem_type or model.problem_type)
            return infer_problem_type_from_draft(draft, model.solver)
        component_spec = deepcopy(model.component_spec or (model.semantic_spec or {}).get("component_spec") or {})
        if component_spec:
            solver_for_diagnosis = model.solver
            if str(solver_for_diagnosis or "").lower() in {"", "highs"}:
                solver_for_diagnosis = None
            return infer_problem_type_from_component_spec(
                component_spec,
                solver_name=solver_for_diagnosis,
                requested_problem_type=model.model_problem_type or component_spec.get("model_problem_type") or model.problem_type,
            )
        return {
            "inferred_problem_type": model.model_problem_type or model.problem_type or "LP",
            "recommended_problem_type": model.model_problem_type or model.problem_type or "LP",
            "recommended_solver": "HiGHS",
            "requested_problem_type": model.model_problem_type or model.problem_type or "LP",
            "effective_problem_type": model.model_problem_type or model.problem_type or "LP",
            "expression_class": "linear",
            "has_integer_variables": False,
            "variable_types": ["continuous"],
            "solver": model.solver,
            "solver_supported": True,
            "solver_supported_problem_types": [],
            "reasons": ["非组件化模型沿用已声明的问题类型"],
            "warnings": [],
            "function_assets_used": [],
            "linearization_strategy": [],
            "nonlinear_diagnostics": {"count": 0, "relationships": [], "blocking_items": [], "warning_items": [], "has_blocking_nonlinearity": False, "converted_count": 0},
            "publish_valid": True,
        }

    def _validate_component_sets(self, model: ModelPackage | ModelView) -> list[dict[str, Any]]:
        draft = deepcopy(model.model_draft or {})
        if not draft:
            draft = {
                "semantic": deepcopy(model.semantic_spec or {}),
                "components": deepcopy((model.component_spec or {}).get("components") or []),
                "objective": deepcopy((model.component_spec or {}).get("objective") or {}),
                "constraints": deepcopy((model.component_spec or {}).get("additional_custom_constraints") or []),
            }
        finalize_model_draft(draft)
        sets = (draft.get("semantic") or {}).get("sets") or []
        by_code = {str(item.get("code") or item.get("key")): item for item in sets}
        runtime_params = model.parameters or (model.model_draft or {}).get("runtime_parameters") or {}
        errors: list[dict[str, Any]] = []
        for item in sets:
            code = str(item.get("code") or item.get("key") or "")
            runtime_members = runtime_params.get(code)
            if not item.get("configured") and isinstance(runtime_members, list) and runtime_members:
                item["members"] = runtime_members
                item["values"] = runtime_members
                item["configured"] = True
            if item.get("type") == "time_period":
                self._complete_time_period_from_runtime(item, runtime_params)
                if item.get("time_granularity") is None and not self._is_known_template_model(model) and (item.get("members") or item.get("values")):
                    item["time_granularity"] = 60
                    item.setdefault("time_unit", "minute")
                    item["delta_t"] = 1
                    item["delta_t_unit"] = "hour"
                    item["configured"] = True
            if item.get("type") == "state_time" and not item.get("configured"):
                base = by_code.get(str(item.get("base_set") or "time")) or {}
                base_members = base.get("members") or base.get("values") or []
                if base_members and item.get("generation_rule") == "horizon_plus_1":
                    item["members"] = list(range(len(base_members) + 1))
                    item["values"] = item["members"]
                    item["configured"] = True
            if item.get("conflicts"):
                errors.append({"field": f"semantic.sets.{code}", "error": "set type conflict", "actual": item.get("conflicts"), "suggestion": "请统一组件 required_sets 与模型语义中的集合类型。"})
            if item.get("required") and not item.get("configured"):
                errors.append({"field": f"semantic.sets.{code}", "error": "required set is not configured", "expected": "members or generation rule configured", "actual": None})
            if item.get("type") == "time_period":
                if item.get("horizon") is None or item.get("time_granularity") is None:
                    errors.append({"field": f"semantic.sets.{code}", "error": "time_period set requires horizon and time_granularity", "expected": ["horizon", "time_granularity"], "actual": item})
                if item.get("delta_t") is None and item.get("time_granularity") is not None:
                    errors.append({"field": f"semantic.sets.{code}.delta_t", "error": "delta_t is not generated", "expected": "generated from time_granularity", "actual": None})
            if item.get("type") == "state_time":
                base_code = str(item.get("base_set") or "")
                if not base_code or base_code not in by_code:
                    errors.append({"field": f"semantic.sets.{code}.base_set", "error": "state_time base_set is missing", "expected": sorted(by_code), "actual": base_code})
        errors.extend(self._validate_formula_set_relations(draft, by_code))
        return errors

    def _complete_time_period_from_runtime(self, item: dict[str, Any], runtime_params: dict[str, Any]) -> None:
        try:
            horizon = int(item.get("horizon") or runtime_params.get("horizon") or 0)
        except (TypeError, ValueError):
            horizon = 0
        granularity = item.get("time_granularity")
        if granularity is None and runtime_params.get("time_granularity") is not None:
            granularity = runtime_params.get("time_granularity")
        if granularity is None and runtime_params.get("time_step_seconds") is not None:
            try:
                granularity = float(runtime_params["time_step_seconds"]) / 60
            except (TypeError, ValueError):
                granularity = None
        if granularity is None and runtime_params.get("delta_t") is not None:
            try:
                granularity = float(runtime_params["delta_t"]) * 60
            except (TypeError, ValueError):
                granularity = None
        if horizon > 0:
            item["horizon"] = horizon
            item["members"] = list(range(horizon))
            item["values"] = item["members"]
        if granularity is not None:
            item["time_granularity"] = granularity
            item.setdefault("time_unit", "minute")
            item["delta_t"] = float(granularity) / 60
            item["delta_t_unit"] = "hour"
        item["configured"] = bool(item.get("members") and item.get("horizon") is not None and item.get("time_granularity") is not None)

    def _validate_formula_set_relations(self, draft: dict[str, Any], sets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        constraints = []
        for component in draft.get("components") or []:
            definition = component.get("definition") or {}
            constraints.extend(definition.get("generated_constraints") or component.get("generated_constraints") or [])
        constraints.extend(draft.get("constraints") or [])
        state_sets = [item for item in sets.values() if item.get("type") == "state_time"]
        for index, constraint in enumerate(constraints):
            expression = str(constraint.get("expression") or constraint.get("formula") or "")
            field = f"constraints[{index}]"
            if "t+1" in expression.replace(" ", "") and not state_sets:
                errors.append({"field": field, "error": "t+1 requires a state_time set", "expected": "state_time with generation_rule=horizon_plus_1", "actual": expression})
            if "t-1" in expression.replace(" ", "") and str(constraint.get("boundary_strategy") or "") not in {"skip_first", "use_initial_value"}:
                errors.append({"field": f"{field}.boundary_strategy", "error": "t-1 requires boundary_strategy", "expected": ["skip_first", "use_initial_value"], "actual": constraint.get("boundary_strategy")})
        return errors

    def _structured_publish_errors(self, errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows = []
        for error in errors:
            message = error.get("message") or error.get("error") or error.get("actual") or "校验失败"
            rows.append(
                {
                    "code": error.get("code") or "VALIDATION_ERROR",
                    "field": error.get("field"),
                    "expected": error.get("expected"),
                    "actual": error.get("actual"),
                    **error,
                    "message": message,
                    "suggestion": error.get("suggestion") or error.get("expected") or self._suggestion_for_field(str(error.get("field", ""))),
                }
            )
        return rows

    def _validate_component_library_references(self, component_spec: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        for index, component in enumerate(component_spec.get("components") or []):
            component_type = str(component.get("type") or component.get("component_id") or "")
            if not component_type:
                errors.append({"field": f"component_spec.components[{index}]", "error": "component type is required"})
                continue
            inline_definition = component.get("definition") or {}
            if inline_definition:
                definition = {**inline_definition, "component_id": inline_definition.get("component_id") or component_type}
                validation = validate_component_definition(definition)
                if not validation["valid"]:
                    for item in validation["errors"]:
                        errors.append({"field": f"component_spec.components[{index}].{item['field']}", "error": item["message"], "suggestion": item.get("suggestion")})
                continue
            try:
                from app.model_components.registry import component_definition

                component_definition(component_type)
                continue
            except RuntimeError:
                definition = load_library_component(component_type)
            if not definition:
                errors.append({"field": f"component_spec.components[{index}]", "error": "组件不存在", "actual": component_type, "suggestion": "请先在组件库中创建并发布该组件。"})
                continue
            if definition.get("status") != "published":
                errors.append({"field": f"component_spec.components[{index}]", "error": "未发布组件不能用于发布模型", "actual": component_type, "suggestion": "请先完成组件发布校验。"})
            if definition.get("enabled", True) is False:
                errors.append({"field": f"component_spec.components[{index}]", "error": "停用组件不能用于发布模型", "actual": component_type, "suggestion": "请启用组件或从模型中移除。"})
            validation = validate_component_definition(definition)
            if not validation["valid"]:
                for item in validation["errors"]:
                    errors.append({"field": f"component_spec.components[{index}].{item['field']}", "error": item["message"], "suggestion": item.get("suggestion")})
        return errors

    def _validate_component_dependency_integrity(self, component_spec: dict[str, Any]) -> list[dict[str, Any]]:
        from app.model_components.registry import COMPONENT_DEPENDENCIES

        enabled = {
            str(item.get("type") or item.get("component_id") or item.get("code") or "")
            for item in component_spec.get("components") or []
            if item.get("enabled", True) is not False
        }
        errors: list[dict[str, Any]] = []
        for component_id in sorted(enabled):
            dependencies = set(COMPONENT_DEPENDENCIES.get(component_id, []))
            definition = load_library_component(component_id)
            if definition:
                dependencies.update(definition.get("depends_on") or [])
            for dependency in sorted(dependencies):
                if dependency and dependency not in enabled:
                    errors.append(
                        {
                            "field": "component_spec.components",
                            "error": "missing component dependency",
                            "component_id": component_id,
                            "missing_dependency": dependency,
                            "suggestion": f"add required component {dependency} before publishing",
                        }
                    )
        return errors

    def _suggestion_for_field(self, field: str) -> str:
        if "additional_custom_constraints" in field:
            return "请检查附加约束变量名、索引和表达式，仅支持简单边界表达式。"
        if "objective" in field:
            return "请启用已实现目标项，或将自定义目标项标注为 display_only。"
        if "components" in field:
            return "请先加载或配置组件清单。"
        return "请根据字段要求补齐模型资产信息后重新发布。"

    def _model_version_info(self, model: ModelPackage | ModelView, dry_run_result: dict[str, Any] | None = None) -> dict[str, Any]:
        component_versions = []
        for component in (model.component_spec or {}).get("components", []) or []:
            component_versions.append({"component_id": component.get("type") or component.get("component_id"), "version": component.get("version", "1.0.0")})
        return {
            "version": model.version,
            "created_at": model.created_at,
            "updated_at": model.updated_at,
            "published_at": model.published_at,
            "component_versions": component_versions,
            "parameter_schema_version": "1.0.0",
            "objective_version": "1.0.0",
            "dry_run_status": (dry_run_result or {}).get("structure_check", {}).get("status"),
        }

    def _dry_run_model(self, model: ModelPackage | ModelView, *, test_parameters: dict[str, Any] | None = None, run_solver: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "structure_check": {"status": "passed", "errors": []},
            "solver_check": {"status": "skipped", "warnings": []},
        }
        component_spec = model.component_spec or (model.semantic_spec or {}).get("component_spec") or {}
        is_component_based = self._is_component_based_model(model)
        is_template_backed = self._is_known_template_model(model)
        if not model.generic_spec and not (is_component_based and component_spec) and not is_template_backed:
            return result
        if not has_pyomo():
            level = "error" if require_pyomo_for_publish() else "warning"
            message = {"field": "environment.pyomo", "level": level, "error": "dependency missing, dry-run skipped" if level == "warning" else "dependency missing", "expected": "pyomo installed", "actual": "not installed"}
            if level == "error":
                result["structure_check"] = {"status": "failed", "errors": [message]}
            else:
                result["solver_check"]["warnings"].append(message)
            return result
        try:
            if is_component_based and component_spec:
                from app.builders.pyomo_builder import PyomoModelBuilder

                semantic = deepcopy(model.semantic_spec or {})
                semantic["build_mode"] = "component_based"
                semantic["component_spec"] = deepcopy(component_spec)
                dry_parameters = {
                    **(model.parameters or {}),
                    **(semantic.get("sample_runtime_parameters") or {}),
                    **(test_parameters or {}),
                    "semantic_spec": semantic,
                }
                self._fill_component_dry_parameters(dry_parameters, component_spec)
                self._normalize_component_dry_parameters(dry_parameters, str(component_spec.get("model_code") or semantic.get("model_code") or ""))
                pyomo_model, _ = PyomoModelBuilder().build(semantic, dry_parameters)
            elif is_template_backed and not model.generic_spec:
                from app.builders.pyomo_builder import PyomoModelBuilder

                semantic = deepcopy(model.semantic_spec or {})
                dry_parameters = {
                    **(model.parameters or {}),
                    **(semantic.get("sample_runtime_parameters") or {}),
                    **(test_parameters or {}),
                }
                dry_parameters.setdefault("model_code", model.template_id or semantic.get("model_code") or semantic.get("code"))
                pyomo_model, _ = PyomoModelBuilder().build(semantic, dry_parameters)
            else:
                dry_spec = deepcopy(model.generic_spec)
                dry_parameters = {
                    **self._build_dry_run_parameters(model.semantic_spec or {}, dry_spec),
                    **(dry_spec.get("parameters") or {}),
                    **(model.parameters or {}),
                    **(test_parameters or {}),
                }
                self._complete_generic_dry_parameters(dry_parameters, model.semantic_spec or {}, dry_spec)
                dry_spec["parameters"] = dry_parameters
                pyomo_model, _ = GenericLinearBuilder().build(dry_spec)
            if run_solver:
                problem_type = solver_router.infer_problem_type_from_model(pyomo_model)
                solver_result = solver_router.solve(pyomo_model, problem_type=problem_type, requested_solver=None)
                result["solver_check"] = {"status": "passed", "warnings": [], "objective_value": solver_result.objective_value, "solver_status": solver_result.status, "problem_type": problem_type}
        except Exception as exc:
            function_component_index = self._first_function_mapping_component_index(component_spec) if is_component_based else None
            field = (
                f"component_spec.components[{function_component_index}]"
                if function_component_index is not None
                else ("component_spec.additional_custom_constraints" if is_component_based else "generic_spec")
            )
            suggestion = (
                "请检查函数映射组件的 x/y 变量、索引集合、函数资产定义域和求解策略。"
                if function_component_index is not None
                else None
            )
            message = {"field": field, "level": "error", "error": "solver test failed" if run_solver else "dry run build failed", "actual": str(exc)}
            if suggestion:
                message["suggestion"] = suggestion
            if run_solver:
                result["solver_check"] = {"status": "failed", "warnings": [message]}
            else:
                result["structure_check"] = {"status": "failed", "errors": [message]}
        return result

    def _first_function_mapping_component_index(self, component_spec: dict[str, Any]) -> int | None:
        for index, component in enumerate(component_spec.get("components") or []):
            config = component.get("config") if isinstance(component.get("config"), dict) else {}
            component_type = str(component.get("type") or component.get("component_id") or config.get("type") or config.get("component_id") or "")
            if component_type in {"function_mapping_component", "piecewise_linear_curve", "function_mapping_2d_component"}:
                return index
        return None

    def _validate_function_asset_bindings(self, component_spec: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        variables = {
            str(item.get("code") or item.get("name") or item.get("key")): item
            for item in component_spec.get("variables") or []
        }
        for index, component in enumerate(component_spec.get("components") or []):
            component_type = str(component.get("type") or component.get("component_id") or "")
            if component_type not in {"function_mapping_component", "piecewise_linear_curve", "function_mapping_2d_component"}:
                continue
            config = component.get("config") if isinstance(component.get("config"), dict) else {}
            cfg = {**config, **component}
            function_id = str(cfg.get("function_asset_id") or cfg.get("curve_asset_id") or cfg.get("curve") or "")
            field = f"component_spec.components[{index}].function_asset_id"
            if not function_id:
                errors.append({"field": field, "error": "function_asset_id is required"})
                continue
            try:
                asset = get_function_asset(function_id)
            except RuntimeError as exc:
                errors.append({"field": field, "error": "function asset does not exist", "actual": function_id, "suggestion": str(exc)})
                continue
            validation = validate_function_asset(asset)
            if not validation["valid"]:
                errors.append(
                    {
                        "field": field,
                        "error": "function asset validation failed",
                        "actual": validation["errors"],
                        "suggestion": "请先修正函数/曲线资产断点、状态或绑定关系。",
                    }
                )
                continue
            is_2d = component_type == "function_mapping_2d_component" or asset.get("function_type") == "piecewise_2d"
            strategy = str(cfg.get("solve_strategy") or asset.get("solve_strategy") or ("triangulated_milp_exact" if is_2d else "convex_combination_lp"))
            if not cfg.get("x"):
                errors.append({"field": f"component_spec.components[{index}].x", "error": "x is required"})
            if not cfg.get("y"):
                errors.append({"field": f"component_spec.components[{index}].y", "error": "y is required"})
            if is_2d and not cfg.get("z"):
                errors.append({"field": f"component_spec.components[{index}].z", "error": "z is required"})
            supported_strategies = {"display_only", "triangulated_milp_exact", "convex_hull_lp_approx"} if is_2d else {"display_only", "segment_binary", "sos2", "convex_combination_lp", "binary_segment_milp"}
            if strategy not in supported_strategies:
                errors.append({"field": f"component_spec.components[{index}].solve_strategy", "error": "unsupported solve_strategy", "actual": strategy})
                continue
            if is_2d and asset.get("function_type") != "piecewise_2d":
                errors.append({"field": field, "error": "function_mapping_2d_component requires a piecewise_2d asset", "actual": asset.get("function_type")})
                continue
            asset_metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
            recommended = asset_metadata.get("recommended_bindings") or {}
            if is_2d and asset_metadata.get("binding_policy") == "exact_variable_code":
                for axis in ("x", "y", "z"):
                    expected = str(recommended.get(axis) or "")
                    actual = self._base_variable_name(str(cfg.get(axis) or ""))
                    if expected and actual and actual != expected:
                        errors.append(
                            {
                                "field": f"component_spec.components[{index}].{axis}",
                                "error": f"函数资产绑定变量不匹配：{axis} 应绑定 {expected}，当前为 {actual}",
                                "expected": expected,
                                "actual": actual,
                                "suggestion": "二维水电出力曲面的第一输入请绑定发电流量 q_gen，不要绑定包含弃水的 q_out。",
                            }
                        )
            y_var = self._base_variable_name(str(cfg.get("y") or ""))
            if y_var and y_var not in variables:
                row = {
                    "field": f"component_spec.components[{index}].y",
                    "level": "warning" if strategy == "display_only" else "error",
                    "error": f"输出变量 {y_var} 未在语义模型变量中定义，请先在 Step2 新增该变量，或选择已有变量。",
                    "actual": str(cfg.get("y") or ""),
                    "suggestion": "请先在 Step2 新增该变量，或选择已有变量。",
                }
                if strategy == "display_only":
                    warnings.append({**row, "message": row["error"]})
                else:
                    errors.append(row)
            if strategy == "binary_segment_milp":
                errors.append(
                    {
                        "field": f"component_spec.components[{index}].solve_strategy",
                        "error": "binary_segment_milp is reserved and cannot be published as a solvable model",
                        "actual": strategy,
                        "suggestion": "Use convex_combination_lp for the current LP approximation or display_only for diagnostics.",
                    }
                )
            if is_2d and strategy == "display_only":
                errors.append(
                    {
                        "field": f"component_spec.components[{index}].solve_strategy",
                        "error": "display_only cannot be published as a solve-active 2D function mapping",
                        "actual": strategy,
                        "suggestion": "Use triangulated_milp_exact for exact MILP solving, or remove the mapping from the published model.",
                    }
                )
            if is_2d and strategy == "convex_hull_lp_approx":
                warnings.append(
                    {
                        "field": f"component_spec.components[{index}].solve_strategy",
                        "level": "warning",
                        "message": "convex_hull_lp_approx is not exact for general 2D surfaces",
                        "actual": strategy,
                    }
                )
            if is_2d and strategy == "triangulated_milp_exact":
                triangle_count = int(validation["diagnostics"].get("triangle_count") or 0)
                if triangle_count > 400:
                    warnings.append({"field": f"component_spec.components[{index}].triangles", "level": "warning", "message": "2D PWL triangle count exceeds the default recommended limit", "actual": triangle_count, "expected": "<= 400"})
                z_var = self._base_variable_name(str(cfg.get("z") or ""))
                if z_var and z_var not in variables:
                    errors.append({"field": f"component_spec.components[{index}].z", "error": f"z variable {z_var} is not defined in component_spec.variables", "actual": str(cfg.get("z") or "")})
            if strategy == "convex_combination_lp" and validation["diagnostics"].get("convexity") in {"nonconvex", "unknown"}:
                warnings.append(
                    {
                        "field": f"component_spec.components[{index}].solve_strategy",
                        "level": "warning",
                        "message": "convex_combination_lp may allow convex combinations of non-adjacent breakpoints; results may not lie strictly on the original piecewise curve",
                        "actual": validation["diagnostics"].get("convexity"),
                        "suggestion": "declare a convex/concave curve shape or use binary_segment_milp when exact segment selection is required",
                    }
                )
            x_var = self._base_variable_name(str(cfg.get("x") or ""))
            domain = validation.get("domain") or asset.get("domain") or {}
            if x_var and x_var in variables and domain:
                variable = variables[x_var]
                lower = self._numeric_bound(variable.get("lower_bound", variable.get("lb")))
                upper = self._numeric_bound(variable.get("upper_bound", variable.get("ub")))
                x_min = self._numeric_bound(domain.get("x_min"))
                x_max = self._numeric_bound(domain.get("x_max"))
                if lower is None or upper is None:
                    warnings.append({"field": f"component_spec.variables.{x_var}", "level": "warning", "message": "variable bound is missing; function asset domain coverage cannot be fully verified", "expected": domain})
                else:
                    if x_min is not None and lower < x_min:
                        errors.append({"field": f"component_spec.variables.{x_var}.lower_bound", "error": "variable lower bound is outside function asset domain", "actual": lower, "expected": f">= {x_min}"})
                    if x_max is not None and upper > x_max:
                        errors.append({"field": f"component_spec.variables.{x_var}.upper_bound", "error": "variable upper bound is outside function asset domain", "actual": upper, "expected": f"<= {x_max}"})
            elif x_var:
                warnings.append({"field": f"component_spec.components[{index}].x", "level": "warning", "message": "x variable was not found in component_spec.variables", "actual": x_var})
        return errors, warnings

    def _base_variable_name(self, expression: str) -> str:
        import re

        match = re.match(r"\s*([A-Za-z_]\w*)", expression or "")
        return match.group(1) if match else ""

    def _numeric_bound(self, value: Any) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    def _fill_component_dry_parameters(self, params: dict[str, Any], component_spec: dict[str, Any]) -> None:
        sets = {str(item.get("code") or item.get("name") or item.get("key")): list(item.get("values") or []) for item in component_spec.get("sets", []) or []}
        horizon = int(params.get("horizon") or len(params.get("time", [])) or len(sets.get("time", [])) or 4)
        sets.setdefault("time", list(range(horizon)))
        sets.setdefault("time_volume", list(range(horizon + 1)))
        params.setdefault("horizon", horizon)
        for item in component_spec.get("parameters", []) or []:
            code = str(item.get("code") or item.get("name") or item.get("key") or "")
            if not code or code in params:
                continue
            if str(item.get("type") or item.get("param_type") or "").lower() in {"piecewise_curve", "curve"}:
                params[code] = item.get("points") or [[0, 0], [1, 1]]
                continue
            default = item.get("default", item.get("default_value", None))
            if default is None:
                default = self._safe_sample_scalar(code, item.get("validation") or {})
            params[code] = self._dry_value_for_dimensions(list(item.get("dimension") or []), sets, default)

    def _normalize_component_dry_parameters(self, params: dict[str, Any], model_code: str) -> None:
        try:
            horizon = int(params.get("horizon"))
        except (TypeError, ValueError):
            return
        if horizon <= 0:
            return
        if not isinstance(params.get("time"), list) or len(params.get("time", [])) != horizon:
            params["time"] = list(range(horizon))
        if not isinstance(params.get("time_volume"), list) or len(params.get("time_volume", [])) != horizon + 1:
            params["time_volume"] = list(range(horizon + 1))
        if not model_code.startswith("cascade_hydro_dispatch"):
            return

        def resize(values: object) -> object:
            if not isinstance(values, list):
                return values
            if len(values) == horizon:
                return list(values)
            if not values:
                return [0 for _ in range(horizon)]
            result = list(values)
            while len(result) < horizon:
                result.extend(values)
            return result[:horizon]

        for key in ("availability", "local_inflow"):
            value = params.get(key)
            if not isinstance(value, dict):
                continue
            for item_key, item_value in list(value.items()):
                value[item_key] = resize(item_value)

    def _validate_component_objective_terms(self, component_spec: dict[str, Any]) -> list[dict[str, Any]]:
        if not component_spec:
            return []
        supported = {"load_deviation", "spill", "ramp", "terminal_volume", "investment", "curtailment", "deviation", "deviation_penalty_cost", "storage_cycle", "battery_degradation", "energy_revenue", "terminal_soc", "piecewise_cost"}
        errors: list[dict[str, Any]] = []
        for term in ((component_spec.get("objective") or {}).get("terms") or []):
            if term.get("enabled", True) is False:
                continue
            if term.get("supported_by_backend") is False:
                continue
            if term.get("solve_participation", "solve") in {"display_only", "remark_only", "none"}:
                continue
            weight_key = str(term.get("weight_key") or "")
            if weight_key not in supported:
                if term.get("supported_by_backend") is True:
                    expression = str(term.get("expression") or "").strip()
                    if not expression:
                        errors.append(
                            {
                                "field": "component_spec.objective.terms",
                                "level": "error",
                                "error": "solve_active 目标项缺少 expression",
                                "actual": term.get("term_id") or term.get("name") or weight_key,
                                "expected": "可编译的线性目标表达式",
                            }
                        )
                    continue
                errors.append(
                    {
                        "field": "component_spec.objective.terms",
                        "level": "error",
                        "error": "目标函数项暂不支持参与后端求解",
                        "actual": term.get("term_id") or term.get("name") or weight_key,
                        "expected": f"已实现目标项 weight_key 属于 {sorted(supported)}；用户新增目标项请标注 display_only 或禁用",
                    }
                )
        return errors

    def _validate_component_objective_publish_mode(self, component_spec: dict[str, Any], model: ModelPackage | ModelView) -> dict[str, Any] | None:
        terms = [term for term in ((component_spec.get("objective") or {}).get("terms") or []) if term.get("enabled", True) is not False]
        if not terms:
            return None
        active_terms = [term for term in terms if term.get("solve_participation", "solve") not in {"display_only", "remark_only", "none"}]
        if active_terms:
            return None
        supported = {"load_deviation", "spill", "ramp", "terminal_volume", "investment", "curtailment", "deviation", "deviation_penalty_cost", "storage_cycle", "battery_degradation", "energy_revenue", "terminal_soc", "piecewise_cost"}
        has_backend_supported_display_term = any(term.get("supported_by_backend") is True or str(term.get("weight_key") or "") in supported for term in terms)
        if not has_backend_supported_display_term:
            return None
        objective = component_spec.get("objective") or {}
        ui_metadata = model.ui_metadata or {}
        if ui_metadata.get("feasibility_model_confirmed") or objective.get("feasibility_model_confirmed") or component_spec.get("feasibility_model_confirmed"):
            return None
        return {
            "field": "component_spec.objective.terms",
            "level": "error",
            "error": "所有目标项均为 display_only，普通优化模型必须至少有一个 solve_active 目标项",
            "suggestion": "如确认为可行性模型，请设置 feasibility_model_confirmed=true；否则启用至少一个 solve_active 目标项后再发布。",
        }

    def _build_dry_run_parameters(self, semantic_spec: dict[str, Any], generic_spec: dict[str, Any]) -> dict[str, Any]:
        sets = generic_spec.get("sets") or {}
        variables = generic_spec.get("variables") or []
        upper_bound_params = {str(item.get("ub_param")) for item in variables if item.get("ub_param")}
        result: dict[str, Any] = {}
        for param in semantic_spec.get("parameters", []) or []:
            code = str(param.get("math_param") or param.get("code") or param.get("key") or "")
            if not code:
                continue
            if param.get("sample_value") is not None:
                result[code] = param.get("sample_value")
                continue
            if param.get("default_value") is not None:
                result[code] = param.get("default_value")
                continue
            if param.get("default") is not None:
                result[code] = param.get("default")
                continue
            validation = param.get("validation") or {}
            base_value = self._safe_sample_scalar(code, validation, code in upper_bound_params)
            if code in upper_bound_params or "max" in code or "upper" in code:
                base_value = validation.get("default", validation.get("max", 999))
            elif validation.get("default") is not None:
                base_value = validation.get("default")
            dimensions = list(param.get("dimension") or [])
            result[code] = self._dry_value_for_dimensions(dimensions, sets, base_value)
        return result

    def _complete_generic_dry_parameters(self, params: dict[str, Any], semantic_spec: dict[str, Any], generic_spec: dict[str, Any]) -> None:
        sets = generic_spec.get("sets") or {}
        variables = generic_spec.get("variables") or []
        upper_bound_params = {str(item.get("ub_param")) for item in variables if item.get("ub_param")}
        for param in semantic_spec.get("parameters", []) or []:
            code = str(param.get("math_param") or param.get("code") or param.get("key") or "")
            dimensions = list(param.get("dimension") or [])
            if not code or not dimensions:
                continue
            validation = param.get("validation") or {}
            base_value = self._safe_sample_scalar(code, validation, code in upper_bound_params)
            if code in upper_bound_params or "max" in code or "upper" in code:
                base_value = validation.get("default", validation.get("max", 999))
            elif validation.get("default") is not None:
                base_value = validation.get("default")
            fallback = self._dry_value_for_dimensions(dimensions, sets, base_value)
            params[code] = self._merge_indexed_dry_value(params.get(code), fallback, dimensions, sets)

    def _merge_indexed_dry_value(self, current: Any, fallback: Any, dimensions: list[str], sets: dict[str, Any]) -> Any:
        if not dimensions:
            return fallback if current is None else current
        if len(dimensions) == 1:
            keys = [str(item) for item in list(sets.get(dimensions[0]) or [])]
            result = dict(fallback if isinstance(fallback, dict) else {})
            if isinstance(current, dict):
                for key in keys:
                    value = current.get(key)
                    if value is None:
                        try:
                            value = current.get(int(key))
                        except (TypeError, ValueError):
                            value = None
                    if value is not None:
                        result[key] = value
            elif isinstance(current, list):
                for index, key in enumerate(keys):
                    if index < len(current) and current[index] is not None:
                        result[key] = current[index]
            elif current is not None:
                result = {key: current for key in keys}
            return result
        if len(dimensions) == 2:
            first_keys = [str(item) for item in list(sets.get(dimensions[0]) or [])]
            second_keys = [str(item) for item in list(sets.get(dimensions[1]) or [])]
            result = deepcopy(fallback if isinstance(fallback, dict) else {})
            if isinstance(current, dict):
                for first in first_keys:
                    nested = current.get(first)
                    if nested is None:
                        try:
                            nested = current.get(int(first))
                        except (TypeError, ValueError):
                            nested = None
                    if not isinstance(nested, dict):
                        continue
                    result.setdefault(first, {})
                    for second in second_keys:
                        value = nested.get(second)
                        if value is None:
                            try:
                                value = nested.get(int(second))
                            except (TypeError, ValueError):
                                value = None
                        if value is not None:
                            result[first][second] = value
            return result
        return fallback if current in (None, {}, []) else current

    def _dry_value_for_dimensions(self, dimensions: list[str], sets: dict[str, Any], value: Any) -> Any:
        if not dimensions:
            return value
        if len(dimensions) == 1:
            return {str(item): value for item in list(sets.get(dimensions[0]) or [])}
        if len(dimensions) == 2:
            first, second = dimensions
            return {
                str(first_item): {str(second_item): value for second_item in list(sets.get(second) or [])}
                for first_item in list(sets.get(first) or [])
            }
        return {}

    def _safe_sample_scalar(self, code: str, validation: dict[str, Any], is_upper_bound: bool = False) -> float:
        lowered = code.lower()
        if is_upper_bound or any(token in lowered for token in ("max", "upper", "capacity", "limit")):
            return float(validation.get("default", validation.get("max", 999)))
        if any(token in lowered for token in ("min", "lower")):
            return float(validation.get("default", validation.get("min", 0)))
        if any(token in lowered for token in ("efficiency", "eta")):
            return 0.95
        if any(token in lowered for token in ("cost", "price", "tariff")):
            return float(validation.get("default", max(float(validation.get("min", 1)), 10)))
        if any(token in lowered for token in ("load", "forecast", "demand")):
            return float(validation.get("default", max(float(validation.get("min", 1)), 100)))
        return float(validation.get("default", validation.get("min", 1)))

    def _template_time_granularity(self, template: dict[str, Any]) -> str | None:
        sets = (
            list(template.get("sets") or [])
            + list((template.get("component_spec") or {}).get("sets") or [])
            + list(((template.get("model_draft") or {}).get("semantic") or {}).get("sets") or [])
        )
        time_set = next((item for item in sets if (item.get("code") or item.get("key")) == "time" or item.get("type") == "time_period"), None)
        if not time_set:
            return None
        granularity = time_set.get("time_granularity")
        if granularity is None:
            sample = template.get("sample_runtime_parameters") or {}
            if sample.get("time_step_seconds") is not None:
                granularity = float(sample["time_step_seconds"]) / 60
            elif sample.get("delta_t") is not None:
                granularity = float(sample["delta_t"]) * 60
        if not granularity:
            return None
        value = float(granularity)
        return f"{int(value) if value.is_integer() else value}min"

    def seed_default_templates(self) -> None:
        self._ensure_default_component_library()
        self._ensure_default_template_models_published()
        self._ensure_default_template_skills_enabled()
        self.reconcile_version_state()
        with STORE.lock:
            if STORE.models:
                return
        timestamp = now_text()
        base_uc_params = {
            "unit": ["U1", "U2", "U3"],
            "unit_min_output": {"U1": 50, "U2": 30, "U3": 20},
            "unit_max_output": {"U1": 180, "U2": 120, "U3": 80},
            "fuel_cost": {"U1": 280, "U2": 330, "U3": 420},
            "startup_cost": {"U1": 6000, "U2": 3500, "U3": 1500},
            "ramp_up_limit": {"U1": 80, "U2": 60, "U3": 40},
            "ramp_down_limit": {"U1": 80, "U2": 60, "U3": 40},
            "reserve_ratio": 0.1,
        }
        models: list[ModelView] = []
        for code, template in power_template_library().items():
            sample = template.get("sample_runtime_parameters", {})
            params = {**base_uc_params, **sample} if code == "unit_commitment_day_ahead" else dict(sample)
            models.append(
                ModelView(
                    id=f"MODEL-POWER-{code.upper().replace('_', '-')}",
                    model_family_id=f"builtin:{code}",
                    is_active_version=True,
                    template_id=code,
                    name=template["name"],
                    scene=template.get("scenario", template["name"]),
                    version=template.get("version", "v1.0"),
                    status=template.get("status", "published"),
                    solver="HiGHS",
                    problem_type=template.get("problem_type", template.get("model_problem_type", "MILP")),
                    objective=((template.get("model_draft") or {}).get("objective_strategy") or {}).get("summary") or (template.get("objectives") or [{"code": "objective"}])[0]["code"],
                    time_granularity=self._template_time_granularity(template),
                    tags=template.get("tags", []),
                    semantic_spec=template,
                    build_mode=template.get("build_mode", "template_based"),
                    component_spec=template.get("component_spec", {}),
                    component_schema=template.get("component_schema", {}),
                    model_draft=template.get("model_draft", {}),
                    objective_config=template.get("objective_config", {}),
                    draft_constraints=template.get("draft_constraints", []),
                    mathematical_expansion=template.get("mathematical_expansion", {}),
                    model_problem_type=template.get("model_problem_type", template.get("problem_type", "MILP")),
                    required_solver_capabilities=template.get("required_solver_capabilities", ["LP"]),
                    ui_metadata={
                        **(template.get("ui_metadata", {}) or {}),
                        "managed_default_template": True,
                        "managed_template_version": template.get("version", "v1.0"),
                    },
                    parameters=params,
                    input_contract={"runtime_parameters": [p["code"] for p in template.get("parameters", [])]},
                    output_contract={"variables": [v["code"] for v in template.get("variables", [])]},
                    created_at=timestamp,
                    updated_at=timestamp,
                    published_at=timestamp,
                )
            )
        with STORE.lock:
            for model in models:
                STORE.models[model.id] = model
                skill_name = f"run_{str(model.template_id).lower().replace('-', '_').replace(' ', '_')}"
            STORE.save_runtime()

    def reconcile_version_state(self) -> None:
        """Deterministically migrate legacy duplicate codes and rebuild version indexes."""
        with STORE.lock:
            normalized: dict[str, ModelView] = {}
            by_code: dict[str, list[ModelView]] = {}
            for model_id, model in STORE.models.items():
                code = self._model_code(model)
                family_id = model.model_family_id or (f"builtin:{code}" if self._is_managed_default(model) else f"legacy:{model.id}")
                current = model if model.model_family_id else model.model_copy(update={"model_family_id": family_id})
                normalized[model_id] = current
                if current.status in CALLABLE_STATUSES:
                    by_code.setdefault(code, []).append(current)

            STORE.active_model_versions.clear()
            for code, candidates in by_code.items():
                def score(item: ModelView) -> tuple[int, int, int, int, str, str]:
                    explicit_active = 1 if item.is_active_version else 0
                    user_model = 0 if self._is_managed_default(item) else 1
                    status_score = {"published": 3, "tested": 2, "trial": 1}.get(str(item.status), 0)
                    return (explicit_active * user_model, user_model, explicit_active, status_score, str(item.published_at or item.updated_at or item.created_at or ""), item.id)

                winner = sorted(candidates, key=score, reverse=True)[0]
                if len(candidates) > 1:
                    LOGGER.info("Resolved legacy duplicate model_code=%s to active model_id=%s", code, winner.id)
                for candidate in candidates:
                    normalized[candidate.id] = normalized[candidate.id].model_copy(update={"is_active_version": candidate.id == winner.id})
                STORE.active_model_versions[str(winner.model_family_id)] = winner.id

            STORE.models.clear()
            STORE.models.update(normalized)
            STORE.model_versions.clear()
            for model in STORE.models.values():
                self._record_model_version_locked(model)
            STORE.save_runtime()

    def _ensure_default_template_skills_enabled(self) -> None:
        timestamp = now_text()
        template_codes = list(power_template_library().keys())
        with STORE.lock:
            changed = False
            for code in template_codes:
                skill_name = f"run_{str(code).lower().replace('-', '_').replace(' ', '_')}"
                default_model_id = f"MODEL-POWER-{code.upper().replace('_', '-')}"
                existing = STORE.skills.get(skill_name, {})
                next_record = {
                    **existing,
                    "skill_name": skill_name,
                    "model_id": default_model_id,
                    "model_version": existing.get("model_version", "v1.0"),
                    "status": existing.get("status", "enabled"),
                    "updated_at": timestamp,
                }
                if existing != next_record:
                    STORE.skills[skill_name] = next_record
                    changed = True
            if changed:
                STORE.save_runtime()

    def _ensure_default_template_models_published(self) -> None:
        timestamp = now_text()
        templates = power_template_library()
        default_ids = {f"MODEL-POWER-{code.upper().replace('_', '-')}": code for code in templates.keys()}
        with STORE.lock:
            changed = False
            for model_id, code in default_ids.items():
                model = STORE.models.get(model_id)
                template = templates[code]
                if model:
                    continue
                else:
                    STORE.models[model_id] = ModelView(
                        id=model_id,
                        model_family_id=f"builtin:{code}",
                        is_active_version=True,
                        template_id=code,
                        name=template["name"],
                        scene=template.get("scenario", template["name"]),
                        version=template.get("version", "v1.0"),
                        status=template.get("status", "published"),
                        solver=template.get("solver", "HiGHS"),
                        problem_type=template.get("problem_type", template.get("model_problem_type", "MILP")),
                        objective=((template.get("model_draft") or {}).get("objective_strategy") or {}).get("summary") or (template.get("objectives") or [{"code": "objective"}])[0]["code"],
                        time_granularity=self._template_time_granularity(template),
                        tags=template.get("tags", []),
                        semantic_spec=template,
                        build_mode=template.get("build_mode", "template_based"),
                        component_spec=template.get("component_spec", {}),
                        component_schema=template.get("component_schema", {}),
                        model_draft=template.get("model_draft", {}),
                        objective_config=template.get("objective_config", {}),
                        draft_constraints=template.get("draft_constraints", []),
                        mathematical_expansion=template.get("mathematical_expansion", {}),
                        model_problem_type=template.get("model_problem_type", template.get("problem_type", "MILP")),
                        required_solver_capabilities=template.get("required_solver_capabilities", ["LP"]),
                        ui_metadata={
                            **(template.get("ui_metadata", {}) or {}),
                            "managed_default_template": True,
                            "managed_template_version": template.get("version", "v1.0"),
                        },
                        parameters=dict(template.get("sample_runtime_parameters", {})),
                        input_contract={"runtime_parameters": [p["code"] for p in template.get("parameters", [])]},
                        output_contract={"variables": [v["code"] for v in template.get("variables", [])]},
                        created_at=timestamp,
                        updated_at=timestamp,
                        published_at=timestamp,
                    )
                    changed = True
            if changed:
                STORE.save_runtime()

    def _ensure_default_component_library(self) -> None:
        from app.model_components.registry import list_component_catalog

        hydro_assets = []
        for item in list_component_catalog():
            component_id = str(item.get("component_id") or item.get("type") or "")
            if component_id.startswith("hydro_"):
                hydro_assets.append(
                    {
                        **deepcopy(item),
                        "component_id": component_id,
                        "type": component_id,
                        "status": item.get("status") or "published",
                        "implemented": item.get("implemented", True),
                        "enabled": item.get("enabled", True),
                        "domain": "梯级水电日前调度",
                        "problem_types": ["LP"],
                        "solver_capabilities": ["LP"],
                        "backend_builder": component_id,
                        "metadata_only": item.get("metadata_only", False),
                        "managed_default_version": "hydro-components-v2-validated-metadata",
                    }
                )
        defaults = hydro_assets + [_normalize_default_component(component) for component in _default_library_components()]
        timestamp = now_text()
        with STORE.lock:
            changed = False
            for component in defaults:
                component_id = component["component_id"]
                existing = STORE.custom_components.get(component_id)
                if existing and existing.get("status") == "published" and existing.get("managed_default_version") == component.get("managed_default_version"):
                    continue
                implemented = bool(component.get("implemented", True))
                enabled = component.get("enabled", True) is not False
                status = component.get("status") or ("published" if implemented else "reserved")
                STORE.custom_components[component_id] = {
                    **component,
                    "type": component_id,
                    "status": status,
                    "implemented": implemented,
                    "enabled": enabled,
                    "created_at": existing.get("created_at") if existing else timestamp,
                    "updated_at": timestamp,
                    "published_at": existing.get("published_at") if existing else timestamp,
                    "editable": True,
                    "managed_default_version": component.get("managed_default_version"),
                }
                changed = True
            if changed:
                STORE.save_runtime()


model_service = ModelService()


def _normalize_default_component(component: dict[str, Any]) -> dict[str, Any]:
    row = deepcopy(component)
    normalized_sets = []
    for item in row.get("sets") or row.get("required_sets") or []:
        normalized = deepcopy(item)
        code = str(normalized.get("code") or normalized.get("key") or normalized.get("name") or "")
        if code == "time":
            normalized["type"] = "time_period"
        if code in {"time_volume", "soc_time"}:
            normalized["type"] = "state_time"
            normalized["base_set"] = "time"
            normalized["generation_rule"] = "horizon_plus_1"
        normalized_sets.append(normalized)
    if normalized_sets:
        row["sets"] = normalized_sets
        row["required_sets"] = deepcopy(normalized_sets)
    dependency_map = {
        "storage_soc_bounds": ["storage_soc_balance"],
        "storage_terminal_soc_tracking": ["storage_soc_balance"],
        "storage_charge_discharge_exclusive": ["storage_soc_balance"],
        "grid_power_limit": ["pv_storage_power_balance"],
    }
    component_id = str(row.get("component_id") or row.get("type") or "")
    if component_id in dependency_map:
        row["depends_on"] = sorted(set(row.get("depends_on") or []) | set(dependency_map[component_id]))
    return row


def _default_library_components() -> list[dict[str, Any]]:
    common_sets = [{"code": "time", "name": "调度时段"}, {"code": "time_volume", "name": "SOC时点"}]
    storage_vars = [
        {"code": "p_ch", "name": "充电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
        {"code": "p_dis", "name": "放电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
        {"code": "soc", "name": "储能SOC", "dimension": ["time_volume"], "unit": "MWh", "type": "continuous", "lower_bound": 0},
    ]


def _default_library_components() -> list[dict[str, Any]]:
    marker = {"managed_default_version": "pv-storage-v2-components-zh-v3"}
    time = [{"code": "time", "name": "调度时段"}]
    time_volume = [{"code": "time_volume", "name": "SOC时点"}]
    marker["managed_default_version"] = "pv-storage-v2-components-zh-v4"
    for item in time:
        item.update({"type": "time_period", "required": True})
    for item in time_volume:
        item.update({"type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1", "required": True})
    common_sets = time + time_volume
    storage_vars = [
        {"code": "p_ch", "name": "储能充电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
        {"code": "p_dis", "name": "储能放电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
        {"code": "soc", "name": "储能SOC", "dimension": ["time_volume"], "unit": "MWh", "type": "continuous", "lower_bound": 0},
    ]
    return [
        {
            **marker,
            "component_id": "storage_soc_balance",
            "name": "储能SOC平衡组件",
            "domain": "光储一体化",
            "category": "储能组件",
            "version": "1.1.0",
            "problem_types": ["LP", "MILP"],
            "solver_capabilities": ["LP", "MILP"],
            "description": "按充放电效率递推各时段储能SOC，并约束功率和能量容量边界。",
            "sets": common_sets,
            "parameters": [
                {"code": "eta_ch", "name": "充电效率", "dimension": [], "unit": "p.u.", "required": True, "default": 0.95},
                {"code": "eta_dis", "name": "放电效率", "dimension": [], "unit": "p.u.", "required": True, "default": 0.95},
                {"code": "delta_t", "name": "时间步长", "dimension": [], "unit": "h", "required": True, "default": 1},
                {"code": "initial_soc", "name": "初始SOC", "dimension": [], "unit": "MWh", "required": False, "default": 0},
                {"code": "storage_power_capacity", "name": "储能功率容量", "dimension": [], "unit": "MW", "required": False, "default": 50},
                {"code": "storage_energy_capacity", "name": "储能能量容量", "dimension": [], "unit": "MWh", "required": False, "default": 100},
            ],
            "variables": storage_vars,
            "constraints": [
                {"constraint_id": "storage_initial_soc_eq", "name": "初始SOC", "type": "state_transition", "indices": [], "expression": "soc[0] == initial_soc"},
                {"constraint_id": "storage_soc_balance_eq", "name": "储能SOC平衡", "type": "state_transition", "indices": ["time"], "expression": "soc[t+1] == soc[t] + eta_ch * p_ch[t] * delta_t - p_dis[t] / eta_dis * delta_t"},
                {"constraint_id": "storage_charge_power_cap", "name": "充电功率上限", "indices": ["time"], "expression": "p_ch[t] <= storage_power_capacity"},
                {"constraint_id": "storage_discharge_power_cap", "name": "放电功率上限", "indices": ["time"], "expression": "p_dis[t] <= storage_power_capacity"},
                {"constraint_id": "storage_soc_energy_cap", "name": "SOC能量上限", "indices": ["time_volume"], "expression": "soc[time_volume] <= storage_energy_capacity"},
            ],
            "objective_terms": [{"term_id": "storage_cycle_cost", "name": "充放电成本", "expression": "sum(p_ch[t] + p_dis[t] for t in time)", "weight_key": "storage_cycle", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "SOC[t+1] = SOC[t] + eta_ch * P_ch[t] * dt - P_dis[t] / eta_dis * dt"},
        },
        {
            **marker,
            "component_id": "pv_available_output",
            "name": "光伏可用出力组件",
            "domain": "光储一体化",
            "category": "光伏组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "约束光伏利用功率与弃光功率之和等于预测可用出力。",
            "sets": time,
            "parameters": [
                {"code": "pv_forecast", "name": "光伏预测出力", "dimension": ["time"], "unit": "MW", "required": True, "default": 100},
                {"code": "curtailment_penalty", "name": "弃光惩罚", "dimension": [], "unit": "元/MWh", "required": False, "default": 100},
            ],
            "variables": [
                {"code": "p_pv_used", "name": "光伏利用功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_pv_curtail", "name": "弃光功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "pv_available_balance", "name": "光伏出力分解", "indices": ["time"], "expression": "p_pv_used[t] + p_pv_curtail[t] == pv_forecast[t]"}],
            "objective_terms": [{"term_id": "pv_curtailment_penalty", "name": "弃光惩罚", "expression": "curtailment_penalty * sum(p_pv_curtail[t] for t in time)", "weight_key": "curtailment", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "P_pv_used[t] + P_pv_curtail[t] = PV_forecast[t]"},
        },
        {
            **marker,
            "component_id": "pv_storage_power_balance",
            "name": "光储功率平衡组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "协调光伏利用、储能充放电与并网功率之间的功率平衡。",
            "sets": time,
            "parameters": [{"code": "price", "name": "电价", "dimension": ["time"], "unit": "元/MWh", "required": False, "default": 0}],
            "variables": [
                {"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_pv_used", "name": "光伏利用功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_ch", "name": "充电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_dis", "name": "放电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "pv_storage_power_balance_eq", "name": "光储功率平衡", "indices": ["time"], "expression": "p_grid[t] == p_pv_used[t] + p_dis[t] - p_ch[t]"}],
            "objective_terms": [{"term_id": "grid_energy_revenue", "name": "售电收益", "expression": "price[t] * p_grid[t]", "weight_key": "energy_revenue", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "depends_on": ["pv_available_output", "storage_soc_balance"],
            "math_template": {"formula": "P_grid[t] = P_pv_used[t] + P_dis[t] - P_ch[t]"},
        },
        {
            **marker,
            "component_id": "grid_power_limit",
            "name": "并网功率限制组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "限制各时段并网功率不超过电网接入上限。",
            "sets": time,
            "parameters": [{"code": "grid_limit", "name": "并网限制", "dimension": ["time"], "unit": "MW", "required": True, "default": 200}],
            "variables": [{"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0}],
            "constraints": [{"constraint_id": "grid_power_upper", "name": "并网功率上限", "indices": ["time"], "expression": "p_grid[t] <= grid_limit[t]"}],
            "math_template": {"formula": "0 <= P_grid[t] <= GridLimit[t]"},
        },
        {
            **marker,
            "component_id": "storage_capacity_decision",
            "name": "储能功率容量决策组件",
            "domain": "光储一体化",
            "category": "容量配置组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "在容量配置场景中生成储能功率容量、能量容量和对应运行变量。",
            "sets": common_sets,
            "variables": [
                {"code": "storage_power_capacity", "name": "储能功率容量", "dimension": [], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "storage_energy_capacity", "name": "储能能量容量", "dimension": [], "unit": "MWh", "type": "continuous", "lower_bound": 0},
                *storage_vars,
            ],
            "parameters": [
                {"code": "soc_min", "name": "SOC下限比例", "dimension": [], "unit": "p.u.", "required": True, "default": 0.1},
                {"code": "capex_power", "name": "功率投资成本", "dimension": [], "unit": "元/MW", "required": False, "default": 1000},
                {"code": "capex_energy", "name": "容量投资成本", "dimension": [], "unit": "元/MWh", "required": False, "default": 500},
            ],
            "constraints": [
                {"constraint_id": "charge_capacity_limit", "name": "充电容量上限", "indices": ["time"], "expression": "p_ch[t] <= storage_power_capacity"},
                {"constraint_id": "discharge_capacity_limit", "name": "放电容量上限", "indices": ["time"], "expression": "p_dis[t] <= storage_power_capacity"},
                {"constraint_id": "soc_energy_upper", "name": "SOC容量上限", "indices": ["time_volume"], "expression": "soc[time_volume] <= storage_energy_capacity"},
                {"constraint_id": "soc_energy_lower", "name": "SOC容量下限", "indices": ["time_volume"], "expression": "soc[time_volume] >= soc_min * storage_energy_capacity"},
            ],
            "objective_terms": [{"term_id": "investment_cost", "name": "投资成本", "expression": "capex_power * storage_power_capacity + capex_energy * storage_energy_capacity", "weight_key": "investment", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "P_ch/P_dis <= P_cap, SOC <= E_cap"},
        },
        {
            **marker,
            "component_id": "schedule_tracking",
            "name": "计划曲线跟踪组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "用正负偏差变量刻画并网功率与计划曲线的偏离。",
            "sets": time,
            "parameters": [{"code": "schedule", "name": "计划曲线", "dimension": ["time"], "unit": "MW", "required": True, "default": 100}],
            "variables": [
                {"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "deviation_pos", "name": "正偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "deviation_neg", "name": "负偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "schedule_tracking_eq", "name": "计划曲线跟踪", "indices": ["time"], "expression": "p_grid[t] + deviation_pos[t] - deviation_neg[t] == schedule[t]"}],
            "objective_terms": [{"term_id": "schedule_deviation_penalty", "name": "计划偏差惩罚", "expression": "sum(deviation_pos[t] + deviation_neg[t] for t in time)", "weight_key": "deviation", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "P_grid[t] + Dev+[t] - Dev-[t] = Schedule[t]"},
        },
        {
            **marker,
            "component_id": "deviation_penalty_component",
            "name": "偏差考核组件",
            "domain": "光储一体化",
            "category": "计划偏差/市场考核",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "计算超出允许偏差范围的偏差考核电量，并形成偏差考核成本目标项。",
            "sets": time,
            "parameters": [
                {"code": "deviation_limit", "name": "允许偏差", "dimension": ["time"], "unit": "MW", "required": False, "default": 0},
                {"code": "deviation_penalty_price", "name": "偏差考核单价", "dimension": [], "unit": "元/MWh", "required": False, "default": 1},
                {"code": "delta_t", "name": "时间步长", "dimension": [], "unit": "h", "required": False, "default": 1},
            ],
            "variables": [
                {"code": "deviation_pos", "name": "正偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
                {"code": "deviation_neg", "name": "负偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
                {"code": "deviation_penalty", "name": "超限偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
            ],
            "constraints": [
                {"constraint_id": "deviation_penalty_pos_limit", "name": "正偏差超限考核", "indices": ["time"], "expression": "deviation_penalty[t] >= deviation_pos[t] - deviation_limit[t]"},
                {"constraint_id": "deviation_penalty_neg_limit", "name": "负偏差超限考核", "indices": ["time"], "expression": "deviation_penalty[t] >= deviation_neg[t] - deviation_limit[t]"},
            ],
            "depends_on": ["schedule_tracking"],
            "objective_terms": [{"term_id": "deviation_penalty_cost", "name": "偏差考核成本", "expression": "sum(deviation_penalty[t] * deviation_penalty_price * delta_t for t in time)", "weight_key": "deviation_penalty_cost", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "deviation_penalty[t] >= deviation_pos/neg[t] - deviation_limit[t]", "business_meaning": "仅对超过允许偏差的部分计算考核电量。"},
        },
        {
            **marker,
            "component_id": "storage_charge_discharge_exclusive",
            "name": "储能充放电互斥组件",
            "domain": "光储一体化",
            "category": "储能运行组件",
            "version": "1.1.0",
            "problem_types": ["MILP"],
            "solver_capabilities": ["MILP"],
            "description": "用二进制状态变量避免储能在同一时段同时充电和放电。",
            "sets": time,
            "parameters": [{"code": "storage_power_capacity", "name": "储能功率容量", "dimension": [], "unit": "MW", "required": True, "default": 50}],
            "variables": [
                {"code": "p_ch", "name": "充电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
                {"code": "p_dis", "name": "放电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
                {"code": "u_ch", "name": "充电状态", "dimension": ["time"], "unit": "0/1", "type": "binary", "domain": "Binary"},
                {"code": "u_dis", "name": "放电状态", "dimension": ["time"], "unit": "0/1", "type": "binary", "domain": "Binary"},
            ],
            "constraints": [
                {"constraint_id": "charge_discharge_exclusive", "name": "充放电互斥", "indices": ["time"], "expression": "u_ch[t] + u_dis[t] <= 1"},
                {"constraint_id": "charge_status_big_m", "name": "充电状态Big-M约束", "indices": ["time"], "expression": "p_ch[t] <= storage_power_capacity * u_ch[t]"},
                {"constraint_id": "discharge_status_big_m", "name": "放电状态Big-M约束", "indices": ["time"], "expression": "p_dis[t] <= storage_power_capacity * u_dis[t]"},
            ],
            "math_template": {"formula": "u_ch[t] + u_dis[t] <= 1; p_ch/p_dis <= capacity * status"},
            "ui_hint": "该组件包含二进制变量，会将模型问题类型从 LP 升级为 MILP。",
        },
        {
            **marker,
            "component_id": "storage_soc_bounds",
            "name": "储能SOC上下限组件",
            "domain": "光储一体化",
            "category": "储能运行组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "按能量容量和SOC上下限比例约束储能SOC安全范围。",
            "sets": time_volume,
            "parameters": [
                {"code": "storage_energy_capacity", "name": "储能能量容量", "dimension": [], "unit": "MWh", "required": True, "default": 100},
                {"code": "soc_min", "name": "SOC下限比例", "dimension": [], "unit": "p.u.", "required": False, "default": 0.2},
                {"code": "soc_max", "name": "SOC上限比例", "dimension": [], "unit": "p.u.", "required": False, "default": 1.0},
            ],
            "variables": [{"code": "soc", "name": "储能SOC", "dimension": ["time_volume"], "unit": "MWh", "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0}],
            "constraints": [
                {"constraint_id": "soc_energy_lower_bound", "name": "SOC能量下限", "indices": ["time_volume"], "expression": "soc[time_volume] >= soc_min * storage_energy_capacity"},
                {"constraint_id": "soc_energy_upper_bound", "name": "SOC能量上限", "indices": ["time_volume"], "expression": "soc[time_volume] <= soc_max * storage_energy_capacity"},
            ],
            "math_template": {"formula": "soc_min * E_cap <= soc[t] <= soc_max * E_cap"},
        },
        {
            **marker,
            "component_id": "storage_terminal_soc_tracking",
            "name": "储能期末SOC跟踪组件",
            "domain": "光储一体化",
            "category": "储能组件",
            "version": "1.1.0",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "description": "通过正负偏差变量跟踪期末SOC目标。",
            "sets": time_volume,
            "parameters": [{"code": "terminal_time", "name": "期末时点", "dimension": [], "default": 4}, {"code": "terminal_soc_target", "name": "期末SOC目标", "dimension": [], "unit": "MWh", "default": 0}],
            "variables": [
                {"code": "soc", "name": "储能SOC", "dimension": ["time_volume"], "unit": "MWh", "type": "continuous", "lower_bound": 0},
                {"code": "terminal_soc_dev_pos", "name": "期末SOC正偏差", "dimension": [], "unit": "MWh", "type": "continuous", "lower_bound": 0},
                {"code": "terminal_soc_dev_neg", "name": "期末SOC负偏差", "dimension": [], "unit": "MWh", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "terminal_soc_tracking_eq", "name": "期末SOC目标跟踪", "indices": [], "expression": "soc[terminal_time] + terminal_soc_dev_pos - terminal_soc_dev_neg == terminal_soc_target"}],
            "objective_terms": [{"term_id": "terminal_soc_penalty", "name": "期末SOC偏差惩罚", "expression": "terminal_soc_dev_pos + terminal_soc_dev_neg", "weight_key": "terminal_soc", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}],
            "math_template": {"formula": "SOC[T] + Dev+ - Dev- = SOC_target"},
        },
    ]
    return [
        {
            "component_id": "storage_soc_balance",
            "name": "储能SOC平衡组件",
            "domain": "光储一体化",
            "category": "储能组件",
            "version": "1.0.0",
            "problem_types": ["LP", "MILP"],
            "solver_capabilities": ["LP", "MILP"],
            "description": "描述储能SOC在相邻时段之间的递推关系。",
            "sets": common_sets,
            "parameters": [
                {"code": "eta_ch", "name": "充电效率", "dimension": [], "unit": "p.u.", "required": True, "default": 0.95},
                {"code": "eta_dis", "name": "放电效率", "dimension": [], "unit": "p.u.", "required": True, "default": 0.95},
                {"code": "delta_t", "name": "时间步长", "dimension": [], "unit": "h", "required": True, "default": 1},
            ],
            "variables": storage_vars,
            "constraints": [
                {
                    "constraint_id": "storage_soc_balance_eq",
                    "name": "储能SOC平衡",
                    "type": "state_transition",
                    "indices": ["time"],
                    "expression": "soc[t+1] == soc[t] + eta_ch * p_ch[t] * delta_t - p_dis[t] / eta_dis * delta_t",
                    "business_meaning": "下一时段SOC等于当前SOC加充电电量并扣减放电电量。",
                }
            ],
            "math_template": {"formula": "SOC[t+1] = SOC[t] + eta_ch * P_ch[t] * Δt - P_dis[t] / eta_dis * Δt"},
        },
        {
            "component_id": "pv_available_output",
            "name": "光伏可用出力组件",
            "domain": "光储一体化",
            "category": "光伏组件",
            "version": "1.0.0",
            "sets": [{"code": "time", "name": "调度时段"}],
            "parameters": [{"code": "pv_forecast", "name": "光伏预测出力", "dimension": ["time"], "unit": "MW", "required": True, "default": 100}],
            "variables": [
                {"code": "p_pv_used", "name": "光伏利用功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_pv_curtail", "name": "弃光功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "pv_available_balance", "name": "光伏出力分解", "indices": ["time"], "expression": "p_pv_used[t] + p_pv_curtail[t] == pv_forecast[t]"}],
            "math_template": {"formula": "P_pv_used[t] + P_pv_curtail[t] = PV_forecast[t]"},
        },
        {
            "component_id": "pv_storage_power_balance",
            "name": "光储功率平衡组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.0.0",
            "sets": [{"code": "time", "name": "调度时段"}],
            "variables": [
                {"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_pv_used", "name": "光伏利用功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_ch", "name": "充电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "p_dis", "name": "放电功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "pv_storage_power_balance_eq", "name": "光储功率平衡", "indices": ["time"], "expression": "p_grid[t] == p_pv_used[t] + p_dis[t] - p_ch[t]"}],
            "depends_on": ["pv_available_output", "storage_soc_balance"],
            "math_template": {"formula": "P_grid[t] = P_pv_used[t] + P_dis[t] - P_ch[t]"},
        },
        {
            "component_id": "grid_power_limit",
            "name": "并网功率限制组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.0.0",
            "sets": [{"code": "time", "name": "调度时段"}],
            "parameters": [{"code": "grid_limit", "name": "并网限制", "dimension": ["time"], "unit": "MW", "required": True, "default": 200}],
            "variables": [{"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0}],
            "constraints": [{"constraint_id": "grid_power_upper", "name": "并网功率上限", "indices": ["time"], "expression": "p_grid[t] <= grid_limit[t]"}],
            "math_template": {"formula": "0 <= P_grid[t] <= GridLimit[t]"},
        },
        {
            "component_id": "storage_capacity_decision",
            "name": "储能功率容量决策组件",
            "domain": "光储一体化",
            "category": "容量配置组件",
            "version": "1.0.0",
            "sets": [{"code": "time", "name": "调度时段"}],
            "variables": [
                {"code": "storage_power_capacity", "name": "储能功率容量", "dimension": [], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "storage_energy_capacity", "name": "储能能量容量", "dimension": [], "unit": "MWh", "type": "continuous", "lower_bound": 0},
                *storage_vars,
            ],
            "parameters": [{"code": "soc_min", "name": "SOC下限比例", "dimension": [], "unit": "p.u.", "required": True, "default": 0.1}],
            "constraints": [
                {"constraint_id": "charge_capacity_limit", "name": "充电容量上限", "indices": ["time"], "expression": "p_ch[t] <= storage_power_capacity"},
                {"constraint_id": "discharge_capacity_limit", "name": "放电容量上限", "indices": ["time"], "expression": "p_dis[t] <= storage_power_capacity"},
                {"constraint_id": "soc_energy_upper", "name": "SOC容量上限", "indices": ["time_volume"], "expression": "soc[time_volume] <= storage_energy_capacity"},
                {"constraint_id": "soc_energy_lower", "name": "SOC容量下限", "indices": ["time_volume"], "expression": "soc[time_volume] >= soc_min * storage_energy_capacity"},
            ],
            "objective_terms": [{"term_id": "investment_cost_display", "name": "投资成本", "expression": "storage_power_capacity + storage_energy_capacity", "weight_key": "investment", "solve_participation": "display_only"}],
            "math_template": {"formula": "P_ch/P_dis <= P_cap, SOC <= E_cap"},
        },
        {
            "component_id": "schedule_tracking",
            "name": "计划曲线跟踪组件",
            "domain": "光储一体化",
            "category": "并网/计划组件",
            "version": "1.0.0",
            "sets": [{"code": "time", "name": "调度时段"}],
            "parameters": [{"code": "schedule", "name": "计划曲线", "dimension": ["time"], "unit": "MW", "required": True, "default": 100}],
            "variables": [
                {"code": "p_grid", "name": "并网功率", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "deviation_pos", "name": "正偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
                {"code": "deviation_neg", "name": "负偏差", "dimension": ["time"], "unit": "MW", "type": "continuous", "lower_bound": 0},
            ],
            "constraints": [{"constraint_id": "schedule_tracking_eq", "name": "计划曲线跟踪", "indices": ["time"], "expression": "p_grid[t] + deviation_pos[t] - deviation_neg[t] == schedule[t]"}],
            "objective_terms": [{"term_id": "deviation_penalty_display", "name": "偏差惩罚", "expression": "sum(deviation_pos[t] + deviation_neg[t] for t in time)", "weight_key": "deviation", "solve_participation": "display_only"}],
            "math_template": {"formula": "P_grid[t] + Dev+[t] - Dev-[t] = Schedule[t]"},
        },
    ]
