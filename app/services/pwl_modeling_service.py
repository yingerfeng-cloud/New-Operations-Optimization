from __future__ import annotations

import re
from typing import Any, Callable

import pyomo.environ as pyo


ExpressionFactory = Callable[[tuple[Any, ...]], Any]


class PwlModelingService:
    """Compile function assets into local, linear Pyomo interpolation constraints."""

    def add_piecewise_1d(
        self,
        model: Any,
        *,
        base_name: str,
        index_sets: list[Any],
        index_count: int,
        points: list[list[float]],
        x_expr: ExpressionFactory,
        y_expr: ExpressionFactory,
        interpolation_mode: str = "segment_binary",
    ) -> dict[str, Any]:
        if interpolation_mode not in {"segment_binary", "sos2"}:
            raise RuntimeError(f"unsupported 1D interpolation_mode: {interpolation_mode}")
        if interpolation_mode == "sos2":
            # HiGHS through appsi does not provide a portable SOS2 path. The
            # segment formulation is equivalent and keeps the model linear.
            interpolation_mode = "segment_binary"
        if len(points) < 2:
            raise RuntimeError("piecewise_1d requires at least two breakpoints")

        name = _safe_name(base_name)
        point_name = _safe_name(f"{name}_points")
        segment_name = _safe_name(f"{name}_segments")
        lambda_name = _safe_name(f"{name}_lambda")
        selected_name = _safe_name(f"{name}_segment_selected")
        setattr(model, point_name, pyo.RangeSet(0, len(points) - 1))
        setattr(model, segment_name, pyo.RangeSet(0, len(points) - 2))
        point_set = getattr(model, point_name)
        segment_set = getattr(model, segment_name)
        setattr(model, lambda_name, pyo.Var(*index_sets, point_set, bounds=(0, 1)))
        setattr(model, selected_name, pyo.Var(*index_sets, segment_set, within=pyo.Binary))
        lambdas = getattr(model, lambda_name)
        selected = getattr(model, selected_name)

        def lam(values: tuple[Any, ...], point: int) -> Any:
            return lambdas[(*values, point)] if values else lambdas[point]

        def seg(values: tuple[Any, ...], segment: int) -> Any:
            return selected[(*values, segment)] if values else selected[segment]

        def lambda_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(lam(values, point) for point in range(len(points))) == 1

        def segment_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(seg(values, segment) for segment in range(len(points) - 1)) == 1

        def adjacency_rule(_m: Any, *args: Any) -> Any:
            values = args[:index_count]
            point = int(args[index_count])
            adjacent = []
            if point > 0:
                adjacent.append(seg(values, point - 1))
            if point < len(points) - 1:
                adjacent.append(seg(values, point))
            return lam(values, point) <= sum(adjacent)

        def x_link_rule(_m: Any, *values: Any) -> Any:
            return x_expr(values) == sum(float(points[k][0]) * lam(values, k) for k in range(len(points)))

        def y_link_rule(_m: Any, *values: Any) -> Any:
            return y_expr(values) == sum(float(points[k][1]) * lam(values, k) for k in range(len(points)))

        self._constraint(model, f"{name}_lambda_sum", index_sets, lambda_sum_rule)
        self._constraint(model, f"{name}_segment_sum", index_sets, segment_sum_rule)
        self._constraint(model, f"{name}_adjacency", index_sets + [point_set], adjacency_rule)
        self._constraint(model, f"{name}_x_link", index_sets, x_link_rule)
        self._constraint(model, f"{name}_y_link", index_sets, y_link_rule)
        return {
            "compiler": "piecewise_1d_segment_binary",
            "interpolation_mode": interpolation_mode,
            "point_count": len(points),
            "segment_count": len(points) - 1,
            "points": [list(point) for point in points],
            "lambda_variable": lambda_name,
            "segment_binary_variable": selected_name,
        }

    def add_piecewise_2d(
        self,
        model: Any,
        *,
        base_name: str,
        index_sets: list[Any],
        index_count: int,
        points: list[list[float]],
        triangles: list[list[int]],
        x_expr: ExpressionFactory,
        y_expr: ExpressionFactory,
        z_expr: ExpressionFactory,
    ) -> dict[str, Any]:
        if not triangles:
            raise RuntimeError("piecewise_2d requires at least one triangle")
        name = _safe_name(base_name)
        triangle_name = _safe_name(f"{name}_triangles")
        vertex_name = _safe_name(f"{name}_vertices")
        selected_name = _safe_name(f"{name}_triangle_selected")
        lambda_name = _safe_name(f"{name}_lambda")
        setattr(model, triangle_name, pyo.RangeSet(0, len(triangles) - 1))
        setattr(model, vertex_name, pyo.RangeSet(0, 2))
        triangle_set = getattr(model, triangle_name)
        vertex_set = getattr(model, vertex_name)
        setattr(model, selected_name, pyo.Var(*index_sets, triangle_set, within=pyo.Binary))
        setattr(model, lambda_name, pyo.Var(*index_sets, triangle_set, vertex_set, bounds=(0, 1)))
        selected = getattr(model, selected_name)
        lambdas = getattr(model, lambda_name)

        def tri(values: tuple[Any, ...], triangle: int) -> Any:
            return selected[(*values, triangle)] if values else selected[triangle]

        def lam(values: tuple[Any, ...], triangle: int, vertex: int) -> Any:
            return lambdas[(*values, triangle, vertex)] if values else lambdas[triangle, vertex]

        def point(triangle: int, vertex: int) -> list[float]:
            return points[triangles[triangle][vertex]]

        def triangle_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(tri(values, k) for k in range(len(triangles))) == 1

        def lambda_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(lam(values, k, j) for k in range(len(triangles)) for j in range(3)) == 1

        def lambda_bound_rule(_m: Any, *args: Any) -> Any:
            values = args[:index_count]
            triangle = int(args[index_count])
            vertex = int(args[index_count + 1])
            return lam(values, triangle, vertex) <= tri(values, triangle)

        def link_rule(expr: ExpressionFactory, coordinate: int):
            def rule(_m: Any, *values: Any) -> Any:
                rhs = sum(
                    float(point(k, j)[coordinate]) * lam(values, k, j)
                    for k in range(len(triangles))
                    for j in range(3)
                )
                return expr(values) == rhs

            return rule

        self._constraint(model, f"{name}_triangle_sum", index_sets, triangle_sum_rule)
        self._constraint(model, f"{name}_lambda_sum", index_sets, lambda_sum_rule)
        self._constraint(model, f"{name}_lambda_bound", index_sets + [triangle_set, vertex_set], lambda_bound_rule)
        self._constraint(model, f"{name}_x_link", index_sets, link_rule(x_expr, 0))
        self._constraint(model, f"{name}_y_link", index_sets, link_rule(y_expr, 1))
        self._constraint(model, f"{name}_z_link", index_sets, link_rule(z_expr, 2))
        return {
            "compiler": "triangulated_milp_exact",
            "point_count": len(points),
            "triangle_count": len(triangles),
            "points": [list(point) for point in points],
            "triangles": [list(triangle) for triangle in triangles],
            "binary_variable": selected_name,
            "lambda_variable": lambda_name,
        }

    @staticmethod
    def _constraint(model: Any, name: str, sets: list[Any], rule: Callable[..., Any]) -> Any:
        safe_name = _safe_name(name)
        constraint = pyo.Constraint(*sets, rule=rule) if sets else pyo.Constraint(rule=lambda m: rule(m))
        setattr(model, safe_name, constraint)
        return constraint


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"\W+", "_", value).strip("_")
    return cleaned or "piecewise"


pwl_modeling_service = PwlModelingService()
