from __future__ import annotations

from typing import Any

from app.model_components.registry import register_component


class _ReservedComponent:
    category = "预留扩展"
    formula = ""
    required_parameters: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        return None

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        context["metadata"].setdefault("reserved_components", []).append(self.component_type)

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "example": "该组件已预留，当前版本暂未实现，后续用于高级水电特性建模。",
            "required_parameters": list(self.required_parameters),
            "common_errors": ["当前版本不应在生产模型中启用该预留组件。"],
            "sample_spec": {"type": self.component_type, "enabled": False},
        }


@register_component("piecewise_linear_curve")
class PiecewiseLinearCurveComponent(_ReservedComponent):
    display_name = "分段线性曲线组件"
    description = "后续用于水位-库容、尾水位-流量、效率曲线等分段线性化。"
    formula = "y = piecewise(x)"


@register_component("hydro_head_calculation")
class HydroHeadCalculationComponent(_ReservedComponent):
    display_name = "水头计算组件"
    description = "后续用于 head = forebay_level - tailwater_level - head_loss。"
    formula = "head = forebay_level - tailwater_level - head_loss"
