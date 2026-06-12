from __future__ import annotations

from typing import Any


def diagnose_infeasible(model_code: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    if model_code != "unit_commitment_day_ahead":
        if model_code == "economic_dispatch":
            return _diagnose_economic_dispatch(params)
        if model_code == "storage_dispatch":
            return _diagnose_storage(params)
        if model_code == "renewable_storage_dispatch":
            return _diagnose_renewable_storage(params)
        if model_code == "chp_dispatch":
            return _diagnose_chp(params)
        return []
    return diagnose_unit_commitment(params)


def diagnose_unit_commitment(params: dict[str, Any]) -> list[dict[str, Any]]:
    diagnosis: list[dict[str, Any]] = []
    units = list(params.get("unit", params.get("units", ["U1", "U2", "U3"])))
    load = _series(params.get("load_forecast"), 24, 180.0)
    renewable = _series(params.get("renewable_forecast"), len(load), 0.0)
    p_min = _unit_dict(params.get("unit_min_output"), units, 20.0)
    p_max = _unit_dict(params.get("unit_max_output"), units, 100.0)
    ramp_up = _unit_dict(params.get("ramp_up_limit"), units, 50.0)
    ramp_down = _unit_dict(params.get("ramp_down_limit"), units, 50.0)
    initial_status = _unit_dict(params.get("initial_unit_status"), units, 0.0)
    initial_output = _unit_dict(params.get("initial_unit_output"), units, 0.0)
    reserve_ratio = float(params.get("reserve_ratio", 0.1))

    for t, value in enumerate(load):
        available = sum(p_max.values()) + renewable[t]
        needed = value * (1.0 + reserve_ratio)
        if available + 1e-6 < needed:
            diagnosis.append(
                {
                    "rule": "capacity_check",
                    "level": "high",
                    "message": f"time {t}: available capacity {available:.2f} MW is below load plus reserve {needed:.2f} MW.",
                    "suggestion": "Increase committed capacity, lower reserve ratio, or add emergency supply/curtailment variables.",
                }
            )

    for t, value in enumerate(load):
        min_generation = sum(p_min.values())
        net_load = value - renewable[t]
        if min_generation - 1e-6 > net_load:
            diagnosis.append(
                {
                    "rule": "minimum_output_check",
                    "level": "medium",
                    "message": f"time {t}: all-unit minimum output {min_generation:.2f} MW is above net load {net_load:.2f} MW.",
                    "suggestion": "Allow unit shutdown, renewable curtailment, or reduce must-run minimum output.",
                }
            )

    for unit in units:
        if initial_status.get(unit, 0.0) < 0.5 and initial_output.get(unit, 0.0) > 1e-6:
            diagnosis.append(
                {
                    "rule": "initial_status_check",
                    "level": "high",
                    "message": f"{unit}: initial output is positive while initial status is offline.",
                    "suggestion": "Align initial_unit_status and initial_unit_output before submitting the job.",
                }
            )

    net_load = [load[t] - renewable[t] for t in range(len(load))]
    for t in range(1, len(net_load)):
        delta = net_load[t] - net_load[t - 1]
        if delta > sum(ramp_up.values()) + 1e-6:
            diagnosis.append(
                {
                    "rule": "ramp_up_check",
                    "level": "medium",
                    "message": f"time {t}: net load increase {delta:.2f} MW exceeds aggregate ramp-up capability.",
                    "suggestion": "Relax ramp-up limits, start units earlier, or add storage/import flexibility.",
                }
            )
        if -delta > sum(ramp_down.values()) + 1e-6:
            diagnosis.append(
                {
                    "rule": "ramp_down_check",
                    "level": "medium",
                    "message": f"time {t}: net load decrease {-delta:.2f} MW exceeds aggregate ramp-down capability.",
                    "suggestion": "Relax ramp-down limits or add curtailment/export flexibility.",
                }
            )
    return diagnosis[:20]


def _series(value: Any, horizon: int, default: float) -> list[float]:
    if isinstance(value, list):
        return [float(v) for v in value]
    if isinstance(value, dict):
        return [float(value.get(str(i), value.get(i, default))) for i in range(horizon)]
    return [default for _ in range(horizon)]


def _unit_dict(value: Any, units: list[str], default: float) -> dict[str, float]:
    if isinstance(value, dict):
        return {unit: float(value.get(unit, value.get(str(unit), default))) for unit in units}
    return {unit: default for unit in units}


def _diagnose_economic_dispatch(params: dict[str, Any]) -> list[dict[str, Any]]:
    units = list(params.get("unit", ["U1", "U2"]))
    load = _series(params.get("load_forecast"), int(params.get("horizon", 4)), 100.0)
    p_min = _unit_dict(params.get("unit_min_output"), units, 0.0)
    p_max = _unit_dict(params.get("unit_max_output"), units, 100.0)
    ramp = _unit_dict(params.get("ramp_up_limit"), units, 9999.0)
    out = []
    for t, value in enumerate(load):
        if value > sum(p_max.values()):
            out.append({"rule": "capacity_check", "level": "high", "message": f"time {t}: load exceeds available capacity.", "suggestion": "Increase online capacity or add load shedding variable."})
        if value < sum(p_min.values()):
            out.append({"rule": "minimum_output_check", "level": "medium", "message": f"time {t}: load is below aggregate minimum output.", "suggestion": "Reduce must-run units or allow curtailment/export."})
    for t in range(1, len(load)):
        if load[t] - load[t - 1] > sum(ramp.values()):
            out.append({"rule": "ramp_check", "level": "medium", "message": f"time {t}: load increase exceeds ramp capability.", "suggestion": "Relax ramp limits or pre-position generation."})
    return out[:20]


def _diagnose_storage(params: dict[str, Any]) -> list[dict[str, Any]]:
    storage = list(params.get("storage", ["B1"]))
    capacity = _unit_dict(params.get("storage_capacity"), storage, 100.0)
    initial = _unit_dict(params.get("initial_soc"), storage, 0.0)
    charge = _unit_dict(params.get("charge_power_max"), storage, 0.0)
    discharge = _unit_dict(params.get("discharge_power_max"), storage, 0.0)
    out = []
    for s in storage:
        if initial[s] < 0 or initial[s] > capacity[s]:
            out.append({"rule": "initial_soc_check", "level": "high", "message": f"{s}: initial SOC is outside capacity bounds.", "suggestion": "Correct initial_soc or storage_capacity."})
        if capacity[s] <= 0:
            out.append({"rule": "capacity_check", "level": "high", "message": f"{s}: storage capacity is not positive.", "suggestion": "Set a positive storage_capacity."})
        if charge[s] <= 0 and discharge[s] <= 0:
            out.append({"rule": "power_limit_check", "level": "medium", "message": f"{s}: charge and discharge limits are both zero.", "suggestion": "Provide usable charge/discharge power limits."})
    return out


def _diagnose_renewable_storage(params: dict[str, Any]) -> list[dict[str, Any]]:
    load = _series(params.get("load_forecast"), int(params.get("horizon", 4)), 80.0)
    grid = _series(params.get("grid_export_limit"), len(load), 9999.0)
    storage = list(params.get("storage", ["B1"]))
    capacity = _unit_dict(params.get("storage_capacity"), storage, 0.0)
    out = []
    for t, value in enumerate(load):
        if grid[t] < value:
            out.append({"rule": "grid_export_limit_check", "level": "high", "message": f"time {t}: grid limit is below load.", "suggestion": "Increase grid_export_limit or add demand response/load shedding."})
    if sum(capacity.values()) <= 0:
        out.append({"rule": "storage_capacity_check", "level": "medium", "message": "No usable storage capacity is configured.", "suggestion": "Add storage capacity to absorb renewable surplus."})
    if not params.get("renewable_forecast"):
        out.append({"rule": "forecast_check", "level": "medium", "message": "Renewable forecast is missing.", "suggestion": "Provide site-time renewable_forecast."})
    return out[:20]


def _diagnose_chp(params: dict[str, Any]) -> list[dict[str, Any]]:
    units = list(params.get("unit", ["CHP1", "CHP2"]))
    e_load = _series(params.get("electric_load"), int(params.get("horizon", 4)), 80.0)
    h_load = _series(params.get("heat_load"), len(e_load), 100.0)
    e_max = _unit_dict(params.get("electric_max"), units, 100.0)
    h_max = _unit_dict(params.get("heat_max"), units, 100.0)
    r_min = _unit_dict(params.get("heat_to_power_ratio_min"), units, 0.5)
    r_max = _unit_dict(params.get("heat_to_power_ratio_max"), units, 3.0)
    out = []
    for t, value in enumerate(e_load):
        if value > sum(e_max.values()):
            out.append({"rule": "electric_capacity_check", "level": "high", "message": f"time {t}: electric load exceeds CHP electric capacity.", "suggestion": "Add electric capacity or relax balance with import."})
        if h_load[t] > sum(h_max.values()):
            out.append({"rule": "heat_capacity_check", "level": "high", "message": f"time {t}: heat load exceeds CHP heat capacity.", "suggestion": "Add boiler/heat storage or increase heat capacity."})
    for u in units:
        if r_min[u] > r_max[u]:
            out.append({"rule": "coupling_region_check", "level": "high", "message": f"{u}: heat-to-power minimum ratio exceeds maximum ratio.", "suggestion": "Correct coupling_region parameters."})
    return out[:20]
