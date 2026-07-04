from __future__ import annotations

import ast
import math
import re
from typing import Any

import pyomo.environ as pyo

from app.model_components.formula_components import _eval_formula_node, _normalize_index_specs, _safe_name


REQUIRED_FIELDS = ("x", "y", "w", "x_lower", "x_upper", "y_lower", "y_upper")


def validate_mccormick_spec(spec: dict[str, Any]) -> None:
    missing = [field for field in REQUIRED_FIELDS if spec.get(field) in (None, "")]
    if missing:
        raise RuntimeError(f"mccormick_bilinear_relaxation_component requires fields: {', '.join(missing)}")
    x_lower, x_upper, y_lower, y_upper = (_finite_float(spec[field], field) for field in ("x_lower", "x_upper", "y_lower", "y_upper"))
    if x_lower > x_upper:
        raise RuntimeError("x_lower must be <= x_upper for McCormick relaxation")
    if y_lower > y_upper:
        raise RuntimeError("y_lower must be <= y_upper for McCormick relaxation")


def add_mccormick_constraints(model: Any, spec: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    validate_mccormick_spec(spec)
    x_lower = float(spec["x_lower"])
    x_upper = float(spec["x_upper"])
    y_lower = float(spec["y_lower"])
    y_upper = float(spec["y_upper"])
    x_node = ast.parse(str(spec["x"]), mode="eval").body
    y_node = ast.parse(str(spec["y"]), mode="eval").body
    w_node = ast.parse(str(spec["w"]), mode="eval").body
    index_specs = _normalize_index_specs(list(spec.get("indices") or []))
    index_sets = [getattr(model, item["set"]) for item in index_specs]
    base_name = _safe_name(str(spec.get("constraint_id") or spec.get("name") or "mccormick_bilinear_relaxation"))

    def scoped_indices(values: tuple[Any, ...]) -> dict[str, Any]:
        scoped: dict[str, Any] = {}
        for item, value in zip(index_specs, values, strict=False):
            scoped[item["set"]] = value
            scoped[item["alias"]] = value
        return scoped

    def values_for(values: tuple[Any, ...]) -> tuple[Any, Any, Any]:
        scoped = scoped_indices(values)
        x = _eval_formula_node(x_node, model, context, scoped)
        y = _eval_formula_node(y_node, model, context, scoped)
        w = _eval_formula_node(w_node, model, context, scoped)
        return x, y, w

    rules = {
        f"{base_name}_lower_1": lambda _m, *values: values_for(values)[2] >= x_lower * values_for(values)[1] + y_lower * values_for(values)[0] - x_lower * y_lower,
        f"{base_name}_lower_2": lambda _m, *values: values_for(values)[2] >= x_upper * values_for(values)[1] + y_upper * values_for(values)[0] - x_upper * y_upper,
        f"{base_name}_upper_1": lambda _m, *values: values_for(values)[2] <= x_upper * values_for(values)[1] + y_lower * values_for(values)[0] - x_upper * y_lower,
        f"{base_name}_upper_2": lambda _m, *values: values_for(values)[2] <= x_lower * values_for(values)[1] + y_upper * values_for(values)[0] - x_lower * y_upper,
    }
    created: dict[str, Any] = {}
    for raw_name, rule in rules.items():
        name = _safe_component_name(model, raw_name)
        setattr(model, name, pyo.Constraint(*index_sets, rule=rule) if index_sets else pyo.Constraint(rule=lambda m, _rule=rule: _rule(m)))
        created[name] = getattr(model, name)
        context.setdefault("constraints", {})[name] = created[name]
    context.setdefault("metadata", {}).setdefault("mccormick_relaxations", []).append(
        {
            "component": "mccormick_bilinear_relaxation_component",
            "x": spec.get("x"),
            "y": spec.get("y"),
            "w": spec.get("w"),
            "x_lower": x_lower,
            "x_upper": x_upper,
            "y_lower": y_lower,
            "y_upper": y_upper,
            "relaxation_type": spec.get("relaxation_type") or "convex_envelope",
            "message": "McCormick relaxation is not an exact equality; report relaxation-gap risk in result interpretation.",
        }
    )
    return created


def _finite_float(value: Any, field: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{field} must be a finite numeric bound for McCormick relaxation") from exc
    if not math.isfinite(result):
        raise RuntimeError(f"{field} must be a finite numeric bound for McCormick relaxation")
    return result


def _safe_component_name(model: Any, raw: str) -> str:
    name = _safe_name(re.sub(r"\W+", "_", raw).strip("_"))
    if not hasattr(model, name):
        return name
    index = 2
    while hasattr(model, f"{name}_{index}"):
        index += 1
    return f"{name}_{index}"
