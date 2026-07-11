from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import HTTPException

from app.schemas.model import ModelPackage
from app.schemas.time_dimension import TimeDimensionConfig, validate_time_dimension_contract, validate_time_dimension_mode_fields
from app.services.time_dimension_service import resolve_state_time_set
from app.model_dimensions import extract_dimensions


def _ui_time_dimension(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    config = value.get("time_dimension")
    return deepcopy(config) if isinstance(config, dict) else None


def _has_time_structure(*specs: dict) -> bool:
    for spec in specs:
        sets = (spec or {}).get("sets") or []
        if isinstance(sets, dict) and any(str(code) in {"time", "time_volume"} for code in sets):
            return True
        if isinstance(sets, list) and any(str(item.get("code") or item.get("key") or "") in {"time", "time_volume"} or item.get("type") in {"time_period", "state_time"} for item in sets if isinstance(item, dict)):
            return True
        for section in ("parameters", "variables"):
            if any(any(dim in {"time", "time_volume"} for dim in extract_dimensions(item)) for item in (spec or {}).get(section) or [] if isinstance(item, dict)):
                return True
    return False


def _set_length(spec: dict, code: str) -> int | None:
    sets = (spec or {}).get("sets") or []
    if isinstance(sets, dict):
        value = sets.get(code)
        return len(value) if isinstance(value, list) else None
    for item in sets if isinstance(sets, list) else []:
        if isinstance(item, dict) and str(item.get("code") or item.get("key") or "") == code:
            values = item.get("values") if item.get("values") is not None else item.get("members")
            if isinstance(values, list):
                return len(values)
            if item.get("horizon") is not None:
                return int(item["horizon"])
    return None


def _infer(model: ModelPackage) -> dict:
    semantic = model.semantic_spec or {}
    component = model.component_spec or semantic.get("component_spec") or {}
    generic = model.generic_spec or semantic.get("generic_spec") or {}
    if not _has_time_structure(semantic, component, generic):
        return {"schema_version": 1, "enabled": False, "policy": "not_applicable", "editable": False}
    horizon = model.parameters.get("horizon") or _set_length(semantic, "time") or _set_length(component, "time") or _set_length(generic, "time")
    return {
        "schema_version": 1,
        "enabled": True,
        "policy": "fixed",
        "default_horizon": horizon,
        "time_set": "time",
        "state_time_set": "time_volume" if any(_set_length(spec, "time_volume") is not None for spec in (semantic, component, generic)) else None,
        "editable": False,
    }


def _available_set_names(*specs: dict) -> set[str]:
    names: set[str] = set()
    for spec in specs:
        sets = (spec or {}).get("sets") or {}
        if isinstance(sets, dict):
            names.update(str(code) for code in sets)
        elif isinstance(sets, list):
            names.update(
                str(item.get("code") or item.get("key") or item.get("name"))
                for item in sets
                if isinstance(item, dict) and (item.get("code") or item.get("key") or item.get("name"))
            )
    return names


def _normalized_config(raw: dict, *, available_sets: set[str]) -> dict:
    data = deepcopy(raw)
    policy = str(data.get("policy") or ("fixed" if data.get("enabled") else "not_applicable"))
    data["schema_version"] = 1
    data["policy"] = policy
    if policy == "not_applicable":
        data.update({"enabled": False, "editable": False})
        data.pop("derive_from", None)
        data["allowed_horizons"] = []
    else:
        data["enabled"] = True
        data.setdefault("time_set", "time")
        data["state_time_set"] = resolve_state_time_set(data, available_sets=available_sets)
        data["editable"] = policy == "runtime_variable"
        data.setdefault("allowed_horizons", [])
        data.setdefault("label_generation", "none")
        data.setdefault("label_format", "HH:mm")
    try:
        return TimeDimensionConfig.model_validate(data).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"message": "模型时间维度配置无效", "errors": [{"field": "ui_metadata.time_dimension", "error": str(exc)}]}) from exc


def _clean_legacy_mode_fields(raw: dict) -> dict:
    data = deepcopy(raw)
    policy = str(data.get("policy") or ("fixed" if data.get("enabled") else "not_applicable"))
    if policy == "not_applicable":
        return {"schema_version": 1, "enabled": False, "policy": "not_applicable", "editable": False}
    if policy == "fixed":
        keys = ("allowed_horizons", "min_horizon", "max_horizon", "horizon_step", "interval_minutes_by_horizon", "delta_t_by_horizon", "derive_from")
    elif policy == "runtime_variable" and data.get("allowed_horizons"):
        keys = ("min_horizon", "max_horizon", "horizon_step", "derive_from", "interval_minutes", "delta_t")
    elif policy == "runtime_variable":
        keys = ("allowed_horizons", "interval_minutes_by_horizon", "delta_t_by_horizon", "derive_from")
    else:
        keys = ("allowed_horizons", "min_horizon", "max_horizon", "horizon_step", "interval_minutes_by_horizon", "delta_t_by_horizon")
    for key in keys:
        data.pop(key, None)
    return data


def _validate_explicit_config(raw: dict) -> None:
    try:
        parsed = TimeDimensionConfig.model_validate(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"message": "模型时间维度配置无效", "errors": [{"field": "ui_metadata.time_dimension", "error": str(exc)}]}) from exc
    errors = validate_time_dimension_mode_fields(parsed)
    if not parsed.allowed_horizons and parsed.interval_minutes is not None and parsed.delta_t is not None:
        if abs(parsed.delta_t - parsed.interval_minutes / 60) > 1e-8:
            errors.append({
                "field": "ui_metadata.time_dimension.delta_t",
                "error": "time_granularity_mismatch",
                "expected": parsed.interval_minutes / 60,
                "actual": parsed.delta_t,
            })
    if errors:
        raise HTTPException(status_code=422, detail={"message": "时间维度配置与当前策略不一致。", "errors": errors})


def _sync_snapshot(spec: dict, config: dict) -> dict:
    result = deepcopy(spec or {})
    result.setdefault("ui_metadata", {})["time_dimension"] = deepcopy(config)
    return result


def _mark_time_set_types(spec: dict, config: dict) -> dict:
    result = deepcopy(spec or {})
    sets = result.get("sets") or []
    if not isinstance(sets, list):
        return result
    time_set = str(config.get("time_set") or "time")
    state_set = config.get("state_time_set")
    for item in sets:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or item.get("key") or "")
        if code == time_set:
            item.setdefault("type", "time_period")
            item.setdefault("dimensionType", "time_period")
        elif state_set and code == str(state_set):
            item.setdefault("type", "state_time")
            item.setdefault("dimensionType", "state_time")
            item.setdefault("base_set", time_set)
            item.setdefault("generation_rule", "horizon_plus_1")
    return result


def normalize_model_time_dimension_contract(model: ModelPackage) -> ModelPackage:
    semantic = deepcopy(model.semantic_spec or {})
    component = deepcopy(model.component_spec or semantic.get("component_spec") or {})
    generic = deepcopy(model.generic_spec or semantic.get("generic_spec") or {})
    draft = deepcopy(model.model_draft or {})
    advanced = draft.get("advanced") if isinstance(draft.get("advanced"), dict) else {}
    explicit = _ui_time_dimension(model.ui_metadata)
    raw = (
        explicit
        or (deepcopy(draft.get("time_dimension")) if isinstance(draft.get("time_dimension"), dict) else None)
        or _ui_time_dimension((advanced or {}).get("ui_metadata"))
        or _ui_time_dimension(semantic.get("ui_metadata"))
        or _ui_time_dimension(component.get("ui_metadata"))
        or _ui_time_dimension(generic.get("ui_metadata"))
        or _infer(model)
    )
    if explicit is not None:
        _validate_explicit_config(explicit)
    else:
        raw = _clean_legacy_mode_fields(raw)
    config = _normalized_config(raw, available_sets=_available_set_names(semantic, component, generic))
    ui_metadata = deepcopy(model.ui_metadata or {})
    ui_metadata["time_dimension"] = deepcopy(config)
    draft["time_dimension"] = deepcopy(config)
    semantic = _sync_snapshot(_mark_time_set_types(semantic, config), config)
    if component:
        component = _sync_snapshot(_mark_time_set_types(component, config), config)
        semantic["component_spec"] = deepcopy(component)
    if generic:
        generic = _sync_snapshot(generic, config)
        semantic["generic_spec"] = deepcopy(generic)
    parameters = deepcopy(model.parameters or {})
    if config["policy"] == "not_applicable":
        parameters.pop("horizon", None)
    elif config.get("default_horizon"):
        parameters["horizon"] = config["default_horizon"]
    return model.model_copy(update={"ui_metadata": ui_metadata, "model_draft": draft, "semantic_spec": semantic, "component_spec": component, "generic_spec": generic, "parameters": parameters})


def validate_model_time_dimension_contract(model: ModelPackage, require_publish_ready: bool) -> tuple[list[dict], list[dict]]:
    config = _ui_time_dimension(model.ui_metadata) or _infer(model)
    return validate_time_dimension_contract(
        config=config,
        semantic_spec=model.semantic_spec or {},
        component_spec=model.component_spec or (model.semantic_spec or {}).get("component_spec") or {},
        generic_spec=model.generic_spec or (model.semantic_spec or {}).get("generic_spec") or {},
        parameters=model.parameters or {},
        require_publish_ready=require_publish_ready,
        build_mode=model.build_mode,
    )
