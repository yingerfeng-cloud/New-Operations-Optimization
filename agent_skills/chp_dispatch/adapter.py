from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["electric_load", "heat_load", "fuel_cost", "electric_max", "heat_max"]
OPTIONAL_PARAMETERS = ["electric_min", "heat_min"]
API_SKILL_NAME = "run_chp_dispatch"


def build_api_request(parameter_draft: dict[str, Any], confirmed_defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    confirmed_defaults = confirmed_defaults or {}
    missing = [key for key in REQUIRED_PARAMETERS if key not in (parameter_draft or {})]
    if missing:
        return {"ok": False, "missing_parameters": missing}
    parameters = {key: parameter_draft[key] for key in REQUIRED_PARAMETERS}
    for key in OPTIONAL_PARAMETERS:
        if key in parameter_draft:
            parameters[key] = parameter_draft[key]
        elif key in confirmed_defaults:
            parameters[key] = confirmed_defaults[key]
    return {"ok": True, "api_skill_name": API_SKILL_NAME, "request": {"parameters": parameters, "options": {"mode": "sync", "explain": True}}}
