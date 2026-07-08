from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["k", "flow_min", "flow_max", "head_min", "head_max", "power_max"]
OPTIONAL_PARAMETERS = []
API_SKILL_NAME = "run_nonlinear_hydro_power_demo"


def build_api_request(parameter_draft: dict[str, Any], confirmed_defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    confirmed_defaults = confirmed_defaults or {}
    parameter_draft = parameter_draft or {}
    missing = [key for key in REQUIRED_PARAMETERS if key not in parameter_draft]
    if missing:
        return {"ok": False, "missing_parameters": missing}
    parameters = {key: parameter_draft[key] for key in REQUIRED_PARAMETERS}
    for key in OPTIONAL_PARAMETERS:
        if key in parameter_draft:
            parameters[key] = parameter_draft[key]
        elif key in confirmed_defaults:
            parameters[key] = confirmed_defaults[key]
    return {"ok": True, "api_skill_name": API_SKILL_NAME, "request": {"parameters": parameters, "options": {"mode": "sync", "explain": True}}}
