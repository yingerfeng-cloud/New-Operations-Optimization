from __future__ import annotations

import time
from copy import deepcopy

import pyomo.environ as pyo
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.builders.generic_linear_builder import GenericLinearBuilder
from app.builders.pyomo_builder import PyomoModelBuilder
from app.model_components.registry import list_component_types
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template

client = TestClient(app)


def _hydro_case():
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    model, context = PyomoModelBuilder().build(template, {**params, "semantic_spec": template})
    return template, params, model, context


def test_component_based_hydro_model_solve_success() -> None:
    _, _, model, context = _hydro_case()
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert solver_result.status == "optimal"
    assert context["build_mode"] == "component_based"
    assert "hydro_reservoir_balance" in context["component_types"]


def test_hydro_maintenance_limits_station_power() -> None:
    _, _, model, _ = _hydro_case()
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    station_power = solver_result.variable_values["station_power"]
    assert station_power["station_power[S1,1]"] <= 100.0 + 1e-5
    assert station_power["station_power[S1,2]"] <= 100.0 + 1e-5


def test_additional_custom_boundary_constraint_participates_in_solve() -> None:
    template = deepcopy(get_template("cascade_hydro_dispatch"))
    template["component_spec"]["additional_custom_constraints"] = [
        {"name": "limit_s1_t0", "expression": "station_power[S1,0] <= 120", "scope": "station,time"}
    ]
    params = deepcopy(template["sample_runtime_parameters"])
    model, _ = PyomoModelBuilder().build(template, {**params, "semantic_spec": template})
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert solver_result.status == "optimal"
    assert solver_result.variable_values["station_power"]["station_power[S1,0]"] <= 120.0 + 1e-5
    assert hasattr(model, "limit_s1_t0")


def test_hydro_delay_uses_previous_outflow() -> None:
    _, params, model, _ = _hydro_case()
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    q_out_s1_t0 = solver_result.variable_values["q_out"]["q_out[S1,0]"]
    assert pyo.value(model.hydro_inflow["S2", 0]) == pytest.approx(params["local_inflow"]["S2"][0] + 300.0)
    assert pyo.value(model.hydro_inflow["S2", 1]) == pytest.approx(params["local_inflow"]["S2"][1] + q_out_s1_t0)


def test_hydro_missing_initial_upstream_outflow_validation_error() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    del params["initial_upstream_outflow"]["S1->S2"]
    with pytest.raises(RuntimeError, match="initial_upstream_outflow 缺少 S1->S2"):
        PyomoModelBuilder().build(template, {**params, "semantic_spec": template})


def test_hydro_components_registered() -> None:
    expected = {
        "hydro_initial_volume",
        "hydro_volume_bounds",
        "hydro_station_available_capacity",
        "hydro_power_flow_conversion",
        "hydro_outflow_balance",
        "hydro_outflow_bounds",
        "hydro_spill_bounds",
        "hydro_cascade_inflow_delay",
        "hydro_reservoir_balance",
        "hydro_load_tracking",
        "hydro_terminal_volume",
        "hydro_ramp_smoothing",
    }
    assert expected.issubset(set(list_component_types()))


def test_component_based_runtime_validator_accepts_time_volume_list() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    errors = RuntimeParameterValidator().validate(template, params)
    assert errors == []


def test_optimize_run_cascade_hydro_complete_chain() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    response = client.post(
        "/api/optimize/run",
        json={
            "model_code": "cascade_hydro_dispatch",
            "runtime_parameters": params,
            "time_limit_seconds": 30,
        },
    )
    assert response.status_code == 200, response.text
    task_id = response.json()["id"]
    task = _wait_task(task_id)
    assert task["status"] == "SUCCESS", task
    assert task["recent_logs"]
    assert "solve_seconds" in task["trace"]
    result = client.get(f"/api/optimize/result/{task_id}")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["metrics"]["total_spill_million_m3"] >= 0
    assert "total_spill_m3s_sum" not in body["metrics"]


def test_cascade_hydro_skill_run_complete_chain() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    response = client.post(
        "/api/skills/run_cascade_hydro_dispatch/run",
        json={"parameters": params, "options": {"mode": "sync", "explain": True}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    assert body["result"]["metrics"]["total_spill_million_m3"] >= 0
    assert "百万立方米" in body["explanation"]


def test_cascade_hydro_model_invoke_complete_chain() -> None:
    models = client.get("/api/models")
    assert models.status_code == 200, models.text
    model = next(
        item
        for item in models.json()
        if item.get("template_id") == "cascade_hydro_dispatch" and item.get("status") in {"published", "trial", "tested"}
    )
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    response = client.post(
        f"/api/models/{model['id']}/invoke",
        json={"parameters": params, "options": {"mode": "sync", "explain": True}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUCCESS", body
    assert "dispatch_detail" in body["business_result"]


def test_component_based_validator_returns_chinese_hydro_error() -> None:
    template = get_template("cascade_hydro_dispatch")
    params = deepcopy(template["sample_runtime_parameters"])
    params["availability"]["S1_U2"] = [1, 0, 1]
    errors = RuntimeParameterValidator().validate(template, params)
    assert errors
    assert "梯级水电模型参数错误：机组 S1_U2 的 availability 长度为 3，但 horizon 为 4。" in errors[0]["error"]


def test_cascade_hydro_template_parameters_have_agent_dimensions() -> None:
    template = get_template("cascade_hydro_dispatch")
    dimensions = {item["code"]: item["dimension"] for item in template["parameters"]}
    assert dimensions["availability"] == ["unit", "time"]
    assert dimensions["local_inflow"] == ["station", "time"]
    assert dimensions["volume_min"] == ["station"]
    assert dimensions["volume_max"] == ["station"]
    assert dimensions["edges"] == ["edge"]


def test_existing_generic_linear_builder_still_works() -> None:
    spec = {
        "sense": "minimize",
        "sets": {"unit": ["U1"], "time": [0]},
        "parameters": {"load": {0: 5.0}, "cost": {"U1": 2.0}},
        "variables": [{"name": "unit_output", "indices": ["unit", "time"], "domain": "NonNegativeReals"}],
        "constraints": [
            {
                "name": "meet_load",
                "foreach": ["time"],
                "terms": [{"var": "unit_output", "foreach": ["unit"], "key": ["unit", "time"], "coef": 1}],
                "sense": ">=",
                "rhs_param": "load",
                "rhs_key": ["time"],
            }
        ],
        "objective": {
            "terms": [
                {
                    "var": "unit_output",
                    "foreach": ["unit", "time"],
                    "key": ["unit", "time"],
                    "coef_param": "cost",
                    "param_key": ["unit"],
                }
            ]
        },
    }
    model, _ = GenericLinearBuilder().build(spec)
    solver_result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert solver_result.status == "optimal"
    assert solver_result.variable_values["unit_output"]["U1,0"] == pytest.approx(5.0)


def _wait_task(task_id: str) -> dict:
    latest: dict = {}
    for _ in range(120):
        response = client.get(f"/api/optimize/jobs/{task_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            return latest
        time.sleep(0.1)
    return latest
