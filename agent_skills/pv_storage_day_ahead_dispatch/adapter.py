from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["horizon", "time", "time_volume", "pv_forecast", "grid_limit", "schedule", "price", "storage_power_capacity", "storage_energy_capacity", "initial_soc", "terminal_time", "terminal_soc_target", "capex_power", "capex_energy", "curtailment_penalty", "storage_cycle_cost", "eta_ch", "eta_dis", "delta_t", "soc_min"]
OPTIONAL_PARAMETERS = []
API_SKILL_NAME = "run_pv_storage_day_ahead_dispatch"


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
