from __future__ import annotations

import json
from pathlib import Path

import pyomo.environ as pyo
import pytest

from app.builders.component_model_builder import ComponentModelBuilder
from app.formulas.service import analyze_formula
from app.model_components.formula_components import normalize_component_payload, validate_component_definition
from app.model_components.formula_contracts import normalize_participation, participates_in_solve, participation_fields
from app.schemas.formula import FormulaAnalyzeRequest
from app.solvers.highs_adapter import HiGHSAdapter
from app.problem_type_diagnosis import component_problem_type_fields
from scripts.audit_component_formulas import audit_components


@pytest.mark.parametrize(
    ("raw", "canonical", "enters_solve", "enabled"),
    [
        ("solve_active", "solve_active", True, True),
        ("preview_only", "preview_only", False, True),
        ("disabled", "disabled", False, False),
        ("display_only", "preview_only", False, True),
        ("remark_only", "preview_only", False, True),
        ("none", "disabled", False, False),
    ],
)
def test_participation_contract(raw: str, canonical: str, enters_solve: bool, enabled: bool) -> None:
    fields = participation_fields(raw)
    assert normalize_participation(raw) == canonical
    assert fields == {
        "solve_participation": canonical,
        "participates_in_solve": enters_solve,
        "enabled": enabled,
    }
    assert participates_in_solve(fields) is enters_solve


@pytest.mark.parametrize("source_field", ["dsl_formula", "formula", "expression"])
def test_component_normalization_reads_and_synchronizes_all_formula_fields(source_field: str) -> None:
    component = {
        "component_id": f"field_{source_field}",
        "variables": [{"code": "x", "dimension": []}],
        "constraints": [{"constraint_id": "c", source_field: "x >= 5", "solve_participation": "solve_active"}],
    }
    row = normalize_component_payload(component)["generated_constraints"][0]
    assert row["dsl_formula"] == "x >= 5"
    assert row["formula"] == "x >= 5"
    assert row["expression"] == "x >= 5"


def _scalar_model(constraints: list[dict], terms: list[dict]) -> tuple[object, object]:
    spec = {
        "model_code": "formula_participation_contract",
        "required_solver_capabilities": ["LP"],
        "sets": [],
        "parameters": [],
        "variables": [{"code": "x", "indices": [], "domain": "Reals"}],
        "components": [
            {
                "type": "contract_component",
                "definition": {
                    "component_id": "contract_component",
                    "variables": [{"code": "x", "dimension": []}],
                    "constraints": constraints,
                },
            }
        ],
        "objective": {"sense": "minimize", "terms": terms},
    }
    model, _ = ComponentModelBuilder().build(spec, {"solver": "highs"})
    result = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert result.status == "optimal"
    return model, result


def test_preview_and_disabled_constraints_do_not_enter_real_highs_solve() -> None:
    model, _ = _scalar_model(
        [
            {"constraint_id": "active", "dsl_formula": "x >= 5", "solve_participation": "solve_active"},
            {"constraint_id": "preview", "dsl_formula": "x >= 20", "solve_participation": "preview_only"},
            {"constraint_id": "disabled", "dsl_formula": "x >= 30", "solve_participation": "disabled"},
        ],
        [{"term_id": "min_x", "dsl_formula": "x", "weight_key": "custom_x", "supported_by_backend": True, "solve_participation": "solve_active"}],
    )
    assert pyo.value(model.x) == pytest.approx(5.0)
    assert sum(len(item) for item in model.component_objects(pyo.Constraint, active=True)) == 1


def test_preview_and_disabled_objectives_do_not_enter_real_highs_solve() -> None:
    model, _ = _scalar_model(
        [
            {"constraint_id": "lower", "dsl_formula": "x >= 0", "solve_participation": "solve_active"},
            {"constraint_id": "upper", "dsl_formula": "x <= 100", "solve_participation": "solve_active"},
        ],
        [
            {"term_id": "active", "dsl_formula": "x", "weight_key": "active_custom", "supported_by_backend": True, "solve_participation": "solve_active"},
            {"term_id": "preview", "dsl_formula": "-2*x", "weight_key": "preview_custom", "supported_by_backend": True, "solve_participation": "preview_only"},
            {"term_id": "disabled", "dsl_formula": "-3*x", "weight_key": "disabled_custom", "supported_by_backend": True, "solve_participation": "disabled"},
        ],
    )
    assert pyo.value(model.x) == pytest.approx(0.0)
    assert pyo.value(model.objective) == pytest.approx(0.0)


def test_component_parameter_binding_maps_model_parameter_during_solve() -> None:
    definition = {
        "component_id": "mapped_limit_component",
        "parameters": [{"code": "component_limit", "required": True}],
        "variables": [{"code": "x", "dimension": []}],
        "constraints": [
            {"constraint_id": "lower", "dsl_formula": "x >= 0", "solve_participation": "solve_active"},
            {"constraint_id": "upper", "dsl_formula": "x <= component_limit", "solve_participation": "solve_active"},
        ],
    }
    spec = {
        "model_code": "parameter_binding_contract",
        "required_solver_capabilities": ["LP"],
        "sets": [],
        "parameters": [{"code": "plant_limit", "required": True}],
        "variables": [{"code": "x", "indices": [], "domain": "Reals"}],
        "components": [{
            "type": "mapped_limit_component",
            "definition": definition,
            "parameter_bindings": [{
                "component_parameter": "component_limit",
                "model_parameter": "plant_limit",
                "required": True,
                "status": "bound",
            }],
        }],
        "objective": {
            "sense": "maximize",
            "terms": [{
                "term_id": "max_x",
                "dsl_formula": "x",
                "weight_key": "custom_x",
                "supported_by_backend": True,
                "solve_participation": "solve_active",
            }],
        },
    }

    model, _ = ComponentModelBuilder().build(spec, {"solver": "highs", "plant_limit": 7})
    result = HiGHSAdapter().solve(model, time_limit_seconds=10)

    assert result.status == "optimal"
    assert pyo.value(model.x) == pytest.approx(7.0)


def test_non_solve_formulas_do_not_change_component_problem_type() -> None:
    fields = component_problem_type_fields(
        {
            "variables": [{"code": "x", "type": "continuous"}],
            "constraints": [
                {"dsl_formula": "x >= 0", "solve_participation": "solve_active"},
                {"dsl_formula": "exp(x) <= 10", "solve_participation": "preview_only"},
            ],
            "objective_terms": [{"dsl_formula": "sqrt(x)", "solve_participation": "disabled"}],
        }
    )
    assert fields["problem_type"] == "LP"
    assert fields["expression_class"] == "linear"


def _state_compile_request(formula: str, boundary_strategy: str) -> FormulaAnalyzeRequest:
    return FormulaAnalyzeRequest(
        formula=formula,
        formula_type="constraint",
        participation="solve_active",
        formula_id="state_transition",
        scope=[{"alias": "t", "set": "time"}],
        symbols={
            "sets": {"time": {"values": [0, 1]}, "state_time": {"values": [0, 1, 2]}},
            "parameters": [],
            "variables": [{"code": "state", "dimension": ["state_time"]}],
        },
        model_context={
            "time_dimension": {"time_set": "time", "state_time_set": "state_time"},
            "boundary_strategy": boundary_strategy,
        },
    )


def test_authoritative_state_offsets_record_boundary_artifact() -> None:
    forward = analyze_formula(_state_compile_request("state[t+1] == state[t]", "strict"), compile_requested=True, expand_requested=True)
    backward = analyze_formula(_state_compile_request("state[t] == state[t-1]", "skip_first"), compile_requested=True, expand_requested=True)
    assert forward["status"] == "compile_valid"
    assert backward["status"] == "compile_valid"
    forward_artifact = forward["compiled_fragment"]
    backward_artifact = backward["compiled_fragment"]
    assert forward_artifact["source_set"] == "time"
    assert forward_artifact["target_set"] == "state_time"
    assert forward_artifact["offset"] == 1
    assert forward_artifact["effective_scope"] == [0, 1]
    assert forward_artifact["excluded_boundary_count"] == 0
    assert backward_artifact["boundary_strategy"] == "skip_first"
    assert backward_artifact["offset"] == -1
    assert backward_artifact["effective_scope"] == [1]
    assert backward_artifact["excluded_boundary_count"] == 1


def test_authoritative_strict_boundary_rejects_out_of_range_offset() -> None:
    result = analyze_formula(_state_compile_request("state[t] == state[t-1]", "strict"), compile_requested=True, expand_requested=True)
    assert result["status"] == "compile_failed"
    assert any(item["code"] == "FORMULA_INDEX_OFFSET_OUT_OF_RANGE" for item in result["diagnostics"])


def test_generic_state_transition_builds_and_solves_with_highs() -> None:
    component = {
        "component_id": "generic_state_contract",
        "sets": [{"code": "time"}, {"code": "state_time"}],
        "parameters": [
            {"code": "input", "dimension": ["time"]},
            {"code": "output", "dimension": ["time"]},
            {"code": "initial_state", "dimension": []},
        ],
        "variables": [{"code": "state", "dimension": ["state_time"]}],
        "constraints": [
            {"constraint_id": "initial", "dsl_formula": "state[0] == initial_state", "solve_participation": "solve_active"},
            {"constraint_id": "transition", "indices": [{"set": "time", "alias": "t"}], "dsl_formula": "state[t+1] == state[t] + input[t] - output[t]", "boundary_strategy": "strict", "solve_participation": "solve_active"},
        ],
    }
    spec = {
        "model_code": "state_contract",
        "required_solver_capabilities": ["LP"],
        "sets": [{"code": "time", "values": [0, 1]}, {"code": "state_time", "values": [0, 1, 2]}],
        "parameters": component["parameters"],
        "variables": [{"code": "state", "indices": ["state_time"], "domain": "Reals"}],
        "components": [{"type": "generic_state_contract", "definition": component}],
        "objective": {"sense": "minimize", "terms": [{"term_id": "terminal", "dsl_formula": "state[2]", "weight_key": "terminal_custom", "supported_by_backend": True, "solve_participation": "solve_active"}]},
    }
    model, _ = ComponentModelBuilder().build(
        spec,
        {"solver": "highs", "time": [0, 1], "state_time": [0, 1, 2], "input": [2, 3], "output": [1, 1], "initial_state": 1},
    )
    result = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert result.status == "optimal"
    assert [pyo.value(model.state[t]) for t in [0, 1, 2]] == pytest.approx([1, 2, 4])


def test_compile_fixture_aligns_scalar_index_parameter_to_target_dimension() -> None:
    result = validate_component_definition(
        {
            "component_id": "generic_terminal_state",
            "sets": [{"code": "state_time"}],
            "parameters": [
                {"code": "terminal_index", "dimension": [], "default": 24},
                {"code": "terminal_target", "dimension": [], "default": 0},
            ],
            "variables": [{"code": "state", "dimension": ["state_time"]}],
            "constraints": [
                {
                    "constraint_id": "terminal",
                    "dsl_formula": "state[terminal_index] == terminal_target",
                    "solve_participation": "solve_active",
                }
            ],
        }
    )
    assert result["valid"] is True


def test_fixed_component_audit_is_reproducible_and_clean() -> None:
    report = audit_components()
    baseline = json.loads((Path(__file__).resolve().parents[1] / "reports/component_formula_audit.json").read_text())
    assert report == baseline
    assert "compute_power_coordination_core" in report["component_ids"]
    assert set(report["component_ids"]) == {
        'audit_backward_transition',
        'audit_disabled',
        'audit_dsl_formula',
        'audit_historical_expression',
        'audit_historical_formula',
        'audit_multiple_constraints',
        'audit_multiple_objectives',
        'audit_objective',
        'audit_preview_only',
        'audit_state_transition',
        'balance_equation_component',
        'capacity_bounds_component',
        'compute_power_coordination_core',
        'function_mapping_2d_component',
        'function_mapping_component',
        'hydro_cascade_inflow_delay',
        'hydro_ecological_flow',
        'hydro_generation_flow_bounds',
        'hydro_head_calculation',
        'hydro_initial_volume',
        'hydro_load_tracking',
        'hydro_outflow_balance',
        'hydro_outflow_bounds',
        'hydro_power_flow_conversion',
        'hydro_ramp_smoothing',
        'hydro_reservoir_balance',
        'hydro_spill_bounds',
        'hydro_station_available_capacity',
        'hydro_terminal_volume',
        'hydro_volume_bounds',
        'mccormick_bilinear_relaxation_component',
        'network_delay_flow_component',
        'piecewise_linear_curve',
        'ramp_smoothing_component',
        'schedule_tracking_component',
        'state_balance_component',
        'terminal_state_tracking_component',
    }
    assert all(row["compile_success"] for row in report["details"])
    compute_rows = [row for row in report["details"] if row["component_id"] == "compute_power_coordination_core"]
    assert len(compute_rows) == 10
    assert all(row["compile_status"] == "programmatic" for row in compute_rows)
    assert report["component_count"] == 37
    assert report["builtin_component_count"] == 27
    assert report["fixture_component_count"] == 10
    assert report["constraint_count"] == 51
    assert report["objective_count"] == 10
    assert report["empty_formula_count"] == 0
    assert report["compile_failure_count"] == 0
    assert report["participation_mismatch_count"] == 0
