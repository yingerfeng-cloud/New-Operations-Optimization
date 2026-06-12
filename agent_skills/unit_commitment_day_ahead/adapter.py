from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["load_forecast", "renewable_forecast"]
OPTIONAL_PARAMETERS = ["initial_unit_status", "initial_unit_output"]
API_SKILL_NAME = "run_unit_commitment_day_ahead"


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
    if "horizon" in parameter_draft:
        parameters["horizon"] = parameter_draft["horizon"]
    return {"ok": True, "api_skill_name": API_SKILL_NAME, "request": {"parameters": parameters, "options": {"mode": "sync", "explain": True}}}
