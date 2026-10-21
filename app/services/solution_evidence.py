"""Physical decisions and residuals observed on the actual solved Pyomo model."""
import math
from copy import deepcopy

import pyomo.environ as pyo


def solution_evidence(model, solver_result, semantic, runtime, settings, metrics=None):
    from app.model_dimensions import extract_dimensions
    spec = semantic.get("component_spec") or {}
    declarations = {str(item.get("code") or item.get("name") or item.get("key")): item
                    for item in [*(spec.get("variables") or []), *(semantic.get("variables") or [])]}
    decisions = []
    for code, values in solver_result.variable_values.items():
        declaration = declarations.get(code, {})
        for coordinate, value in (values.items() if isinstance(values, dict) else [("scalar", values)]):
            if isinstance(value, (int, float)) and math.isfinite(value):
                key = str(coordinate) if str(coordinate).startswith(f"{code}[") else f"{code}[{coordinate}]"
                decisions.append({"key": key, "code": code, "coordinate": str(coordinate),
                    "name": declaration.get("name") or code, "unit": declaration.get("unit") or "未声明",
                    "definition": {"dimension": extract_dimensions(declaration), "unit": declaration.get("unit") or "未声明"}, "value": value})
    constraints = []
    assets = (runtime.get("_component_dependencies") or {}).get("assets") or {}
    for row in model.component_data_objects(pyo.Constraint, active=True):
        body = float(pyo.value(row.body))
        lower = float(pyo.value(row.lower)) if row.has_lb() else None
        upper = float(pyo.value(row.upper)) if row.has_ub() else None
        violation = max(0., (lower - body) if lower is not None else 0., (body - upper) if upper is not None else 0.)
        logical_key = row.name
        for identifier in sorted(assets, key=len, reverse=True):
            if row.name.startswith(identifier + "_"):
                logical_key = assets[identifier]["family_id"] + row.name[len(identifier):]
                break
        constraints.append({"key": logical_key, "execution_name": row.name, "body": body, "lower": lower, "upper": upper, "violation": violation,
                            "definition": str(row.expr), "unit": "按模型约束定义"})
    input_keys = {str(item.get("math_param") or item.get("code") or item.get("key")) for item in semantic.get("parameters") or []}
    input_keys.update({str(item.get("code") or item.get("name") or item.get("key")) for item in semantic.get("sets") or []})
    input_keys.update({"horizon", "delta_t", "interval_minutes", "time_step_seconds"})
    declared_metrics = []
    for item in ((spec.get("metrics_config") or semantic.get("metrics_config") or {}).get("metrics") or []):
        key = str(item.get("key") or item.get("code") or "")
        value = (metrics or {}).get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            declared_metrics.append({"key": key, "name": item.get("name") or item.get("label") or key,
                "unit": item.get("unit") or "未声明", "definition": {"expression": item.get("expression"), "unit": item.get("unit") or "未声明"}, "value": value})
    bounds = []
    for variable in model.component_data_objects(pyo.Var, active=True):
        value = pyo.value(variable, exception=False)
        if value is not None:
            low = pyo.value(variable.lb) if variable.has_lb() else None
            high = pyo.value(variable.ub) if variable.has_ub() else None
            bounds.append({"key": variable.name, "violation": max(0., low - value if low is not None else 0., value - high if high is not None else 0.),
                "integrality_violation": abs(value - round(value)) if variable.is_integer() or variable.is_binary() else 0.})
    return {"schema_version": 1, "business_inputs": {key: deepcopy(runtime[key]) for key in sorted(input_keys) if key in runtime},
        "settings": deepcopy(settings), "decisions": decisions, "constraints": constraints,
        "metrics": declared_metrics, "variable_checks": bounds,
        "max_constraint_violation": max([row["violation"] for row in constraints] or [0.]),
        "objective": {"value": solver_result.objective_value, "definition": str(model.objective.expr) if hasattr(model, "objective") else "unknown",
                      "sense": str(model.objective.sense) if hasattr(model, "objective") else "unknown", "unit": "模型加权目标"}}
