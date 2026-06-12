from __future__ import annotations

import uuid
from copy import deepcopy

from fastapi.testclient import TestClient

from app.main import app
from app.model_draft import build_component_spec_from_draft, build_mathematical_expansion
from app.problem_type_diagnosis import infer_problem_type


client = TestClient(app)


def _component_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_formula_state_transition_t_plus_1_skip_last() -> None:
    component_id = _component_id("state_transition")
    payload = {
        "component_id": component_id,
        "name": "state transition",
        "sets": [{"code": "time"}, {"code": "time_volume"}],
        "parameters": [{"code": "inflow", "dimension": ["time"], "default": [1, 1]}, {"code": "outflow", "dimension": ["time"], "default": [0, 0]}],
        "variables": [{"code": "x", "dimension": ["time_volume"], "type": "continuous"}],
        "constraints": [
            {
                "constraint_id": "balance",
                "indices": [{"set": "time", "alias": "t"}],
                "expression": "x[t+1] == x[t] + inflow[t] - outflow[t]",
                "boundary_strategy": "skip_last",
            }
        ],
    }

    response = client.post("/api/components/catalog", json=payload)
    assert response.status_code == 200, response.text
    validated = client.post(f"/api/components/{component_id}/validate", json=payload)
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True


def test_formula_rejects_invalid_boundary_strategy_for_t_minus_1() -> None:
    payload = {
        "component_id": _component_id("bad_boundary"),
        "sets": [{"code": "unit"}, {"code": "time"}],
        "variables": [
            {"code": "start", "dimension": ["unit", "time"], "type": "binary"},
            {"code": "stop", "dimension": ["unit", "time"], "type": "binary"},
            {"code": "on", "dimension": ["unit", "time"], "type": "binary"},
        ],
        "constraints": [
            {
                "constraint_id": "start_stop",
                "indices": [{"set": "unit", "alias": "u"}, {"set": "time", "alias": "t"}],
                "expression": "start[u,t] - stop[u,t] == on[u,t] - on[u,t-1]",
                "boundary_strategy": "normal",
            }
        ],
    }

    response = client.post(f"/api/components/{payload['component_id']}/validate", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert "t-1" in str(response.json()["errors"])


def test_big_m_component_infers_milp_and_lp_publish_rejected() -> None:
    diagnosis = infer_problem_type(
        variables=[{"code": "p_ch", "type": "continuous"}, {"code": "is_charging", "type": "binary"}],
        constraints=[{"expression": "p_ch[t] <= M * is_charging[t]"}],
        objective_terms=[],
        solver_name="HiGHS",
        requested_problem_type="LP",
    )

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["publish_valid"] is False


def test_sum_multi_index_and_alias_mapping_compile() -> None:
    component_id = _component_id("multi_index")
    payload = {
        "component_id": component_id,
        "sets": [{"code": "station"}, {"code": "unit"}, {"code": "time"}],
        "parameters": [
            {"code": "load", "dimension": ["time"], "default": [100, 100, 100]},
            {"code": "unit_pmax", "dimension": ["station", "unit"], "default": 100},
            {"code": "availability", "dimension": ["station", "unit", "time"], "default": 1},
        ],
        "variables": [{"code": "p_gen", "dimension": ["station", "unit", "time"], "type": "continuous"}],
        "constraints": [
            {
                "constraint_id": "balance",
                "indices": [{"set": "time", "alias": "t"}],
                "expression": "sum(p_gen[s,u,t] for s in station for u in unit) == load[t]",
            },
            {
                "constraint_id": "capacity",
                "indices": [{"set": "station", "alias": "s"}, {"set": "unit", "alias": "u"}, {"set": "time", "alias": "t"}],
                "expression": "p_gen[s,u,t] <= unit_pmax[s,u] * availability[s,u,t]",
            },
        ],
    }

    assert client.post("/api/components/catalog", json=payload).status_code == 200
    validated = client.post(f"/api/components/{component_id}/validate", json=payload)
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True, validated.json()


def test_expression_type_parameter_variable_quadratic_and_nonlinear() -> None:
    linear = infer_problem_type(
        variables=[{"code": "x", "type": "continuous"}],
        constraints=[{"expression": "price[t] * x[t] <= limit[t]"}],
        objective_terms=[],
    )
    quadratic = infer_problem_type(
        variables=[{"code": "x", "type": "continuous"}, {"code": "y", "type": "continuous"}],
        constraints=[{"expression": "x[t] * y[t] <= limit[t]"}],
        objective_terms=[],
    )
    nonlinear = infer_problem_type(
        variables=[{"code": "x", "type": "continuous"}, {"code": "y", "type": "continuous"}],
        constraints=[{"expression": "x[t] / y[t] <= limit[t]"}],
        objective_terms=[],
    )

    assert linear["expression_class"] == "linear"
    assert quadratic["inferred_problem_type"] == "QP"
    assert nonlinear["inferred_problem_type"] == "NLP"


def test_piecewise_curve_component_can_be_created_and_expanded_display_only() -> None:
    component_id = _component_id("piecewise_cost")
    payload = {
        "component_id": component_id,
        "name": "piecewise cost",
        "sets": [{"code": "time"}],
        "variables": [{"code": "p", "dimension": ["time"], "type": "continuous"}, {"code": "cost", "dimension": ["time"], "type": "continuous"}],
        "curves": [{"code": "cost_curve", "type": "piecewise_curve", "x": "p", "y": "cost", "points": [[0, 0], [10, 100], [20, 260]], "interpolation": "linear"}],
        "constraints": [
            {
                "constraint_id": "piecewise_cost",
                "indices": [{"set": "time", "alias": "t"}],
                "expression": "cost[t] == piecewise(p[t], cost_curve)",
                "solve_participation": "display_only",
            }
        ],
        "objective_terms": [{"term_id": "cost_sum", "expression": "sum(cost[t] for t in time)", "weight_key": "cost", "solve_participation": "display_only"}],
    }
    created = client.post("/api/components/catalog", json=payload)
    assert created.status_code == 200, created.text
    validated = client.post(f"/api/components/{component_id}/validate", json=payload)
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True

    draft = {"components": [{"type": component_id, "component_id": component_id, "definition": created.json()}], "objective": {"terms": payload["objective_terms"]}}
    expansion = build_mathematical_expansion(draft)
    assert any(section["type"] == "piecewise_curve" and section["curve_points"] for section in expansion["sections"])


def test_piecewise_curve_solve_active_requires_supported_compiler() -> None:
    payload = {
        "component_id": _component_id("piecewise_active"),
        "sets": [{"code": "time"}],
        "variables": [{"code": "p", "dimension": ["time"], "type": "continuous"}, {"code": "cost", "dimension": ["time"], "type": "continuous"}],
        "constraints": [{"constraint_id": "piecewise_cost", "indices": [{"set": "time", "alias": "t"}], "expression": "cost[t] == piecewise(p[t], cost_curve)", "solve_participation": "solve_active"}],
    }
    response = client.post(f"/api/components/{payload['component_id']}/validate", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert "piecewise" in str(response.json()["errors"])


def test_add_remove_component_updates_model_draft_and_blocks_dependency() -> None:
    base_component = {
        "component_id": _component_id("base_component"),
        "sets": [{"code": "time"}],
        "parameters": [{"code": "limit", "dimension": ["time"], "default": [1, 1, 1]}],
        "variables": [{"code": "x", "dimension": ["time"], "type": "continuous"}],
        "constraints": [{"constraint_id": "x_limit", "indices": [{"set": "time", "alias": "t"}], "expression": "x[t] <= limit[t]"}],
        "objective_terms": [{"term_id": "x_sum", "expression": "sum(x[t] for t in time)", "weight_key": "x", "weight": 2, "solve_participation": "solve_active", "supported_by_backend": True}],
    }
    child_component = deepcopy(base_component)
    child_component["component_id"] = _component_id("child_component")
    child_component["dependencies"] = [base_component["component_id"]]
    child_component["variables"] = [{"code": "y", "dimension": ["time"], "type": "continuous"}]
    child_component["constraints"] = [{"constraint_id": "y_limit", "indices": [{"set": "time", "alias": "t"}], "expression": "y[t] <= limit[t]"}]
    child_component["objective_terms"] = []

    base = client.post("/api/components/catalog", json=base_component)
    child = client.post("/api/components/catalog", json=child_component)
    assert base.status_code == 200, base.text
    assert child.status_code == 200, child.text
    assert client.post(f"/api/components/{base_component['component_id']}/publish").status_code == 200
    assert client.post(f"/api/components/{child_component['component_id']}/publish").status_code == 200

    draft = {
        "basic_info": {"model_code": "draft_link", "problem_type": "LP", "solver": "HiGHS"},
        "semantic": {"sets": [{"code": "time", "values": [0, 1, 2]}], "variables": [], "parameters": []},
        "components": [{"type": base_component["component_id"], "definition": base.json()}, {"type": child_component["component_id"], "definition": child.json()}],
        "objective": {"sense": "minimize", "terms": base_component["objective_terms"]},
        "constraints": [],
        "advanced": {"component_spec": {}},
    }
    spec = build_component_spec_from_draft(draft)
    assert {item["name"] for item in spec["variables"]} >= {"x", "y"}
    assert spec["objective"]["terms"]

    remaining = deepcopy(draft)
    remaining["components"] = [draft["components"][1]]
    assert child_component["dependencies"][0] not in {item["type"] for item in remaining["components"]}
