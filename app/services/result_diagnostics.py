"""Expose diagnostics measured on the solved model without inventing checks."""
import math
from typing import Any


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def result_diagnostics(result: dict[str, Any]) -> dict[str, Any]:
    output = {key: result[key] for key in (
        "problem_type", "solver_available", "termination_condition",
        "constraint_violation_summary", "local_optimum_warning",
    ) if result.get(key) is not None}
    if not output.get("termination_condition") and result.get("raw_termination_condition"):
        output["termination_condition"] = result["raw_termination_condition"]
    if not output.get("problem_type") and result.get("solver_type"):
        output["problem_type"] = result["solver_type"]
    evidence = result.get("solution_evidence") or {}
    rows = evidence.get("constraints") if isinstance(evidence, dict) else None
    if not isinstance(rows, list):
        return output
    tolerance = 1e-6
    checks = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not _finite(row.get("body")) or not _finite(row.get("violation")):
            continue
        lower, upper, value = row.get("lower"), row.get("upper"), row["body"]
        if any(bound is not None and not _finite(bound) for bound in (lower, upper)):
            continue
        margins = ([value - lower] if lower is not None else []) + ([upper - value] if upper is not None else [])
        margin = min(margins) if margins else None
        violation = row["violation"]
        checks.append({
            **row, "name": row.get("key") or row.get("execution_name") or f"constraint_{index + 1}",
            "value": value, "limit": upper if upper is not None else lower, "margin": margin,
            "status": "violated" if violation > tolerance else "binding" if margin is not None and abs(margin) <= tolerance else "satisfied",
            "tolerance": tolerance, "source_ref": f"solution_evidence.constraints.{index}",
        })
    if checks:
        output["constraint_checks"] = checks
    if not rows or checks:
        violated = [row for row in checks if row["violation"] > tolerance]
        bounds = [row for row in evidence.get("variable_checks") or [] if isinstance(row, dict) and _finite(row.get("violation"))]
        output["constraint_violation_summary"] = {
            **(result.get("constraint_violation_summary") or {}),
            "source": "solution_evidence", "tolerance": tolerance,
            "constraint_count": len(rows), "checked_count": len(checks),
            "unchecked_count": len(rows) - len(checks), "violated_count": len(violated),
            "max_violation": max((row["violation"] for row in checks), default=0.0),
            "violations": violated,
            "variable_checked_count": len(bounds),
            "bound_violated_count": sum(row["violation"] > tolerance for row in bounds),
            "max_bound_violation": max((row["violation"] for row in bounds), default=None),
            "max_integrality_violation": max((row["integrality_violation"] for row in bounds if _finite(row.get("integrality_violation"))), default=None),
        }
    return output
