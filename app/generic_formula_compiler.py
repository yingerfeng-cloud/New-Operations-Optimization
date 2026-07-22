from __future__ import annotations

import ast
from copy import deepcopy
from typing import Any

from app.formulas.service import analyze_formula
from app.schemas.formula import FormulaAnalyzeRequest


UNSUPPORTED_FORMULA_MESSAGE = "公式未通过后端权威编译，不能进入求解结构。"


class FormulaCompileError(RuntimeError):
    pass


def compile_generic_formula_spec(generic_spec: dict[str, Any], semantic_spec: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compile all solve-active DSL formulas through the authoritative backend.

    Existing already-structured rows remain compatible.  Preview-only formulas are
    intentionally moved to ``preview_formulas`` and never reach GenericLinearBuilder.
    """
    spec = deepcopy(generic_spec or {})
    if not spec:
        return spec
    symbols = _symbols(spec, semantic_spec or {})
    definitions = [item for item in (spec.get("formula_definitions") or []) if isinstance(item, dict)]
    if definitions:
        spec["constraints"] = [
            {
                **item,
                "formula_id": item.get("formula_id"),
                "name": item.get("name"),
                "dsl_formula": item.get("dsl_formula") or item.get("formula"),
                "display_formula": item.get("display_formula"),
                "solve_participation": item.get("solve_participation") or item.get("participation") or "solve_active",
                "scope": item.get("scope") or [],
                "foreach": item.get("foreach") or [],
            }
            for item in definitions
            if item.get("kind") == "constraint"
        ]
        objective_from_definitions = deepcopy(spec.get("objective") or {})
        objective_from_definitions["terms"] = [
            {
                **item,
                "formula_id": item.get("formula_id"),
                "term_id": item.get("formula_id"),
                "name": item.get("name"),
                "dsl_formula": item.get("dsl_formula") or item.get("formula"),
                "display_formula": item.get("display_formula"),
                "solve_participation": item.get("solve_participation") or item.get("participation") or "solve_active",
                "scope": item.get("scope") or [],
                "foreach": item.get("foreach") or [],
                "weight": item.get("weight", 1.0),
                "weight_explicit": "weight" in item,
                "priority": item.get("priority", 1),
            }
            for item in definitions
            if item.get("kind") == "objective"
        ]
        spec["objective"] = objective_from_definitions
    preview: list[dict[str, Any]] = list(spec.get("preview_formulas") or [])
    disabled: list[dict[str, Any]] = list(spec.get("disabled_formulas") or [])
    migration_report: list[dict[str, Any]] = []
    compiled_constraints: list[dict[str, Any]] = []
    for index, source in enumerate(spec.get("constraints") or []):
        row = deepcopy(source)
        participation = _participation(row)
        formula = _formula_text(row)
        if participation == "disabled":
            disabled.append({**row, "participation": "disabled", "compile_status": "disabled", "migration_status": row.get("migration_status") or "needs_review"})
            continue
        if participation == "preview_only":
            analyzed = _analyzed_preview(row, formula, "constraint", symbols)
            analyzed["migration_status"] = row.get("migration_status") or "preview_only"
            preview.append(analyzed)
            continue
        if not formula and row.get("terms") and ("rhs_param" in row or "rhs" in row or "rhs_terms" in row):
            row.setdefault("compile_status", "compile_valid")
            compiled_constraints.append(row)
            continue
        if not formula:
            compiled_constraints.append(row)
            continue
        scope = _scope(row, formula, symbols)
        result = analyze_formula(
            FormulaAnalyzeRequest(
                formula=formula,
                formula_type="constraint",
                participation="solve_active",
                formula_id=str(row.get("formula_id") or row.get("constraint_id") or row.get("name") or f"constraint_{index + 1}"),
                scope=scope,
                symbols=symbols,
                model_context=spec.get("model_context") or {},
            ),
            compile_requested=True,
        )
        fragment_rows = (result.get("compiled_fragment") or {}).get("constraints") or []
        if not fragment_rows:
            row.update({"compile_status": "compile_failed", "compile_error": _diagnostic_text(result), "diagnostics": result.get("diagnostics") or [], "expression_class": result.get("expression_class"), "ast_version": result.get("ast_version"), "compiler_version": result.get("compiler_version"), "migration_status": row.get("migration_status") or ("unsupported" if result.get("expression_class") == "unsupported" else "needs_review")})
            migration_report.append({"formula_id": row.get("formula_id"), "status": row["migration_status"], "diagnostics": row["diagnostics"]})
            compiled_constraints.append(row)
            continue
        for split, compiled in enumerate(fragment_rows, start=1):
            merged = {**row, **compiled}
            merged["name"] = str(row.get("name") or row.get("constraint_id") or f"formula_constraint_{index + 1}")
            if len(fragment_rows) > 1:
                merged["name"] = f"{merged['name']}__{split}"
            merged["diagnostics"] = result.get("diagnostics") or []
            merged["expression_class"] = result.get("expression_class")
            merged["ast_version"] = result.get("ast_version")
            merged["compiler_version"] = result.get("compiler_version")
            merged["migration_status"] = row.get("migration_status") or "migrated"
            migration_report.append({"formula_id": merged.get("formula_id"), "status": merged["migration_status"], "diagnostics": merged["diagnostics"]})
            _legacy_rhs_shortcut(merged)
            compiled_constraints.append(merged)
    spec["constraints"] = compiled_constraints

    objective = deepcopy(spec.get("objective") or {})
    direction = str(objective.get("sense") or spec.get("sense") or "").lower()
    if direction in {"min", "minimum"}:
        direction = "minimize"
    elif direction in {"max", "maximum"}:
        direction = "maximize"
    objective["sense"] = direction
    spec["sense"] = direction
    compiled_terms: list[dict[str, Any]] = []
    active_formula_count = 0
    for index, source in enumerate(objective.get("terms") or []):
        row = deepcopy(source)
        participation = _participation(row)
        formula = _formula_text(row)
        if participation == "disabled":
            disabled.append({**row, "participation": "disabled", "compile_status": "disabled", "migration_status": row.get("migration_status") or "needs_review"})
            continue
        if participation == "preview_only":
            analyzed = _analyzed_preview(row, formula, "objective", symbols, direction)
            analyzed["migration_status"] = row.get("migration_status") or "preview_only"
            preview.append(analyzed)
            continue
        active_formula_count += 1
        if not formula and row.get("var"):
            row.setdefault("compile_status", "compile_valid")
            compiled_terms.append(row)
            continue
        if not formula:
            compiled_terms.append(row)
            continue
        scope = _scope(row, formula, symbols)
        result = analyze_formula(
            FormulaAnalyzeRequest(
                formula=formula,
                formula_type="objective",
                participation="solve_active",
                formula_id=str(row.get("formula_id") or row.get("term_id") or row.get("name") or f"objective_{index + 1}"),
                objective_direction=direction if direction in {"minimize", "maximize"} else None,
                scope=scope,
                symbols=symbols,
                model_context=spec.get("model_context") or {},
            ),
            compile_requested=True,
        )
        fragment = result.get("compiled_fragment") or {}
        terms = fragment.get("terms") or []
        if not terms:
            row.update({"compile_status": "compile_failed", "compile_error": _diagnostic_text(result), "diagnostics": result.get("diagnostics") or [], "expression_class": result.get("expression_class"), "ast_version": result.get("ast_version"), "compiler_version": result.get("compiler_version"), "migration_status": row.get("migration_status") or ("unsupported" if result.get("expression_class") == "unsupported" else "needs_review")})
            migration_report.append({"formula_id": row.get("formula_id"), "status": row["migration_status"], "diagnostics": row["diagnostics"]})
            compiled_terms.append(row)
            continue
        for offset, term in enumerate(terms, start=1):
            merged = {
                **{key: deepcopy(value) for key, value in row.items() if key not in {"foreach", "key", "param_key", "coef", "coef_param", "coef_factors", "var"}},
                **term,
                "term_id": row.get("term_id") or row.get("formula_id") or f"formula_objective_{index + 1}_{offset}",
                "name": row.get("name") or row.get("term_id") or f"formula objective {index + 1}",
                "compile_status": "compile_valid",
                "diagnostics": result.get("diagnostics") or [],
                "expression_class": result.get("expression_class"),
                "ast_version": result.get("ast_version"),
                "compiler_version": result.get("compiler_version"),
                "migration_status": row.get("migration_status") or "migrated",
            }
            migration_report.append({"formula_id": merged.get("formula_id"), "status": merged["migration_status"], "diagnostics": merged["diagnostics"]})
            weight = float(row.get("weight", 1.0))
            merged["weight"] = weight
            merged["weight_explicit"] = bool(row.get("weight_explicit", "weight" in row))
            compiled_terms.append(merged)

    mode = str(objective.get("mode") or spec.get("objective_mode") or "").lower()
    if definitions and active_formula_count > 1 and mode not in {"single", "weighted_sum"}:
        for row in compiled_terms:
            row["compile_status"] = "compile_failed"
            row["compile_error"] = "存在多个 solve_active 目标时必须显式选择 single 或 weighted_sum。"
    if mode == "single" and active_formula_count > 1:
        for row in compiled_terms:
            row["compile_status"] = "compile_failed"
            row["compile_error"] = "single 模式只允许一个 solve_active 目标公式。"
    if mode == "weighted_sum":
        for row in compiled_terms:
            if not row.get("weight_explicit"):
                row["compile_status"] = "compile_failed"
                row["compile_error"] = "weighted_sum 模式要求每个目标显式配置权重。"
    objective["terms"] = compiled_terms
    spec["objective"] = objective
    if preview:
        spec["preview_formulas"] = preview
    if disabled:
        spec["disabled_formulas"] = disabled
    if migration_report:
        spec["formula_migration_report"] = migration_report
    spec["formula_ast_version"] = "1.0"
    spec["formula_compiler"] = "backend_authoritative_v2"
    return spec


def _symbols(spec: dict[str, Any], semantic: dict[str, Any]) -> dict[str, Any]:
    sets = {str(code): {"values": list(values) if isinstance(values, list) else list((values or {}).get("values") or [])} for code, values in (spec.get("sets") or {}).items()}
    variables = []
    for item in spec.get("variables") or []:
        variables.append({**item, "code": str(item.get("name") or item.get("code") or item.get("key")), "dimension": list(item.get("indices") or item.get("dimension") or [])})
    parameters: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in semantic.get("parameters") or []:
        code = str(item.get("math_param") or item.get("code") or item.get("key") or item.get("name") or "")
        if code:
            parameters.append({**item, "code": code})
            seen.add(code)
    for code, value in (spec.get("parameters") or {}).items():
        if str(code) not in seen:
            parameters.append({"code": str(code), "dimension": [], "default": value})
    return {"sets": sets, "parameters": parameters, "variables": variables}


def _scope(row: dict[str, Any], formula: str, symbols: dict[str, Any]) -> list[dict[str, str]]:
    explicit = row.get("scope")
    if isinstance(explicit, list) and explicit and isinstance(explicit[0], dict):
        used_aliases = _free_index_aliases(formula)
        retained = [{"alias": str(item.get("alias")), "set": str(item.get("set"))} for item in explicit if str(item.get("alias")) in used_aliases]
        if retained:
            return retained
    declared_sets = [str(item.get("set") if isinstance(item, dict) else item) for item in (row.get("foreach") or row.get("indices") or [])]
    variable_dims = {str(item.get("code")): list(item.get("dimension") or item.get("indices") or []) for item in symbols.get("variables") or []}
    parameter_dims = {str(item.get("code")): list(item.get("dimension") or item.get("indices") or []) for item in symbols.get("parameters") or []}
    inferred: dict[str, str] = {}
    aggregate_aliases: set[str] = set()
    try:
        tree = ast.parse(formula, mode="eval")
        aggregate_aliases = {
            node.target.id
            for node in ast.walk(tree)
            if isinstance(node, ast.comprehension) and isinstance(node.target, ast.Name)
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.Subscript):
                continue
            code = node.value.id if isinstance(node.value, ast.Name) else ""
            dimensions = variable_dims.get(code) or parameter_dims.get(code) or []
            indices = list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]
            for index, expected in zip(indices, dimensions):
                base = index.left if isinstance(index, ast.BinOp) else index
                if isinstance(base, ast.Name) and base.id not in aggregate_aliases:
                    inferred.setdefault(base.id, str(expected))
    except SyntaxError:
        pass
    return [{"alias": alias, "set": set_code} for alias, set_code in inferred.items()]


def _free_index_aliases(formula: str) -> set[str]:
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError:
        return set()
    aggregate_aliases = {
        node.target.id
        for node in ast.walk(tree)
        if isinstance(node, ast.comprehension) and isinstance(node.target, ast.Name)
    }
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Subscript):
            continue
        indices = list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]
        for index in indices:
            base = index.left if isinstance(index, ast.BinOp) else index
            if isinstance(base, ast.Name) and base.id not in aggregate_aliases:
                aliases.add(base.id)
    return aliases


def _analyzed_preview(row: dict[str, Any], formula: str, kind: str, symbols: dict[str, Any], direction: str = "") -> dict[str, Any]:
    if not formula:
        return {**row, "participation": "preview_only", "compile_status": "preview_only"}
    result = analyze_formula(
        FormulaAnalyzeRequest(
            formula=formula,
            formula_type=kind,
            participation="preview_only",
            objective_direction=direction if direction in {"minimize", "maximize"} else None,
            scope=_scope(row, formula, symbols),
            symbols=symbols,
        ),
        compile_requested=True,
    )
    return {**row, "participation": "preview_only", "compile_status": "preview_only", "analysis": result}


def _legacy_rhs_shortcut(row: dict[str, Any]) -> None:
    terms = row.get("rhs_terms") or []
    if len(terms) != 1:
        return
    term = terms[0]
    factors = term.get("factors") or []
    if term.get("numeric") == 1 and len(factors) == 1 and factors[0].get("power") == 1:
        row["rhs_param"] = factors[0]["parameter"]
        row["rhs_key"] = factors[0].get("indices") or []
        row.pop("rhs_terms", None)


def _participation(row: dict[str, Any]) -> str:
    value = str(row.get("participation") or row.get("solve_participation") or "solve_active")
    if value in {"disabled", "inactive", "off"}:
        return "disabled"
    return "preview_only" if value in {"preview_only", "display_only", "remark_only", "none"} or row.get("participates_in_solve") is False else "solve_active"


def _formula_text(row: dict[str, Any]) -> str:
    for key in ("dsl_formula", "dsl", "formula", "expression", "math_expression", "display_formula"):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _diagnostic_text(result: dict[str, Any]) -> str:
    messages = [str(item.get("message")) for item in result.get("diagnostics") or [] if item.get("severity") == "error"]
    return "；".join(messages) or UNSUPPORTED_FORMULA_MESSAGE
