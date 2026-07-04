from __future__ import annotations

from typing import Any

from app.components.mccormick import add_mccormick_constraints, validate_mccormick_spec
from app.model_components.registry import register_component


def _component_config(spec: dict[str, Any]) -> dict[str, Any]:
    config = spec.get("config") if isinstance(spec.get("config"), dict) else {}
    return {**config, **{key: value for key, value in spec.items() if key != "config"}}


@register_component("mccormick_bilinear_relaxation_component")
class McCormickBilinearRelaxationComponent:
    display_name = "McCormick 双线性松弛"
    category = "通用建模组件"
    description = "为 w = x * y 生成 McCormick convex-envelope 松弛约束；这是松弛，不是等价精确表达。"
    formula = "w ~= x * y"
    required_parameters: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        validate_mccormick_spec(_component_config(spec))

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        add_mccormick_constraints(model, _component_config(spec), context)

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "example": "w[t] ~= flow[t] * head[t]",
            "config_schema": {
                "x": {"type": "formula_expression", "required": True},
                "y": {"type": "formula_expression", "required": True},
                "w": {"type": "formula_expression", "required": True},
                "x_lower": {"type": "number", "required": True},
                "x_upper": {"type": "number", "required": True},
                "y_lower": {"type": "number", "required": True},
                "y_upper": {"type": "number", "required": True},
                "indices": {"type": "index_list", "default": []},
                "relaxation_type": {"enum": ["convex_envelope"]},
            },
            "sample_generated_constraints": [
                {"constraint_id": "mccormick_lower_1", "type": "mccormick", "expression": "w >= xL*y + yL*x - xL*yL"},
                {"constraint_id": "mccormick_lower_2", "type": "mccormick", "expression": "w >= xU*y + yU*x - xU*yU"},
                {"constraint_id": "mccormick_upper_1", "type": "mccormick", "expression": "w <= xU*y + yL*x - xU*yL"},
                {"constraint_id": "mccormick_upper_2", "type": "mccormick", "expression": "w <= xL*y + yU*x - xL*yU"},
            ],
            "problem_type": "LP",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "linearization_strategy": "mccormick_relaxation",
            "relaxation_warning": "McCormick 是松弛，不是等价精确表达；结果解释必须展示松弛误差风险。",
        }
