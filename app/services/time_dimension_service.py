from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.model_dimensions import extract_dimensions


POLICIES = {"not_applicable", "fixed", "runtime_variable", "data_derived"}
SYSTEM_TIME_KEYS = {"horizon"}

# Metadata may name custom sets, but the current builders are only end-to-end
# verified with the standard ``time`` and ``time_volume`` set names.


def resolve_time_dimension_config(
    *,
    model: object | None,
    semantic_spec: dict | None,
    component_spec: dict | None,
    generic_spec: dict | None,
    runtime_parameters: dict | None,
) -> dict:
    """Resolve platform time-dimension metadata from model assets or conservative inference."""

    for source in (
        getattr(model, "ui_metadata", None),
        (semantic_spec or {}).get("ui_metadata"),
        (component_spec or {}).get("ui_metadata"),
        (generic_spec or {}).get("ui_metadata"),
    ):
        config = _time_dimension_from_ui_metadata(source)
        if config:
            return _normalize_config(
                config,
                runtime_parameters,
                available_sets=_available_set_names(semantic_spec, component_spec, generic_spec),
            )

    inferred = _infer_config(
        semantic_spec=semantic_spec,
        component_spec=component_spec,
        generic_spec=generic_spec,
        runtime_parameters=runtime_parameters,
    )
    return _normalize_config(
        inferred,
        runtime_parameters,
        available_sets=_available_set_names(semantic_spec, component_spec, generic_spec),
    )


def resolve_state_time_set(
    config: dict[str, Any],
    *,
    available_sets: set[str] | None = None,
) -> str | None:
    """Preserve explicit null while conservatively migrating old contracts."""

    if "state_time_set" in config:
        value = config["state_time_set"]
        if value is None or value == "":
            return None
        return str(value)
    return "time_volume" if available_sets and "time_volume" in available_sets else None


def normalize_runtime_time_dimension(
    *,
    semantic_spec: dict | None,
    component_spec: dict | None,
    generic_spec: dict | None,
    runtime_parameters: dict,
    explicit_horizon: int | None,
    explicitly_provided_keys: set[str],
    time_dimension: dict,
) -> tuple[dict, dict | None, dict | None, dict]:
    params = deepcopy(runtime_parameters or {})
    component = deepcopy(component_spec) if component_spec else None
    generic = deepcopy(generic_spec) if generic_spec else None
    available_sets = _available_set_names(semantic_spec, component_spec, generic_spec)
    config = _normalize_config(time_dimension or {}, params, available_sets=available_sets)

    policy = str(config.get("policy") or "not_applicable")
    time_set = str(config.get("time_set") or "time")
    state_time_set = resolve_state_time_set(config, available_sets=available_sets)
    provided_keys = set(explicitly_provided_keys or set())
    horizon_provided = explicit_horizon is not None or "horizon" in provided_keys
    provided_horizon = explicit_horizon if explicit_horizon is not None else _coerce_int(params.get("horizon"))

    if policy == "not_applicable":
        if horizon_provided:
            _raise_detail(
                "当前模型不是时序模型，不支持设置调度时段 horizon。",
                [{"field": "horizon", "error": "not_applicable", "expected": "不提交 horizon", "actual": provided_horizon}],
            )
        params.pop("horizon", None)
        params.pop(time_set, None)
        if state_time_set:
            params.pop(state_time_set, None)
        return params, component, generic, config

    if policy == "data_derived":
        derived_horizon = _derive_horizon(params, config, semantic_spec, component, generic)
        if derived_horizon is None:
            _raise_detail(
                "当前模型调度时段需要由主时间序列推导，但未找到可推导的时间序列参数。",
                [{"field": "horizon", "error": "data_derived_missing_source", "expected": config.get("derive_from"), "actual": None}],
            )
        if horizon_provided and provided_horizon != derived_horizon:
            _raise_detail(
                f"提交的调度时段 horizon={provided_horizon} 与主时间序列推导结果 {derived_horizon} 不一致。",
                [{"field": "horizon", "error": "data_derived_horizon_mismatch", "expected": derived_horizon, "actual": provided_horizon}],
            )
        horizon = derived_horizon
        _validate_allowed_horizon(config, horizon)
        params["horizon"] = horizon
        params[time_set] = list(range(horizon))
        if state_time_set:
            params[state_time_set] = list(range(horizon + 1))
        component = _rebuild_spec_sets(component, time_set, state_time_set, horizon)
        generic = _rebuild_spec_sets(generic, time_set, state_time_set, horizon)
        _apply_horizon_metadata(params, config, horizon, provided_keys)
        _normalize_terminal_time(params, horizon, provided_keys, semantic_spec, component, generic)
        _validate_time_series_lengths(params, semantic_spec, component, generic, config)
        config["resolved_horizon"] = horizon
        return params, component, generic, config

    default_horizon = _default_horizon(config, params, semantic_spec, component, generic, time_set)
    if default_horizon is None:
        default_horizon = 0

    if policy == "fixed":
        if horizon_provided and provided_horizon is not None and default_horizon and provided_horizon != default_horizon:
            _raise_detail(
                "当前模型为固定时段模型，不支持运行时修改 horizon。",
                [{"field": "horizon", "error": "fixed_horizon_override", "expected": default_horizon, "actual": provided_horizon}],
            )
        horizon = provided_horizon if provided_horizon is not None and provided_horizon == default_horizon else default_horizon
        if horizon:
            params["horizon"] = horizon
            published_time = _first_set_values(time_set, semantic_spec, component, generic)
            params.setdefault(time_set, published_time or list(range(horizon)))
            if state_time_set:
                published_state_time = _first_set_values(state_time_set, semantic_spec, component, generic)
                params.setdefault(state_time_set, published_state_time or list(range(horizon + 1)))
            _apply_horizon_metadata(params, config, horizon, provided_keys)
            _normalize_terminal_time(params, horizon, provided_keys, semantic_spec, component, generic)
            _validate_time_series_lengths(params, semantic_spec, component, generic, config)
        config["resolved_horizon"] = horizon or None
        return params, component, generic, config

    if policy != "runtime_variable":
        _raise_detail(
            f"模型时间维度策略无效：{policy}。",
            [{"field": "time_dimension.policy", "error": "invalid_policy", "expected": sorted(POLICIES), "actual": policy}],
        )

    horizon = provided_horizon if provided_horizon is not None else default_horizon
    if horizon is None or int(horizon) <= 0:
        _raise_detail(
            "当前模型支持自定义调度时段，但未能确定有效的 horizon。",
            [{"field": "horizon", "error": "missing_horizon", "expected": "正整数", "actual": provided_horizon}],
        )
    horizon = int(horizon)
    _validate_allowed_horizon(config, horizon)
    params["horizon"] = horizon
    params[time_set] = list(range(horizon))
    if state_time_set:
        params[state_time_set] = list(range(horizon + 1))
    component = _rebuild_spec_sets(component, time_set, state_time_set, horizon)
    if generic is not None:
        generic = _rebuild_spec_sets(generic, time_set, state_time_set, horizon)
    _apply_horizon_metadata(params, config, horizon, provided_keys)
    _normalize_terminal_time(params, horizon, provided_keys, semantic_spec, component, generic)
    _validate_time_series_lengths(params, semantic_spec, component, generic, config)
    config["resolved_horizon"] = horizon
    return params, component, generic, config


def _time_dimension_from_ui_metadata(source: Any) -> dict | None:
    if not isinstance(source, dict):
        return None
    config = source.get("time_dimension")
    return deepcopy(config) if isinstance(config, dict) else None


def _normalize_config(
    config: dict,
    runtime_parameters: dict | None,
    *,
    available_sets: set[str] | None = None,
) -> dict:
    result = deepcopy(config or {})
    policy = str(result.get("policy") or ("fixed" if result.get("enabled") else "not_applicable"))
    if policy not in POLICIES:
        policy = "not_applicable"
    result["policy"] = policy
    result["enabled"] = bool(result.get("enabled", policy != "not_applicable"))
    result.setdefault("time_set", "time")
    result["state_time_set"] = resolve_state_time_set(result, available_sets=available_sets)
    allowed_horizons = result.get("allowed_horizons")
    if isinstance(allowed_horizons, (list, tuple, set)):
        normalized_allowed = []
        for value in allowed_horizons:
            horizon = _coerce_int(value)
            if horizon is not None and horizon > 0 and horizon not in normalized_allowed:
                normalized_allowed.append(horizon)
        result["allowed_horizons"] = normalized_allowed
    else:
        result["allowed_horizons"] = []
    if result.get("default_horizon") is None:
        horizon = _coerce_int((runtime_parameters or {}).get("horizon"))
        if horizon is not None:
            result["default_horizon"] = horizon
    result.setdefault("editable", policy == "runtime_variable")
    return result


def _validate_allowed_horizon(config: dict, horizon: int) -> None:
    allowed = (config.get("allowed_horizons") or []) if config.get("policy") == "runtime_variable" else []
    if allowed:
        if horizon in allowed:
            return
        choices = "、".join(str(value) for value in allowed)
        _raise_detail(
            f"当前模型仅支持 {choices} 点调度时段切换，实际提交 horizon={horizon}。",
            [{"field": "horizon", "error": "horizon_not_allowed", "expected": allowed, "actual": horizon}],
        )
    minimum = _coerce_int(config.get("min_horizon")) or 1
    maximum = _coerce_int(config.get("max_horizon"))
    step = _coerce_int(config.get("horizon_step")) or 1
    if horizon < minimum or maximum is not None and horizon > maximum or (horizon - minimum) % step != 0:
        _raise_detail(
            f"提交的 horizon={horizon} 不符合模型范围：最小值 {minimum}，最大值 {maximum or '不限'}，步长 {step}。",
            [{"field": "horizon", "error": "horizon_out_of_range", "expected": {"min": minimum, "max": maximum, "step": step}, "actual": horizon}],
        )


def _apply_horizon_metadata(params: dict, config: dict, horizon: int, provided_keys: set[str]) -> None:
    allowed_horizons = config.get("allowed_horizons") or []
    expected_interval = _mapping_value(config.get("interval_minutes_by_horizon"), horizon) if allowed_horizons else config.get("interval_minutes")
    expected_delta = _mapping_value(config.get("delta_t_by_horizon"), horizon) if allowed_horizons else config.get("delta_t")
    if expected_delta is None and expected_interval is not None:
        expected_delta = float(expected_interval) / 60
    for field, expected in (("interval_minutes", expected_interval), ("delta_t", expected_delta)):
        if expected is None:
            continue
        if field in provided_keys and not _numbers_match(params.get(field), expected):
            _raise_detail(
                f"运行参数 {field} 与模型时间维度契约不一致，应为 {expected}，实际提交 {params.get(field)}。",
                [{"field": field, "error": "time_granularity_mismatch", "expected": expected, "actual": params.get(field)}],
            )
        params[field] = expected

    label_set = str(config.get("label_set") or "")
    if not label_set or config.get("label_generation") != "auto":
        return
    if label_set in provided_keys:
        labels = params.get(label_set)
        actual = len(labels) if isinstance(labels, (list, dict)) else None
        if actual != horizon:
            _raise_detail(
                f"当前调度时段 horizon={horizon}，但参数 {label_set} 实际提供 {actual if actual is not None else '非数组'} 个标签，需要 {horizon} 个标签。",
                [{"field": label_set, "error": "time_labels_length_mismatch", "expected": horizon, "actual": actual}],
            )
        return
    params[label_set] = _generate_time_labels(horizon, params.get("interval_minutes") or config.get("interval_minutes"), str(config.get("label_format") or "HH:mm"))


def _mapping_value(mapping: Any, horizon: int) -> Any:
    if not isinstance(mapping, dict):
        return None
    if str(horizon) in mapping:
        return mapping[str(horizon)]
    return mapping.get(horizon)


def _numbers_match(actual: Any, expected: Any) -> bool:
    try:
        return abs(float(actual) - float(expected)) <= 1e-8
    except (TypeError, ValueError):
        return actual == expected


def _generate_time_labels(horizon: int, interval_minutes: Any, label_format: str = "HH:mm") -> list[str]:
    try:
        minutes = int(interval_minutes)
    except (TypeError, ValueError):
        minutes = 0
    if label_format == "sequence" or minutes <= 0:
        return [f"T{index + 1}" for index in range(horizon)]
    return [f"{((index * minutes) // 60) % 24:02d}:{(index * minutes) % 60:02d}" for index in range(horizon)]


def _infer_config(
    *,
    semantic_spec: dict | None,
    component_spec: dict | None,
    generic_spec: dict | None,
    runtime_parameters: dict | None,
) -> dict:
    has_time = _has_time_sets(semantic_spec) or _has_time_sets(component_spec) or _has_time_sets(generic_spec) or _has_time_dimensions(semantic_spec) or _has_time_dimensions(component_spec) or _has_time_dimensions(generic_spec)
    if not has_time:
        return {"enabled": False, "policy": "not_applicable"}
    default_horizon = _default_horizon({}, runtime_parameters or {}, semantic_spec, component_spec, generic_spec, "time")
    return {
        "enabled": True,
        "policy": "fixed",
        "default_horizon": default_horizon,
        "time_set": "time",
        "state_time_set": "time_volume" if "time_volume" in _available_set_names(semantic_spec, component_spec, generic_spec) else None,
        "editable": False,
    }


def _has_time_sets(spec: dict | None) -> bool:
    if not isinstance(spec, dict):
        return False
    sets = spec.get("sets") or {}
    if isinstance(sets, dict):
        return "time" in sets or "time_volume" in sets
    if isinstance(sets, list):
        for item in sets:
            if isinstance(item, dict) and str(item.get("code") or item.get("key") or item.get("name")) in {"time", "time_volume"}:
                return True
    return False


def _has_time_dimensions(spec: dict | None) -> bool:
    if not isinstance(spec, dict):
        return False
    for section in ("parameters", "variables"):
        for item in spec.get(section) or []:
            if isinstance(item, dict) and any(dim in {"time", "time_volume"} for dim in extract_dimensions(item)):
                return True
    for child in ("component_spec", "semantic_spec"):
        if _has_time_dimensions(spec.get(child)):
            return True
    return False


def _available_set_names(*specs: dict | None) -> set[str]:
    names: set[str] = set()
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        sets = spec.get("sets") or {}
        if isinstance(sets, dict):
            names.update(str(code) for code in sets)
        elif isinstance(sets, list):
            names.update(
                str(item.get("code") or item.get("key") or item.get("name"))
                for item in sets
                if isinstance(item, dict) and (item.get("code") or item.get("key") or item.get("name"))
            )
    return names


def _default_horizon(config: dict, params: dict, semantic_spec: dict | None, component_spec: dict | None, generic_spec: dict | None, time_set: str) -> int | None:
    for value in (
        config.get("default_horizon"),
        params.get("horizon"),
        len(params.get(time_set)) if isinstance(params.get(time_set), list) else None,
        _set_length(semantic_spec, time_set),
        _set_length(component_spec, time_set),
        _set_length(generic_spec, time_set),
    ):
        horizon = _coerce_int(value)
        if horizon is not None and horizon > 0:
            return horizon
    return None


def _set_length(spec: dict | None, set_name: str) -> int | None:
    if not isinstance(spec, dict):
        return None
    sets = spec.get("sets") or {}
    if isinstance(sets, dict):
        values = sets.get(set_name)
        return len(values) if isinstance(values, list) else None
    if isinstance(sets, list):
        for item in sets:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("key") or item.get("name") or "")
            if code != set_name:
                continue
            members = item.get("members") or item.get("values") or []
            if isinstance(members, list):
                return len(members)
            horizon = _coerce_int(item.get("horizon"))
            if horizon is not None:
                return horizon + (1 if item.get("type") == "state_time" else 0)
    return None


def _first_set_values(set_name: str, *specs: dict | None) -> list[Any]:
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        sets = spec.get("sets") or {}
        if isinstance(sets, dict) and isinstance(sets.get(set_name), list):
            return deepcopy(sets[set_name])
        if isinstance(sets, list):
            for item in sets:
                if not isinstance(item, dict):
                    continue
                code = str(item.get("code") or item.get("key") or item.get("name") or "")
                values = item.get("members") or item.get("values") or []
                if code == set_name and isinstance(values, list):
                    return deepcopy(values)
    return []


def _rebuild_spec_sets(spec: dict | None, time_set: str, state_time_set: str | None, horizon: int) -> dict | None:
    if spec is None:
        return None
    result = deepcopy(spec)
    sets = result.setdefault("sets", {})
    if isinstance(sets, dict):
        sets[time_set] = list(range(horizon))
        if state_time_set:
            sets[state_time_set] = list(range(horizon + 1))
        return result
    if isinstance(sets, list):
        seen: set[str] = set()
        for item in sets:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("key") or item.get("name") or "")
            if code == time_set:
                item["values"] = list(range(horizon))
                seen.add(time_set)
            elif state_time_set and code == state_time_set:
                item["values"] = list(range(horizon + 1))
                seen.add(state_time_set)
        if time_set not in seen:
            sets.append({"code": time_set, "name": "调度时段", "values": list(range(horizon))})
        if state_time_set and state_time_set not in seen:
            sets.append({"code": state_time_set, "name": "状态时点", "values": list(range(horizon + 1))})
    return result


def _derive_horizon(params: dict, config: dict, semantic_spec: dict | None, component_spec: dict | None, generic_spec: dict | None) -> int | None:
    source = config.get("derive_from")
    if source and str(source) in params:
        value = params[str(source)]
        item = next((row for row in _parameter_defs(semantic_spec, component_spec, generic_spec) if _param_code(row) == str(source)), {})
        dimensions = extract_dimensions(item)
        time_set = str(config.get("time_set") or "time")
        time_index = dimensions.index(time_set) if time_set in dimensions else 0
        if time_index == 0 and isinstance(value, (list, dict)):
            return len(value)
        rows = value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else []
        first = rows[0] if rows else None
        if isinstance(first, (list, dict)):
            return len(first)
    for item in _parameter_defs(semantic_spec, component_spec, generic_spec):
        code = _param_code(item)
        if not code or code not in params:
            continue
        dimensions = extract_dimensions(item)
        time_set = str(config.get("time_set") or "time")
        if time_set in dimensions and isinstance(params[code], (list, dict)):
            time_index = dimensions.index(time_set)
            if time_index == 0:
                return len(params[code])
            rows = params[code] if isinstance(params[code], list) else list(params[code].values())
            if rows and isinstance(rows[0], (list, dict)):
                return len(rows[0])
    return None


def _normalize_terminal_time(
    params: dict,
    horizon: int,
    provided_keys: set[str],
    *specs: dict | None,
) -> None:
    if "terminal_time" not in params and not any(
        _param_code(item) == "terminal_time" for item in _parameter_defs(*specs)
    ):
        return
    if "terminal_time" not in params or "terminal_time" not in provided_keys:
        params["terminal_time"] = horizon
        return
    terminal = _coerce_int(params.get("terminal_time"))
    if terminal is None or terminal < 0 or terminal > horizon:
        _raise_detail(
            f"terminal_time 必须位于 0 到 horizon={horizon} 之间。",
            [{"field": "terminal_time", "error": "terminal_time_out_of_range", "expected": f"0 <= terminal_time <= {horizon}", "actual": params.get("terminal_time")}],
        )
    params["terminal_time"] = terminal


def _validate_time_series_lengths(params: dict, semantic_spec: dict | None, component_spec: dict | None, generic_spec: dict | None, config: dict) -> None:
    horizon = _coerce_int(params.get("horizon"))
    if horizon is None:
        return
    time_set = str(config.get("time_set") or "time")
    state_time_set = resolve_state_time_set(config)
    set_lengths = _runtime_set_lengths(params, semantic_spec, component_spec, generic_spec, time_set, state_time_set, horizon)
    errors: list[dict[str, Any]] = []
    for item in _parameter_defs(semantic_spec, component_spec, generic_spec):
        code = _param_code(item)
        managed_keys = SYSTEM_TIME_KEYS | {time_set}
        if state_time_set:
            managed_keys.add(state_time_set)
        if config.get("label_generation") == "auto" and config.get("label_set"):
            managed_keys.add(str(config["label_set"]))
        if not code or code not in params or code in managed_keys:
            continue
        dimensions = extract_dimensions(item)
        if time_set not in dimensions and (not state_time_set or state_time_set not in dimensions):
            continue
        _validate_value_dimensions(errors, code, params[code], dimensions, set_lengths, horizon, time_set, state_time_set)
    if errors:
        first = errors[0]
        _raise_detail(str(first.get("message") or "时间序列参数长度不匹配。"), errors)


def _runtime_set_lengths(params: dict, semantic_spec: dict | None, component_spec: dict | None, generic_spec: dict | None, time_set: str, state_time_set: str | None, horizon: int) -> dict[str, int]:
    lengths = {time_set: horizon}
    if state_time_set:
        lengths[state_time_set] = horizon + 1
    for spec in (semantic_spec, component_spec, generic_spec):
        for name, length in _iter_set_lengths(spec).items():
            lengths.setdefault(name, length)
    for key, value in params.items():
        if isinstance(value, list):
            lengths[str(key)] = len(value)
    lengths[time_set] = horizon
    if state_time_set:
        lengths[state_time_set] = horizon + 1
    return lengths


def _iter_set_lengths(spec: dict | None) -> dict[str, int]:
    lengths: dict[str, int] = {}
    if not isinstance(spec, dict):
        return lengths
    sets = spec.get("sets") or {}
    if isinstance(sets, dict):
        for key, values in sets.items():
            if isinstance(values, list):
                lengths[str(key)] = len(values)
    elif isinstance(sets, list):
        for item in sets:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("key") or item.get("name") or "")
            values = item.get("members") or item.get("values") or []
            if code and isinstance(values, list):
                lengths[code] = len(values)
    return lengths


def _parameter_defs(*specs: dict | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        for item in spec.get("parameters") or []:
            if isinstance(item, dict):
                rows.append(item)
        child = spec.get("component_spec")
        if isinstance(child, dict):
            for item in child.get("parameters") or []:
                if isinstance(item, dict):
                    rows.append(item)
    return rows


def _param_code(item: dict[str, Any]) -> str:
    return str(item.get("math_param") or item.get("code") or item.get("key") or item.get("name") or "")


def _validate_value_dimensions(
    errors: list[dict[str, Any]],
    code: str,
    value: Any,
    dimensions: list[str],
    set_lengths: dict[str, int],
    horizon: int,
    time_set: str,
    state_time_set: str | None,
) -> None:
    expected_lengths = [set_lengths.get(dim) for dim in dimensions]
    if len(dimensions) == 1:
        expected = expected_lengths[0]
        if expected is None:
            return
        actual = len(value) if isinstance(value, (list, dict)) else None
        if actual != expected:
            errors.append(_length_error(code, horizon, actual, expected, dimensions[0], time_set, state_time_set))
        return
    if len(dimensions) == 2:
        first_expected, second_expected = expected_lengths
        if first_expected is not None:
            actual_first = len(value) if isinstance(value, (list, dict)) else None
            if actual_first != first_expected:
                errors.append(_length_error(code, horizon, actual_first, first_expected, dimensions[0], time_set, state_time_set))
                return
        rows = value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else []
        for idx, row in enumerate(rows):
            actual_second = len(row) if isinstance(row, (list, dict)) else None
            if second_expected is not None and actual_second != second_expected:
                errors.append(_length_error(f"{code}[{idx}]", horizon, actual_second, second_expected, dimensions[1], time_set, state_time_set))
                return


def _length_error(code: str, horizon: int, actual: int | None, expected: int, dimension: str, time_set: str, state_time_set: str | None) -> dict[str, Any]:
    need = horizon if dimension == time_set else horizon + 1 if state_time_set and dimension == state_time_set else expected
    actual_text = "非数组/字典" if actual is None else f"{actual} 个点"
    return {
        "field": code,
        "error": "time_series_length_mismatch",
        "expected": need,
        "actual": actual,
        "message": f"当前调度时段 horizon={horizon}，但参数 {code} 实际提供 {actual_text}，需要 {need} 个点。",
    }


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _raise_detail(message: str, errors: list[dict[str, Any]]) -> None:
    raise HTTPException(status_code=422, detail={"message": message, "errors": errors})
