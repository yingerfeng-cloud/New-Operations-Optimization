from __future__ import annotations

import uuid
from copy import deepcopy

from fastapi.testclient import TestClient

from app.builders.pyomo_builder import PyomoModelBuilder
from app.main import app
from app.explain.result_formatter import SolveResultFormatter
from app.services.model_service import model_service
from app.solvers.highs_adapter import HiGHSAdapter
from app.templates.power_templates import get_template
from tests.test_helpers import test_and_publish_model


client = TestClient(app)


def _template(code: str) -> dict:
    model_service.seed_default_templates()
    return get_template(code)


def _solve(code: str, overrides: dict | None = None):
    template = _template(code)
    params = deepcopy(template["sample_runtime_parameters"])
    params.update(overrides or {})
    model, context = PyomoModelBuilder().build(template, params)
    result = HiGHSAdapter().solve(model, time_limit_seconds=30)
    assert result.status == "optimal", result
    return template, params, context, result


def _objective_terms(code: str) -> list[dict]:
    return _template(code)["component_spec"]["objective"]["terms"]


def test_pv_storage_capacity_objective_is_solve_active() -> None:
    terms = _objective_terms("pv_storage_capacity_planning")
    active_terms = {term["weight_key"] for term in terms if term.get("solve_participation") == "solve_active"}

    assert {"investment", "curtailment"} <= active_terms
    assert all(term.get("supported_by_backend") is True for term in terms if term["weight_key"] in active_terms)


def test_pv_storage_capacity_objective_value_changes_with_capex_or_curtailment_penalty() -> None:
    _, _, _, low_penalty = _solve("pv_storage_capacity_planning", {"curtailment_penalty": 10})
    _, _, _, high_penalty = _solve("pv_storage_capacity_planning", {"curtailment_penalty": 500})

    assert low_penalty.objective_value != high_penalty.objective_value


def test_pv_storage_capacity_template_sample_invokes_successfully() -> None:
    model_service.seed_default_templates()
    template = _template("pv_storage_capacity_planning")
    model_id = "MODEL-POWER-PV-STORAGE-CAPACITY-PLANNING"

    response = client.post(
        f"/api/models/{model_id}/invoke",
        json={"parameters": deepcopy(template["sample_runtime_parameters"]), "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    body = response.json()
    metrics = body["business_result"]["metrics"]

    assert response.status_code == 200, response.text
    assert body["status"] == "SUCCESS", body
    for key in ["storage_power_capacity", "storage_energy_capacity", "investment_cost", "curtailment_rate", "payback_period_years"]:
        assert key in metrics


def test_pv_storage_capacity_does_not_require_decision_capacity_as_runtime_param() -> None:
    template = _template("pv_storage_capacity_planning")
    param_by_code = {param["code"]: param for param in template["parameters"]}
    schema = client.get("/api/models/MODEL-POWER-PV-STORAGE-CAPACITY-PLANNING/schema").json()["input_schema"]
    schema_by_key = {item["key"]: item for item in schema}

    assert "storage_power_capacity" not in template["sample_runtime_parameters"]
    assert "storage_energy_capacity" not in template["sample_runtime_parameters"]
    assert "storage_power_capacity" not in param_by_code
    assert "storage_energy_capacity" not in param_by_code
    assert schema_by_key.get("storage_power_capacity", {}).get("required") is not True
    assert schema_by_key.get("storage_energy_capacity", {}).get("required") is not True
    assert {"max_storage_power_capacity", "max_storage_energy_capacity"} <= set(param_by_code)


def test_pv_storage_capacity_uses_max_capacity_params_as_bounds() -> None:
    _, _, context, result = _solve(
        "pv_storage_capacity_planning",
        {
            "max_storage_power_capacity": 10,
            "max_storage_energy_capacity": 10,
            "capex_power": 100,
            "capex_energy": 50,
            "curtailment_penalty": 5000,
        },
    )
    metrics = SolveResultFormatter().format("pv_storage_capacity_planning", result, context)["business_output"]["metrics"]

    assert metrics["storage_power_capacity"] <= 10
    assert metrics["storage_energy_capacity"] <= 10


def test_pv_storage_capacity_uses_solved_capacity_variables_in_metrics() -> None:
    _, _, context, result = _solve(
        "pv_storage_capacity_planning",
        {"capex_power": 100, "capex_energy": 50, "curtailment_penalty": 5000},
    )
    formatted = SolveResultFormatter().format("pv_storage_capacity_planning", result, context)
    metrics = formatted["business_output"]["metrics"]
    capacity = formatted["business_output"]["capacity_result"]
    solved_power = result.variable_values["storage_power_capacity"]["storage_power_capacity"]
    solved_energy = result.variable_values["storage_energy_capacity"]["storage_energy_capacity"]

    assert capacity["storage_power_capacity"] == solved_power
    assert capacity["storage_energy_capacity"] == solved_energy
    assert metrics["storage_power_capacity"] == solved_power
    assert metrics["storage_energy_capacity"] == solved_energy


def test_pv_storage_capacity_solved_capacity_metrics_match_variables() -> None:
    test_pv_storage_capacity_uses_solved_capacity_variables_in_metrics()


def test_pv_storage_capacity_changes_with_capex_and_curtailment_penalty() -> None:
    _, _, low_cost_context, low_cost = _solve(
        "pv_storage_capacity_planning",
        {"capex_power": 100, "capex_energy": 50, "curtailment_penalty": 5000},
    )
    _, _, high_cost_context, high_cost = _solve(
        "pv_storage_capacity_planning",
        {"capex_power": 10000, "capex_energy": 5000, "curtailment_penalty": 5000},
    )
    _, _, low_penalty_context, low_penalty = _solve(
        "pv_storage_capacity_planning",
        {"capex_power": 100, "capex_energy": 50, "curtailment_penalty": 10},
    )
    low_cost_metrics = SolveResultFormatter().format("pv_storage_capacity_planning", low_cost, low_cost_context)["business_output"]["metrics"]
    high_cost_metrics = SolveResultFormatter().format("pv_storage_capacity_planning", high_cost, high_cost_context)["business_output"]["metrics"]
    low_penalty_metrics = SolveResultFormatter().format("pv_storage_capacity_planning", low_penalty, low_penalty_context)["business_output"]["metrics"]

    assert high_cost_metrics["storage_power_capacity"] <= low_cost_metrics["storage_power_capacity"]
    assert high_cost_metrics["storage_energy_capacity"] <= low_cost_metrics["storage_energy_capacity"]
    assert low_cost_metrics["storage_power_capacity"] >= low_penalty_metrics["storage_power_capacity"]
    assert low_cost_metrics["total_pv_curtailment"] <= low_penalty_metrics["total_pv_curtailment"]


def test_pv_storage_capacity_can_create_publish_invoke_from_template() -> None:
    template = _template("pv_storage_capacity_planning")
    model_id = f"MODEL-PV-CAP-{uuid.uuid4().hex[:8].upper()}"
    created = client.post(
        "/api/models",
        json={
            "id": model_id,
            "template_id": "pv_storage_capacity_planning",
            "name": template["name"],
            "scene": template["scenario"],
            "status": "developing",
            "solver": "HiGHS",
            "problem_type": "LP",
            "objective": "pv_storage_objective",
            "semantic_spec": template,
            "build_mode": "component_based",
            "component_spec": template["component_spec"],
            "component_schema": template.get("component_schema", {}),
            "model_draft": template["model_draft"],
            "objective_config": template["objective_config"],
            "draft_constraints": template["draft_constraints"],
            "mathematical_expansion": template["mathematical_expansion"],
            "model_problem_type": "LP",
            "required_solver_capabilities": ["LP"],
            "ui_metadata": template.get("ui_metadata", {}),
            "parameters": deepcopy(template["sample_runtime_parameters"]),
        },
    )
    assert created.status_code == 200, created.text
    published = test_and_publish_model(client, model_id)
    assert published.status_code == 200, published.text

    invoked = client.post(
        f"/api/models/{model_id}/invoke",
        json={"parameters": {}, "options": {"mode": "sync", "time_limit_seconds": 30}},
    )
    body = invoked.json()

    assert invoked.status_code == 200, invoked.text
    assert body["status"] == "SUCCESS", body
    assert "storage_power_capacity" in body["business_result"]["metrics"]


def test_pv_storage_dispatch_minimizes_schedule_deviation() -> None:
    _, _, _, result = _solve("pv_storage_day_ahead_dispatch")
    deviation = sum(result.variable_values["deviation_pos"].values()) + sum(result.variable_values["deviation_neg"].values())

    assert deviation <= 1.0


def test_pv_storage_dispatch_penalizes_curtailment() -> None:
    terms = _objective_terms("pv_storage_day_ahead_dispatch")
    curtailment = next(term for term in terms if term["weight_key"] == "curtailment")

    assert curtailment["solve_participation"] == "solve_active"
    assert curtailment["supported_by_backend"] is True


def test_pv_storage_dispatch_uses_price_or_cost_terms() -> None:
    terms = _objective_terms("pv_storage_day_ahead_dispatch")
    active_keys = {term["weight_key"] for term in terms if term.get("solve_participation") == "solve_active"}
    _, _, _, zero_price = _solve("pv_storage_day_ahead_dispatch", {"price": [0, 0, 0, 0]})
    _, _, _, market_price = _solve("pv_storage_day_ahead_dispatch", {"price": [300, 300, 450, 500]})

    assert {"energy_revenue", "storage_cycle"} <= active_keys
    assert zero_price.objective_value != market_price.objective_value


def test_pv_storage_day_ahead_runtime_weights_override_term_weights() -> None:
    scenarios = [
        {"deviation": 1, "curtailment": 100, "energy_revenue": 0.2, "terminal_soc": 200},
        {"deviation": 10000, "curtailment": 100, "energy_revenue": 0.2, "terminal_soc": 200},
        {"deviation": 1000, "curtailment": 1, "energy_revenue": 0.2, "terminal_soc": 200},
        {"deviation": 1000, "curtailment": 100, "energy_revenue": 10, "terminal_soc": 200},
        {"deviation": 1000, "curtailment": 100, "energy_revenue": 0.2, "terminal_soc": 1},
    ]
    outputs = []
    for weights in scenarios:
        _, _, context, result = _solve("pv_storage_day_ahead_dispatch", {"weights": weights})
        metrics = SolveResultFormatter().format("pv_storage_day_ahead_dispatch", result, context)["business_output"]["metrics"]
        outputs.append((round(result.objective_value, 6), metrics))
        for key, expected in weights.items():
            assert context["metadata"]["objective_weights"][key] == expected

    objective_values = {item[0] for item in outputs}
    schedule_deviations = {item[1]["schedule_deviation"] for item in outputs}
    soc_ends = {item[1]["soc_end"] for item in outputs}

    assert len(objective_values) == len(scenarios)
    assert len(schedule_deviations) > 1
    assert len(soc_ends) > 1


def test_pv_storage_day_ahead_and_intraday_templates_are_separate() -> None:
    day_ahead = _template("pv_storage_day_ahead_dispatch")
    intraday = _template("pv_storage_intraday_dispatch")

    assert day_ahead["model_code"] != intraday["model_code"]
    assert day_ahead["ui_metadata"]["dispatch_mode"] == "day_ahead"
    assert intraday["ui_metadata"]["dispatch_mode"] == "intraday"
    assert day_ahead["name"] != intraday["name"]


def test_pv_storage_outputs_business_metrics() -> None:
    _, _, context, result = _solve("pv_storage_day_ahead_dispatch")
    formatted = SolveResultFormatter().format("pv_storage_day_ahead_dispatch", result, context)
    metrics = formatted["business_output"]["metrics"]

    for key in [
        "total_pv_generation_used",
        "total_pv_curtailment",
        "curtailment_rate",
        "storage_charge_energy",
        "storage_discharge_energy",
        "soc_start",
        "soc_end",
        "schedule_deviation",
        "revenue",
        "investment_cost",
        "payback_period_years",
        "storage_power_capacity",
        "storage_energy_capacity",
    ]:
        assert key in metrics
    assert formatted["business_output"]["capacity_result"]


def test_pv_storage_not_all_objective_terms_are_display_only() -> None:
    for code in ["pv_storage_capacity_planning", "pv_storage_day_ahead_dispatch", "pv_storage_intraday_dispatch"]:
        terms = _objective_terms(code)
        assert any(term.get("solve_participation") == "solve_active" for term in terms)
        assert not all(term.get("solve_participation") == "display_only" for term in terms)
