from __future__ import annotations

import uuid

import pyomo.environ as pyo
from fastapi.testclient import TestClient

from app.main import app
from app.problem_type_diagnosis import infer_problem_type, infer_problem_type_from_component_spec
from app.services.nonlinear_analyzer import analyze_component_spec, analyze_expression
from app.solvers.solver_router import SolverRouteError, solver_router


client = TestClient(app)


def test_analyzer_identifies_bilinear_product() -> None:
    findings = analyze_expression("power[t] == k * flow[t] * head[t]", variables={"power", "flow", "head"})

    assert findings[0]["nonlinear_type"] == "bilinear"
    assert findings[0]["involved_variables"] == ["flow[t]", "head[t]"]
    assert findings[0]["supported_by_current_solver"] is False
    assert "mccormick_relaxation" in findings[0]["recommended_strategy"]


def test_analyzer_identifies_quadratic_power() -> None:
    findings = analyze_expression("cost[t] == p[t]^2", variables={"cost", "p"})

    assert any(item["nonlinear_type"] == "quadratic" for item in findings)
    assert any("qp" in item["recommended_strategy"] for item in findings)


def test_analyzer_identifies_one_dimensional_function_asset() -> None:
    findings = analyze_expression("level[t] == storage_level(storage[t])", variables={"level", "storage"})

    assert findings[0]["nonlinear_type"] == "function_1d"
    assert findings[0]["recommended_strategy"] == ["piecewise_1d"]


def test_analyzer_identifies_two_dimensional_function_asset() -> None:
    findings = analyze_expression("power[t] == hydro_power(flow[t], head[t])", variables={"power", "flow", "head"})

    assert findings[0]["nonlinear_type"] == "function_2d"
    assert findings[0]["recommended_strategy"] == ["piecewise_2d"]


def test_component_spec_reports_transformed_mccormick_as_supported() -> None:
    report = analyze_component_spec(
        {
            "variables": [
                {"name": "flow", "domain": "NonNegativeReals"},
                {"name": "head", "domain": "NonNegativeReals"},
                {"name": "w", "domain": "NonNegativeReals"},
            ],
            "components": [
                {
                    "type": "mccormick_bilinear_relaxation_component",
                    "x": "flow[t]",
                    "y": "head[t]",
                    "w": "w[t]",
                    "x_lower": 0,
                    "x_upper": 10,
                    "y_lower": 0,
                    "y_upper": 20,
                    "indices": [{"set": "time", "alias": "t"}],
                }
            ],
        }
    )

    assert report["has_blocking_nonlinearity"] is False
    assert report["relationships"][0]["converted"] is True
    assert report["relationships"][0]["supported_by_current_solver"] is True


def test_problem_type_upgrades_unconverted_bilinear_to_nlp() -> None:
    diagnosis = infer_problem_type(
        variables=[
            {"name": "flow", "domain": "NonNegativeReals"},
            {"name": "head", "domain": "NonNegativeReals"},
            {"name": "power", "domain": "NonNegativeReals"},
        ],
        constraints=[{"expression": "power[t] == flow[t] * head[t]"}],
        objective_terms=[],
        solver_name="HiGHS",
        requested_problem_type="LP",
    )

    assert diagnosis["inferred_problem_type"] == "NLP"
    assert diagnosis["publish_valid"] is False
    assert diagnosis["nonlinear_diagnostics"]["has_blocking_nonlinearity"] is True


def test_step5_publish_check_blocks_unconverted_nonlinearity() -> None:
    model_id = f"MODEL-NONLINEAR-{uuid.uuid4().hex[:8].upper()}"
    component_spec = {
        "model_code": model_id.lower(),
        "build_mode": "component_based",
        "model_problem_type": "LP",
        "required_solver_capabilities": ["LP"],
        "sets": [{"code": "time", "values": [0]}],
        "variables": [
            {"name": "flow", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 10},
            {"name": "head", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 10},
            {"name": "power", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "components": [
            {
                "component_id": "raw_bilinear_component",
                "type": "raw_bilinear_component",
                "enabled": True,
                "generated_constraints": [{"constraint_id": "raw", "expression": "power[t] == flow[t] * head[t]", "indices": [{"set": "time", "alias": "t"}]}],
            }
        ],
        "objective": {
            "sense": "minimize",
            "terms": [{"term_id": "obj", "weight_key": "obj", "expression": "sum(power[t] for t in time)", "supported_by_backend": True}],
        },
    }
    payload = {
        "id": model_id,
        "name": "nonlinear blocker",
        "scene": "test",
        "status": "developing",
        "build_mode": "component_based",
        "semantic_spec": {"model_code": model_id.lower(), "build_mode": "component_based", "sets": [{"code": "time", "values": [0]}], "component_spec": component_spec},
        "component_spec": component_spec,
        "mathematical_expansion": {"sections": [{"formula": "power[t] == flow[t] * head[t]"}]},
        "parameters": {"horizon": 1, "time": [0]},
    }
    created = client.post("/api/models", json=payload)
    assert created.status_code == 200, created.text

    published = client.post(f"/api/models/{model_id}/publish")

    assert published.status_code == 422, published.text
    assert "非线性" in published.text or "nonlinear" in published.text
    assert "HiGHS" in published.text


def test_solver_router_rejects_highs_for_unconverted_nonlinear_constraint() -> None:
    model = pyo.ConcreteModel()
    model.x = pyo.Var(bounds=(0, 1))
    model.y = pyo.Var(bounds=(0, 1))
    model.c = pyo.Constraint(expr=model.x * model.y <= 0.5)
    model.o = pyo.Objective(expr=model.x + model.y)

    try:
        solver_router.solve(model, problem_type="LP", requested_solver="HiGHS")
    except SolverRouteError as exc:
        assert exc.payload["error_code"] == "NONLINEAR_NOT_LINEARIZED"
    else:
        raise AssertionError("SolverRouter allowed HiGHS to receive an unconverted nonlinear constraint")


def test_component_spec_with_mccormick_stays_lp() -> None:
    diagnosis = infer_problem_type_from_component_spec(
        {
            "model_problem_type": "LP",
            "variables": [
                {"name": "flow", "domain": "NonNegativeReals"},
                {"name": "head", "domain": "NonNegativeReals"},
                {"name": "w", "domain": "NonNegativeReals"},
            ],
            "components": [
                {"type": "mccormick_bilinear_relaxation_component", "x": "flow[t]", "y": "head[t]", "w": "w[t]", "x_lower": 0, "x_upper": 1, "y_lower": 0, "y_upper": 1}
            ],
        },
        solver_name="HiGHS",
    )

    assert diagnosis["inferred_problem_type"] == "LP"
    assert diagnosis["publish_valid"] is True


def test_template_linear_problem_types_do_not_upgrade_to_nonlinear() -> None:
    expected = {
        "unit_commitment_day_ahead": "MILP",
        "economic_dispatch": "LP",
        "storage_dispatch": "MILP",
    }
    for template_code, problem_type in expected.items():
        cloned = client.post(f"/api/templates/{template_code}/clone")
        assert cloned.status_code == 200, cloned.text
        diagnosis = infer_problem_type_from_component_spec(
            cloned.json().get("component_spec") or {},
            solver_name="HiGHS",
            requested_problem_type=problem_type,
        )
        draft_diagnosis = cloned.json()["model_draft"]["problem_type_diagnosis"]

        assert draft_diagnosis["inferred_problem_type"] == problem_type
        assert draft_diagnosis["expression_class"] == "linear"
        assert draft_diagnosis["nonlinear_diagnostics"]["count"] == 0
        assert diagnosis["nonlinear_diagnostics"]["has_blocking_nonlinearity"] is False


def test_parameter_times_variable_stays_linear() -> None:
    diagnosis = infer_problem_type(
        variables=[{"name": "unit_on", "domain": "Binary"}],
        constraints=[{"expression": "sum(unit_max_output[unit] * unit_on[unit,time] for unit in unit) >= load_forecast[time]"}],
        objective_terms=[],
        solver_name="HiGHS",
        requested_problem_type="MILP",
    )

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["expression_class"] == "linear"
    assert diagnosis["nonlinear_diagnostics"]["count"] == 0
