"""Compile model-owned DSL alongside reusable component definitions.

The model draft remains the source of truth. No library component is invented
or modified to carry an editor formula, and invalid formulas never disappear
silently from a runnable component model.
"""
from copy import deepcopy
from typing import Any

from app.formulas.service import analyze_formula
from app.model_components.formula_contracts import formula_expression, participates_in_solve
from app.schemas.formula import FormulaAnalyzeRequest


def synchronize_model_formulas(draft: dict[str, Any]) -> None:
    semantic = draft.get("semantic") or {}
    objective = draft.setdefault("objective", {})
    terms = [term for term in objective.get("terms") or [] if term.get("source") != "model_formula"]
    constraints, errors = [], []
    symbols = {
        "sets": {row["code"]: {"values": row.get("values") or row.get("members") or []} for row in semantic.get("sets") or []},
        "parameters": semantic.get("parameters") or [],
        "variables": semantic.get("variables") or [],
    }
    direction = objective.get("global_direction") or objective.get("sense") or "minimize"
    for index, formula in enumerate(draft.get("formulas") or []):
        if not participates_in_solve(formula) or formula.get("source_component"):
            continue
        kind = formula.get("kind")
        if kind not in {"constraint", "objective"}:
            continue
        identifier = str(formula.get("formula_id") or f"model_formula_{index}")
        expression = formula_expression(formula)
        try:
            request = FormulaAnalyzeRequest(
                formula=expression, formula_type=kind, formula_id=identifier,
                objective_direction=formula.get("objective_direction") if kind == "objective" else None,
                scope=formula.get("scope") or [], symbols=symbols,
                model_context={"time_dimension": draft.get("time_dimension") or {}, "boundary_strategy": formula.get("boundary_strategy") or "strict"},
            )
            result = analyze_formula(request, compile_requested=True, expand_requested=True)
            if result["status"] != "compile_valid":
                diagnostics = [item for item in result.get("diagnostics") or [] if item.get("severity") == "error"]
                errors.extend({"field": f"model_draft.formulas[{index}]", "error": item.get("message") or result["status"], "suggestion": item.get("fix_hint") or "修正公式并重新执行后端编译。"} for item in diagnostics or [{"message": "模型公式未通过后端编译"}])
                continue
        except (ValueError, TypeError) as exc:
            errors.append({"field": f"model_draft.formulas[{index}]", "error": str(exc), "suggestion": "补齐公式、目标方向和索引后重新编译。"})
            continue
        row = {
            "formula_id": identifier, "name": formula.get("name") or identifier,
            "expression": expression, "dsl_formula": expression, "formula": expression,
            "solve_participation": "solve_active", "enabled": True, "participates_in_solve": True,
            "source": "model_formula", "compile_status": "compile_valid", "scope": result["scope"],
            "boundary_strategy": formula.get("boundary_strategy") or "strict",
        }
        if kind == "constraint":
            constraints.append({**row, "constraint_id": identifier, "indices": deepcopy(result["scope"])})
        else:
            weight = formula.get("weight", 1)
            weight = 1 if weight is None else weight
            sign = 1 if formula.get("objective_direction") == direction else -1
            terms.append({**row, "term_id": identifier, "weight_key": f"model_formula_{identifier}",
                          "weight": float(weight) * sign, "supported_by_backend": True})
    objective["sense"] = direction
    objective["terms"] = terms
    draft["model_formula_constraints"] = constraints
    draft["model_formula_errors"] = errors
