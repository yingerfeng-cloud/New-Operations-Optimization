from __future__ import annotations

import copy
from typing import Any


TIME_SERIES_KEYS = {
    "load_forecast",
    "electricity_price",
    "renewable_forecast",
    "heat_load",
    "electric_load",
}


def infer_parameter_dimensions(parameters: dict[str, Any] | None) -> dict[str, Any]:
    """Materialize dynamic sets from supplied business data.

    Template samples describe examples, not runtime cardinality.  This function
    turns a 24-value forecast into a 24-period contract and derives the unit set
    from the user's keyed parameters before shape validation runs.
    """
    inferred = copy.deepcopy(parameters or {})

    series = next(
        (
            value
            for key, value in inferred.items()
            if key in TIME_SERIES_KEYS and isinstance(value, list) and value
        ),
        None,
    )
    if series is not None:
        horizon = len(series)
        supplied_time = inferred.get("time")
        if not isinstance(supplied_time, list) or len(supplied_time) != horizon:
            inferred["time"] = list(range(horizon))
        inferred["horizon"] = horizon

    unit_keys: set[str] = set()
    for key in (
        "unit_min_output",
        "unit_max_output",
        "fuel_cost",
        "ramp_up_limit",
        "ramp_down_limit",
        "initial_unit_output",
    ):
        value = inferred.get(key)
        if isinstance(value, dict):
            unit_keys.update(str(item) for item in value)
    if unit_keys:
        inferred["unit"] = sorted(unit_keys, key=_natural_key)

    # The economic-dispatch builder needs an initial point for first-period
    # ramping.  In the absence of an explicit value, minimum stable output is a
    # deterministic and auditable system inference.
    if "initial_unit_output" not in inferred and isinstance(inferred.get("unit_min_output"), dict):
        inferred["initial_unit_output"] = copy.deepcopy(inferred["unit_min_output"])
    return inferred


def validate_business_semantics(parameters: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Validate cross-field constraints that JSON shape checks cannot express."""
    values = parameters or {}
    invalid: list[dict[str, Any]] = []
    load = values.get("load_forecast")
    minimum = values.get("unit_min_output")
    maximum = values.get("unit_max_output")
    bounds_invalid_units: set[str] = set()

    if isinstance(load, list):
        bad_periods = [index for index, value in enumerate(load) if not _is_number(value) or float(value) < 0]
        if bad_periods:
            invalid.append({
                "key": "load_forecast",
                "code": "LOAD_VALUE_INVALID",
                "error": "load values must be non-negative numbers",
                "message": f"负荷预测有 {len(bad_periods)} 个时段不是非负数，请修正后继续。",
                "periods": bad_periods[:20],
            })

    if isinstance(minimum, dict) and isinstance(maximum, dict):
        shared = sorted(set(map(str, minimum)) & set(map(str, maximum)), key=_natural_key)
        bad_units = [
            unit
            for unit in shared
            if _is_number(minimum.get(unit))
            and _is_number(maximum.get(unit))
            and float(minimum[unit]) > float(maximum[unit])
        ]
        if bad_units:
            bounds_invalid_units.update(bad_units)
            detail = "、".join(
                f"{unit}（最小 {minimum[unit]} > 最大 {maximum[unit]}）"
                for unit in bad_units[:8]
            )
            invalid.append({
                "key": "unit_min_output",
                "related_key": "unit_max_output",
                "code": "UNIT_OUTPUT_BOUNDS_INVALID",
                "error": "minimum output exceeds maximum output",
                "message": f"机组出力上下界冲突：{detail}。",
                "units": bad_units,
            })

        if not bad_units and isinstance(load, list) and shared:
            if all(_is_number(minimum.get(unit)) and _is_number(maximum.get(unit)) for unit in shared):
                total_min = sum(float(minimum[unit]) for unit in shared)
                total_max = sum(float(maximum[unit]) for unit in shared)
                below = [i for i, value in enumerate(load) if _is_number(value) and float(value) < total_min]
                above = [i for i, value in enumerate(load) if _is_number(value) and float(value) > total_max]
                if below or above:
                    pieces = []
                    if below:
                        pieces.append(f"{len(below)} 个时段低于在线机组最小总出力 {total_min:g} MW")
                    if above:
                        pieces.append(f"{len(above)} 个时段超过最大总出力 {total_max:g} MW")
                    invalid.append({
                        "key": "load_forecast",
                        "code": "LOAD_OUTSIDE_CAPACITY",
                        "error": "load is outside aggregate unit capacity",
                        "message": "负荷与机组容量不可行：" + "；".join(pieces) + "。",
                        "below_periods": below[:20],
                        "above_periods": above[:20],
                        "aggregate_min": total_min,
                        "aggregate_max": total_max,
                    })

    initial = values.get("initial_unit_output")
    if not bounds_invalid_units and isinstance(initial, dict) and isinstance(minimum, dict) and isinstance(maximum, dict):
        bad_initial = [
            unit
            for unit, value in initial.items()
            if unit in minimum
            and unit in maximum
            and _is_number(value)
            and not (float(minimum[unit]) <= float(value) <= float(maximum[unit]))
        ]
        if bad_initial:
            invalid.append({
                "key": "initial_unit_output",
                "code": "INITIAL_OUTPUT_OUT_OF_BOUNDS",
                "error": "initial output is outside unit bounds",
                "message": "初始出力超出机组上下界：" + "、".join(map(str, bad_initial[:8])) + "。",
                "units": bad_initial,
            })
    return invalid


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _natural_key(value: str) -> tuple[str, int]:
    prefix = value.rstrip("0123456789")
    suffix = value[len(prefix):]
    return prefix, int(suffix) if suffix else -1
