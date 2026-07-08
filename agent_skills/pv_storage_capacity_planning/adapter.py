from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["load_forecast", "unit_max_output", "fuel_cost"]
OPTIONAL_PARAMETERS = ["unit_min_output", "ramp_up_limit", "ramp_down_limit"]


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
    return {
        "ok": True,
        "api_skill_name": "run_economic_dispatch",
        "request": {
            "parameters": parameters,
            "options": {"mode": "sync", "explain": True},
        },
    }
