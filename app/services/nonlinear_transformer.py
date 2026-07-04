from __future__ import annotations

import re
from typing import Any

from app.services.nonlinear_analyzer import analyze_expression


def recommend_strategies(expression: str, variables: list[str] | set[str] | None = None) -> list[dict[str, Any]]:
    return analyze_expression(expression, variables=set(variables or []))


def mccormick_component_from_bilinear(
    *,
    x: str,
    y: str,
    w: str,
    x_lower: float,
    x_upper: float,
    y_lower: float,
    y_upper: float,
    indices: list[dict[str, str]] | None = None,
    relaxation_type: str = "convex_envelope",
    component_id: str | None = None,
) -> dict[str, Any]:
    return {
        "component_id": "mccormick_bilinear_relaxation_component",
        "type": "mccormick_bilinear_relaxation_component",
        "name": component_id or _safe_id(f"mccormick_{x}_{y}_{w}"),
        "enabled": True,
        "x": x,
        "y": y,
        "w": w,
        "x_lower": x_lower,
        "x_upper": x_upper,
        "y_lower": y_lower,
        "y_upper": y_upper,
        "indices": indices or [],
        "relaxation_type": relaxation_type,
        "generated_constraints": [
            {
                "constraint_id": "mccormick_relaxation",
                "type": "mccormick",
                "expression": f"{w} ~= {x} * {y}",
                "solve_participation": "solve_active",
                "message": "McCormick 是松弛，不是等价精确表达。",
            }
        ],
        "metadata": {
            "linearization_strategy": "mccormick_relaxation",
            "relaxation_warning": "McCormick 松弛可能产生松弛误差，结果解释中必须提示风险。",
        },
    }


def _safe_id(text: str) -> str:
    value = re.sub(r"\W+", "_", text).strip("_").lower()
    if not value or value[0].isdigit():
        value = f"mccormick_{value}"
    return value[:80]
