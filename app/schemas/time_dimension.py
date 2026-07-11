from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.model_dimensions import extract_dimensions, validate_dimension_field_consistency


class TimeDimensionConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: int = 1
    enabled: bool
    policy: Literal["not_applicable", "fixed", "runtime_variable", "data_derived"]
    default_horizon: int | None = None
    time_set: str | None = None
    state_time_set: str | None = None
    editable: bool = False
    min_horizon: int | None = None
    max_horizon: int | None = None
    horizon_step: int | None = None
    allowed_horizons: list[int] = Field(default_factory=list)
    interval_minutes: float | None = None
    delta_t: float | None = None
    interval_minutes_by_horizon: dict[str, float] = Field(default_factory=dict)
    delta_t_by_horizon: dict[str, float] = Field(default_factory=dict)
    derive_from: str | None = None
    label_set: str | None = None
    label_generation: Literal["none", "auto"] = "none"
    label_format: Literal["HH:mm", "sequence"] = "HH:mm"


def _rows(spec: dict | None, section: str) -> list[dict[str, Any]]:
    return [item for item in (spec or {}).get(section) or [] if isinstance(item, dict)]


def _set_rows(*specs: dict | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in specs:
        sets = (spec or {}).get("sets") or []
        if isinstance(sets, dict):
            rows.extend({"code": str(code), "values": values} for code, values in sets.items())
        elif isinstance(sets, list):
            rows.extend(item for item in sets if isinstance(item, dict))
    return rows


def _set_code(item: dict[str, Any]) -> str:
    return str(item.get("code") or item.get("key") or item.get("name") or "")


def _set_values(item: dict[str, Any]) -> list[Any]:
    values = item.get("values") if item.get("values") is not None else item.get("members")
    return values if isinstance(values, list) else []


def _parameter_defs(*specs: dict | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for spec in specs:
        for item in _rows(spec, "parameters"):
            code = str(item.get("math_param") or item.get("code") or item.get("key") or "")
            if code and code not in seen:
                rows.append(item)
                seen.add(code)
    return rows


def _parameter_code(item: dict[str, Any]) -> str:
    return str(item.get("math_param") or item.get("code") or item.get("key") or "")


def _sample_value(code: str, item: dict[str, Any], parameters: dict) -> Any:
    return parameters.get(code, item.get("default", item.get("defaultValue", item.get("default_value", item.get("sample_value")))))


def _length(value: Any) -> int | None:
    return len(value) if isinstance(value, (list, dict)) else None


def _error(field: str, error: str, expected: Any = None, actual: Any = None) -> dict[str, Any]:
    return {"field": field, "error": error, "expected": expected, "actual": actual}


def validate_time_dimension_mode_fields(config: TimeDimensionConfig) -> list[dict[str, Any]]:
    prefix = "ui_metadata.time_dimension"
    policy = config.policy
    mode = "choice" if policy == "runtime_variable" and config.allowed_horizons else "free" if policy == "runtime_variable" else policy
    forbidden: dict[str, tuple[str, ...]] = {
        "not_applicable": (
            "default_horizon", "time_set", "state_time_set", "min_horizon", "max_horizon",
            "horizon_step", "allowed_horizons", "interval_minutes", "delta_t",
            "interval_minutes_by_horizon", "delta_t_by_horizon", "derive_from", "label_set",
        ),
        "fixed": (
            "allowed_horizons", "min_horizon", "max_horizon", "horizon_step",
            "interval_minutes_by_horizon", "delta_t_by_horizon", "derive_from",
        ),
        "free": ("interval_minutes_by_horizon", "delta_t_by_horizon", "derive_from"),
        "choice": ("min_horizon", "max_horizon", "horizon_step", "derive_from", "interval_minutes", "delta_t"),
        "data_derived": (
            "allowed_horizons", "min_horizon", "max_horizon", "horizon_step",
            "interval_minutes_by_horizon", "delta_t_by_horizon",
        ),
    }
    errors: list[dict[str, Any]] = []
    for field in forbidden[mode]:
        actual = getattr(config, field)
        if actual not in (None, [], {}):
            errors.append({
                "field": f"{prefix}.{field}",
                "error": "field_not_allowed_for_policy",
                "policy": policy,
                "expected": [] if isinstance(actual, (list, dict)) else None,
                "actual": actual,
            })
    if policy == "not_applicable" and config.label_generation == "auto":
        errors.append({
            "field": f"{prefix}.label_generation",
            "error": "field_not_allowed_for_policy",
            "policy": policy,
            "expected": "none",
            "actual": "auto",
        })
    expected_enabled = policy != "not_applicable"
    expected_editable = policy == "runtime_variable"
    for field, expected, actual in (
        ("enabled", expected_enabled, config.enabled),
        ("editable", expected_editable, config.editable),
    ):
        if actual != expected:
            errors.append({
                "field": f"{prefix}.{field}",
                "error": "field_not_allowed_for_policy",
                "policy": policy,
                "expected": expected,
                "actual": actual,
            })
    return errors


def validate_time_dimension_contract(
    *,
    config: dict,
    semantic_spec: dict,
    component_spec: dict,
    generic_spec: dict,
    parameters: dict,
    require_publish_ready: bool,
    build_mode: str | None = None,
) -> tuple[list[dict], list[dict]]:
    errors: list[dict] = []
    warnings: list[dict] = []
    try:
        parsed = TimeDimensionConfig.model_validate(config)
    except Exception as exc:
        return [_error("ui_metadata.time_dimension", "时间维度配置格式无效", "有效的 TimeDimensionConfig", str(exc))], warnings
    data = parsed.model_dump()
    prefix = "ui_metadata.time_dimension"
    policy = parsed.policy
    time_set = parsed.time_set or "time"
    state_set = parsed.state_time_set
    errors.extend(validate_time_dimension_mode_fields(parsed))
    definitions = _parameter_defs(semantic_spec, component_spec)
    all_structure = definitions + _rows(semantic_spec, "variables") + _rows(component_spec, "variables")
    time_references = [item for item in all_structure if any(dim in {time_set, state_set} for dim in extract_dimensions(item))]
    for spec_name, spec in (("semantic_spec", semantic_spec), ("component_spec", component_spec), ("generic_spec", generic_spec)):
        for section in ("parameters", "variables"):
            for index, item in enumerate(_rows(spec, section)):
                errors.extend(validate_dimension_field_consistency(item, path=f"{spec_name}.{section}[{index}]"))

    if policy == "not_applicable":
        if parsed.enabled:
            errors.append(_error(f"{prefix}.enabled", "非时序模型必须设置 enabled=false", False, True))
        if parsed.editable:
            errors.append(_error(f"{prefix}.editable", "非时序模型不可编辑 horizon", False, True))
        if parsed.allowed_horizons:
            errors.append(_error(f"{prefix}.allowed_horizons", "非时序模型不应配置 allowed_horizons", [], parsed.allowed_horizons))
        if parsed.derive_from:
            errors.append(_error(f"{prefix}.derive_from", "非时序模型不应配置 derive_from", None, parsed.derive_from))
        if require_publish_ready and time_references:
            errors.append(_error(f"{prefix}.policy", "非时序模型仍有参数或变量引用时间集合", "解除全部时间维度引用", len(time_references)))
        return errors, warnings

    if not parsed.enabled:
        errors.append(_error(f"{prefix}.enabled", "时序策略必须设置 enabled=true", True, False))
    if not parsed.default_horizon and policy != "data_derived":
        errors.append(_error(f"{prefix}.default_horizon", "默认 horizon 必须为正整数", "> 0", parsed.default_horizon))
    if parsed.default_horizon is not None and parsed.default_horizon <= 0:
        errors.append(_error(f"{prefix}.default_horizon", "默认 horizon 必须为正整数", "> 0", parsed.default_horizon))
    if policy == "fixed" and parsed.editable:
        errors.append(_error(f"{prefix}.editable", "固定时段模型不可在任务中心编辑", False, True))
    if policy == "runtime_variable" and not parsed.editable:
        errors.append(_error(f"{prefix}.editable", "动态时段模型必须允许任务中心编辑", True, False))
    if policy == "data_derived" and parsed.editable:
        errors.append(_error(f"{prefix}.editable", "数据推导策略不可手工编辑 horizon", False, True))

    if policy == "runtime_variable" and not parsed.allowed_horizons:
        minimum = parsed.min_horizon or 1
        maximum = parsed.max_horizon
        step = parsed.horizon_step or 1
        if minimum <= 0:
            errors.append(_error(f"{prefix}.min_horizon", "min_horizon 必须大于 0", "> 0", minimum))
        if maximum is not None and maximum < minimum:
            errors.append(_error(f"{prefix}.max_horizon", "max_horizon 必须不小于 min_horizon", f">= {minimum}", maximum))
        if step <= 0:
            errors.append(_error(f"{prefix}.horizon_step", "horizon_step 必须大于 0", "> 0", step))
        if parsed.default_horizon and (parsed.default_horizon < minimum or maximum is not None and parsed.default_horizon > maximum):
            errors.append(_error(f"{prefix}.default_horizon", "默认 horizon 必须位于 min/max 范围内", [minimum, maximum], parsed.default_horizon))

    if not parsed.allowed_horizons:
        for field, mapping in (
            ("interval_minutes_by_horizon", parsed.interval_minutes_by_horizon),
            ("delta_t_by_horizon", parsed.delta_t_by_horizon),
        ):
            if mapping:
                errors.append(_error(
                    f"{prefix}.{field}",
                    f"当前时间策略未配置 allowed_horizons，不应配置 {field}",
                    {},
                    mapping,
                ))

    allowed = parsed.allowed_horizons
    if allowed:
        if len(set(allowed)) != len(allowed) or any(not isinstance(value, int) or value <= 0 for value in allowed):
            errors.append(_error(f"{prefix}.allowed_horizons", "候选 horizon 必须为不重复的正整数", "正整数且不重复", allowed))
        if parsed.default_horizon not in allowed:
            errors.append(_error(f"{prefix}.default_horizon", "默认 horizon 必须属于 allowed_horizons", allowed, parsed.default_horizon))
        expected_keys = {str(value) for value in allowed}
        for field, mapping in (("interval_minutes_by_horizon", parsed.interval_minutes_by_horizon), ("delta_t_by_horizon", parsed.delta_t_by_horizon)):
            actual_keys = set(mapping)
            if actual_keys != expected_keys:
                errors.append(_error(f"{prefix}.{field}", "映射 key 必须完整覆盖且仅覆盖 allowed_horizons", sorted(expected_keys), sorted(actual_keys)))
            if any(value <= 0 for value in mapping.values()):
                errors.append(_error(f"{prefix}.{field}", "映射值必须大于 0", "> 0", mapping))
        for horizon in expected_keys & set(parsed.interval_minutes_by_horizon) & set(parsed.delta_t_by_horizon):
            interval = parsed.interval_minutes_by_horizon[horizon]
            delta = parsed.delta_t_by_horizon[horizon]
            if abs(delta - interval / 60) > 1e-8:
                errors.append(_error(f"{prefix}.delta_t_by_horizon.{horizon}", "delta_t 必须等于 interval_minutes / 60", interval / 60, delta))

    if parsed.label_generation == "auto" and not parsed.label_set:
        errors.append(_error(f"{prefix}.label_set", "自动生成标签时 label_set 必填", "非空字段名", parsed.label_set))

    if not allowed and parsed.interval_minutes is not None and parsed.delta_t is not None:
        if abs(parsed.delta_t - parsed.interval_minutes / 60) > 1e-8:
            errors.append(_error(
                f"{prefix}.delta_t",
                "delta_t 必须等于 interval_minutes / 60",
                parsed.interval_minutes / 60,
                parsed.delta_t,
            ))

    if policy == "data_derived":
        source = next((item for item in definitions if _parameter_code(item) == parsed.derive_from), None)
        if not parsed.derive_from or source is None:
            errors.append(_error(f"{prefix}.derive_from", "推导来源参数不存在", "已定义运行时参数", parsed.derive_from))
        elif time_set not in extract_dimensions(source):
            errors.append(_error(f"{prefix}.derive_from", "推导来源参数维度必须包含 time_set", time_set, extract_dimensions(source)))
        elif source.get("runtime_injected") is False or str(source.get("sourceType") or source.get("source_type") or source.get("source_system") or "runtime") not in {"runtime", ""}:
            errors.append(_error(f"{prefix}.derive_from", "推导来源必须是运行时输入参数", "runtime", source.get("sourceType") or source.get("source_type") or source.get("source_system")))
        elif parsed.default_horizon is None:
            sample = _sample_value(str(parsed.derive_from), source, parameters)
            if _length(sample) in {None, 0}:
                errors.append(_error(f"{prefix}.default_horizon", "data_derived 缺少可用于建模预览的样例序列或 default_horizon", "非空样例或正整数 default_horizon", parsed.default_horizon))

    if not require_publish_ready:
        return errors, warnings

    sets = _set_rows(semantic_spec, component_spec, generic_spec)
    time_row = next((item for item in sets if _set_code(item) == time_set), None)
    state_row = next((item for item in sets if state_set and _set_code(item) == state_set), None)
    if time_row is None:
        errors.append(_error(f"{prefix}.time_set", "声明的时间集合不存在", time_set, None))
    else:
        set_type = str(time_row.get("type") or time_row.get("dimensionType") or "")
        if set_type != "time_period":
            errors.append(_error(f"semantic_spec.sets.{time_set}.type", "时间集合类型必须为 time_period", "time_period", set_type))
        if parsed.default_horizon and len(_set_values(time_row)) != parsed.default_horizon:
            errors.append(_error(f"semantic_spec.sets.{time_set}.values", "时间集合默认成员长度必须等于 default_horizon", parsed.default_horizon, len(_set_values(time_row))))
    if state_set:
        if state_row is None:
            errors.append(_error(f"{prefix}.state_time_set", "声明的状态时点集合不存在", state_set, None))
        else:
            set_type = str(state_row.get("type") or state_row.get("dimensionType") or "")
            if set_type != "state_time":
                errors.append(_error(f"semantic_spec.sets.{state_set}.type", "状态时点集合类型必须为 state_time", "state_time", set_type))
            if state_row.get("base_set") != time_set:
                errors.append(_error(f"semantic_spec.sets.{state_set}.base_set", "状态时点集合 base_set 必须指向 time_set", time_set, state_row.get("base_set")))
            if parsed.default_horizon and len(_set_values(state_row)) != parsed.default_horizon + 1:
                errors.append(_error(f"semantic_spec.sets.{state_set}.values", "状态时点集合长度必须等于 default_horizon + 1", parsed.default_horizon + 1, len(_set_values(state_row))))

    if parsed.default_horizon:
        expected_lengths = {time_set: parsed.default_horizon}
        if state_set:
            expected_lengths[state_set] = parsed.default_horizon + 1
        system_codes = {"horizon", time_set, state_set, parsed.label_set if parsed.label_generation == "auto" else None, "interval_minutes", "delta_t"}
        for item in definitions:
            code = _parameter_code(item)
            dims = extract_dimensions(item)
            if not code or code in system_codes or not any(dim in expected_lengths for dim in dims):
                continue
            sample = _sample_value(code, item, parameters)
            if sample is None:
                continue
            time_index = next((index for index, dim in enumerate(dims) if dim in expected_lengths), None)
            if time_index is None:
                continue
            expected = expected_lengths[dims[time_index]]
            values = list(sample.values()) if isinstance(sample, dict) and time_index > 0 else sample
            if time_index == 0:
                actual = _length(sample)
                if actual != expected:
                    errors.append(_error(f"parameters.{code}", "业务时间序列样例长度与 default_horizon 不一致", expected, actual))
            elif isinstance(values, list):
                for row_index, row in enumerate(values):
                    actual = _length(row)
                    if actual != expected:
                        errors.append(_error(f"parameters.{code}[{row_index}]", "业务时间序列内层样例长度与 default_horizon 不一致", expected, actual))
                        break

    mode = str(build_mode or semantic_spec.get("build_mode") or component_spec.get("build_mode") or "")
    if mode == "component_based" and policy != "fixed" and (time_set != "time" or state_set not in {None, "time_volume"}):
        errors.append(_error(prefix, "当前组件化 Builder 的动态时间集合仅验证标准 time/time_volume 命名", {"time_set": "time", "state_time_set": "time_volume 或空"}, {"time_set": time_set, "state_time_set": state_set}))
    if mode == "generic_linear" and policy in {"runtime_variable", "data_derived"}:
        ready = bool(((generic_spec.get("ui_metadata") or {}).get("dynamic_time_compilation_ready")))
        if not ready:
            errors.append(_error(prefix, "当前通用公式模型尚未满足动态时间集合编译条件，请改为固定时段。", "fixed 或显式通过动态编译能力验证", policy))
    return errors, warnings
