from __future__ import annotations

from typing import Any


REQUIRED_PARAMETERS = ["horizon", "time", "time_volume", "time_labels", "delta_t", "load_forecast", "spot_price_forecast", "contract_energy", "contract_price", "bid_min", "bid_max", "deviation_penalty", "storage_capacity", "storage_soc_init", "storage_soc_min", "storage_soc_max", "terminal_soc_target", "terminal_soc_penalty", "charge_max", "discharge_max", "charge_efficiency", "discharge_efficiency", "storage_cycle_cost", "flex_up", "flex_down", "cut_limit", "shift_cost", "cut_cost"]
OPTIONAL_PARAMETERS = []
API_SKILL_NAME = "run_retail_da_spot_bidding_v1"


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
