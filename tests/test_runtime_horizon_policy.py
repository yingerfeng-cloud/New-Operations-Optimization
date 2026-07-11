from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.time_dimension_service import normalize_runtime_time_dimension, resolve_time_dimension_config
from app.templates.power_templates import get_template


TIME_DIMENSION = {
    "enabled": True,
    "policy": "runtime_variable",
    "default_horizon": 4,
    "time_set": "time",
    "state_time_set": "time_volume",
    "editable": True,
}


def _semantic_spec() -> dict:
    return {
        "model_code": "metadata_driven_dispatch",
        "sets": [{"code": "time", "values": [0, 1, 2, 3]}, {"code": "time_volume", "values": [0, 1, 2, 3, 4]}],
        "parameters": [
            {"code": "load_forecast", "dimension": ["time"], "validation": {"type": "array", "required": True}},
            {"code": "renewable_forecast", "dimension": ["time"], "validation": {"type": "array", "required": True}},
            {"code": "terminal_time", "dimension": [], "default": 4},
        ],
        "ui_metadata": {"time_dimension": TIME_DIMENSION},
    }


def test_runtime_variable_model_rebuilds_time_sets() -> None:
    spec = _semantic_spec()
    params, component, generic, config = normalize_runtime_time_dimension(
        semantic_spec=spec,
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"load_forecast": [180, 185, 190, 195, 200, 205], "renewable_forecast": [20, 22, 25, 24, 21, 20]},
        explicit_horizon=6,
        explicitly_provided_keys={"horizon", "load_forecast", "renewable_forecast"},
        time_dimension=resolve_time_dimension_config(model=None, semantic_spec=spec, component_spec=None, generic_spec=None, runtime_parameters={}),
    )

    assert config["policy"] == "runtime_variable"
    assert params["time"] == [0, 1, 2, 3, 4, 5]
    assert params["time_volume"] == [0, 1, 2, 3, 4, 5, 6]
    assert params["terminal_time"] == 6
    assert component is None
    assert generic is None


def test_time_series_length_mismatch_returns_chinese_422() -> None:
    spec = _semantic_spec()
    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec=spec,
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"load_forecast": [180, 185, 190, 195], "renewable_forecast": [20, 22, 25, 24, 21, 20]},
            explicit_horizon=6,
            explicitly_provided_keys={"horizon", "load_forecast", "renewable_forecast"},
            time_dimension=TIME_DIMENSION,
        )

    assert exc.value.status_code == 422
    text = str(exc.value.detail)
    assert "horizon=6" in text
    assert "load_forecast" in text
    assert "4 个点" in text
    assert "需要 6 个点" in text


def test_component_model_uses_runtime_time_lengths() -> None:
    semantic = {
        **_semantic_spec(),
        "build_mode": "component_based",
        "component_spec": {
            "build_mode": "component_based",
            "sets": [{"code": "time", "values": [0, 1, 2, 3]}, {"code": "time_volume", "values": [0, 1, 2, 3, 4]}],
            "parameters": [
                {"code": "pv_forecast", "dimension": ["time"], "validation": {"type": "array", "required": True}},
                {"code": "grid_limit", "dimension": ["time"], "validation": {"type": "array", "required": True}},
                {"code": "schedule", "dimension": ["time"], "validation": {"type": "array", "required": True}},
                {"code": "price", "dimension": ["time"], "validation": {"type": "array", "required": True}},
            ],
            "ui_metadata": {"time_dimension": TIME_DIMENSION},
        },
    }
    runtime = {
        "load_forecast": [1] * 6,
        "renewable_forecast": [0] * 6,
        "pv_forecast": [1, 2, 3, 4, 5, 6],
        "grid_limit": [9] * 6,
        "schedule": [3] * 6,
        "price": [10] * 6,
    }
    params, component, _, _ = normalize_runtime_time_dimension(
        semantic_spec=semantic,
        component_spec=semantic["component_spec"],
        generic_spec=None,
        runtime_parameters=runtime,
        explicit_horizon=6,
        explicitly_provided_keys={"horizon", *runtime.keys()},
        time_dimension=TIME_DIMENSION,
    )
    semantic["component_spec"] = component

    assert len(component["sets"][0]["values"]) == 6
    assert len(component["sets"][1]["values"]) == 7
    assert RuntimeParameterValidator().validate(semantic, params) == []


def test_generic_spec_defaults_to_fixed_and_rejects_horizon_override() -> None:
    generic_spec = {"sets": {"time": [0, 1, 2, 3]}, "parameters": [], "variables": [], "constraints": [], "objective": {}}
    config = resolve_time_dimension_config(model=None, semantic_spec=None, component_spec=None, generic_spec=generic_spec, runtime_parameters={})
    assert config["policy"] == "fixed"

    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec=None,
            component_spec=None,
            generic_spec=generic_spec,
            runtime_parameters={},
            explicit_horizon=6,
            explicitly_provided_keys={"horizon"},
            time_dimension=config,
        )
    assert exc.value.status_code == 422
    assert "固定时段模型" in str(exc.value.detail)
    assert "不支持运行时修改 horizon" in str(exc.value.detail)


def test_not_applicable_model_rejects_horizon() -> None:
    config = resolve_time_dimension_config(model=None, semantic_spec={"parameters": []}, component_spec=None, generic_spec=None, runtime_parameters={})
    assert config["policy"] == "not_applicable"
    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec={"parameters": []},
            component_spec=None,
            generic_spec=None,
            runtime_parameters={},
            explicit_horizon=24,
            explicitly_provided_keys={"horizon"},
            time_dimension=config,
        )
    assert "不是时序模型" in str(exc.value.detail)
    assert "不支持设置调度时段" in str(exc.value.detail)


def test_terminal_time_follows_horizon_and_validates_explicit_value() -> None:
    spec = _semantic_spec()
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec=spec,
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"load_forecast": [1] * 6, "renewable_forecast": [2] * 6},
        explicit_horizon=6,
        explicitly_provided_keys={"horizon", "load_forecast", "renewable_forecast"},
        time_dimension=TIME_DIMENSION,
    )
    assert params["terminal_time"] == 6

    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec=spec,
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"load_forecast": [1] * 6, "renewable_forecast": [2] * 6, "terminal_time": 8},
            explicit_horizon=6,
            explicitly_provided_keys={"horizon", "load_forecast", "renewable_forecast", "terminal_time"},
            time_dimension=TIME_DIMENSION,
        )
    assert exc.value.status_code == 422
    assert "terminal_time" in str(exc.value.detail)


def test_allowed_horizons_accepts_declared_value_and_rebuilds_sets() -> None:
    config = {**TIME_DIMENSION, "default_horizon": 96, "allowed_horizons": [24, 48, 96]}
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec={"sets": {"time": list(range(96)), "time_volume": list(range(97))}},
        component_spec=None,
        generic_spec=None,
        runtime_parameters={},
        explicit_horizon=48,
        explicitly_provided_keys={"horizon"},
        time_dimension=config,
    )

    assert len(params["time"]) == 48
    assert len(params["time_volume"]) == 49


def test_allowed_horizons_rejects_undeclared_value() -> None:
    config = {**TIME_DIMENSION, "default_horizon": 96, "allowed_horizons": [24, 48, 96]}
    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec={"sets": {"time": list(range(96))}},
            component_spec=None,
            generic_spec=None,
            runtime_parameters={},
            explicit_horizon=36,
            explicitly_provided_keys={"horizon"},
            time_dimension=config,
        )

    assert exc.value.status_code == 422
    assert "仅支持 24、48、96" in str(exc.value.detail)
    assert exc.value.detail["errors"][0]["actual"] == 36


def test_horizon_mapping_updates_delta_t_and_interval_minutes() -> None:
    config = {
        **TIME_DIMENSION,
        "default_horizon": 96,
        "allowed_horizons": [24, 48, 96],
        "interval_minutes_by_horizon": {"24": 60, "48": 30, "96": 15},
        "delta_t_by_horizon": {"24": 1.0, "48": 0.5, "96": 0.25},
    }
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec={"sets": {"time": list(range(96))}},
        component_spec=None,
        generic_spec=None,
        runtime_parameters={},
        explicit_horizon=48,
        explicitly_provided_keys={"horizon"},
        time_dimension=config,
    )

    assert params["interval_minutes"] == 30
    assert params["delta_t"] == 0.5

    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec={"sets": {"time": list(range(96))}},
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"delta_t": 1.0},
            explicit_horizon=48,
            explicitly_provided_keys={"horizon", "delta_t"},
            time_dimension=config,
        )
    assert exc.value.detail["errors"][0]["error"] == "time_granularity_mismatch"


@pytest.mark.parametrize(
    ("policy", "config", "runtime", "explicit_horizon", "expected_horizon", "expected_interval", "expected_delta"),
    [
        ("fixed", {"default_horizon": 48, "interval_minutes": 30}, {}, None, 48, 30, 0.5),
        ("runtime_variable", {"default_horizon": 24, "interval_minutes": 30}, {}, 48, 48, 30, 0.5),
        ("data_derived", {"derive_from": "load", "interval_minutes": 15}, {"load": [1] * 36}, None, 36, 15, 0.25),
    ],
)
def test_scalar_time_granularity_is_injected_from_contract(
    policy: str,
    config: dict,
    runtime: dict,
    explicit_horizon: int | None,
    expected_horizon: int,
    expected_interval: float,
    expected_delta: float,
) -> None:
    metadata = {
        "schema_version": 1,
        "enabled": True,
        "policy": policy,
        "time_set": "time",
        "state_time_set": None,
        "editable": policy == "runtime_variable",
        **config,
    }
    semantic = {
        "sets": [{"code": "time", "values": list(range(int(config.get("default_horizon") or len(runtime.get("load", [])) or 1)))}],
        "parameters": [{"code": "load", "dimensions": ["time"]}] if "load" in runtime else [],
    }
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec=semantic,
        component_spec=None,
        generic_spec=None,
        runtime_parameters=runtime,
        explicit_horizon=explicit_horizon,
        explicitly_provided_keys=set(runtime) | ({"horizon"} if explicit_horizon else set()),
        time_dimension=metadata,
    )
    assert params["horizon"] == expected_horizon
    assert params["interval_minutes"] == expected_interval
    assert params["delta_t"] == expected_delta


def test_scalar_time_granularity_rejects_explicit_runtime_conflict() -> None:
    config = {**TIME_DIMENSION, "state_time_set": None, "interval_minutes": 30, "delta_t": 0.5}
    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec={"sets": {"time": list(range(4))}},
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"delta_t": 1},
            explicit_horizon=4,
            explicitly_provided_keys={"horizon", "delta_t"},
            time_dimension=config,
        )
    assert exc.value.detail["errors"][0] == {
        "field": "delta_t",
        "error": "time_granularity_mismatch",
        "expected": 0.5,
        "actual": 1,
    }


def test_legacy_data_derived_runtime_ignores_stale_allowed_horizons() -> None:
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec={"sets": {"time": [0]}, "parameters": [{"code": "load", "dimensions": ["time"]}]},
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"load": [1] * 36},
        explicit_horizon=None,
        explicitly_provided_keys={"load"},
        time_dimension={"schema_version": 1, "enabled": True, "policy": "data_derived", "time_set": "time", "state_time_set": None, "derive_from": "load", "allowed_horizons": [24, 48], "editable": False},
    )
    assert params["horizon"] == 36


def test_auto_time_labels_follow_horizon() -> None:
    config = {
        **TIME_DIMENSION,
        "default_horizon": 96,
        "allowed_horizons": [24, 48, 96],
        "interval_minutes_by_horizon": {"24": 60, "48": 30, "96": 15},
        "label_set": "time_labels",
        "label_generation": "auto",
    }
    params, _, _, _ = normalize_runtime_time_dimension(
        semantic_spec={"sets": {"time": list(range(96))}},
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"time_labels": ["stale"] * 96},
        explicit_horizon=24,
        explicitly_provided_keys={"horizon"},
        time_dimension=config,
    )

    assert len(params["time_labels"]) == 24
    assert params["time_labels"][0] == "00:00"
    assert params["time_labels"][1] == "01:00"

    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec={"sets": {"time": list(range(96))}},
            component_spec=None,
            generic_spec=None,
            runtime_parameters={"time_labels": ["T1"]},
            explicit_horizon=24,
            explicitly_provided_keys={"horizon", "time_labels"},
            time_dimension=config,
        )
    assert exc.value.detail["errors"][0]["error"] == "time_labels_length_mismatch"


def test_market_trading_and_capacity_templates_are_fixed() -> None:
    for code in ("contract_spot_exposure_v1", "retail_da_spot_bidding_v1", "pv_storage_capacity_planning"):
        template = get_template(code)
        config = template["ui_metadata"]["time_dimension"]
        assert config["policy"] == "fixed"
        assert config["editable"] is False

    template = get_template("contract_spot_exposure_v1")
    config = template["ui_metadata"]["time_dimension"]
    assert config["default_horizon"] == 96
    with pytest.raises(HTTPException) as exc:
        normalize_runtime_time_dimension(
            semantic_spec=template,
            component_spec=template.get("component_spec"),
            generic_spec=template.get("generic_spec"),
            runtime_parameters=template["sample_runtime_parameters"],
            explicit_horizon=24,
            explicitly_provided_keys={"horizon"},
            time_dimension=config,
        )
    assert "固定时段模型" in str(exc.value.detail)
    assert exc.value.detail["errors"][0] == {
        "field": "horizon",
        "error": "fixed_horizon_override",
        "expected": 96,
        "actual": 24,
    }


def test_data_derived_supports_nested_mapping_time_series() -> None:
    semantic = {
        "sets": [{"code": "site", "values": ["S1", "S2"]}, {"code": "time", "values": [0, 1, 2]}],
        "parameters": [{"code": "load_forecast", "dimension": ["site", "time"]}],
    }
    config = {"schema_version": 1, "enabled": True, "policy": "data_derived", "time_set": "time", "state_time_set": None, "derive_from": "load_forecast", "editable": False}
    params, _, _, resolved = normalize_runtime_time_dimension(
        semantic_spec=semantic,
        component_spec=None,
        generic_spec=None,
        runtime_parameters={"load_forecast": {"S1": [1, 2, 3, 4], "S2": [2, 3, 4, 5]}},
        explicit_horizon=None,
        explicitly_provided_keys={"load_forecast"},
        time_dimension=config,
    )
    assert resolved["resolved_horizon"] == 4
    assert params["time"] == [0, 1, 2, 3]
    assert "time_volume" not in params


@pytest.mark.parametrize("policy", ["fixed", "runtime_variable"])
def test_explicit_null_state_time_set_never_generates_time_volume(policy: str) -> None:
    config = {
        "schema_version": 1,
        "enabled": True,
        "policy": policy,
        "default_horizon": 4,
        "time_set": "time",
        "state_time_set": None,
        "editable": policy == "runtime_variable",
    }
    params, component, _, resolved = normalize_runtime_time_dimension(
        semantic_spec={"sets": [{"code": "time", "values": list(range(4))}]},
        component_spec={"sets": [{"code": "time", "values": list(range(4))}]} if policy == "runtime_variable" else None,
        generic_spec=None,
        runtime_parameters={},
        explicit_horizon=8 if policy == "runtime_variable" else None,
        explicitly_provided_keys={"horizon"} if policy == "runtime_variable" else set(),
        time_dimension=config,
    )
    assert len(params["time"]) == (8 if policy == "runtime_variable" else 4)
    assert "time_volume" not in params
    assert resolved["state_time_set"] is None
    if component:
        assert all(item.get("code") != "time_volume" for item in component["sets"])


def test_missing_state_time_set_uses_legacy_set_presence_only() -> None:
    with_state = {"sets": {"time": [0, 1], "time_volume": [0, 1, 2]}, "ui_metadata": {"time_dimension": {"enabled": True, "policy": "fixed", "default_horizon": 2, "time_set": "time"}}}
    without_state = {"sets": {"time": [0, 1]}, "ui_metadata": {"time_dimension": {"enabled": True, "policy": "fixed", "default_horizon": 2, "time_set": "time"}}}
    assert resolve_time_dimension_config(model=None, semantic_spec=with_state, component_spec=None, generic_spec=None, runtime_parameters={})["state_time_set"] == "time_volume"
    assert resolve_time_dimension_config(model=None, semantic_spec=without_state, component_spec=None, generic_spec=None, runtime_parameters={})["state_time_set"] is None


def test_no_runtime_model_code_horizon_whitelist() -> None:
    allowed = {Path("app/templates/power_templates.py"), Path("tests/test_runtime_horizon_policy.py")}
    forbidden_tokens = ("runtime_variable_codes", "pv_storage_day_ahead_dispatch_v2")
    for path in [Path("app/services/job_service.py"), Path("app/semantic/semantic_validator.py"), *Path("app/builders").glob("*.py")]:
        text = path.read_text(encoding="utf-8")
        if path in allowed:
            continue
        for token in forbidden_tokens:
            assert token not in text, f"{token} must not appear in runtime file {path}"
