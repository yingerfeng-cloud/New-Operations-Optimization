from __future__ import annotations

import ast
from typing import Any

import pyomo.environ as pyo

from app.model_components.formula_components import DynamicFormulaComponent
from app.model_components.formula_components import _eval_formula_node, _normalize_index_specs, _safe_name
from app.model_components.registry import register_component
from app.services.function_asset_service import get_function_asset, get_function_asset_points, get_function_asset_surface


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
        function_id = str(cfg.get("function_asset_id") or "")
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

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        cfg = _component_config(spec)
        strategy = str(cfg.get("solve_strategy") or "triangulated_milp_exact")
        function_id = str(cfg.get("function_asset_id") or "")
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
        tri_name = _safe_name(f"{base_name}_triangles")
        vertex_name = _safe_name(f"{base_name}_vertices")
        setattr(model, tri_name, pyo.RangeSet(0, len(triangles) - 1))
        setattr(model, vertex_name, pyo.RangeSet(0, 2))
        triangle_set = getattr(model, tri_name)
        vertex_set = getattr(model, vertex_name)
        binary_name = _safe_name(f"{base_name}_select")
        lambda_name = _safe_name(f"{base_name}_lambda")
        if index_sets:
            setattr(model, binary_name, pyo.Var(*index_sets, triangle_set, within=pyo.Binary))
            setattr(model, lambda_name, pyo.Var(*index_sets, triangle_set, vertex_set, bounds=(0, 1)))
        else:
            setattr(model, binary_name, pyo.Var(triangle_set, within=pyo.Binary))
            setattr(model, lambda_name, pyo.Var(triangle_set, vertex_set, bounds=(0, 1)))
        binary = getattr(model, binary_name)
        lambdas = getattr(model, lambda_name)
        x_node = ast.parse(str(cfg["x"]), mode="eval").body
        y_node = ast.parse(str(cfg["y"]), mode="eval").body
        z_node = ast.parse(str(cfg["z"]), mode="eval").body

        def scoped_indices(values: tuple[Any, ...]) -> dict[str, Any]:
            scoped: dict[str, Any] = {}
            for item, value in zip(index_specs, values, strict=False):
                scoped[item["set"]] = value
                scoped[item["alias"]] = value
            return scoped

        def b(values: tuple[Any, ...], k: int) -> Any:
            return binary[(*values, k)] if values else binary[k]

        def lam(values: tuple[Any, ...], k: int, j: int) -> Any:
            return lambdas[(*values, k, j)] if values else lambdas[k, j]

        def selected_point(k: int, j: int) -> list[float]:
            return points[triangles[k][j]]

        def binary_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(b(values, k) for k in range(len(triangles))) == 1

        def lambda_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(lam(values, k, j) for k in range(len(triangles)) for j in range(3)) == 1

        def lambda_bound_rule(_m: Any, *args: Any) -> Any:
            values = args[: len(index_specs)]
            k = int(args[len(index_specs)])
            j = int(args[len(index_specs) + 1])
            return lam(values, k, j) <= b(values, k)

        def link_rule(node: ast.AST, coord: int):
            def rule(_m: Any, *values: Any) -> Any:
                scoped = scoped_indices(values)
                lhs = _eval_formula_node(node, model, context, scoped)
                rhs = sum(float(selected_point(k, j)[coord]) * lam(values, k, j) for k in range(len(triangles)) for j in range(3))
                return lhs == rhs

            return rule

        constraints = {
            _safe_name(f"{base_name}_binary_sum"): (index_sets, binary_sum_rule),
            _safe_name(f"{base_name}_lambda_sum"): (index_sets, lambda_sum_rule),
            _safe_name(f"{base_name}_x_link"): (index_sets, link_rule(x_node, 0)),
            _safe_name(f"{base_name}_y_link"): (index_sets, link_rule(y_node, 1)),
            _safe_name(f"{base_name}_z_link"): (index_sets, link_rule(z_node, 2)),
        }
        for name, (sets, rule) in constraints.items():
            setattr(model, name, pyo.Constraint(*sets, rule=rule) if sets else pyo.Constraint(rule=lambda m, _rule=rule: _rule(m)))
            context["constraints"][name] = getattr(model, name)
        bound_name = _safe_name(f"{base_name}_lambda_bound")
        setattr(model, bound_name, pyo.Constraint(*(index_sets + [triangle_set, vertex_set]), rule=lambda_bound_rule) if index_sets else pyo.Constraint(triangle_set, vertex_set, rule=lambda_bound_rule))
        context["constraints"][bound_name] = getattr(model, bound_name)
        context["metadata"].setdefault("piecewise_2d_constraints", []).append(
            {
                **record,
                "compiler": "triangulated_milp_exact",
                "binary_variable": binary_name,
                "lambda_variable": lambda_name,
            }
        )

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
