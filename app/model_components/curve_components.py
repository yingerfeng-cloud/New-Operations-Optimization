from __future__ import annotations

import ast
from typing import Any

import pyomo.environ as pyo

from app.model_components.formula_components import _eval_formula_node, _normalize_index_specs, _safe_name
from app.model_components.registry import register_component
from app.services.function_asset_service import get_function_asset, get_function_asset_points, get_function_asset_surface
from app.services.pwl_modeling_service import pwl_modeling_service


def _component_config(spec: dict[str, Any]) -> dict[str, Any]:
    config = spec.get("config") if isinstance(spec.get("config"), dict) else {}
    return {**config, **{key: value for key, value in spec.items() if key != "config"}}


def _function_id(cfg: dict[str, Any], context: dict[str, Any], *fallback_keys: str) -> str:
    binding_key = str(cfg.get("function_asset_binding_key") or "")
    bindings = (context.get("runtime_parameters") or {}).get("function_asset_bindings") or {}
    if binding_key and isinstance(bindings, dict) and bindings.get(binding_key):
        return str(bindings[binding_key])
    return str(next((cfg.get(key) for key in fallback_keys if cfg.get(key)), ""))


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
        strategy = str(cfg.get("solve_strategy") or cfg.get("interpolation_mode") or "segment_binary")
        if strategy not in {"display_only", "segment_binary", "sos2", "binary_segment_milp", "convex_combination_lp"}:
            raise RuntimeError(f"unsupported function mapping solve_strategy: {strategy}")
        function_id = _function_id(cfg, context, "function_asset_id", "curve_asset_id", "curve")
        if not function_id:
            raise RuntimeError("function_mapping_component requires function_asset_id")
        asset = get_function_asset(function_id)
        if asset.get("function_type", "piecewise_1d") != "piecewise_1d":
            raise RuntimeError("function_mapping_component currently supports only piecewise_1d assets")
        get_function_asset_points(function_id)
        _validate_domain_coverage(cfg, asset, context, axes=("x",))
        if not cfg.get("x") or not cfg.get("y"):
            raise RuntimeError("function_mapping_component requires x and y expressions")

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or cfg.get("interpolation_mode") or "segment_binary")
        function_id = _function_id(cfg, context, "function_asset_id", "curve_asset_id", "curve")
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
        indices = cfg.get("indices") or cfg.get("index") or [{"set": "time", "alias": "t"}]
        index_specs = _normalize_index_specs(indices)
        index_sets = [getattr(model, item["set"]) for item in index_specs]
        x_node = ast.parse(str(cfg["x"]), mode="eval").body
        y_node = ast.parse(str(cfg["y"]), mode="eval").body

        def expression(node: ast.AST):
            def factory(values: tuple[Any, ...]) -> Any:
                scoped: dict[str, Any] = {}
                for item, value in zip(index_specs, values, strict=False):
                    scoped[item["set"]] = value
                    scoped[item["alias"]] = value
                return _eval_formula_node(node, model, context, scoped)

            return factory

        interpolation_mode = "sos2" if strategy == "sos2" else "segment_binary"
        compiled = pwl_modeling_service.add_piecewise_1d(
            model,
            base_name=str(cfg.get("constraint_id") or f"function_mapping_{function_id}"),
            index_sets=index_sets,
            index_count=len(index_specs),
            points=points,
            x_expr=expression(x_node),
            y_expr=expression(y_node),
            interpolation_mode=interpolation_mode,
        )
        record.update(compiled)
        context["metadata"].setdefault("piecewise_1d_constraints", []).append(record)

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
                "solve_strategy": {"enum": ["display_only", "segment_binary", "sos2"]},
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
            "linearization_strategy": "segment_binary",
            "function_asset_binding": True,
        }


class FunctionMapping2DComponent:
    display_name = "二维函数映射组件"
    category = "通用建模组件"
    description = "表达 z[index] == piecewise_2d(x[index], y[index], function_asset_id)，使用三角剖分 MILP 精确线性化。"
    formula = "z = piecewise_2d(x, y)"
    required_parameters: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or "triangulated_milp_exact")
        if strategy not in {"display_only", "triangulated_milp_exact", "convex_hull_lp_approx"}:
            raise RuntimeError(f"unsupported 2D function mapping solve_strategy: {strategy}")
        function_id = _function_id(cfg, context, "function_asset_id")
        if not function_id:
            raise RuntimeError("function_mapping_2d_component requires function_asset_id")
        asset = get_function_asset(function_id)
        if asset.get("function_type") != "piecewise_2d":
            raise RuntimeError("function_mapping_2d_component requires a piecewise_2d asset")
        if not cfg.get("x") or not cfg.get("y") or not cfg.get("z"):
            raise RuntimeError("function_mapping_2d_component requires x, y and z expressions")
        if strategy == "display_only":
            return
        if strategy == "convex_hull_lp_approx":
            raise RuntimeError("convex_hull_lp_approx is diagnostic/display-only in this phase and cannot be used as an exact solve component")
        surface = get_function_asset_surface(function_id)
        if not surface["triangles"]:
            raise RuntimeError("function_mapping_2d_component requires triangles for triangulated_milp_exact")
        _validate_domain_coverage(cfg, {**asset, "domain": surface["domain"]}, context, axes=("x", "y"))

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or "triangulated_milp_exact")
        function_id = _function_id(cfg, context, "function_asset_id")
        surface = get_function_asset_surface(function_id)
        points: list[list[float]] = surface["points_2d"]
        triangles: list[list[int]] = surface["triangles"]
        indices = cfg.get("indices") or cfg.get("index") or [{"set": "time", "alias": "t"}]
        record = {
            "component": self.component_type,
            "function_asset_id": function_id,
            "x": cfg.get("x"),
            "y": cfg.get("y"),
            "z": cfg.get("z"),
            "solve_strategy": strategy,
            "domain": surface["domain"],
            "triangle_count": len(triangles),
            "point_count": len(points),
        }
        context["metadata"].setdefault("function_assets_used", []).append(record)
        if strategy == "display_only":
            context["metadata"].setdefault("display_only_function_mappings", []).append(record)
            return
        if strategy != "triangulated_milp_exact":
            context["metadata"].setdefault("function_mapping_warnings", []).append(
                {
                    **record,
                    "message": "convex_hull_lp_approx is not exact for general 2D surfaces and is not emitted as solve-active constraints",
                }
            )
            return

        index_specs = _normalize_index_specs(indices)
        index_sets = [getattr(model, item["set"]) for item in index_specs]
        base_name = _safe_name(str(cfg.get("constraint_id") or f"function_mapping_2d_{function_id}"))
        x_node = ast.parse(str(cfg["x"]), mode="eval").body
        y_node = ast.parse(str(cfg["y"]), mode="eval").body
        z_node = ast.parse(str(cfg["z"]), mode="eval").body

        def expression(node: ast.AST):
            def factory(values: tuple[Any, ...]) -> Any:
                scoped: dict[str, Any] = {}
                for item, value in zip(index_specs, values, strict=False):
                    scoped[item["set"]] = value
                    scoped[item["alias"]] = value
                return _eval_formula_node(node, model, context, scoped)

            return factory

        compiled = pwl_modeling_service.add_piecewise_2d(
            model,
            base_name=base_name,
            index_sets=index_sets,
            index_count=len(index_specs),
            points=points,
            triangles=triangles,
            x_expr=expression(x_node),
            y_expr=expression(y_node),
            z_expr=expression(z_node),
        )
        record.update(compiled)
        context["metadata"].setdefault("piecewise_2d_constraints", []).append(record)

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "example": "power[t] == piecewise_2d(flow[t], head[t], hydro_power_surface)",
            "required_parameters": [],
            "config_schema": {
                "function_asset_id": {"type": "string", "required": True},
                "x": {"type": "formula_expression", "required": True},
                "y": {"type": "formula_expression", "required": True},
                "z": {"type": "formula_expression", "required": True},
                "indices": {"type": "index_list", "default": [{"set": "time", "alias": "t"}]},
                "solve_strategy": {"enum": ["display_only", "triangulated_milp_exact", "convex_hull_lp_approx"]},
            },
            "sample_generated_constraints": [
                {
                    "constraint_id": "function_mapping_2d",
                    "type": "piecewise_2d",
                    "formula": "z[index] == piecewise_2d(x[index], y[index], function_asset_id)",
                    "piecewise_method": "triangulated_milp_exact",
                    "solve_participation": "solve_active",
                }
            ],
            "problem_type": "MILP",
            "problem_types": ["MILP"],
            "solver_capabilities": ["MILP"],
            "variable_types": ["continuous", "binary"],
            "linearization_strategy": "triangulated_milp_exact",
            "function_asset_binding": True,
        }


@register_component("function_mapping_component")
class RegisteredFunctionMappingComponent(FunctionMappingComponent):
    pass


@register_component("function_mapping_2d_component")
class RegisteredFunctionMapping2DComponent(FunctionMapping2DComponent):
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

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        params = context.get("runtime_parameters") or {}
        head_loss = params.get("head_loss") or {}

        def rule(m: Any, station: Any, t: Any) -> Any:
            loss = head_loss.get(station, head_loss.get(str(station), 0.0)) if isinstance(head_loss, dict) else head_loss
            return m.head[station, t] == m.forebay_level[station, t] - m.tailwater_level[station, t] - float(loss or 0.0)

        model.hydro_head_calculation = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_head_calculation"] = model.hydro_head_calculation


def _validate_domain_coverage(
    cfg: dict[str, Any],
    asset: dict[str, Any],
    context: dict[str, Any],
    *,
    axes: tuple[str, ...],
) -> None:
    domain = asset.get("domain") or {}
    bounds = cfg.get("domain_bounds") or {}
    policy = str(cfg.get("out_of_domain_policy") or asset.get("out_of_domain_policy") or "reject")
    params = context.get("runtime_parameters") or {}
    stations = list((context.get("sets") or {}).get("station") or [None])
    violations: list[str] = []
    for axis in axes:
        for side in ("min", "max"):
            param_name = bounds.get(f"{axis}_{side}_param")
            if not param_name:
                continue
            raw = params.get(str(param_name))
            domain_value = domain.get(f"{axis}_{side}")
            if raw is None or domain_value is None:
                continue
            for station in stations:
                value = raw.get(station, raw.get(str(station))) if isinstance(raw, dict) and station is not None else raw
                if value is None:
                    continue
                numeric = float(value)
                outside = numeric < float(domain_value) if side == "min" else numeric > float(domain_value)
                if outside:
                    label = f"电站 {station} " if station is not None else ""
                    violations.append(
                        f"{label}{param_name} 模型边界={numeric}，函数资产边界={domain_value}"
                    )
    if violations and policy == "reject":
        raise RuntimeError(
            "函数资产定义域不覆盖模型运行边界："
            + "；".join(violations)
            + "。请调整模型边界或更换覆盖完整的函数资产。"
        )
    if violations:
        context.setdefault("metadata", {}).setdefault("function_domain_clamps", []).append(
            {"function_asset_id": asset.get("function_id"), "policy": policy, "violations": violations}
        )
