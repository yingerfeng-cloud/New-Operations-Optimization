from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.model_components.formula_components import validate_component_definition
from app.problem_type_diagnosis import (
    infer_problem_type,
    infer_problem_type_from_component_spec,
    infer_problem_type_from_draft,
    normalize_problem_type,
    validate_problem_type_override,
)


client = TestClient(app)


def test_mip_normalizes_to_milp() -> None:
    assert normalize_problem_type("MIP") == "MILP"


def test_linear_continuous_infers_lp() -> None:
    diagnosis = infer_problem_type(
        variables=[{"name": "x", "domain": "NonNegativeReals"}],
        constraints=[{"expression": "x[t] <= limit[t]"}],
        objective_terms=[{"expression": "sum(x[t] for t in time)"}],
        solver_name="HiGHS",
    )
    assert diagnosis["inferred_problem_type"] == "LP"
    assert diagnosis["publish_valid"] is True


def test_binary_linear_infers_milp_and_rejects_lp_override() -> None:
    diagnosis = infer_problem_type(
        variables=[{"name": "commit", "domain": "Binary"}],
        constraints=[{"expression": "commit[t] <= 1"}],
        objective_terms=[{"expression": "sum(commit[t] for t in time)"}],
        solver_name="HiGHS",
        requested_problem_type="LP",
    )
    errors, warnings = validate_problem_type_override(diagnosis)
    assert diagnosis["inferred_problem_type"] == "MILP"
    assert errors
    assert not warnings


def test_lp_model_may_be_overridden_to_milp_with_warning() -> None:
    diagnosis = infer_problem_type(
        variables=[{"name": "x", "domain": "Reals"}],
        constraints=[{"expression": "x[t] <= limit[t]"}],
        objective_terms=[{"expression": "sum(x[t] for t in time)"}],
        solver_name="HiGHS",
        requested_problem_type="MILP",
    )
    errors, warnings = validate_problem_type_override(diagnosis)
    assert diagnosis["inferred_problem_type"] == "LP"
    assert not errors
    assert warnings


def test_quadratic_and_nonlinear_rules() -> None:
    qp = infer_problem_type(
        variables=[{"name": "x", "domain": "Reals"}],
        constraints=[],
        objective_terms=[{"expression": "x[t] ** 2"}],
        solver_name="HiGHS",
    )
    minlp = infer_problem_type(
        variables=[{"name": "y", "domain": "Binary"}],
        constraints=[{"expression": "sin(y[t]) <= 1"}],
        objective_terms=[],
        solver_name="HiGHS",
    )
    assert qp["inferred_problem_type"] == "QP"
    assert minlp["inferred_problem_type"] == "MINLP_RESERVED"
    assert minlp["solver_supported"] is False


def test_parameter_variable_products_remain_linear() -> None:
    diagnosis = infer_problem_type(
        variables=[
            {"name": "storage_power_capacity", "domain": "NonNegativeReals"},
            {"name": "p_grid", "domain": "NonNegativeReals"},
            {"name": "p_pv_curtail", "domain": "NonNegativeReals"},
        ],
        constraints=[],
        objective_terms=[
            {"expression": "capex_power * storage_power_capacity"},
            {"expression": "price[t] * p_grid[t]"},
            {"expression": "curtailment_penalty * p_pv_curtail[t]"},
        ],
        solver_name="HiGHS",
        requested_problem_type="LP",
    )

    assert diagnosis["expression_class"] == "linear"
    assert diagnosis["inferred_problem_type"] == "LP"
    assert diagnosis["publish_valid"] is True


def _binary_component(component_id: str) -> dict:
    return {
        "component_id": component_id,
        "name": "Binary charge component",
        "domain": "通用",
        "category": "基础组件",
        "version": "1.0.0",
        "status": "published",
        "implemented": True,
        "enabled": True,
        "sets": [{"code": "time"}],
        "parameters": [{"code": "limit", "dimension": ["time"], "default": [10, 10, 10]}],
        "variables": [{"code": "is_charging", "name": "充电状态", "dimension": ["time"], "type": "binary"}],
        "constraints": [
            {
                "constraint_id": "charging_limit",
                "name": "充电状态上限",
                "indices": [{"set": "time", "alias": "t"}],
                "expression": "is_charging[t] <= limit[t]",
                "business_meaning": "限制充电状态。",
            }
        ],
        "objective_terms": [],
    }


def test_problem_type_infers_milp_from_library_component_binary_variable() -> None:
    component_id = f"binary_component_{uuid.uuid4().hex[:8]}"
    assert client.post("/api/components/catalog", json=_binary_component(component_id)).status_code == 200
    draft = {
        "basic_info": {"problem_type": "MILP", "solver": "HiGHS"},
        "semantic": {"variables": []},
        "components": [{"type": component_id}],
        "objective": {"terms": []},
    }

    diagnosis = infer_problem_type_from_draft(draft, "HiGHS")

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["integer_variable_details"][0]["variable_name"] == "is_charging"


def test_problem_type_diagnosis_resolves_component_definition_from_registry() -> None:
    component_id = f"binary_registry_{uuid.uuid4().hex[:8]}"
    assert client.post("/api/components/catalog", json=_binary_component(component_id)).status_code == 200

    diagnosis = infer_problem_type_from_component_spec(
        {"components": [{"type": component_id}], "model_problem_type": "MILP"},
        solver_name="HiGHS",
    )

    assert diagnosis["inferred_problem_type"] == "MILP"
    assert diagnosis["integer_variable_details"][0]["component_id"] == component_id


def test_problem_type_diagnosis_reason_mentions_component_binary_variable() -> None:
    component_id = f"binary_reason_{uuid.uuid4().hex[:8]}"
    assert client.post("/api/components/catalog", json=_binary_component(component_id)).status_code == 200

    diagnosis = infer_problem_type_from_draft(
        {"basic_info": {"problem_type": "MILP"}, "semantic": {"variables": []}, "components": [{"type": component_id}]},
        "HiGHS",
    )

    reason_text = " ".join(diagnosis["reasons"])
    assert "Binary charge component" in reason_text
    assert "is_charging" in reason_text
    assert "binary" in reason_text
    assert "MILP" in reason_text


def test_publish_rejects_lp_override_when_library_component_has_binary_variable() -> None:
    component_id = f"binary_publish_{uuid.uuid4().hex[:8]}"
    created_component = client.post("/api/components/catalog", json={**_binary_component(component_id), "status": "draft"})
    assert created_component.status_code == 200, created_component.text
    published_component = client.post(f"/api/components/{component_id}/publish")
    assert published_component.status_code == 200, published_component.text

    model_id = f"MODEL-BINARY-LP-{uuid.uuid4().hex[:8].upper()}"
    draft = {
        "basic_info": {"name": "binary lp", "model_code": model_id.lower(), "problem_type": "LP", "builder_mode": "component_based", "solver": "HiGHS"},
        "semantic": {"sets": [{"code": "time", "values": [0, 1, 2]}], "variables": []},
        "components": [{"type": component_id}],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": [{"term_id": "display", "weight_key": "display", "solve_participation": "display_only", "enabled": True}]},
        "advanced": {"component_spec": {"model_code": model_id.lower(), "build_mode": "component_based", "required_solver_capabilities": ["LP"]}},
    }
    created_model = client.post(
        "/api/models",
        json={
            "id": model_id,
            "name": "binary lp",
            "scene": "通用",
            "status": "developing",
            "build_mode": "component_based",
            "model_draft": draft,
            "parameters": {"horizon": 3, "time": [0, 1, 2], "limit": [10, 10, 10]},
        },
    )
    assert created_model.status_code == 200, created_model.text

    published = client.post(f"/api/models/{model_id}/publish")

    assert published.status_code == 422, published.text
    assert "当前模型包含二进制变量 is_charging，系统推荐 MILP，不能发布为 LP" in published.text


def test_indexed_parameter_default_list_compiles_as_pyomo_param() -> None:
    component = _binary_component(f"indexed_default_{uuid.uuid4().hex[:8]}")
    component["variables"] = [{"code": "x", "name": "x", "dimension": ["time"], "type": "continuous"}]
    component["constraints"][0]["expression"] = "x[t] <= limit[t]"

    result = validate_component_definition(component)

    assert result["valid"] is True, result
