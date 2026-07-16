from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.time_dimension import validate_time_dimension_contract
from app.templates.power_templates import apply_time_dimension_metadata
from tests.test_helpers import test_and_publish_model


client = TestClient(app)


def _config(policy: str = "fixed", horizon: int = 3, **overrides) -> dict:
    config = {
        "schema_version": 1,
        "enabled": policy != "not_applicable",
        "policy": policy,
        "default_horizon": horizon,
        "time_set": "time",
        "state_time_set": "time_volume",
        "editable": policy == "runtime_variable",
        "label_generation": "none",
    }
    config.update(overrides)
    return config


def _generic_payload(config: dict, *, load_length: int | None = None, state_length: int | None = None) -> dict:
    horizon = int(config.get("default_horizon") or 3)
    load_length = horizon if load_length is None else load_length
    state_length = horizon + 1 if state_length is None else state_length
    code = f"time_contract_{uuid4().hex[:8]}"
    semantic_sets = [
        {"code": "unit", "values": ["U1"], "type": "business"},
        {"code": "time", "values": list(range(horizon)), "type": "time_period", "managed_by": "time_dimension"},
        {"code": "time_volume", "values": list(range(state_length)), "type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1", "managed_by": "time_dimension"},
    ]
    semantic = {
        "model_code": code,
        "sets": semantic_sets,
        "parameters": [{"code": "load_forecast", "dimension": ["time"], "runtime_injected": True, "sourceType": "runtime", "validation": {"required": True, "type": "array"}}],
        "variables": [{"code": "dispatch", "dimension": ["time"], "domain": "NonNegativeReals"}],
    }
    generic = {
        "sets": {"unit": ["U1"], "time": list(range(horizon)), "time_volume": list(range(state_length))},
        "parameters": {"load_forecast": [1.0] * load_length},
        "variables": [{"name": "dispatch", "indices": ["time"], "domain": "NonNegativeReals"}],
        "constraints": [{"name": "meet_load", "foreach": ["time"], "terms": [{"var": "dispatch", "key": ["time"], "coef": 1}], "sense": ">=", "rhs_param": "load_forecast", "rhs_key": ["time"]}],
        "objective": {"sense": "minimize", "terms": [{"var": "dispatch", "foreach": ["time"], "key": ["time"], "coef": 1}]},
        "ui_metadata": {"dynamic_time_compilation_ready": True},
    }
    return {
        "id": f"MODEL-{uuid4().hex[:10].upper()}",
        "name": code,
        "scene": "时间维度契约测试",
        "template_id": code,
        "build_mode": "generic_linear",
        "model_problem_type": "LP",
        "problem_type": "LP",
        "semantic_spec": semantic,
        "generic_spec": generic,
        "parameters": {"horizon": horizon, "load_forecast": [1.0] * load_length},
        "model_draft": {"basic_info": {"name": code, "model_code": code, "scenario": "测试", "builder_mode": "generic_linear", "solver": "HiGHS"}, "semantic": semantic, "time_dimension": deepcopy(config), "runtime_parameters": {"horizon": horizon, "load_forecast": [1.0] * load_length}, "components": [], "formulas": [], "parameter_groups": {}, "advanced": {"generic_spec": generic}},
        "ui_metadata": {"time_dimension": deepcopy(config)},
    }


def _contract_errors(payload: dict, *, publish: bool = True) -> list[dict]:
    errors, _ = validate_time_dimension_contract(
        config=payload["ui_metadata"]["time_dimension"],
        semantic_spec=payload.get("semantic_spec") or {},
        component_spec=payload.get("component_spec") or {},
        generic_spec=payload.get("generic_spec") or {},
        parameters=payload.get("parameters") or {},
        require_publish_ready=publish,
        build_mode=payload.get("build_mode"),
    )
    return errors


def test_non_time_model_create_has_no_automatic_time_fields() -> None:
    response = client.post("/api/models", json={"name": "静态模型", "scene": "测试", "semantic_spec": {"sets": [], "parameters": [], "variables": []}})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ui_metadata"]["time_dimension"]["policy"] == "not_applicable"
    assert "horizon" not in body["parameters"]
    assert not (body["semantic_spec"].get("sets") or [])


def test_fixed_model_contract_is_authoritative_and_snapshotted() -> None:
    payload = _generic_payload(_config("fixed", 24))
    response = client.post("/api/models", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ui_metadata"]["time_dimension"]["default_horizon"] == 24
    assert body["ui_metadata"]["time_dimension"]["editable"] is False
    assert body["semantic_spec"]["ui_metadata"]["time_dimension"] == body["ui_metadata"]["time_dimension"]
    assert len(next(item for item in body["semantic_spec"]["sets"] if item["code"] == "time")["values"]) == 24


def test_fixed_model_with_explicit_null_state_set_stays_stateless() -> None:
    payload = _generic_payload(_config("fixed", 4, state_time_set=None))
    payload["semantic_spec"]["sets"] = [item for item in payload["semantic_spec"]["sets"] if item["code"] != "time_volume"]
    payload["generic_spec"]["sets"].pop("time_volume")
    response = client.post("/api/models", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ui_metadata"]["time_dimension"]["state_time_set"] is None
    assert all(item["code"] != "time_volume" for item in body["semantic_spec"]["sets"])


def test_free_runtime_horizon_contract_publishes_and_runtime_accepts_48() -> None:
    payload = _generic_payload(_config("runtime_variable", 24, min_horizon=1, max_horizon=168, horizon_step=1, allowed_horizons=[]))
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    published = test_and_publish_model(client, created.json()["id"], created.json()["parameters"])
    assert published.status_code == 200, published.text
    task = client.post("/api/tasks", json={"model_id": created.json()["id"], "horizon": 48, "runtime_parameters": {"horizon": 48, "load_forecast": [1.0] * 48}, "async_run": False})
    assert task.status_code == 200, task.text
    assert task.json()["status"] == "SUCCESS", task.text


def test_choice_horizon_publishes_accepts_48_and_rejects_36() -> None:
    config = _config("runtime_variable", 96, allowed_horizons=[24, 48, 96], interval_minutes_by_horizon={"24": 60, "48": 30, "96": 15}, delta_t_by_horizon={"24": 1, "48": 0.5, "96": 0.25})
    payload = _generic_payload(config)
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    test_and_publish_model(client, created.json()["id"], created.json()["parameters"])
    valid = client.post("/api/tasks", json={"model_id": created.json()["id"], "horizon": 48, "runtime_parameters": {"horizon": 48, "load_forecast": [1.0] * 48}, "async_run": False})
    invalid = client.post("/api/tasks", json={"model_id": created.json()["id"], "horizon": 36, "runtime_parameters": {"horizon": 36, "load_forecast": [1.0] * 36}, "async_run": False})
    assert valid.status_code == 200, valid.text
    assert valid.json()["status"] == "SUCCESS", valid.text
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["errors"][0]["error"] == "horizon_not_allowed"


def test_data_derived_requires_runtime_time_parameter() -> None:
    valid = _generic_payload(_config("data_derived", 3, derive_from="load_forecast", editable=False))
    assert not _contract_errors(valid)
    created = client.post("/api/models", json=valid)
    assert created.status_code == 200, created.text
    published = test_and_publish_model(client, created.json()["id"], created.json()["parameters"])
    assert published.status_code == 200, published.text
    invalid = deepcopy(valid)
    invalid["ui_metadata"]["time_dimension"]["derive_from"] = "missing"
    assert any(error["field"].endswith("derive_from") for error in _contract_errors(invalid))

    missing_preview = deepcopy(valid)
    missing_preview["ui_metadata"]["time_dimension"]["default_horizon"] = None
    missing_preview["parameters"].pop("load_forecast", None)
    missing_preview["generic_spec"]["parameters"].pop("load_forecast", None)
    assert any("建模预览" in error["error"] for error in _contract_errors(missing_preview))


def test_invalid_choice_default_is_rejected_on_create() -> None:
    config = _config("runtime_variable", 72, allowed_horizons=[24, 48, 96], interval_minutes_by_horizon={"24": 60, "48": 30, "96": 15}, delta_t_by_horizon={"24": 1, "48": 0.5, "96": 0.25})
    response = client.post("/api/models", json=_generic_payload(config))
    assert response.status_code == 422
    assert any(error["field"].endswith("default_horizon") for error in response.json()["detail"]["errors"])


def test_missing_time_set_fails_publish_contract() -> None:
    payload = _generic_payload(_config("fixed", 3))
    payload["semantic_spec"]["sets"] = [item for item in payload["semantic_spec"]["sets"] if item["code"] != "time"]
    payload["generic_spec"]["sets"].pop("time")
    errors = _contract_errors(payload)
    assert any(error["field"].endswith("time_set") for error in errors)


def test_state_time_length_mismatch_fails_contract() -> None:
    payload = _generic_payload(_config("fixed", 24), state_length=24)
    errors = _contract_errors(payload)
    assert any("状态时点集合长度" in error["error"] for error in errors)


def test_free_mode_rejects_stale_choice_mappings() -> None:
    payload = _generic_payload(_config(
        "runtime_variable",
        24,
        allowed_horizons=[],
        min_horizon=1,
        max_horizon=168,
        horizon_step=1,
        interval_minutes_by_horizon={"48": 30},
    ))
    errors = _contract_errors(payload)
    assert any(error["field"].endswith("interval_minutes_by_horizon") for error in errors)


@pytest.mark.parametrize(
    ("config", "field"),
    [
        (_config("fixed", 24, allowed_horizons=[24, 48], interval_minutes_by_horizon={"24": 60, "48": 30}), "allowed_horizons"),
        (_config("runtime_variable", 24, allowed_horizons=[], interval_minutes_by_horizon={"24": 60}), "interval_minutes_by_horizon"),
        (_config("runtime_variable", 24, allowed_horizons=[24, 48], interval_minutes_by_horizon={"24": 60, "48": 30}, delta_t_by_horizon={"24": 1, "48": 0.5}, min_horizon=1), "min_horizon"),
        (_config("data_derived", 24, derive_from="load_forecast", allowed_horizons=[24, 48]), "allowed_horizons"),
        (_config("not_applicable", 24, min_horizon=1, interval_minutes=60), "default_horizon"),
    ],
)
def test_explicit_top_level_contract_rejects_fields_from_other_modes(config: dict, field: str) -> None:
    response = client.post("/api/models", json=_generic_payload(config))
    assert response.status_code == 422
    errors = response.json()["detail"]["errors"]
    assert any(item["field"].endswith(field) and item["error"] == "field_not_allowed_for_policy" for item in errors)


def test_legacy_nested_contract_is_cleaned_during_migration() -> None:
    payload = _generic_payload(_config("fixed", 24, allowed_horizons=[24, 48], interval_minutes_by_horizon={"24": 60, "48": 30}))
    payload["ui_metadata"].pop("time_dimension")
    response = client.post("/api/models", json=payload)
    assert response.status_code == 200, response.text
    config = response.json()["ui_metadata"]["time_dimension"]
    assert config["policy"] == "fixed"
    assert config["allowed_horizons"] == []
    assert config["interval_minutes_by_horizon"] == {}


def test_business_series_sample_length_mismatch_fails_contract() -> None:
    payload = _generic_payload(_config("fixed", 24), load_length=4)
    errors = _contract_errors(payload)
    assert any(error["field"] == "parameters.load_forecast" for error in errors)


def test_template_explicit_metadata_is_not_overwritten_by_inference() -> None:
    explicit = _config("runtime_variable", 96, allowed_horizons=[24, 48, 96], interval_minutes_by_horizon={"24": 60, "48": 30, "96": 15}, delta_t_by_horizon={"24": 1, "48": 0.5, "96": 0.25})
    template = {"code": "metadata_only_template", "sets": [{"code": "time", "values": list(range(96))}], "sample_runtime_parameters": {"horizon": 96, "time": list(range(96))}, "ui_metadata": {"time_dimension": deepcopy(explicit)}}
    result = apply_time_dimension_metadata(template)
    assert result["ui_metadata"]["time_dimension"]["allowed_horizons"] == [24, 48, 96]
    assert result["ui_metadata"]["time_dimension"]["delta_t_by_horizon"] == explicit["delta_t_by_horizon"]


def test_model_contract_round_trip_create_get_update_publish_get() -> None:
    payload = _generic_payload(_config("fixed", 3))
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text
    model_id = created.json()["id"]
    authoritative = created.json()["ui_metadata"]["time_dimension"]
    fetched = client.get(f"/api/models/{model_id}").json()
    fetched["name"] = "往返后的模型"
    updated = client.put(f"/api/models/{model_id}", json=fetched)
    assert updated.status_code == 200, updated.text
    published = test_and_publish_model(client, model_id, updated.json()["parameters"])
    assert published.status_code == 200, published.text
    final = client.get(f"/api/models/{model_id}").json()
    assert final["ui_metadata"]["time_dimension"] == authoritative
    assert final["model_draft"]["time_dimension"] == final["ui_metadata"]["time_dimension"]


def test_no_model_code_time_policy_whitelist_in_modeling_runtime_chain() -> None:
    paths = [Path("app/services/model_time_dimension_service.py"), Path("app/services/model_set_reference_validator.py"), Path("app/schemas/time_dimension.py"), Path("app/services/job_service.py")]
    forbidden = ("dynamic_horizon_models", "unit_commitment_day_ahead", "contract_spot_exposure_v1")
    for path in paths:
        content = path.read_text(encoding="utf-8")
        for token in forbidden:
            assert token not in content, f"{token} must not be used in {path}"
    assert "dynamic_horizon_models" not in Path("app/services/model_service.py").read_text(encoding="utf-8")
