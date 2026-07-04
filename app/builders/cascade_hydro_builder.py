from __future__ import annotations

import re
from typing import Any

import pyomo.environ as pyo

from app.services.function_asset_service import get_function_asset_points, get_function_asset_surface


class CascadeHydroDispatchV1Builder:
    def build(self, model_template: dict[str, Any], runtime_parameters: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        params = {**(model_template.get("sample_runtime_parameters") or {}), **runtime_parameters}
        reservoirs = list(params.get("reservoir") or params.get("station") or [])
        times = list(params.get("time") or range(int(params.get("horizon") or 0)))
        if not reservoirs or not times:
            raise RuntimeError("cascade_hydro_dispatch_v1 requires non-empty reservoir/station and time sets")

        assets = params.get("function_asset_bindings") or (model_template.get("component_spec") or {}).get("function_asset_bindings") or {}
        level_asset_id = str(assets.get("level_storage") or "cascade_hydro_level_storage_v1")
        tailwater_asset_id = str(assets.get("tailwater_outflow") or "cascade_hydro_tailwater_outflow_v1")
        power_asset_id = str(assets.get("power_surface") or "cascade_hydro_power_surface_v1")
        level_points = get_function_asset_points(level_asset_id)
        tailwater_points = get_function_asset_points(tailwater_asset_id)
        power_surface = get_function_asset_surface(power_asset_id)

        model = pyo.ConcreteModel(name="cascade_hydro_dispatch_v1")
        model.reservoir = pyo.Set(initialize=reservoirs, ordered=True)
        model.station = pyo.Set(initialize=reservoirs, ordered=True)
        model.time = pyo.Set(initialize=times, ordered=True)

        model.storage = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.outflow = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.spill = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.level = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.tailwater = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.head = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.power = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.generation = pyo.Var(model.reservoir, model.time, within=pyo.NonNegativeReals)
        model.final_storage_deviation = pyo.Var(model.reservoir, within=pyo.NonNegativeReals)

        time_index = {time: idx for idx, time in enumerate(times)}
        previous_time = {time: times[idx - 1] for idx, time in enumerate(times) if idx > 0}
        last_time = times[-1]
        delta_t = float(params.get("delta_t", 1.0) or 1.0)
        delta_storage = delta_t * 3600.0 / 1_000_000.0

        def storage_bounds_rule(m: Any, r: Any, t: Any) -> Any:
            return pyo.inequality(_lookup(params["storage_min"], r), m.storage[r, t], _lookup(params["storage_max"], r))

        def outflow_bounds_rule(m: Any, r: Any, t: Any) -> Any:
            return pyo.inequality(_lookup(params["outflow_min"], r), m.outflow[r, t], _lookup(params["outflow_max"], r))

        def power_bounds_rule(m: Any, r: Any, t: Any) -> Any:
            return pyo.inequality(_lookup(params["power_min"], r), m.power[r, t], _lookup(params["power_max"], r))

        def head_rule(m: Any, r: Any, t: Any) -> Any:
            return m.head[r, t] == m.level[r, t] - m.tailwater[r, t]

        def generation_rule(m: Any, r: Any, t: Any) -> Any:
            return m.generation[r, t] == m.power[r, t] * delta_t

        def terminal_upper_rule(m: Any, r: Any) -> Any:
            return m.final_storage_deviation[r] >= m.storage[r, last_time] - _lookup(params["target_final_storage"], r)

        def terminal_lower_rule(m: Any, r: Any) -> Any:
            return m.final_storage_deviation[r] >= _lookup(params["target_final_storage"], r) - m.storage[r, last_time]

        def water_balance_rule(m: Any, r: Any, t: Any) -> Any:
            natural = _series_value(params["inflow"], r, time_index[t], t)
            upstream = _upstream_release_expr(m, params, r, t, times, time_index)
            previous_storage = _lookup(params["initial_storage"], r) if t == times[0] else m.storage[r, previous_time[t]]
            return m.storage[r, t] == previous_storage + (natural + upstream - m.outflow[r, t] - m.spill[r, t]) * delta_storage

        model.storage_bounds = pyo.Constraint(model.reservoir, model.time, rule=storage_bounds_rule)
        model.outflow_bounds = pyo.Constraint(model.reservoir, model.time, rule=outflow_bounds_rule)
        model.power_bounds = pyo.Constraint(model.reservoir, model.time, rule=power_bounds_rule)
        model.head_calculation = pyo.Constraint(model.reservoir, model.time, rule=head_rule)
        model.generation_calculation = pyo.Constraint(model.reservoir, model.time, rule=generation_rule)
        model.final_storage_deviation_upper = pyo.Constraint(model.reservoir, rule=terminal_upper_rule)
        model.final_storage_deviation_lower = pyo.Constraint(model.reservoir, rule=terminal_lower_rule)
        model.water_balance = pyo.Constraint(model.reservoir, model.time, rule=water_balance_rule)

        level_meta = self._add_piecewise_1d(model, "level_storage_mapping", level_points, model.storage, model.level, reservoirs, times)
        tailwater_meta = self._add_piecewise_1d(model, "tailwater_outflow_mapping", tailwater_points, model.outflow, model.tailwater, reservoirs, times)
        power_meta = self._add_piecewise_2d(
            model,
            "power_surface_mapping",
            power_surface["points_2d"],
            power_surface["triangles"],
            model.outflow,
            model.head,
            model.power,
            reservoirs,
            times,
        )

        penalty_spill = float(params.get("penalty_spill", 10.0) or 0.0)
        penalty_storage_deviation = float(params.get("penalty_storage_deviation", 500.0) or 0.0)
        model.objective = pyo.Objective(
            expr=sum(model.generation[r, t] for r in model.reservoir for t in model.time)
            - penalty_spill * sum(model.spill[r, t] for r in model.reservoir for t in model.time)
            - penalty_storage_deviation * sum(model.final_storage_deviation[r] for r in model.reservoir),
            sense=pyo.maximize,
        )

        context = {
            "model_code": "cascade_hydro_dispatch_v1",
            "build_mode": "template_based",
            "sets": {"reservoir": reservoirs, "station": reservoirs, "time": times},
            "runtime_parameters": params,
            "function_assets": {
                "level_storage": {"function_asset_id": level_asset_id, **level_meta},
                "tailwater_outflow": {"function_asset_id": tailwater_asset_id, **tailwater_meta},
                "power_surface": {"function_asset_id": power_asset_id, **power_meta, "domain": power_surface.get("domain", {})},
            },
            "metadata": {
                "function_assets_used": [
                    {"function_asset_id": level_asset_id, "component": "water_level_storage_function_mapping", "solve_strategy": "convex_combination_lp"},
                    {"function_asset_id": tailwater_asset_id, "component": "tailwater_outflow_function_mapping", "solve_strategy": "convex_combination_lp"},
                    {"function_asset_id": power_asset_id, "component": "power_surface_function_mapping", "solve_strategy": "triangulated_milp_exact"},
                ],
                "piecewise_2d_constraints": [power_meta],
            },
            "delta_storage_million_m3_per_m3s": delta_storage,
        }
        context["model_size"] = _model_size(model)
        model._component_context = context
        return model, context

    def _add_piecewise_1d(
        self,
        model: Any,
        base_name: str,
        points: list[list[float]],
        x_var: Any,
        y_var: Any,
        reservoirs: list[Any],
        times: list[Any],
    ) -> dict[str, Any]:
        point_set_name = _safe_name(f"{base_name}_points")
        lambda_name = _safe_name(f"{base_name}_lambda")
        setattr(model, point_set_name, pyo.RangeSet(0, len(points) - 1))
        point_set = getattr(model, point_set_name)
        setattr(model, lambda_name, pyo.Var(model.reservoir, model.time, point_set, bounds=(0, 1)))
        lambdas = getattr(model, lambda_name)

        def lambda_sum_rule(m: Any, r: Any, t: Any) -> Any:
            return sum(lambdas[r, t, k] for k in point_set) == 1

        def x_link_rule(m: Any, r: Any, t: Any) -> Any:
            return x_var[r, t] == sum(float(points[k][0]) * lambdas[r, t, k] for k in point_set)

        def y_link_rule(m: Any, r: Any, t: Any) -> Any:
            return y_var[r, t] == sum(float(points[k][1]) * lambdas[r, t, k] for k in point_set)

        setattr(model, _safe_name(f"{base_name}_lambda_sum"), pyo.Constraint(model.reservoir, model.time, rule=lambda_sum_rule))
        setattr(model, _safe_name(f"{base_name}_x_link"), pyo.Constraint(model.reservoir, model.time, rule=x_link_rule))
        setattr(model, _safe_name(f"{base_name}_y_link"), pyo.Constraint(model.reservoir, model.time, rule=y_link_rule))
        return {
            "point_count": len(points),
            "lambda_variable": lambda_name,
            "sample_points": points[:5],
            "expanded_lambda_count": len(reservoirs) * len(times) * len(points),
        }

    def _add_piecewise_2d(
        self,
        model: Any,
        base_name: str,
        points: list[list[float]],
        triangles: list[list[int]],
        x_var: Any,
        y_var: Any,
        z_var: Any,
        reservoirs: list[Any],
        times: list[Any],
    ) -> dict[str, Any]:
        triangle_set_name = _safe_name(f"{base_name}_triangles")
        vertex_set_name = _safe_name(f"{base_name}_vertices")
        binary_name = _safe_name(f"{base_name}_select")
        lambda_name = _safe_name(f"{base_name}_lambda")
        setattr(model, triangle_set_name, pyo.RangeSet(0, len(triangles) - 1))
        setattr(model, vertex_set_name, pyo.RangeSet(0, 2))
        triangle_set = getattr(model, triangle_set_name)
        vertex_set = getattr(model, vertex_set_name)
        setattr(model, binary_name, pyo.Var(model.reservoir, model.time, triangle_set, within=pyo.Binary))
        setattr(model, lambda_name, pyo.Var(model.reservoir, model.time, triangle_set, vertex_set, bounds=(0, 1)))
        binary = getattr(model, binary_name)
        lambdas = getattr(model, lambda_name)

        def point(k: int, j: int) -> list[float]:
            return points[triangles[k][j]]

        def binary_sum_rule(m: Any, r: Any, t: Any) -> Any:
            return sum(binary[r, t, k] for k in triangle_set) == 1

        def lambda_sum_rule(m: Any, r: Any, t: Any) -> Any:
            return sum(lambdas[r, t, k, j] for k in triangle_set for j in vertex_set) == 1

        def lambda_bound_rule(m: Any, r: Any, t: Any, k: Any, j: Any) -> Any:
            return lambdas[r, t, k, j] <= binary[r, t, k]

        def x_link_rule(m: Any, r: Any, t: Any) -> Any:
            return x_var[r, t] == sum(float(point(k, j)[0]) * lambdas[r, t, k, j] for k in triangle_set for j in vertex_set)

        def y_link_rule(m: Any, r: Any, t: Any) -> Any:
            return y_var[r, t] == sum(float(point(k, j)[1]) * lambdas[r, t, k, j] for k in triangle_set for j in vertex_set)

        def z_link_rule(m: Any, r: Any, t: Any) -> Any:
            return z_var[r, t] == sum(float(point(k, j)[2]) * lambdas[r, t, k, j] for k in triangle_set for j in vertex_set)

        setattr(model, _safe_name(f"{base_name}_binary_sum"), pyo.Constraint(model.reservoir, model.time, rule=binary_sum_rule))
        setattr(model, _safe_name(f"{base_name}_lambda_sum"), pyo.Constraint(model.reservoir, model.time, rule=lambda_sum_rule))
        setattr(model, _safe_name(f"{base_name}_lambda_bound"), pyo.Constraint(model.reservoir, model.time, triangle_set, vertex_set, rule=lambda_bound_rule))
        setattr(model, _safe_name(f"{base_name}_x_link"), pyo.Constraint(model.reservoir, model.time, rule=x_link_rule))
        setattr(model, _safe_name(f"{base_name}_y_link"), pyo.Constraint(model.reservoir, model.time, rule=y_link_rule))
        setattr(model, _safe_name(f"{base_name}_z_link"), pyo.Constraint(model.reservoir, model.time, rule=z_link_rule))
        return {
            "compiler": "triangulated_milp_exact",
            "point_count": len(points),
            "triangle_count": len(triangles),
            "binary_variable": binary_name,
            "lambda_variable": lambda_name,
            "expanded_binary_count": len(reservoirs) * len(times) * len(triangles),
        }


def _lookup(data: Any, key: Any, default: float | None = None) -> float:
    if isinstance(data, dict):
        value = data.get(key, data.get(str(key), default))
    else:
        value = data if data is not None else default
    if value is None:
        raise RuntimeError(f"missing cascade hydro parameter value for {key}")
    return float(value)


def _series_value(data: Any, reservoir: Any, index: int, time_label: Any) -> float:
    if isinstance(data, dict):
        raw = data.get(reservoir, data.get(str(reservoir)))
        if isinstance(raw, dict):
            return float(raw.get(time_label, raw.get(str(time_label), 0.0)) or 0.0)
        if isinstance(raw, list):
            return float(raw[index] if index < len(raw) else 0.0)
        if raw is not None:
            return float(raw)
    if isinstance(data, list):
        return float(data[index] if index < len(data) else 0.0)
    return float(data or 0.0)


def _upstream_release_expr(model: Any, params: dict[str, Any], reservoir: Any, time_label: Any, times: list[Any], time_index: dict[Any, int]) -> Any:
    upstream_map = params.get("upstream_station") or {}
    upstream = upstream_map.get(reservoir, upstream_map.get(str(reservoir)))
    if not upstream:
        return 0.0
    delay_raw = params.get("cascade_delay") or {}
    delay = int(delay_raw.get(reservoir, delay_raw.get(str(reservoir), 0)) if isinstance(delay_raw, dict) else delay_raw or 0)
    shifted_index = time_index[time_label] - delay
    if shifted_index < 0:
        initial = params.get("initial_upstream_outflow") or {}
        return _lookup(initial, reservoir, 0.0)
    shifted_time = times[shifted_index]
    return model.outflow[upstream, shifted_time] + model.spill[upstream, shifted_time]


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"\W+", "_", value).strip("_")
    return cleaned or "component"


def _model_size(model: Any) -> dict[str, int]:
    variable_count = 0
    binary_count = 0
    constraint_count = 0
    for component in model.component_objects(pyo.Var, active=True):
        for var_data in component.values():
            variable_count += 1
            if var_data.is_binary():
                binary_count += 1
    for component in model.component_objects(pyo.Constraint, active=True):
        constraint_count += len(component)
    return {"variables": variable_count, "binary_variables": binary_count, "constraints": constraint_count}
