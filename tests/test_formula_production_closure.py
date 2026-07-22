from __future__ import annotations

import pytest

from app.builders.generic_linear_builder import GenericLinearBuilder
from app.formulas.service import analyze_formula
from app.schemas.formula import FormulaAnalyzeRequest, FormulaIndexScope
from app.solvers.highs_adapter import HiGHSAdapter


def symbols(*, denominator_contract: dict | None = None) -> dict:
    contract = {"positive": True} if denominator_contract is None else denominator_contract
    return {
        "sets": {
            "unit": {"values": ["U1"]},
            "time": {"values": [0, 1]},
            "state_time": {"values": [0, 1, 2]},
        },
        "parameters": [
            {"code": "a", "dimension": [], "default": 2, **contract},
            {"code": "b", "dimension": [], "default": 0.5, "positive": True},
            {"code": "eta_in", "dimension": [], "default": 0.5, "positive": True},
            {"code": "eta_out", "dimension": [], "default": 0.8, "positive": True},
            {"code": "delta_t", "dimension": [], "default": 1, "positive": True},
            {"code": "upper", "dimension": ["unit"], "default": [20]},
            {"code": "demand", "dimension": ["time"], "default": [3, 4]},
            {"code": "target", "dimension": ["time"], "default": [6, 8]},
            {"code": "input_fixed", "dimension": ["time"], "default": [2, 4]},
            {"code": "output_fixed", "dimension": ["time"], "default": [0, 0]},
            {"code": "initial", "dimension": [], "default": 10},
        ],
        "variables": [
            {"code": "power", "dimension": ["unit", "time"]},
            {"code": "state", "dimension": ["state_time"]},
            {"code": "input", "dimension": ["time"]},
            {"code": "output", "dimension": ["time"]},
        ],
    }


def analyze(formula: str, *, formula_id: str = "f", kind: str = "constraint", scope: list[tuple[str, str]] | None = None, symbol_table: dict | None = None) -> dict:
    return analyze_formula(
        FormulaAnalyzeRequest(
            formula=formula,
            formula_type=kind,
            participation="solve_active",
            formula_id=formula_id,
            objective_direction="minimize" if kind == "objective" else None,
            scope=[FormulaIndexScope(alias=alias, set=set_code) for alias, set_code in (scope or [])],
            symbols=symbol_table or symbols(),
            model_context={"time_dimension": {"time_set": "time", "state_time_set": "state_time"}},
        ),
        compile_requested=True,
        expand_requested=True,
    )


def test_offset_boundaries_are_proved_for_the_entire_scope() -> None:
    valid = analyze("state[t+1] == state[t]", scope=[("t", "time")])
    assert valid["status"] == "compile_valid"
    for formula in ("state[t+2] == state[t]", "state[t-1] == state[t]"):
        invalid = analyze(formula, scope=[("t", "time")])
        assert invalid["status"] == "compile_failed"
        diagnostic = next(item for item in invalid["diagnostics"] if item["code"] == "FORMULA_INDEX_OFFSET_OUT_OF_RANGE")
        assert diagnostic["actual"]["offset"] in {2, -1}
        assert "first_out_of_range" in diagnostic["actual"]


@pytest.mark.parametrize("operator", ["<", ">"])
def test_strict_inequality_is_rejected_by_authoritative_compiler(operator: str) -> None:
    result = analyze(f"power[u,t] {operator} upper[u]", scope=[("u", "unit"), ("t", "time")])
    assert result["status"] == "compile_failed"
    assert any(item["code"] == "FORMULA_STRICT_INEQUALITY_UNSUPPORTED" for item in result["diagnostics"])


def test_parameter_default_does_not_prove_denominator_safety() -> None:
    unproven = symbols(denominator_contract={})
    result = analyze("power[u,t] / a >= demand[t]", scope=[("u", "unit"), ("t", "time")], symbol_table=unproven)
    assert result["status"] == "compile_failed"
    assert any(item["code"] == "FORMULA_DENOMINATOR_NONZERO_UNCONFIRMED" and item["severity"] == "error" for item in result["diagnostics"])
    proven = analyze("power[u,t] / a >= demand[t]", scope=[("u", "unit"), ("t", "time")])
    assert proven["status"] == "compile_valid"


def test_builder_never_silently_drops_out_of_range_terms() -> None:
    spec = {
        "sets": {"time": [0, 1], "state_time": [0, 1, 2]},
        "parameters": {},
        "variables": [{"name": "state", "indices": ["state_time"], "domain": "NonNegativeReals"}],
        "constraints": [{
            "name": "bad_offset", "sense": "==", "scope": [{"alias": "t", "set": "time"}],
            "terms": [{"var": "state", "key": [{"type": "index_offset", "set": "time", "target_set": "state_time", "offset": 2}], "coef": 1}],
            "rhs": 0,
        }],
        "objective": {"sense": "minimize", "terms": [{"var": "state", "key": [0], "coef": 1}]},
        "sense": "minimize",
    }
    with pytest.raises(RuntimeError, match="FORMULA_INDEX_OFFSET_OUT_OF_RANGE"):
        GenericLinearBuilder().build(spec)


def test_authoritative_fragments_chain_division_coefficients_and_state_reach_highs_with_values() -> None:
    formulas = [
        ("chain", "0 <= power[u,t] <= upper[u]", [("u", "unit"), ("t", "time")]),
        ("division", "power[u,t] / a >= demand[t]", [("u", "unit"), ("t", "time")]),
        ("multi", "a * b * power[u,t] >= target[t]", [("u", "unit"), ("t", "time")]),
        ("state", "state[t+1] == state[t] + eta_in * input[t] * delta_t - output[t] / eta_out * delta_t", [("t", "time")]),
        ("input_fix", "input[t] == input_fixed[t]", [("t", "time")]),
        ("output_fix", "output[t] == output_fixed[t]", [("t", "time")]),
        ("initial_fix", "state[0] == initial", []),
    ]
    constraints: list[dict] = []
    artifacts: list[dict] = []
    for formula_id, expression, scope in formulas:
        result = analyze(expression, formula_id=formula_id, scope=scope)
        assert result["status"] == "compile_valid", result["diagnostics"]
        rows = result["compiled_fragment"]["constraints"]
        constraints.extend({**row, "name": f"{formula_id}_{index}", "compiler_version": result["compiler_version"], "compiled_fragment_version": "1.0"} for index, row in enumerate(rows, 1))
        artifacts.append({"formula_id": formula_id, "compiler_version": result["compiler_version"]})
    objective = analyze("sum(power[u,t] for u in unit for t in time)", formula_id="objective", kind="objective")
    assert objective["status"] == "compile_valid"
    spec = {
        "formula_ast_version": "1.0",
        "formula_compiler": "backend_authoritative_v2",
        "compiled_fragment_version": "1.0",
        "formula_artifacts": [*artifacts, {"formula_id": "objective", "compiler_version": objective["compiler_version"]}],
        "sets": {"unit": ["U1"], "time": [0, 1], "state_time": [0, 1, 2]},
        "parameters": {"a": 2, "b": 0.5, "eta_in": 0.5, "eta_out": 0.8, "delta_t": 1, "upper": [20], "demand": [3, 4], "target": [6, 8], "input_fixed": [2, 4], "output_fixed": [0, 0], "initial": 10},
        "variables": [
            {"name": "power", "indices": ["unit", "time"], "domain": "NonNegativeReals"},
            {"name": "state", "indices": ["state_time"], "domain": "NonNegativeReals"},
            {"name": "input", "indices": ["time"], "domain": "NonNegativeReals"},
            {"name": "output", "indices": ["time"], "domain": "NonNegativeReals"},
        ],
        "constraints": constraints,
        "objective": {"sense": "minimize", "terms": objective["compiled_fragment"]["terms"]},
        "sense": "minimize",
    }
    model, metadata = GenericLinearBuilder().build(spec)
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"
    assert solved.objective_value == pytest.approx(14)
    assert model.var_state_0.value == pytest.approx(10)
    assert model.var_state_1.value == pytest.approx(11)
    assert model.var_state_2.value == pytest.approx(13)
    chain_rows = [row for row in constraints if row["source_formula_id"] == "chain"]
    assert [row["split_sequence"] for row in chain_rows] == [1, 2]
    multi_term = next(row for row in constraints if row["source_formula_id"] == "multi")["terms"][0]
    assert [factor["parameter"] for factor in multi_term["coefficient"]["factors"]] == ["a", "b"]
    assert metadata["formula_trace"]


def test_runtime_zero_denominator_is_blocked_before_solver() -> None:
    result = analyze("power[u,t] / a >= demand[t]", scope=[("u", "unit"), ("t", "time")])
    row = {**result["compiled_fragment"]["constraints"][0], "name": "division"}
    spec = {
        "sets": {"unit": ["U1"], "time": [0, 1]},
        "parameters": {"a": 0, "demand": [3, 4]},
        "variables": [{"name": "power", "indices": ["unit", "time"], "domain": "NonNegativeReals"}],
        "constraints": [row],
        "objective": {"sense": "minimize", "terms": [{"var": "power", "key": ["U1", 0], "coef": 1}]},
        "sense": "minimize",
    }
    with pytest.raises(RuntimeError, match="zero in denominator"):
        GenericLinearBuilder().build(spec)


def weighted_spec(*terms: dict, sense: str = "minimize") -> dict:
    return {
        "formula_ast_version": "1.0",
        "formula_compiler": "backend_authoritative_v2",
        "compiled_fragment_version": "1.0",
        "objective_mode": "weighted_sum",
        "global_direction": sense,
        "formula_artifacts": [
            {"formula_id": str(term["source_formula_id"]), "compiler_version": "2.0.0"}
            for term in terms
        ],
        "sets": {},
        "parameters": {},
        "variables": [{"name": "dispatch", "indices": [], "domain": "NonNegativeReals", "ub": 10}],
        "constraints": [],
        "objective": {"mode": "weighted_sum", "sense": sense, "global_direction": sense, "terms": list(terms)},
        "sense": sense,
    }


def objective_term(formula_id: str, *, original: str, global_direction: str, weight: float) -> dict:
    sign = 1 if original == global_direction else -1
    return {
        "var": "dispatch",
        "key": [],
        "coef": 1,
        "coefficient": {"numeric": 1, "factors": []},
        "source_formula_id": formula_id,
        "formula_id": formula_id,
        "objective_weight": weight,
        "weight": weight * sign,
        "original_direction": original,
        "global_direction": global_direction,
        "effective_sign": sign,
    }


def test_weighted_sum_mixed_directions_reaches_real_highs_with_normalized_signs() -> None:
    spec = weighted_spec(
        objective_term("cost", original="minimize", global_direction="minimize", weight=2),
        objective_term("revenue", original="maximize", global_direction="minimize", weight=3),
    )
    model, _ = GenericLinearBuilder().build(spec)
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"
    assert solved.objective_value == pytest.approx(-10)
    assert model.var_dispatch.value == pytest.approx(10)


def test_weighted_sum_same_direction_preserves_positive_weights() -> None:
    spec = weighted_spec(
        objective_term("cost_one", original="minimize", global_direction="minimize", weight=1),
        objective_term("cost_two", original="minimize", global_direction="minimize", weight=2),
    )
    model, _ = GenericLinearBuilder().build(spec)
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"
    assert solved.objective_value == pytest.approx(0)


def test_weighted_sum_maximize_and_zero_weight_are_supported() -> None:
    spec = weighted_spec(
        objective_term("benefit", original="maximize", global_direction="maximize", weight=1),
        objective_term("ignored_cost", original="minimize", global_direction="maximize", weight=0),
        sense="maximize",
    )
    model, _ = GenericLinearBuilder().build(spec)
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"
    assert solved.objective_value == pytest.approx(10)


@pytest.mark.parametrize("invalid_weight", [None, float("nan"), float("inf")])
def test_weighted_sum_rejects_missing_or_nonfinite_weight(invalid_weight: float | None) -> None:
    term = objective_term("bad", original="minimize", global_direction="minimize", weight=1)
    term["objective_weight"] = invalid_weight
    term["weight"] = invalid_weight
    with pytest.raises(RuntimeError, match="FORMULA_OBJECTIVE_WEIGHT_INVALID"):
        GenericLinearBuilder().build(weighted_spec(term))


def test_single_mode_rejects_multiple_objective_sources() -> None:
    first = objective_term("one", original="minimize", global_direction="minimize", weight=1)
    second = objective_term("two", original="minimize", global_direction="minimize", weight=1)
    spec = weighted_spec(first, second)
    spec["objective_mode"] = "single"
    spec["objective"]["mode"] = "single"
    with pytest.raises(RuntimeError, match="FORMULA_SINGLE_OBJECTIVE_COUNT_INVALID"):
        GenericLinearBuilder().build(spec)
