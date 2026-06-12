from __future__ import annotations

from typing import Any


def create_component_context(model_spec: dict[str, Any], runtime_parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "sets": {},
        "parameters": {},
        "variables": {},
        "derived_parameters": {},
        "derived_expressions": {},
        "constraints": {},
        "metadata": {
            "model_code": model_spec.get("model_code"),
            "model_name": model_spec.get("name"),
            "build_mode": model_spec.get("build_mode", "component_based"),
            "horizon": runtime_parameters.get("horizon", model_spec.get("horizon", 96)),
            "model_problem_type": model_spec.get("model_problem_type", "LP"),
            "required_solver_capabilities": model_spec.get("required_solver_capabilities", ["LP"]),
            "component_types": [c.get("type") for c in model_spec.get("components", [])],
            "ui_language": model_spec.get("ui_language", "zh-CN"),
        },
        "runtime_parameters": runtime_parameters,
        "model_spec": model_spec,
    }
