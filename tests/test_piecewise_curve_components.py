from __future__ import annotations

import math

import pytest

from app.builders.component_model_builder import ComponentModelBuilder
from app.model_components.formula_components import normalize_component_payload, validate_component_definition
from app.model_draft import build_component_spec_from_draft, build_mathematical_expansion
from app.problem_type_diagnosis import component_problem_type_fields
from app.solvers.highs_adapter import HiGHSAdapter
from app.storage.memory_store import STORE


def _piecewise_component(points=None, *, participation: str = "solve_active") -> dict:
    return {
        "component_id": "piecewise_cost_component",
        "name": "Piecewise cost component",
        "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": [
            {
                "code": "cost_curve",
                "name": "Cost curve",
                "type": "piecewise_curve",
                "points": points if points is not None else [[0, 0], [10, 100], [20, 260]],
                "interpolation": "linear",
            }
        ],
        "variables": [
            {"code": "p", "name": "Power", "dimension": ["time"], "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 20},
            {"code": "cost", "name": "Cost", "dimension": ["time"], "type": "continuous", "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "constraints": [
            {
                "constraint_id": "piecewise_cost_eq",
                "name": "Piecewise cost",
                "type": "piecewise",
                "indices": [{"set": "time", "alias": "t"}],
                "x": "p[t]",
                "y": "cost[t]",
                "curve": "cost_curve",
                "expression": "cost[t] == piecewise(p[t], cost_curve)",
                "solve_participation": participation,
                "participates_in_solve": participation == "solve_active",
                "enabled": True,
            }
        ],
        "objective_terms": [
            {
                "term_id": "min_piecewise_cost",
                "name": "Min piecewise cost",
                "expression": "sum(cost[t] for t in time)",
                "weight_key": "piecewise_cost",
                "weight": 1,
                "solve_participation": "solve_active",
                "supported_by_backend": True,
                "enabled": True,
            }
        ],
    }


def _model_spec(component: dict) -> dict:
    definition = normalize_component_payload(component)
    return {
        "model_code": "piecewise_test",
        "build_mode": "component_based",
        "required_solver_capabilities": ["LP"],
        "sets": [{"code": "time", "values": [0, 1]}],
        "parameters": definition["parameters"],
        "variables": [
            {"name": item["code"], "indices": item.get("dimension") or [], "domain": item.get("domain", "NonNegativeReals"), "lower_bound": item.get("lower_bound", 0), "upper_bound": item.get("upper_bound")}
            for item in definition["variables"]
        ],
        "components": [{"type": definition["component_id"]}],
        "objective": {"type": "weighted_sum", "sense": "minimize", "terms": definition["generated_objective_terms"]},
    }


def test_piecewise_curve_points_validation_success() -> None:
    result = validate_component_definition(_piecewise_component())
    assert result["valid"], result


@pytest.mark.parametrize(
    "points",
    [
        [[0, 0], [10, 100], [10, 120]],
        [[0, 0], [10, 100], [5, 80]],
        [[0, 0], ["bad", 100]],
        [[0, 0]],
    ],
)
def test_piecewise_curve_points_reject_invalid(points) -> None:
    result = validate_component_definition(_piecewise_component(points))
    assert not result["valid"]
    assert any("points" in str(err.get("field")) or "curve" in str(err.get("field")) for err in result["errors"])


def test_piecewise_solve_active_model_dry_run_and_invoke_success() -> None:
    component = _piecewise_component()
    with STORE.lock:
        STORE.custom_components[component["component_id"]] = {**component, "status": "published", "enabled": True}
    model_spec = _model_spec(component)
    runtime = {"horizon": 2, "time": [0, 1], "cost_curve": [[0, 0], [10, 100], [20, 260]]}
    model, context = ComponentModelBuilder().build(model_spec, runtime)
    model.p[0].fix(10)
    model.p[1].fix(20)
    result = HiGHSAdapter().solve(model)
    assert result.status == "optimal"
    values = result.variable_values["cost"]
    assert math.isclose(values["cost[0]"], 100.0, abs_tol=1e-5)
    assert math.isclose(values["cost[1]"], 260.0, abs_tol=1e-5)
    assert context["metadata"]["piecewise_constraints"][0]["compiler"] == "convex_combination_lp"


def test_piecewise_solve_active_rejects_missing_curve() -> None:
    component = _piecewise_component()
    component["constraints"][0]["curve"] = "missing_curve"
    result = validate_component_definition(component)
    assert not result["valid"]
    assert any("missing_curve" in str(err) for err in result["errors"])


def test_piecewise_display_only_does_not_affect_problem_type() -> None:
    component = normalize_component_payload(_piecewise_component(participation="display_only"))
    fields = component_problem_type_fields(component)
    assert fields["problem_type_effect"] == "LP"
    assert component["generated_constraints"][0]["participates_in_solve"] is False


def test_piecewise_binary_segment_infers_milp_if_used() -> None:
    component = normalize_component_payload(_piecewise_component())
    component["generated_constraints"][0]["piecewise_method"] = "binary_segment"
    fields = component_problem_type_fields(component)
    assert fields["problem_type_effect"] == "MILP"


def test_piecewise_math_expansion_and_component_spec_generated() -> None:
    definition = normalize_component_payload(_piecewise_component())
    draft = {
        "basic_info": {"model_code": "piecewise_test", "problem_type": "LP", "solver": "HiGHS"},
        "semantic": {"sets": [{"code": "time"}], "parameters": [], "variables": []},
        "components": [
            {
                "component_id": definition["component_id"],
                "type": definition["component_id"],
                "enabled": True,
                "definition": definition,
                "generated_constraints": definition["generated_constraints"],
                "generated_objective_terms": definition["generated_objective_terms"],
            }
        ],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": definition["generated_objective_terms"]},
        "advanced": {"component_spec": {}},
    }
    expansion = build_mathematical_expansion(draft)
    spec = build_component_spec_from_draft(draft)
    assert any("piecewise" in section.get("formula", "") for section in expansion["sections"])
    assert any(param["code"] == "cost_curve" for param in spec["parameters"])
    assert any(var["name"] == "cost" for var in spec["variables"])
