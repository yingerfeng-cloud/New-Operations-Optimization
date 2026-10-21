from __future__ import annotations

import re
import uuid
from copy import deepcopy
from typing import Any, Callable, Iterable

from fastapi import HTTPException

from app.schemas.model import ModelPackage, ModelView
from app.storage.memory_store import STORE


class ModelVersionService:
    """Owns model-family identity, version indexes, and publish-code governance."""

    def prepare_identity(self, model: ModelPackage, source: ModelView | None = None, family_models: Iterable[ModelView] = ()) -> ModelPackage:
        metadata = model.ui_metadata or {}
        supersedes_id = model.supersedes_model_id or metadata.get("supersedes_model_id")
        family_id = model.model_family_id or metadata.get("model_family_id")
        version = model.version
        if source is not None:
            family_id = source.model_family_id or f"FAMILY-{source.id}"
            if not version or version == source.version or version == "v0.1":
                version = self.next_family_version(source, family_models)
        family_id = str(family_id or f"FAMILY-{uuid.uuid4().hex[:12].upper()}")
        return model.model_copy(
            update={
                "model_family_id": family_id,
                "supersedes_model_id": supersedes_id,
                "version": version,
                "is_active_version": False,
            }
        )

    def validate_publish_code_ownership(
        self,
        model: ModelView,
        candidates: Iterable[ModelView],
        *,
        is_builtin: Callable[[ModelView], bool],
    ) -> None:
        for candidate in candidates:
            if candidate.id == model.id or not candidate.is_active_version or is_builtin(candidate):
                continue
            if candidate.model_family_id != model.model_family_id:
                raise HTTPException(status_code=409, detail="模型编码已被其他模型家族使用，请修改编码。")

    def record_locked(self, model: ModelView, model_code: str) -> None:
        family_id = str(model.model_family_id or f"FAMILY-{model.id}")
        rows = [item for item in STORE.model_versions.get(family_id, []) if item.get("model_id") != model.id]
        rows.append(
            {
                "model_id": model.id,
                "model_family_id": family_id,
                "model_code": model_code,
                "version": model.version,
                "status": model.status,
                "is_active_version": model.is_active_version,
                "supersedes_model_id": model.supersedes_model_id,
                "published_at": model.published_at,
                "updated_at": model.updated_at,
            }
        )
        STORE.model_versions[family_id] = sorted(
            rows,
            key=lambda item: (str(item.get("updated_at") or ""), str(item.get("model_id") or "")),
        )

    def list_versions(self, model: ModelView) -> list[ModelView]:
        family_id = str(model.model_family_id or f"FAMILY-{model.id}")
        with STORE.lock:
            versions = [item for item in STORE.models.values() if str(item.model_family_id or f"FAMILY-{item.id}") == family_id]
        return sorted(versions, key=lambda item: (self.version_key(item.version), str(item.updated_at or ""), item.id), reverse=True)

    def new_version_package(self, source: ModelView, overrides: dict[str, Any] | None = None, family_models: Iterable[ModelView] = ()) -> ModelPackage:
        data = source.model_dump(
            exclude={
                "id", "created_at", "updated_at", "published_at", "tested_at", "validation_warnings",
                "dry_run_result", "is_active_version", "published_by", "content_hash",
                "tested_content_hash", "tested_model_id",
            }
        )
        data.update(deepcopy(overrides or {}))
        data.update(
            {
                "model_family_id": source.model_family_id or f"FAMILY-{source.id}",
                "supersedes_model_id": source.id,
                "version": self.next_family_version(source, family_models),
                "status": "developing",
                "is_active_version": False,
                "published_at": None,
                "tested_at": None,
                "content_hash": None,
                "tested_content_hash": None,
                "tested_model_id": None,
                "validation_warnings": [],
                "dry_run_result": {},
            }
        )
        metadata = deepcopy(data.get("ui_metadata") or {})
        for key in ("publish_info", "test_result", "version_info", "function_update", "component_update", "managed_default_template", "managed_template_version"):
            metadata.pop(key, None)
        metadata["supersedes_model_id"] = source.id
        metadata["model_family_id"] = data["model_family_id"]
        data["ui_metadata"] = metadata
        draft = deepcopy(data.get("model_draft") or {})
        if draft:
            draft.setdefault("basic_info", {})["version"] = data["version"]
            data["model_draft"] = draft
        return self.with_update_contexts(ModelPackage.model_validate(data))

    def with_update_contexts(self, model: ModelPackage, source: ModelPackage | None = None) -> ModelPackage:
        """Keep operation controls only at the authoritative asset metadata.

        Editor/recovery mirrors cannot restore an old operation or remove the
        current candidate's conflict guard. Historical source assets are untouched.
        """
        keys = {"function_update", "component_update"}

        def clean(value):
            if isinstance(value, list):
                return [clean(item) for item in value]
            if not isinstance(value, dict):
                return deepcopy(value)
            return {key: ({k: clean(v) for k, v in item.items() if k not in keys}
                          if key == "ui_metadata" and isinstance(item, dict) else clean(item))
                    for key, item in value.items()}

        fields = {key: clean(getattr(model, key)) for key in
                  ("model_draft", "semantic_spec", "component_spec", "generic_spec")}
        fields["ui_metadata"] = {key: deepcopy(value) for key, value in model.ui_metadata.items() if key not in keys}
        if source is not None:
            parent = STORE.models.get(source.supersedes_model_id)
            for key in keys:
                if key not in source.ui_metadata:
                    continue
                context = source.ui_metadata[key]
                # Repair a pre-fix ordinary draft only when its direct published
                # parent's preserved audit proves this is an inherited operation.
                inherited = (not source.published_at and parent and parent.published_at
                             and isinstance(context, dict) and context.get("source_model_id") != parent.id
                             and context == parent.ui_metadata.get(key))
                if not inherited:
                    fields["ui_metadata"][key] = deepcopy(context)
        return model.model_copy(update=fields)

    def next_family_version(self, source: ModelView, family_models: Iterable[ModelView]) -> str:
        family_id = str(source.model_family_id or f"FAMILY-{source.id}")
        versions = [source.version]
        versions.extend(
            item.version
            for item in family_models
            if str(item.model_family_id or f"FAMILY-{item.id}") == family_id
        )
        latest = max(versions, key=self.version_key)
        return self.next_version(latest)

    @staticmethod
    def next_version(version: str | None) -> str:
        values = [int(value) for value in re.findall(r"\d+", str(version or ""))]
        major = values[0] if values else 0
        minor = values[1] if len(values) > 1 else 0
        return f"v{major}.{minor + 1}"

    @staticmethod
    def version_key(version: str | None) -> tuple[int, ...]:
        values = tuple(int(value) for value in re.findall(r"\d+", str(version or "")))
        return values or (0,)


model_version_service = ModelVersionService()
