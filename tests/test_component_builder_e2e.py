from __future__ import annotations

import time
from copy import deepcopy

from fastapi.testclient import TestClient

from app.main import app
from app.builders.pyomo_builder import PyomoModelBuilder
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template


client = TestClient(app)
DEFAULT_HYDRO_MODEL_ID = "MODEL-POWER-CASCADE-HYDRO-DISPATCH"


def _sample_params() -> dict:
    return deepcopy(get_template("cascade_hydro_dispatch")["sample_runtime_parameters"])


def _expand_hydro_params(params: dict, horizon: int) -> dict:
    expanded = deepcopy(params)
    expanded["horizon"] = horizon
    expanded.pop("time", None)
    expanded.pop("time_volume", None)

    def resize(values: list) -> list:
        result = list(values)
        while len(result) < horizon:
            result.extend(values)
        return result[:horizon]

    for key in ["load_forecast"]:
        expanded[key] = resize(expanded[key])
    for station, values in list(expanded.get("local_inflow", {}).items()):
        expanded["local_inflow"][station] = resize(values)
    for unit, values in list(expanded.get("availability", {}).items()):
        expanded["availability"][unit] = resize(values)
    return expanded


def _wait_task(task_id: str) -> dict:
    latest = {}
    for _ in range(80):
        response = client.get(f"/api/optimize/jobs/{task_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            return latest
        time.sleep(0.1)
    return latest


def test_cascade_hydro_default_model_invoke_success() -> None:
    response = client.post(
        f"/api/models/{DEFAULT_HYDRO_MODEL_ID}/invoke",
        json={"parameters": _sample_params(), "options": {"mode": "sync", "explain": True, "time_limit_seconds": 30}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    assert body["resolved_model_id"] == DEFAULT_HYDRO_MODEL_ID


def test_cascade_hydro_optimize_run_by_model_code_success() -> None:
    response = client.post(
        "/api/optimize/run",
        json={"model_code": "cascade_hydro_dispatch", "runtime_parameters": _sample_params(), "time_limit_seconds": 30},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resolved_model_id"] == DEFAULT_HYDRO_MODEL_ID
    task = _wait_task(body["id"])
    assert task["status"] == "SUCCESS", task


def test_cascade_hydro_model_run_rejects_partial_series_when_horizon_changes() -> None:
    params = _sample_params()
    load = params["load_forecast"] * 6
    response = client.post(
        "/api/optimize/run",
        json={
            "model_code": "cascade_hydro_dispatch",
            "model_id": DEFAULT_HYDRO_MODEL_ID,
            "horizon": 24,
            "runtime_parameters": {"load_forecast": load},
            "time_limit_seconds": 30,
        },
    )
    assert response.status_code == 422, response.text
    assert "horizon=24" in response.text


def test_cascade_hydro_skill_resolves_default_model() -> None:
    response = client.post(
        "/api/skills/run_cascade_hydro_dispatch/run",
        json={"parameters": _sample_params(), "options": {"mode": "sync", "explain": True, "time_limit_seconds": 30}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    assert body["resolved_model_id"] == DEFAULT_HYDRO_MODEL_ID
    assert body["resolved_model_code"] == "cascade_hydro_dispatch"


def test_custom_cascade_hydro_model_does_not_override_default_skill() -> None:
    copied = client.post(f"/api/models/{DEFAULT_HYDRO_MODEL_ID}/copy")
    assert copied.status_code == 200, copied.text
    copied_body = copied.json()
    custom_id = copied_body["id"]
    custom_code = copied_body["semantic_spec"]["model_code"]
    assert custom_code.startswith("cascade_hydro_dispatch_custom_")

    published = client.post(f"/api/models/{custom_id}/publish")
    assert published.status_code == 200, published.text
    generated = client.post(f"/api/models/{custom_id}/skills/generate")
    assert generated.status_code == 200, generated.text
    assert generated.json()["skill_name"].startswith(f"run_{custom_code}")

    response = client.post(
        "/api/skills/run_cascade_hydro_dispatch/run",
        json={"parameters": _sample_params(), "options": {"mode": "sync", "explain": True, "time_limit_seconds": 30}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    assert body["resolved_model_id"] == DEFAULT_HYDRO_MODEL_ID


def test_hydro_runtime_auto_generates_time_sets() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = _sample_params()
    params.pop("time", None)
    params.pop("time_volume", None)
    runtime = {**params, "semantic_spec": template}
    model, _ = PyomoModelBuilder().build(template, runtime)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert result.status == "optimal"
    assert runtime["time"] == list(range(params["horizon"]))
    assert runtime["time_volume"] == list(range(params["horizon"] + 1))


def test_cascade_hydro_invoke_horizon_96_regenerates_time_sets_success() -> None:
    params = _expand_hydro_params(_sample_params(), 96)
    response = client.post(
        f"/api/models/{DEFAULT_HYDRO_MODEL_ID}/invoke",
        json={"parameters": params, "options": {"mode": "sync", "explain": False, "time_limit_seconds": 30}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body


def test_publish_component_model_infers_build_mode_from_component_spec() -> None:
    template = deepcopy(get_template("cascade_hydro_dispatch"))
    payload = {
        "id": f"MODEL-CASCADE-HYDRO-INFER-{int(time.time() * 1000)}",
        "name": "cascade-hydro-infer-component-mode",
        "scene": "梯级水电日前调度",
        "status": "developing",
        "build_mode": "generic_linear",
        "semantic_spec": {**template, "build_mode": "generic_linear"},
        "generic_spec": {},
        "component_spec": {**template["component_spec"], "build_mode": "component_based"},
        "component_schema": template.get("component_schema", {}),
        "parameters": template["sample_runtime_parameters"],
    }
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text

    published = client.post(f"/api/models/{payload['id']}/publish")
    assert published.status_code == 200, published.text
    body = published.json()
    assert body["status"] == "published"
    assert body["build_mode"] == "component_based"
    assert body["semantic_spec"]["build_mode"] == "component_based"


def test_hydro_invalid_availability_returns_chinese_error() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = _sample_params()
    params["availability"]["S1_U2"] = [1, 0, 1]
    errors = RuntimeParameterValidator().validate(template, params)
    assert errors
    assert "梯级水电模型参数错误" in errors[0]["error"]
    assert "availability 长度" in errors[0]["error"]


def test_hydro_result_contains_spill_volume_metrics() -> None:
    response = client.post(
        "/api/skills/run_cascade_hydro_dispatch/run",
        json={"parameters": _sample_params(), "options": {"mode": "sync", "explain": True, "time_limit_seconds": 30}},
    )
    assert response.status_code == 200, response.text
    metrics = response.json()["result"]["metrics"]
    assert "total_spill_volume_m3" in metrics
    assert "total_spill_volume_million_m3" in metrics
    assert metrics["total_spill_volume_million_m3"] == metrics["total_spill_million_m3"]
