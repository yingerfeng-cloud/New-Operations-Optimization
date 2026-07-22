from __future__ import annotations

from app.builders.generic_linear_builder import GenericLinearBuilder
from app.formulas.service import analyze_formula
from app.generic_formula_compiler import compile_generic_formula_spec
from app.schemas.formula import FormulaAnalyzeRequest
from app.solvers.highs_adapter import HiGHSAdapter
import pyomo.environ as pyo
import time


def _symbols() -> dict:
    return {
        "sets": {"unit": ["U1", "U2"], "time": [0, 1], "state_time": [0, 1, 2]},
        "parameters": [
            {"code": "a", "dimension": [], "default": 2, "unit": "1"},
            {"code": "b", "dimension": [], "default": 3, "unit": "1"},
            {"code": "delta_t", "dimension": [], "default": 1, "unit": "h", "positive": True},
            {"code": "eta", "dimension": [], "default": 0.9, "unit": "1", "positive": True},
            {"code": "load", "dimension": ["time"], "default": [10, 12], "unit": "MW"},
        ],
        "variables": [
            {"code": "power", "dimension": ["unit", "time"], "unit": "MW"},
            {"code": "charge", "dimension": ["time"], "unit": "MW"},
            {"code": "soc", "dimension": ["state_time"], "unit": "MWh"},
        ],
    }


def _analyze(formula: str, *, kind: str = "constraint", participation: str = "solve_active", scope: list[dict] | None = None, direction: str | None = None) -> dict:
    return analyze_formula(
        FormulaAnalyzeRequest(
            formula=formula,
            formula_type=kind,
            participation=participation,
            objective_direction=direction,
            scope=scope or [],
            symbols=_symbols(),
            model_context={"time_dimension": {"time_set": "time", "state_time_set": "state_time"}},
        ),
        compile_requested=True,
    )


def test_preserves_numeric_and_all_parameter_coefficient_factors() -> None:
    result = _analyze("2 * a * b * charge[t] >= load[t]", scope=[{"alias": "t", "set": "time"}])
    assert result["success"] is True
    term = result["compiled_fragment"]["constraints"][0]["terms"][0]
    assert term["coefficient"]["numeric"] == 2
    assert [item["parameter"] for item in term["coefficient"]["factors"]] == ["a", "b"]


def test_parameter_division_and_state_offset_compile_without_semantic_loss() -> None:
    result = _analyze(
        "soc[t+1] == soc[t] + eta * charge[t] * delta_t - charge[t] / eta * delta_t",
        scope=[{"alias": "t", "set": "time"}],
    )
    assert result["success"] is True, result["diagnostics"]
    row = result["compiled_fragment"]["constraints"][0]
    assert row["terms"][0]["key"][0] == {"type": "index_offset", "set": "time", "target_set": "state_time", "offset": 1}
    assert any(any(factor["parameter"] == "eta" and factor["power"] == -1 for factor in term["coefficient"]["factors"]) for term in row["terms"])


def test_chain_constraint_splits_with_traceability() -> None:
    result = _analyze("0 <= charge[t] <= load[t]", scope=[{"alias": "t", "set": "time"}])
    rows = result["compiled_fragment"]["constraints"]
    assert [row["split_sequence"] for row in rows] == [1, 2]
    assert [row["sense"] for row in rows] == ["<=", "<="]


def test_preview_only_is_analyzed_but_never_compiled() -> None:
    result = _analyze("max(charge[t], load[t])", kind="objective", participation="preview_only", scope=[{"alias": "t", "set": "time"}], direction="maximize")
    assert result["success"] is True
    assert result["expression_class"] == "piecewise_linear"
    assert result["compiled_fragment"] is None
    assert result["checks"]["compile"] == "not_applicable"


def test_variable_product_is_classified_and_blocked_with_mccormick_advice() -> None:
    result = _analyze("charge[t] * power[u,t] <= load[t]", scope=[{"alias": "u", "set": "unit"}, {"alias": "t", "set": "time"}])
    assert result["expression_class"] == "bilinear"
    assert result["compiled_fragment"] is None
    assert result["capability"]["recommended_transformation"]["type"] == "mccormick"


def test_dimension_error_contains_expected_actual_hint_and_character_span() -> None:
    result = _analyze("power[t] <= load[t]", scope=[{"alias": "t", "set": "time"}])
    diagnostic = next(item for item in result["diagnostics"] if item["code"] == "FORMULA_INDEX_ARITY_MISMATCH")
    assert diagnostic["expected"] == ["unit", "time"]
    assert diagnostic["actual"] == ["t"]
    assert diagnostic["end"] > diagnostic["start"]
    assert diagnostic["fixHint"]


def test_unit_mismatch_is_a_publish_blocking_semantic_error() -> None:
    result = _analyze("soc[t+1] == charge[t]", scope=[{"alias": "t", "set": "time"}])
    assert any(item["code"] == "FORMULA_UNIT_MISMATCH" and item["severity"] == "error" for item in result["diagnostics"])
    assert result["compiled_fragment"] is None


def test_objective_direction_is_explicit_and_maximize_is_preserved() -> None:
    missing = _analyze("sum(charge[t] for t in time)", kind="objective")
    assert any(item["code"] == "FORMULA_OBJECTIVE_DIRECTION_REQUIRED" for item in missing["diagnostics"])
    compiled = _analyze("sum(charge[t] for t in time)", kind="objective", direction="maximize")
    assert compiled["compiled_fragment"]["direction"] == "maximize"


def test_generic_compiler_excludes_preview_formulas_and_builder_uses_all_factors() -> None:
    semantic = {"parameters": _symbols()["parameters"]}
    spec = {
        "sense": "minimize",
        "sets": {"time": [0, 1]},
        "parameters": {"a": 2, "b": 3, "load": [10, 12]},
        "variables": [{"name": "charge", "indices": ["time"], "domain": "NonNegativeReals"}],
        "constraints": [
            {"name": "active", "formula": "a * b * charge[t] >= load[t]", "scope": [{"alias": "t", "set": "time"}], "solve_participation": "solve_active"},
            {"name": "display", "formula": "max(charge[t], load[t])", "scope": [{"alias": "t", "set": "time"}], "solve_participation": "preview_only"},
        ],
        "objective": {"sense": "minimize", "terms": [{"name": "cost", "formula": "sum(charge[t] for t in time)"}]},
    }
    compiled = compile_generic_formula_spec(spec, semantic)
    assert [row["name"] for row in compiled["constraints"]] == ["active"]
    assert compiled["preview_formulas"][0]["compile_status"] == "preview_only"
    model, _ = GenericLinearBuilder().build(compiled)
    assert model.con_active_0_0_1.active


def test_backend_recompiles_formula_definitions_instead_of_trusting_forged_frontend_terms() -> None:
    spec = {
        "sense": "minimize",
        "sets": {"time": [0, 1]},
        "parameters": {"a": 2, "b": 3, "load": [10, 12]},
        "variables": [{"name": "charge", "indices": ["time"], "domain": "NonNegativeReals"}],
        "constraints": [{"name": "forged", "terms": [{"var": "charge", "key": ["time"], "coef": 999}], "sense": ">=", "rhs": 0}],
        "objective": {"sense": "minimize", "terms": [{"var": "charge", "key": ["time"], "coef": 999}]},
        "formula_definitions": [
            {"formula_id": "safe_constraint", "name": "safe", "kind": "constraint", "dsl_formula": "a * b * charge[t] >= load[t]", "scope": [{"alias": "t", "set": "time"}]},
            {"formula_id": "safe_objective", "name": "cost", "kind": "objective", "dsl_formula": "sum(charge[t] for t in time)"},
        ],
    }
    semantic = {"parameters": _symbols()["parameters"]}
    compiled = compile_generic_formula_spec(spec, semantic)
    assert compiled["constraints"][0]["name"] == "safe"
    assert compiled["constraints"][0]["terms"][0]["coef"] == 1
    assert [item["parameter"] for item in compiled["constraints"][0]["terms"][0]["coefficient"]["factors"]] == ["a", "b"]
    assert compiled["objective"]["terms"][0]["coef"] == 1


def test_multiple_objectives_require_explicit_mode_and_weight() -> None:
    base = {
        "sense": "minimize",
        "sets": {"time": [0, 1]},
        "parameters": {},
        "variables": [{"name": "charge", "indices": ["time"], "domain": "NonNegativeReals"}],
        "constraints": [],
        "objective": {"sense": "minimize", "terms": []},
        "formula_definitions": [
            {"formula_id": "one", "name": "one", "kind": "objective", "dsl_formula": "sum(charge[t] for t in time)"},
            {"formula_id": "two", "name": "two", "kind": "objective", "dsl_formula": "2 * sum(charge[t] for t in time)"},
        ],
    }
    missing_mode = compile_generic_formula_spec(base, {})
    assert all(item["compile_status"] == "compile_failed" for item in missing_mode["objective"]["terms"])
    weighted = {**base, "objective_mode": "weighted_sum", "formula_definitions": [{**item, "weight": index + 1} for index, item in enumerate(base["formula_definitions"])]}
    compiled = compile_generic_formula_spec(weighted, {})
    assert all(item["compile_status"] == "compile_valid" for item in compiled["objective"]["terms"])


def test_state_equation_builds_one_constraint_per_transition_with_state_time_mapping() -> None:
    spec = {
        "sense": "minimize",
        "sets": {"time": [0, 1], "state_time": [0, 1, 2]},
        "parameters": {"eta": 0.9, "delta_t": 1},
        "variables": [
            {"name": "soc", "indices": ["state_time"], "domain": "NonNegativeReals"},
            {"name": "charge", "indices": ["time"], "domain": "NonNegativeReals"},
        ],
        "model_context": {"time_dimension": {"time_set": "time", "state_time_set": "state_time"}},
        "constraints": [{"name": "state", "formula": "soc[t+1] == soc[t] + eta * charge[t] * delta_t", "scope": [{"alias": "t", "set": "time"}]}],
        "objective": {"sense": "minimize", "terms": [{"name": "cost", "formula": "sum(charge[t] for t in time)"}]},
    }
    semantic = {
        "parameters": [
            {"code": "eta", "dimension": [], "default": 0.9, "positive": True},
            {"code": "delta_t", "dimension": [], "default": 1, "positive": True},
        ]
    }
    compiled = compile_generic_formula_spec(spec, semantic)
    model, _ = GenericLinearBuilder().build(compiled)
    constraints = list(model.component_objects(pyo.Constraint, active=True))
    assert len(constraints) == 2
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"


def test_maximize_formula_direction_reaches_real_highs_solve() -> None:
    spec = {
        "sense": "maximize",
        "sets": {"time": [0, 1]},
        "parameters": {"cap": 8},
        "variables": [{"name": "dispatch", "indices": ["time"], "domain": "NonNegativeReals", "ub": 10}],
        "formula_definitions": [
            {"formula_id": "cap", "name": "出力上限", "kind": "constraint", "dsl_formula": "dispatch[t] <= cap", "scope": [{"alias": "t", "set": "time"}]},
            {"formula_id": "maximize", "name": "最大出力", "kind": "objective", "dsl_formula": "sum(dispatch[t] for t in time)", "objective_direction": "maximize"},
        ],
        "objective": {"sense": "maximize", "terms": []},
    }
    compiled = compile_generic_formula_spec(spec, {"parameters": [{"code": "cap", "dimension": [], "default": 8}]})
    model, _ = GenericLinearBuilder().build(compiled)
    solved = HiGHSAdapter().solve(model, time_limit_seconds=10)
    assert solved.status == "optimal"
    assert solved.objective_value == 16


def test_formula_api_returns_versioned_ast_and_standard_diagnostics(client) -> None:
    response = client.post(
        "/api/formulas/analyze",
        json={
            "formula": "charge[t] <= load[t]",
            "formula_type": "constraint",
            "participation": "solve_active",
            "ast_version": "1.0",
            "scope": [{"alias": "t", "set": "time"}],
            "symbols": _symbols(),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ast_version"] == "1.0"
    assert body["compiler_version"] == "2.0.0"
    assert body["ast"]["type"] == "ComparisonExpression"
    assert body["checks"]["compile"] == "passed"


def test_unsafe_attribute_and_unknown_ast_version_are_rejected() -> None:
    unsafe = _analyze("charge.__class__ == 1")
    assert any(item["code"] == "FORMULA_UNSAFE_NODE" for item in unsafe["diagnostics"])
    version = analyze_formula(FormulaAnalyzeRequest(formula="1 <= 2", ast_version="9.9"), compile_requested=True)
    assert version["success"] is False
    assert version["diagnostics"][0]["code"] == "FORMULA_AST_VERSION_UNSUPPORTED"


def test_formula_security_limits_depth_aggregate_nesting_and_scope_count() -> None:
    deep = _analyze(f"{'-' * 270}charge[t] <= load[t]", scope=[{"alias": "t", "set": "time"}])
    assert any(item["code"] == "FORMULA_AST_DEPTH_EXCEEDED" for item in deep["diagnostics"])

    nested = "1"
    for index in range(5):
        nested = f"sum({nested} for i{index} in time)"
    aggregate = _analyze(nested, kind="objective", direction="minimize")
    assert any(item["code"] == "FORMULA_AGGREGATE_DEPTH_EXCEEDED" for item in aggregate["diagnostics"])


def test_formula_expansion_limit_blocks_structure_bomb() -> None:
    symbols = _symbols()
    symbols["sets"] = {"unit": list(range(1001)), "time": list(range(1001))}
    result = analyze_formula(
        FormulaAnalyzeRequest(
            formula="sum(power[u,t] for u in unit) >= load[t]",
            formula_type="constraint",
            scope=[{"alias": "t", "set": "time"}],
            symbols=symbols,
        ),
        compile_requested=True,
    )
    assert result["compiled_fragment"] is None
    assert result["estimated_expansion"]["term_count"] > 1_000_000
    assert any(item["code"] == "FORMULA_EXPANSION_LIMIT_EXCEEDED" for item in result["diagnostics"])


def test_formula_api_rejects_excessive_scope_rows(client) -> None:
    response = client.post(
        "/api/formulas/analyze",
        json={
            "formula": "1 <= 2",
            "scope": [{"alias": f"i{index}", "set": "time"} for index in range(17)],
            "symbols": _symbols(),
        },
    )
    assert response.status_code == 422


def test_disabled_and_legacy_formulas_are_migrated_without_entering_solver_structure() -> None:
    spec = {
        "sense": "minimize",
        "sets": {"time": [0, 1]},
        "parameters": {"load": [10, 12]},
        "variables": [{"name": "charge", "indices": ["time"], "domain": "NonNegativeReals"}],
        "formula_definitions": [
            {"formula_id": "disabled", "name": "停用约束", "kind": "constraint", "dsl_formula": "charge[t] >= load[t]", "solve_participation": "disabled"},
            {"formula_id": "legacy", "name": "旧目标", "kind": "objective", "formula": "sum(charge[t] for t in time)", "objective_direction": "minimize"},
        ],
        "objective": {"sense": "minimize", "terms": []},
    }
    compiled = compile_generic_formula_spec(spec, {"parameters": _symbols()["parameters"]})
    assert compiled["constraints"] == []
    assert compiled["disabled_formulas"][0]["formula_id"] == "disabled"
    assert compiled["objective"]["terms"][0]["migration_status"] == "migrated"
    assert compiled["objective"]["terms"][0]["compiler_version"] == "2.0.0"
    assert compiled["formula_compiler"] == "backend_authoritative_v2"


def test_authoritative_compiler_handles_1000_character_formula_and_200_symbols_promptly() -> None:
    variables = [{"code": f"v{index}", "dimension": ["time"], "unit": "MW"} for index in range(200)]
    expression = " + ".join(f"v{index}[t]" for index in range(120))
    formula = f"{expression} >= load[t]"
    assert len(formula) > 1000
    started = time.perf_counter()
    result = analyze_formula(
        FormulaAnalyzeRequest(
            formula=formula,
            formula_type="constraint",
            scope=[{"alias": "t", "set": "time"}],
            symbols={"sets": {"time": list(range(24))}, "parameters": [{"code": "load", "dimension": ["time"], "unit": "MW"}], "variables": variables},
        ),
        compile_requested=True,
    )
    duration = time.perf_counter() - started
    assert result["success"] is True, result["diagnostics"]
    assert duration < 1.0
