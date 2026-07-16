from __future__ import annotations

import uuid
from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.schemas.model import ModelPackage, ModelView
from app.services.model_service import model_service
from app.storage.memory_store import STORE
from app.templates.power_templates import parameter_schema, power_template_library
from app.utils import now_text


class ModelTemplateLibrary:
    def __init__(self) -> None:
        self.templates = power_template_library()

    def list_templates(self) -> list[dict[str, Any]]:
        self.templates = power_template_library()
        with STORE.lock:
            statuses = STORE.template_status
        rows = []
        for code, template in self.templates.items():
            rows.append(
                {
                    "code": code,
                    "name": template["name"],
                    "version": template.get("version", "v1.0"),
                    "status": statuses.get(code, template.get("status", "published")),
                    "tags": template.get("tags", []),
                    "scenario": template.get("scenario", ""),
                    "description": template.get("description", template.get("scenario", "")),
                    "build_mode": template.get("build_mode", "template_based"),
                    "problem_type": template.get("problem_type", template.get("model_problem_type", "")),
                    "solver": template.get("solver", "HiGHS"),
                    "component_count": len((template.get("component_spec") or {}).get("components", [])),
                }
            )
        return rows

    def get_template(self, template_code: str) -> dict[str, Any]:
        self.templates = power_template_library()
        if template_code not in self.templates:
            raise HTTPException(status_code=404, detail="Template not found")
        template = deepcopy(self.templates[template_code])
        with STORE.lock:
            template["status"] = STORE.template_status.get(template_code, template.get("status", "published"))
        return template

    def clone_template(self, template_code: str) -> ModelView:
        template = self.get_template(template_code)
        timestamp = now_text()
        package = ModelPackage(
            id=f"MODEL-{uuid.uuid4().hex[:8].upper()}",
            template_id=template_code,
            name=f"{template['name']}-clone",
            scene=template.get("scenario", template["name"]),
            version=f"{template.get('version', 'v1.0')}-copy",
            status="developing",
            solver="HiGHS",
            problem_type=template.get("problem_type", template.get("model_problem_type", "MILP")),
            objective=(template.get("objectives") or [{"code": "objective"}])[0]["code"],
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
            ui_metadata=template.get("ui_metadata", {}),
            parameters=self._base_parameters(template),
            input_contract={"runtime_parameters": [p["code"] for p in template.get("parameters", [])]},
            output_contract={"variables": [v["code"] for v in template.get("variables", [])]},
            created_at=timestamp,
            updated_at=timestamp,
        )
        return model_service.create_model(package)

    def publish(self, template_code: str) -> dict[str, Any]:
        model = self.clone_template(template_code)
        sample = self.sample_runtime_parameters(template_code)
        model_service.run_model_test_case(model.id, {"parameters": sample})
        published = model_service.publish_model(model.id)
        with STORE.lock:
            STORE.template_status[template_code] = "published"
        template = self.get_template(template_code)
        template["publish_validation"] = {"clone_status": "passed", "publish_status": "passed", "test_status": "passed"}
        return template

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
        return f"{int(granularity) if granularity and float(granularity).is_integer() else granularity}min" if granularity else None

    def unpublish(self, template_code: str) -> dict[str, Any]:
        self.get_template(template_code)
        with STORE.lock:
            STORE.template_status[template_code] = "offline"
        return self.get_template(template_code)

    def parameter_schema(self, template_code: str) -> list[dict[str, Any]]:
        return parameter_schema(self.get_template(template_code))

    def sample_runtime_parameters(self, template_code: str) -> dict[str, Any]:
        return deepcopy(self.get_template(template_code).get("sample_runtime_parameters", {}))

    def _base_parameters(self, template: dict[str, Any]) -> dict[str, Any]:
        sample = template.get("sample_runtime_parameters", {})
        return deepcopy(sample)


template_library = ModelTemplateLibrary()

