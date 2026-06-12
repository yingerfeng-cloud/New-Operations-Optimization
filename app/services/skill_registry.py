from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.services.invocation_service import invocation_service
from app.services.model_service import CALLABLE_STATUSES, model_service
from app.storage.memory_store import STORE
from app.utils import now_text


SKILL_STATUSES = {"enabled", "disabled"}


class SkillRegistry:
    def list_skills(self) -> list[dict[str, Any]]:
        models = [model for model in model_service.list_models() if model.status in CALLABLE_STATUSES]
        counts: dict[str, int] = {}
        for model in models:
            base = self._base_skill_name(model)
            counts[base] = counts.get(base, 0) + 1
        skills = [
            self._skill_for_model(model, duplicate_count=counts.get(self._base_skill_name(model), 1))
            for model in models
        ]
        return [skill for skill in skills if skill.get("skill_status") == "enabled" or self._is_builtin_default_skill(skill.get("skill_name", ""))]

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        matches = self._matching_models(skill_name)
        if not matches:
            raise HTTPException(status_code=404, detail=f"Skill not found: {skill_name}")
        model = self._choose_model(matches)
        duplicate_count = sum(
            1
            for item in model_service.list_models()
            if item.status in CALLABLE_STATUSES and self._base_skill_name(item) == self._base_skill_name(model)
        )
        skill = self._skill_for_model(model, duplicate_count=duplicate_count)
        candidates = [self._skill_for_model(candidate, duplicate_count=duplicate_count) for candidate in matches]
        skill["canonical_skill_name"] = skill["skill_name"]
        skill["alias_requested"] = skill_name
        skill["candidate_skills"] = [
            {"skill_name": item["skill_name"], "model_id": item["model_id"], "version": item["version"], "status": item["status"], "skill_status": item["skill_status"], "callable": item["callable"], "is_default": item["is_default"]}
            for item in candidates
        ]
        skill["ambiguous_alias"] = len(candidates) > 1 and skill_name != skill["skill_name"]
        return skill

    def generate_skill(self, model_id: str) -> dict[str, Any]:
        model = model_service.get_model(model_id)
        if model.status not in CALLABLE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Model is not skill-ready in status: {model.status}")
        duplicate_count = sum(
            1
            for item in model_service.list_models()
            if item.status in CALLABLE_STATUSES and self._base_skill_name(item) == self._base_skill_name(model)
        )
        skill = self._skill_for_model(model, duplicate_count=duplicate_count)
        record = {
            "skill_name": skill["skill_name"],
            "model_id": model.id,
            "model_version": model.version,
            "status": "enabled",
            "created_at": now_text(),
            "updated_at": now_text(),
        }
        with STORE.lock:
            STORE.skills[skill["skill_name"]] = record
            STORE.save_runtime()
        return self.get_skill_any_status(skill["skill_name"])

    def update_skill(self, skill_name: str, body: dict[str, Any]) -> dict[str, Any]:
        skill = self.get_skill_any_status(skill_name)
        status = body.get("skill_status") or body.get("status") or skill.get("skill_status")
        if status not in SKILL_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid skill status: {status}")
        record = {
            "skill_name": skill["skill_name"],
            "model_id": skill["model_id"],
            "model_version": skill["version"],
            "status": status,
            "description": body.get("description", skill.get("description")),
            "updated_at": now_text(),
        }
        with STORE.lock:
            existing = STORE.skills.get(skill["skill_name"], {})
            STORE.skills[skill["skill_name"]] = {**existing, **record}
            STORE.save_runtime()
        return self.get_skill_any_status(skill["skill_name"])

    def enable_skill(self, skill_name: str) -> dict[str, Any]:
        return self.update_skill(skill_name, {"status": "enabled"})

    def disable_skill(self, skill_name: str) -> dict[str, Any]:
        return self.update_skill(skill_name, {"status": "disabled"})

    def get_skill_any_status(self, skill_name: str) -> dict[str, Any]:
        model = self._model_for_skill(skill_name, require_enabled=False)
        duplicate_count = sum(
            1
            for item in model_service.list_models()
            if item.status in CALLABLE_STATUSES and self._base_skill_name(item) == self._base_skill_name(model)
        )
        return self._skill_for_model(model, duplicate_count=duplicate_count)

    def run_skill(self, skill_name: str, body: dict[str, Any]) -> dict[str, Any]:
        parameters = body.get("parameters") if "parameters" in body else body
        options = body.get("options") or {"mode": "sync", "explain": True}
        model = self._model_for_skill(skill_name, parameters=parameters or {})
        schema = invocation_service.model_schema(model.id).get("input_schema", [])
        if options.get("use_sample_data") is True:
            parameters = {**self._sample_parameters(schema), **(parameters or {})}
        elif options.get("strict_runtime_parameters", True):
            runtime_analysis = invocation_service.analyze_parameters(schema, parameters or {})
            if skill_name == "run_cascade_hydro_dispatch" and not runtime_analysis.get("ready"):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "PARAMETER_INVALID",
                        "missing_required": runtime_analysis.get("missing_required", []),
                        "invalid_parameters": runtime_analysis.get("invalid_parameters", []),
                        "can_use_default": runtime_analysis.get("can_use_default", []),
                        "requires_default_confirmation": runtime_analysis.get("requires_default_confirmation", False),
                        "message": "缺少必填运行参数，不能直接求解。",
                    },
                )
            invalid = self._strict_parameter_errors(schema, parameters or {})
            if invalid:
                missing_required = [item for item in invalid if item.get("error") == "missing_required"]
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "PARAMETER_INVALID",
                        "missing_required": missing_required,
                        "invalid_parameters": [item for item in invalid if item.get("error") != "missing_required"],
                        "message": "缺少必填运行参数，不能直接求解。",
                    },
                )
        response = invocation_service.invoke_model(
            model.id,
            {"parameters": parameters or {}, "options": {**options, "skill_name": skill_name, "caller": "skill"}},
        )
        response["skill_name"] = skill_name
        response["resolved_model_id"] = model.id
        response["resolved_model_code"] = self._model_code(model)
        warning = self._skill_resolution_warning(skill_name, model)
        if warning:
            response["warning"] = warning
            if isinstance(response.get("warnings"), list):
                response["warnings"].append({"level": "warning", "message": warning})
        return response

    def _sample_parameters(self, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for item in input_schema or []:
            key = item.get("key")
            if not key:
                continue
            value = item.get("sample_value")
            if value is None:
                value = item.get("default_value")
            if value is not None:
                values[key] = value
        return values

    def _strict_parameter_errors(self, input_schema: list[dict[str, Any]], parameters: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        for item in input_schema or []:
            key = item.get("key")
            if not key or item.get("required", True) is False:
                continue
            if item.get("default_policy") != "user_required":
                continue
            if key not in parameters or parameters.get(key) in (None, ""):
                errors.append(
                    {
                        "key": key,
                        "name": item.get("name") or key,
                        "default_policy": item.get("default_policy") or "sample_only",
                        "error": "missing_required",
                    }
                )
        return errors

    def analyze_input(self, skill_name: str, body: dict[str, Any]) -> dict[str, Any]:
        partial = body.get("partial_parameters") or {}
        model = self._model_for_skill(skill_name, parameters=partial, require_enabled=False)
        duplicate_count = sum(
            1
            for item in model_service.list_models()
            if item.status in CALLABLE_STATUSES and self._base_skill_name(item) == self._base_skill_name(model)
        )
        skill = self._skill_for_model(model, duplicate_count=duplicate_count)
        return invocation_service.analyze_parameters(skill.get("input_schema", []), partial)

    def _model_for_skill(self, skill_name: str, parameters: dict[str, Any] | None = None, require_enabled: bool = True):
        if skill_name == "run_cascade_hydro_dispatch":
            default_model = self._builtin_default_model(skill_name)
            if default_model is not None:
                with STORE.lock:
                    stored = dict(STORE.skills.get(skill_name, {}))
                if require_enabled and stored.get("status", "enabled") != "enabled":
                    raise HTTPException(status_code=409, detail=f"Skill is not enabled: {skill_name}")
                return default_model
        with STORE.lock:
            stored = dict(STORE.skills.get(skill_name, {}))
        if stored.get("model_id"):
            model = model_service.get_model(stored["model_id"])
            if model.status not in CALLABLE_STATUSES:
                raise HTTPException(status_code=409, detail=f"Model is not callable in status: {model.status}")
            if not parameters or self._parameters_match_model(model, parameters):
                if require_enabled and stored.get("status", "enabled") != "enabled" and not self._is_builtin_default_skill(skill_name):
                    raise HTTPException(status_code=409, detail=f"Skill is not enabled: {skill_name}")
                return model
        matches = self._matching_models(skill_name)
        if parameters:
            compatible = [model for model in matches if self._parameters_match_model(model, parameters)]
            if compatible:
                model = self._choose_model(compatible)
                if require_enabled:
                    skill = self._skill_for_model(model)
                    if skill.get("skill_status") != "enabled":
                        raise HTTPException(status_code=409, detail=f"Skill is not enabled: {skill_name}")
                return model
        if matches:
            model = self._choose_model(matches)
            if require_enabled:
                skill = self._skill_for_model(model)
                if skill.get("skill_status") != "enabled":
                    raise HTTPException(status_code=409, detail=f"Skill is not enabled: {skill_name}")
            return model
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_name}")

    def _matching_models(self, skill_name: str) -> list[Any]:
        return [
            model
            for model in model_service.list_models()
            if model.status in CALLABLE_STATUSES and skill_name in self._skill_aliases(model)
        ]

    def _choose_model(self, models: list[Any]) -> Any:
        def score(model: Any) -> tuple[int, int, str]:
            status_score = {"tested": 3, "published": 2, "trial": 1}.get(str(model.status), 0)
            template_score = 1 if getattr(model, "template_id", None) else 0
            return (status_score, template_score, str(model.updated_at or model.created_at or ""))

        return sorted(models, key=score, reverse=True)[0]

    def _builtin_default_model(self, skill_name: str):
        code = skill_name.removeprefix("run_")
        model_id = f"MODEL-POWER-{code.upper().replace('_', '-')}"
        try:
            return model_service.get_model(model_id)
        except HTTPException:
            return None

    def _model_code(self, model: Any) -> str:
        semantic = model.semantic_spec or {}
        return str(semantic.get("model_code") or (model.component_spec or {}).get("model_code") or model.template_id or model.id)

    def _skill_resolution_warning(self, skill_name: str, model: Any) -> str | None:
        if not self._is_builtin_default_skill(skill_name):
            return None
        code = skill_name.removeprefix("run_")
        candidates = model_service.find_models_by_code(code)
        if len(candidates) <= 1:
            return None
        return f"存在多个 model_code={code} 的模型，当前优先调用默认模板模型 {model.id}。"

    def _parameters_match_model(self, model, parameters: dict[str, Any]) -> bool:
        sets = {
            str(item.get("key") or item.get("code")): set(map(str, item.get("values") or []))
            for item in (model.semantic_spec or {}).get("sets", [])
            if item.get("key") or item.get("code")
        }
        for param in (model.semantic_spec or {}).get("parameters", []) or []:
            code = str(param.get("math_param") or param.get("code") or param.get("key") or "")
            value = parameters.get(code)
            dimensions = list(param.get("dimension") or [])
            if not code or not isinstance(value, dict) or len(dimensions) != 1:
                continue
            expected = sets.get(str(dimensions[0]))
            if expected and not set(map(str, value.keys())).issubset(expected):
                return False
        return True

    def _skill_for_model(self, model, duplicate_count: int = 1) -> dict[str, Any]:
        schema = invocation_service.model_schema(model.id)
        skill_name = self._skill_name(model, duplicate_count=duplicate_count)
        skill_state = self._skill_state(skill_name)
        model_ready = model.status in CALLABLE_STATUSES
        skill_enabled = skill_state.get("status", "enabled") == "enabled"
        callable_reason = None
        if not model_ready:
            callable_reason = f"Model is not callable in status: {model.status}"
        elif not skill_enabled:
            callable_reason = "Skill is disabled"
        return {
            "skill_name": skill_name,
            "canonical_skill_name": skill_name,
            "skill_aliases": self._skill_aliases(model),
            "model_id": model.id,
            "model_code": schema["model_code"],
            "model_version": model.version,
            "version": model.version,
            "status": self._published_status(model.status),
            "model_status": model.status,
            "skill_status": skill_state.get("status", "enabled"),
            "callable": bool(model_ready and skill_enabled),
            "callable_reason": callable_reason,
            "is_default": skill_name == self._base_skill_name(model),
            "display_name": self._display_name(model),
            "name": self._display_name(model),
            "description": skill_state.get("description") or self._business_description(schema["model_code"], model),
            "input_schema": schema["input_schema"],
            "output_schema": schema["output_schema"],
            "endpoint": f"/api/skills/{skill_name}/run",
            "method": "POST",
            "allowed_callers": ["agent", "api", "platform", "agent_console"],
            "safety": (
                "仅提供辅助决策建议；不会自动下发生产控制指令。"
            ),
            "execution_policy": "advisory_only",
            "requires_human_review": True,
        }

    def _skill_state(self, skill_name: str) -> dict[str, Any]:
        with STORE.lock:
            return dict(STORE.skills.get(skill_name, {"status": "enabled"}))

    def _display_name(self, model: Any) -> str:
        return str(model.name or self._model_code(model))

    def _business_description(self, model_code: str, model: Any) -> str:
        descriptions = {
            "economic_dispatch": "经济调度优化能力：基于负荷预测、机组出力边界和燃料成本，计算满足负荷约束下的低成本出力方案。",
            "storage_dispatch": "储能调度优化能力：基于电价、储能容量和充放电功率边界，生成储能充放电与 SOC 运行建议。",
            "unit_commitment_day_ahead": "日前机组组合优化能力：基于负荷预测、新能源预测和机组运行约束，生成机组启停、备用和出力计划建议。",
            "renewable_storage_dispatch": "风光储协同优化能力：基于新能源预测、负荷、电价、储能容量和并网约束，生成消纳与储能协同方案。",
            "chp_dispatch": "电热协同优化能力：基于电负荷、热负荷、燃料成本和机组边界，生成热电联产协同出力方案。",
            "cascade_hydro_dispatch": "梯级水电调度优化能力：基于来水、库容、检修可用容量和负荷预测，生成梯级电站日前出力与水量调度方案。",
        }
        return descriptions.get(str(model_code), f"{model.name}优化调用能力：基于已发布模型的输入输出契约生成辅助决策方案。")

    def _published_status(self, model_status: str) -> str:
        if model_status == "deprecated":
            return "deprecated"
        if model_status in CALLABLE_STATUSES:
            return "published"
        return "draft"

    def _is_builtin_default_skill(self, skill_name: str) -> bool:
        return skill_name in {
            "run_unit_commitment_day_ahead",
            "run_economic_dispatch",
            "run_storage_dispatch",
            "run_renewable_storage_dispatch",
            "run_chp_dispatch",
            "run_cascade_hydro_dispatch",
        }

    def _base_skill_name(self, model) -> str:
        semantic = model.semantic_spec or {}
        code = semantic.get("skill_code") or semantic.get("model_code") or semantic.get("code") or model.template_id or model.id
        if code == "custom_optimization_model":
            scene = f"{model.name} {model.scene}".lower()
            if "economic" in scene or "dispatch" in scene or "经济调度" in model.name or "经济" in model.scene:
                code = "economic_dispatch"
        return f"run_{str(code).lower().replace('-', '_').replace(' ', '_')}"

    def _skill_name(self, model, duplicate_count: int = 1) -> str:
        base = self._base_skill_name(model)
        if duplicate_count <= 1:
            return base
        version = str(model.version or "v0_1").lower().replace(".", "_").replace("-", "_")
        return f"{base}_{version}_{model.id.lower().replace('-', '_')}"

    def _skill_aliases(self, model) -> list[str]:
        base = self._base_skill_name(model)
        version = str(model.version or "v0_1").lower().replace(".", "_").replace("-", "_")
        model_alias = model.id.lower().replace("-", "_")
        return [base, f"{base}_{version}", f"{base}_{model_alias}", f"{base}_{version}_{model_alias}"]


skill_registry = SkillRegistry()
