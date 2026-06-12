from __future__ import annotations

from copy import deepcopy
import uuid
from app.model_draft import (
    build_component_spec_from_draft,
    finalize_model_draft,
    generate_objective_strategy,
    merge_component_required_sets,
)
from app.semantic.semantic_validator import RuntimeParameterValidator
from app.templates.power_templates import get_template
from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_model_mode_removed_from_required_basic_info() -> None:
    template = get_template("cascade_hydro_dispatch")
    draft = deepcopy(template["model_draft"])
    finalize_model_draft(draft)

    assert "problem_type" not in draft["basic_info"]
    assert "time_granularity" not in draft["basic_info"]


def test_component_required_sets_merged_into_model_draft() -> None:
    draft = {
        "basic_info": {"solver": "HiGHS"},
        "semantic": {"sets": []},
        "components": [
            {
                "type": "storage_soc_balance",
                "definition": {
                    "component_id": "storage_soc_balance",
                    "required_sets": [
                        {"code": "time", "type": "time_period", "required": True},
                        {"code": "time_volume", "type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1", "required": True},
                    ],
                },
            }
        ],
        "objective": {"terms": []},
    }

    finalize_model_draft(draft)

    sets = {item["code"]: item for item in draft["semantic"]["sets"]}
    assert sets["time"]["type"] == "time_period"
    assert sets["time_volume"]["base_set"] == "time"
    assert sets["time"]["configured"] is False


def test_required_sets_merge_by_same_code_type_and_required_by() -> None:
    draft = {
        "semantic": {"sets": []},
        "components": [
            {"type": "day_ahead", "definition": {"required_sets": [{"code": "time", "type": "time_period"}]}},
            {"type": "reserve", "definition": {"required_sets": [{"code": "time", "type": "time_period"}]}},
            {"type": "rolling", "definition": {"required_sets": [{"code": "rolling_time", "type": "time_period"}]}},
        ],
    }

    sets = {item["code"]: item for item in merge_component_required_sets(draft)}

    assert set(sets) == {"time", "rolling_time"}
    assert sets["time"]["required_by"] == ["day_ahead", "reserve"]
    assert sets["rolling_time"]["required_by"] == ["rolling"]


def test_required_sets_same_code_different_type_reports_conflict() -> None:
    draft = {
        "semantic": {"sets": []},
        "components": [
            {"type": "a", "definition": {"required_sets": [{"code": "time", "type": "time_period"}]}},
            {"type": "b", "definition": {"required_sets": [{"code": "time", "type": "state_time", "base_set": "time"}]}},
        ],
    }

    sets = {item["code"]: item for item in merge_component_required_sets(draft)}

    assert sets["time"]["type"] == "time_period"
    assert sets["time"]["conflicts"]
    assert sets["time"]["required_by"] == ["a", "b"]


def test_required_sets_remove_component_drops_only_its_required_by_ref() -> None:
    draft = {
        "semantic": {
            "sets": [
                {
                    "code": "time",
                    "type": "time_period",
                    "source": "component_required_set:a",
                    "source_component": "a",
                    "required_by": ["a", "b"],
                }
            ]
        },
        "components": [
            {"type": "b", "definition": {"required_sets": [{"code": "time", "type": "time_period"}]}},
        ],
    }

    sets = {item["code"]: item for item in merge_component_required_sets(draft)}

    assert sets["time"]["required_by"] == ["b"]
    assert sets["time"]["source_component"] == "b"


def test_time_period_generates_members_and_delta_t_and_state_time() -> None:
    draft = {
        "semantic": {
            "sets": [
                {"code": "time", "type": "time_period", "horizon": 24, "time_granularity": 60, "time_unit": "minute"},
                {"code": "time_volume", "type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1"},
            ]
        },
        "components": [],
        "objective": {"terms": []},
        "runtime_parameters": {},
    }

    finalize_model_draft(draft)
    sets = {item["code"]: item for item in draft["semantic"]["sets"]}

    assert sets["time"]["members"] == list(range(24))
    assert sets["time"]["delta_t"] == 1.0
    assert sets["time_volume"]["members"] == list(range(25))
    assert draft["runtime_parameters"]["delta_t"] == 1.0


def test_objective_strategy_generated_from_solve_active_terms() -> None:
    strategy = generate_objective_strategy(
        {
            "sense": "minimize",
            "terms": [
                {"term_id": "a", "name": "负荷偏差惩罚", "weight": 100, "solve_participation": "solve_active"},
                {"term_id": "b", "name": "展示项", "solve_participation": "display_only"},
            ],
        }
    )

    assert strategy["status"] == "generated"
    assert "负荷偏差惩罚" in strategy["summary"]
    assert all(item["term_id"] != "b" for item in strategy["active_terms"])


def test_problem_type_inferred_after_binary_component_add() -> None:
    draft = {
        "basic_info": {"solver": "HiGHS"},
        "semantic": {"sets": []},
        "components": [
            {
                "type": "binary_component",
                "definition": {
                    "component_id": "binary_component",
                    "variables": [{"code": "is_on", "type": "binary", "dimension": ["time"]}],
                    "generated_constraints": [{"expression": "x[t] <= big_m * is_on[t]", "indices": ["time"]}],
                    "required_sets": [{"code": "time", "type": "time_period", "horizon": 2, "time_granularity": 60}],
                },
            }
        ],
        "objective": {"terms": [{"term_id": "x", "name": "成本", "expression": "x[t]"}]},
    }

    component_spec = build_component_spec_from_draft(draft)

    assert component_spec["model_problem_type"] == "MILP"
    assert component_spec["problem_type_diagnosis"]["inferred_problem_type"] == "MILP"


def test_runtime_parameter_length_validated_against_time_set() -> None:
    errors = RuntimeParameterValidator().validate(
        {
            "model_code": "runtime_shape_check",
            "build_mode": "component_based",
            "sets": [{"code": "time", "type": "time_period", "horizon": 3, "time_granularity": 60, "members": [0, 1, 2]}],
            "component_spec": {
                "parameters": [{"code": "load_forecast", "dimension": ["time"], "required": True, "validation": {"required": True}}],
            },
        },
        {"load_forecast": [1, 2]},
    )

    assert errors
    assert "load_forecast" in errors[0]["error"]


def test_non_time_model_response_does_not_default_time_granularity() -> None:
    payload = {
        "id": f"MODEL-NONTIME-{uuid.uuid4().hex[:8].upper()}",
        "name": "non-time-allocation",
        "scene": "资源分配",
        "semantic_spec": {
            "model_code": "non_time_allocation",
            "sets": [{"key": "resource", "name": "资源", "values": ["R1", "R2"]}],
            "parameters": [{"key": "cost", "math_param": "cost", "dimension": ["resource"], "default_value": {"R1": 1, "R2": 2}}],
            "variables": [{"key": "alloc", "math_var": "alloc", "dimension": ["resource"], "domain": "NonNegativeReals"}],
            "objectives": [{"code": "cost_min", "name": "成本最小", "sense": "minimize"}],
        },
        "generic_spec": {
            "sets": {"resource": ["R1", "R2"]},
            "parameters": {"cost": {"R1": 1, "R2": 2}},
            "variables": [{"name": "alloc", "indices": ["resource"], "domain": "NonNegativeReals", "lb": 0}],
            "constraints": [],
            "objective": {"terms": [{"var": "alloc", "key": ["resource"], "foreach": ["resource"], "coef_param": "cost", "param_key": ["resource"]}], "constant": 0},
        },
    }

    created = client.post("/api/models", json=payload)

    assert created.status_code == 200, created.text
    assert created.json().get("time_granularity") is None


def test_top_level_objective_not_default_total_cost_min_when_strategy_generated() -> None:
    payload = {
        "id": f"MODEL-OBJSTR-{uuid.uuid4().hex[:8].upper()}",
        "name": "objective-strategy-model",
        "scene": "组件模型",
        "build_mode": "component_based",
        "model_draft": {
            "basic_info": {"name": "objective-strategy-model", "model_code": "objective_strategy_model", "builder_mode": "component_based"},
            "semantic": {"sets": [{"code": "resource", "type": "normal", "members": ["R1"]}], "variables": [{"code": "x", "dimension": ["resource"]}]},
            "components": [{"type": "dummy", "definition": {"component_id": "dummy", "variables": [{"code": "x", "dimension": ["resource"]}]}}],
            "objective": {"sense": "minimize", "terms": [{"term_id": "penalty", "name": "偏差惩罚", "weight_key": "load_deviation", "expression": "x[R1]", "solve_participation": "solve_active", "supported_by_backend": True}]},
        },
        "parameters": {},
    }

    created = client.post("/api/models", json=payload)

    assert created.status_code == 200, created.text
    assert created.json().get("objective") != "total_cost_min"
    assert "偏差惩罚" in created.json().get("objective", "")
