from __future__ import annotations

from typing import Any

from app.model_components.formula_components import DynamicFormulaComponent
from app.model_components.registry import register_component
from app.services.function_asset_service import get_function_asset, get_function_asset_points


def _component_config(spec: dict[str, Any]) -> dict[str, Any]:
    config = spec.get("config") if isinstance(spec.get("config"), dict) else {}
    return {**config, **{key: value for key, value in spec.items() if key != "config"}}


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
            "example": "该组件为预留扩展，当前版本不参与求解。",
            "required_parameters": list(self.required_parameters),
            "common_errors": ["当前版本不应在生产模型中启用该预留组件。"],
            "sample_spec": {"type": self.component_type, "enabled": False},
        }


class FunctionMappingComponent:
    display_name = "函数映射组件"
    category = "通用建模组件"
    description = "表达 y[index] == piecewise(x[index], function_asset_id)，支持函数资产中心的一维分段线性曲线。"
    formula = "y = piecewise(x)"
    required_parameters: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or "convex_combination_lp")
        if strategy not in {"display_only", "convex_combination_lp", "binary_segment_milp"}:
            raise RuntimeError(f"unsupported function mapping solve_strategy: {strategy}")
        function_id = str(cfg.get("function_asset_id") or cfg.get("curve_asset_id") or cfg.get("curve") or "")
        if not function_id:
            raise RuntimeError("function_mapping_component requires function_asset_id")
        asset = get_function_asset(function_id)
        if asset.get("function_type", "piecewise_1d") != "piecewise_1d":
            raise RuntimeError("function_mapping_component currently supports only piecewise_1d assets")
        get_function_asset_points(function_id)
        if not cfg.get("x") or not cfg.get("y"):
            raise RuntimeError("function_mapping_component requires x and y expressions")

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or "convex_combination_lp")
        function_id = str(cfg.get("function_asset_id") or cfg.get("curve_asset_id") or cfg.get("curve") or "")
        asset = get_function_asset(function_id)
        points = get_function_asset_points(function_id)
        record = {
            "component": self.component_type,
            "function_asset_id": function_id,
            "x": cfg.get("x"),
            "y": cfg.get("y"),
            "solve_strategy": strategy,
            "domain": asset.get("domain") or {},
            "monotonicity": asset.get("monotonicity"),
        }
        context["metadata"].setdefault("function_assets_used", []).append(record)
        if strategy == "display_only":
            context["metadata"].setdefault("display_only_function_mappings", []).append(record)
            return
        if strategy == "binary_segment_milp":
            context["metadata"].setdefault("reserved_function_mappings", []).append(record)
            raise RuntimeError("binary_segment_milp structure is recorded for diagnosis, but full MILP constraints are not implemented in this phase")
        curve_name = f"__function_asset_{function_id.replace('-', '_')}"
        indices = cfg.get("indices") or cfg.get("index") or [{"set": "time", "alias": "t"}]
        definition = {
            "component_id": self.component_type,
            "variables": (context.get("model_spec") or {}).get("variables") or [],
            "parameters": [{"code": curve_name, "type": "piecewise_curve", "points": points, "interpolation": asset.get("interpolation", "linear")}],
            "constraints": [
                {
                    "constraint_id": cfg.get("constraint_id") or f"function_mapping_{function_id}",
                    "type": "piecewise",
                    "indices": indices,
                    "x": cfg["x"],
                    "y": cfg["y"],
                    "curve": curve_name,
                    "expression": f"{cfg['y']} == piecewise({cfg['x']}, {curve_name})",
                    "solve_participation": "solve_active",
                    "piecewise_method": "convex_combination_lp",
                    "function_asset_id": function_id,
                }
            ],
        }
        DynamicFormulaComponent(definition).build(model, spec, context)

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "example": "level[t] == piecewise(volume[t], level_volume_curve)",
            "required_parameters": [],
            "config_schema": {
                "function_asset_id": {"type": "string", "required": True},
                "x": {"type": "formula_expression", "required": True},
                "y": {"type": "formula_expression", "required": True},
                "indices": {"type": "index_list", "default": [{"set": "time", "alias": "t"}]},
                "solve_strategy": {"enum": ["display_only", "convex_combination_lp", "binary_segment_milp"]},
            },
            "sample_generated_constraints": [
                {
                    "constraint_id": "function_mapping_piecewise",
                    "type": "piecewise",
                    "formula": "y[index] == piecewise(x[index], function_asset_id)",
                    "expression": "y[index] == piecewise(x[index], function_asset_id)",
                    "piecewise_method": "convex_combination_lp",
                    "solve_participation": "solve_active",
                }
            ],
            "problem_types": ["LP", "MILP"],
            "solver_capabilities": ["LP", "MILP"],
            "linearization_strategy": "convex_combination_lp",
            "function_asset_binding": True,
        }


@register_component("function_mapping_component")
class RegisteredFunctionMappingComponent(FunctionMappingComponent):
    pass


@register_component("piecewise_linear_curve")
class PiecewiseLinearCurveComponent(FunctionMappingComponent):
    display_name = "分段线性曲线组件"
    description = "兼容旧入口的通用函数映射组件，建议新模型使用 function_mapping_component。"
    category = "通用建模组件"


@register_component("hydro_head_calculation")
class HydroHeadCalculationComponent(_ReservedComponent):
    display_name = "水头计算组件"
    description = "预留：head = forebay_level - tailwater_level - head_loss。"
    formula = "head = forebay_level - tailwater_level - head_loss"
