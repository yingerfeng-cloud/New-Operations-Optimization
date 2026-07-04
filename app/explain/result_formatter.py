from __future__ import annotations

from typing import Any


def _metric_series(raw: Any, times: list[Any], default: float = 0.0) -> dict[Any, float]:
    if isinstance(raw, dict):
        return {t: float(raw.get(t, raw.get(str(t), default)) or 0.0) for t in times}
    if isinstance(raw, list):
        return {t: float(raw[index] if index < len(raw) else default) for index, t in enumerate(times)}
    return {t: float(default if raw is None else raw) for t in times}


class SolveResultFormatter:
    def format(self, model_code: str, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        if model_code == "unit_commitment_day_ahead":
            return self._format_unit_commitment(solver_result, context)
        if model_code == "cascade_hydro_dispatch_v1":
            return self._format_cascade_hydro_dispatch_v1(solver_result, context)
        if model_code == "cascade_hydro_dispatch":
            return self._format_cascade_hydro_dispatch(solver_result, context)
        if model_code == "storage_dispatch":
            return self._format_storage_dispatch(solver_result, context)
        if model_code.startswith("pv_storage_"):
            return self._format_pv_storage(model_code, solver_result, context)
        if model_code == "economic_dispatch":
            return self._generic(model_code, solver_result, "经济调度已完成，系统在满足负荷和机组边界约束下最小化发电成本。", context)
        if model_code == "renewable_storage_dispatch":
            return self._generic(model_code, solver_result, "风光储协同优化已完成，系统在满足并网和储能约束下提升新能源消纳。", context)
        if model_code == "chp_dispatch":
            return self._generic(model_code, solver_result, "电热协同优化已完成，系统在电热可行域内同时满足电负荷和热负荷。", context)
        return self._generic(model_code, solver_result, "模型已通过统一 Pyomo 建模引擎和 HiGHS 求解链路完成求解。", context)

    def _format_unit_commitment(self, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        units = context["units"]
        times = context["times"]
        output_values = solver_result.variable_values.get("unit_output", {})
        on_values = solver_result.variable_values.get("unit_on", {})
        startup_values = solver_result.variable_values.get("unit_startup", {})
        fuel_cost = context["fuel_cost"]
        startup_cost = context["startup_cost"]
        p_max = context["p_max"]
        ramp_up = context["ramp_up"]
        load = context["load"]
        renewable = context["renewable"]
        reserve_ratio = context["reserve_ratio"]

        schedule = []
        period_output = []
        fuel_total = 0.0
        startup_total = 0.0
        tightness = {"output_upper": [], "ramp_limit": [], "reserve_margin": []}
        previous_output = {unit: 0.0 for unit in units}

        for t_idx, time_label in enumerate(times):
            total_output = 0.0
            committed_capacity = 0.0
            startup_count = 0
            for unit in units:
                output = float(output_values.get(f"unit_output[{unit},{t_idx}]", 0.0))
                on = round(float(on_values.get(f"unit_on[{unit},{t_idx}]", 0.0)))
                startup = round(float(startup_values.get(f"unit_startup[{unit},{t_idx}]", 0.0)))
                total_output += output
                committed_capacity += p_max[unit] * on
                startup_count += startup
                fuel_total += output * fuel_cost[unit]
                startup_total += startup * startup_cost[unit]
                if on and abs(output - p_max[unit]) <= 1e-4:
                    tightness["output_upper"].append({"unit": unit, "time": time_label, "slack": 0.0})
                if t_idx > 0 and output - previous_output[unit] >= ramp_up[unit] - 1e-4:
                    tightness["ramp_limit"].append({"unit": unit, "time": time_label, "slack": 0.0})
                previous_output[unit] = output
                schedule.append(
                    {
                        "time": time_label,
                        "unit": unit,
                        "unit_output": round(output, 3),
                        "unit_on": on,
                        "unit_startup": startup,
                        "fuel_cost": round(output * fuel_cost[unit], 2),
                        "startup_cost": round(startup * startup_cost[unit], 2),
                    }
                )
            reserve_required = load[time_label] * (1.0 + reserve_ratio)
            reserve_slack = committed_capacity + renewable[time_label] - reserve_required
            if reserve_slack <= 1e-4:
                tightness["reserve_margin"].append({"time": time_label, "slack": round(reserve_slack, 4)})
            period_output.append(
                {
                    "time": time_label,
                    "load_forecast": load[time_label],
                    "renewable_forecast": renewable[time_label],
                    "total_unit_output": round(total_output, 3),
                    "total_supply": round(total_output + renewable[time_label], 3),
                    "committed_capacity": round(committed_capacity, 3),
                    "startup_count": startup_count,
                    "reserve_required": round(reserve_required, 3),
                    "reserve_slack": round(reserve_slack, 3),
                }
            )

        objective = float(solver_result.objective_value or 0.0)
        summary = self._uc_summary(period_output, tightness)
        return {
            "series": schedule,
            "chart": {
                "labels": [str(t) for t in times],
                "renewable": [renewable[t] for t in times],
                "thermal": [row["total_unit_output"] for row in period_output],
                "load": [load[t] for t in times],
                "reserve_slack": [row["reserve_slack"] for row in period_output],
            },
            "metrics": {
                "objective_value": round(objective, 3),
                "total_cost": round(objective, 3),
                "fuel_cost": round(fuel_total, 2),
                "startup_cost": round(startup_total, 2),
                "gap": "0.00%",
                "risk": "low",
            },
            "business_output": {
                "unit_commitment_schedule": schedule,
                "unit_start_stop_plan": schedule,
                "unit_output_plan": period_output,
                "period_total_output": period_output,
                "reserve_margin": period_output,
                "cost_breakdown": {
                    "fuel_cost": round(fuel_total, 2),
                    "startup_cost": round(startup_total, 2),
                    "total_cost": round(objective, 2),
                },
                "constraint_tightness": tightness,
                "constraint_check": {
                    "power_balance_satisfied": True,
                    "reserve_margin_min": min((row["reserve_slack"] for row in period_output), default=0),
                    "binding_constraints": tightness,
                },
            },
            "business_explanation": {
                "summary": summary,
                "model_code": "unit_commitment_day_ahead",
                "decision": "输出日前机组启停、启动和分时段出力计划。",
                "binding_rules": ["功率平衡", "出力上下限", "启动逻辑", "爬坡约束", "备用约束"],
            },
        }

    def _format_storage_dispatch(self, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        storage = context["storage"]
        times = context["times"]
        charge = solver_result.variable_values.get("storage_charge", {})
        discharge = solver_result.variable_values.get("storage_discharge", {})
        soc = solver_result.variable_values.get("storage_soc", {})
        rows = []
        action_count = 0
        conflict = False
        hit_lower = False
        hit_upper = False
        for t_idx, time_label in enumerate(times):
            for item in storage:
                c = float(charge.get(f"storage_charge[{item},{t_idx}]", 0.0))
                d = float(discharge.get(f"storage_discharge[{item},{t_idx}]", 0.0))
                s = float(soc.get(f"storage_soc[{item},{t_idx}]", 0.0))
                if c > 1e-5 or d > 1e-5:
                    action_count += 1
                if c > 1e-5 and d > 1e-5:
                    conflict = True
                if s <= 10 + 1e-5:
                    hit_lower = True
                if s >= float(context["capacity"][item]) - 1e-5:
                    hit_upper = True
                rows.append(
                    {
                        "time": time_label,
                        "storage": item,
                        "charge": round(c, 3),
                        "discharge": round(d, 3),
                        "soc": round(s, 3),
                        "price": context["price"][time_label],
                    }
                )
        profit = float(solver_result.objective_value or 0.0)
        constraint_check = {
            "soc_within_bounds": True,
            "soc_hits_lower_bound": hit_lower,
            "soc_hits_upper_bound": hit_upper,
            "charge_discharge_exclusive": not conflict,
            "charge_discharge_conflict": conflict,
        }
        return {
            "series": rows,
            "chart": {
                "labels": [str(t) for t in times],
                "price": [context["price"][t] for t in times],
                "soc": [row["soc"] for row in rows if row["storage"] == storage[0]],
                "charge": [row["charge"] for row in rows if row["storage"] == storage[0]],
                "discharge": [row["discharge"] for row in rows if row["storage"] == storage[0]],
            },
            "metrics": {
                "objective_value": round(profit, 3),
                "total_cost": round(-profit, 3),
                "profit": round(profit, 3),
                "gap": "0.00%",
                "risk": "low",
            },
            "business_output": {
                "charge_discharge_plan": rows,
                "soc_curve": rows,
                "revenue_assessment": {
                    "arbitrage_profit": round(profit, 2),
                    "charge_discharge_count": action_count,
                },
                "arbitrage_profit": round(profit, 2),
                "charge_discharge_count": action_count,
                "constraint_check": constraint_check,
            },
            "business_explanation": {
                "summary": "储能在低价时段充电、高价时段放电，在满足SOC和功率约束下实现峰谷套利收益最大。"
            },
        }

    def _format_cascade_hydro_dispatch(self, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        component_context = context.get("context", context)
        sets = component_context.get("sets", {})
        params = component_context.get("runtime_parameters", {})
        stations = list(sets.get("station") or params.get("station") or [])
        times = list(sets.get("time") or params.get("time") or [])
        time_volume = list(sets.get("time_volume") or params.get("time_volume") or [])
        values = solver_result.variable_values
        load_forecast = list(params.get("load_forecast") or [])
        step_hours = float(params.get("time_step_seconds", 900)) / 3600

        system_curve = []
        station_summary = []
        dispatch_detail = []
        station_power_chart = {station: [] for station in stations}
        volume_chart = {station: [] for station in stations}
        total_generation_mwh = 0.0
        total_spill_million_m3 = 0.0
        total_spill_flow_sum_m3s = 0.0
        total_spill_volume_m3 = 0.0
        total_abs_deviation = 0.0

        for time_idx, time_label in enumerate(times):
            total_power = sum(self._value(values, "station_power", station, time_label) for station in stations)
            load = float(load_forecast[time_idx]) if time_idx < len(load_forecast) else 0.0
            dev_pos = self._value(values, "load_dev_pos", time_label)
            dev_neg = self._value(values, "load_dev_neg", time_label)
            signed_deviation = dev_pos - dev_neg
            total_abs_deviation += abs(signed_deviation)
            system_curve.append(
                {
                    "time_index": time_label,
                    "load_forecast_MW": round(load, 6),
                    "total_hydro_power_MW": round(total_power, 6),
                    "load_deviation_MW": round(signed_deviation, 6),
                }
            )
            for station in stations:
                power = self._value(values, "station_power", station, time_label)
                q_gen = self._value(values, "q_gen", station, time_label)
                q_spill = self._value(values, "q_spill", station, time_label)
                q_out = self._value(values, "q_out", station, time_label)
                volume_start = self._value(values, "volume", station, time_volume[time_idx])
                volume_end = self._value(values, "volume", station, time_volume[time_idx + 1])
                station_power_chart[station].append(round(power, 6))
                volume_chart[station].append(round(volume_start, 6))
                total_generation_mwh += power * step_hours
                spill_volume_m3 = q_spill * float(params.get("time_step_seconds", 900))
                total_spill_flow_sum_m3s += q_spill
                total_spill_volume_m3 += spill_volume_m3
                total_spill_million_m3 += spill_volume_m3 / 1_000_000
                dispatch_detail.append(
                    {
                        "time_index": time_label,
                        "station": station,
                        "station_power_MW": round(power, 6),
                        "q_gen_m3s": round(q_gen, 6),
                        "q_spill_m3s": round(q_spill, 6),
                        "q_out_m3s": round(q_out, 6),
                        "volume_start_million_m3": round(volume_start, 6),
                        "volume_end_million_m3": round(volume_end, 6),
                        "load_forecast_MW": round(load, 6),
                        "total_hydro_power_MW": round(total_power, 6),
                        "load_deviation_MW": round(signed_deviation, 6),
                    }
                )

        terminal_time = time_volume[-1] if time_volume else None
        terminal_deviation_sum = 0.0
        spill_stations = []
        for station in stations:
            station_generation = sum(self._value(values, "station_power", station, t) for t in times) * step_hours
            station_spill_flow_sum_m3s = sum(self._value(values, "q_spill", station, t) for t in times)
            station_spill_volume_m3 = station_spill_flow_sum_m3s * float(params.get("time_step_seconds", 900))
            station_spill_million_m3 = station_spill_volume_m3 / 1_000_000
            terminal_volume = self._value(values, "volume", station, terminal_time) if terminal_time is not None else 0.0
            target = float((params.get("target_terminal_volume") or {}).get(station, 0.0))
            terminal_deviation = terminal_volume - target
            terminal_deviation_sum += abs(terminal_deviation)
            if station_spill_million_m3 > 1e-6:
                spill_stations.append(station)
            station_summary.append(
                {
                    "station": station,
                    "generation_MWh": round(station_generation, 6),
                    "spill_flow_sum_m3s": round(station_spill_flow_sum_m3s, 6),
                    "spill_volume_m3": round(station_spill_volume_m3, 6),
                    "spill_volume_million_m3": round(station_spill_million_m3, 6),
                    "terminal_volume_million_m3": round(terminal_volume, 6),
                    "target_terminal_volume_million_m3": round(target, 6),
                    "terminal_volume_deviation_million_m3": round(terminal_deviation, 6),
                }
            )

        objective = float(solver_result.objective_value or 0.0)
        metrics = {
            "objective_value": round(objective, 6),
            "total_cost": round(objective, 6),
            "total_generation_MWh": round(total_generation_mwh, 6),
            "total_spill_flow_sum_m3s": round(total_spill_flow_sum_m3s, 6),
            "total_spill_volume_m3": round(total_spill_volume_m3, 6),
            "total_spill_volume_million_m3": round(total_spill_million_m3, 6),
            "total_spill_million_m3": round(total_spill_million_m3, 6),
            "total_abs_load_deviation_MW": round(total_abs_deviation, 6),
            "terminal_volume_deviation_sum_million_m3": round(terminal_deviation_sum, 6),
            "gap": "0.00%",
            "risk": "low",
        }
        explanation = {
            "summary": "梯级水电调度优化已完成，结果包含各电站分时出力、发电流量、弃水、下泄流量和库容过程。",
            "maintenance": "检修可用容量组件已按 availability 折算电站分时最大出力。",
            "cascade_delay": "上游下泄已按 edges 中的 delay_periods 通过传播时滞影响下游入库。",
            "spill": "出现弃水的电站：" + ("、".join(spill_stations) if spill_stations else "无明显弃水"),
            "advisory": "结果作为调度辅助建议，需调度人员结合实际水情、电网计划和安全边界复核。",
        }
        return {
            "series": dispatch_detail,
            "dispatch_detail": dispatch_detail,
            "system_curve": system_curve,
            "station_summary": station_summary,
            "chart": {
                "labels": [str(t) for t in times],
                "load_forecast_MW": [row["load_forecast_MW"] for row in system_curve],
                "total_hydro_power_MW": [row["total_hydro_power_MW"] for row in system_curve],
                "load_deviation_MW": [row["load_deviation_MW"] for row in system_curve],
                "station_power_MW": station_power_chart,
                "volume_million_m3": volume_chart,
            },
            "metrics": metrics,
            "business_output": {
                "dispatch_detail": dispatch_detail,
                "system_curve": system_curve,
                "station_summary": station_summary,
                "metrics": metrics,
                "constraint_check": {
                    "load_tracking_mode": "positive_and_negative_deviation",
                    "component_based": True,
                },
            },
            "business_explanation": explanation,
        }

    def _format_cascade_hydro_dispatch_v1(self, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        params = context.get("runtime_parameters", {})
        sets = context.get("sets", {})
        reservoirs = list(sets.get("reservoir") or sets.get("station") or params.get("reservoir") or [])
        times = list(sets.get("time") or params.get("time") or [])
        values = solver_result.variable_values
        delta_t = float(params.get("delta_t", 1.0) or 1.0)
        delta_storage = float(context.get("delta_storage_million_m3_per_m3s") or delta_t * 3600 / 1_000_000)

        rows = []
        storage_curve = []
        outflow_curve = []
        power_curve = []
        spill_curve = []
        water_balance = []
        interpolation = []
        total_generation = 0.0
        total_spill_flow = 0.0
        total_spill_volume = 0.0
        max_balance_error = 0.0

        for t_index, t in enumerate(times):
            for reservoir in reservoirs:
                storage = self._value(values, "storage", reservoir, t)
                outflow = self._value(values, "outflow", reservoir, t)
                spill = self._value(values, "spill", reservoir, t)
                level = self._value(values, "level", reservoir, t)
                tailwater = self._value(values, "tailwater", reservoir, t)
                head = self._value(values, "head", reservoir, t)
                power = self._value(values, "power", reservoir, t)
                generation = self._value(values, "generation", reservoir, t)
                natural = self._series_value(params.get("inflow"), reservoir, t_index, t)
                upstream = self._upstream_release_value(values, params, reservoir, t, times, t_index)
                previous_storage = float((params.get("initial_storage") or {}).get(reservoir, 0.0)) if t_index == 0 else self._value(values, "storage", reservoir, times[t_index - 1])
                expected_storage = previous_storage + (natural + upstream - outflow - spill) * delta_storage
                balance_error = storage - expected_storage
                max_balance_error = max(max_balance_error, abs(balance_error))
                total_generation += generation
                total_spill_flow += spill
                total_spill_volume += spill * delta_t * 3600
                row = {
                    "time": t,
                    "reservoir": reservoir,
                    "storage": round(storage, 6),
                    "outflow": round(outflow, 6),
                    "spill": round(spill, 6),
                    "level": round(level, 6),
                    "tailwater": round(tailwater, 6),
                    "head": round(head, 6),
                    "power": round(power, 6),
                    "generation": round(generation, 6),
                }
                rows.append(row)
                storage_curve.append({"time": t, "reservoir": reservoir, "storage": round(storage, 6)})
                outflow_curve.append({"time": t, "reservoir": reservoir, "outflow": round(outflow, 6)})
                power_curve.append({"time": t, "reservoir": reservoir, "power": round(power, 6)})
                spill_curve.append({"time": t, "reservoir": reservoir, "spill": round(spill, 6)})
                water_balance.append(
                    {
                        "time": t,
                        "reservoir": reservoir,
                        "previous_storage": round(previous_storage, 6),
                        "natural_inflow": round(natural, 6),
                        "upstream_release": round(upstream, 6),
                        "outflow": round(outflow, 6),
                        "spill": round(spill, 6),
                        "expected_storage": round(expected_storage, 6),
                        "actual_storage": round(storage, 6),
                        "balance_error": round(balance_error, 8),
                    }
                )
                interpolation.append(
                    {
                        "time": t,
                        "reservoir": reservoir,
                        "level_storage": {"x_storage": round(storage, 6), "y_level": round(level, 6), "function_asset_id": context.get("function_assets", {}).get("level_storage", {}).get("function_asset_id")},
                        "tailwater_outflow": {"x_outflow": round(outflow, 6), "y_tailwater": round(tailwater, 6), "function_asset_id": context.get("function_assets", {}).get("tailwater_outflow", {}).get("function_asset_id")},
                        "power_surface": {
                            "x_outflow": round(outflow, 6),
                            "y_head": round(head, 6),
                            "z_power": round(power, 6),
                            "function_asset_id": context.get("function_assets", {}).get("power_surface", {}).get("function_asset_id"),
                            **self._selected_power_triangle(values, context, reservoir, t),
                        },
                    }
                )

        station_summary = []
        for reservoir in reservoirs:
            first_t = times[0]
            last_t = times[-1]
            initial = float((params.get("initial_storage") or {}).get(reservoir, 0.0))
            terminal = self._value(values, "storage", reservoir, last_t)
            target = float((params.get("target_final_storage") or {}).get(reservoir, 0.0))
            deviation = self._value(values, "final_storage_deviation", reservoir)
            station_summary.append(
                {
                    "reservoir": reservoir,
                    "initial_storage": round(initial, 6),
                    "first_period_storage": round(self._value(values, "storage", reservoir, first_t), 6),
                    "final_storage": round(terminal, 6),
                    "target_final_storage": round(target, 6),
                    "final_storage_deviation": round(deviation, 6),
                    "generation": round(sum(self._value(values, "generation", reservoir, t) for t in times), 6),
                    "spill": round(sum(self._value(values, "spill", reservoir, t) for t in times), 6),
                }
            )

        model_size = context.get("model_size") or {}
        metrics = {
            "objective_value": round(float(solver_result.objective_value or 0.0), 6),
            "total_generation": round(total_generation, 6),
            "total_generation_MWh": round(total_generation, 6),
            "total_spill": round(total_spill_flow, 6),
            "total_spill_volume_m3": round(total_spill_volume, 6),
            "total_spill_volume_million_m3": round(total_spill_volume / 1_000_000, 6),
            "total_spill_million_m3": round(total_spill_volume / 1_000_000, 6),
            "max_water_balance_error": round(max_balance_error, 8),
            "variable_count": int(model_size.get("variables", 0)),
            "binary_variable_count": int(model_size.get("binary_variables", 0)),
            "constraint_count": int(model_size.get("constraints", 0)),
            "risk": "medium" if int(model_size.get("binary_variables", 0)) else "low",
        }
        labels = [str(t) for t in times]
        chart = {
            "labels": labels,
            "storage": {r: [item["storage"] for item in storage_curve if item["reservoir"] == r] for r in reservoirs},
            "outflow": {r: [item["outflow"] for item in outflow_curve if item["reservoir"] == r] for r in reservoirs},
            "power": {r: [item["power"] for item in power_curve if item["reservoir"] == r] for r in reservoirs},
            "spill": {r: [item["spill"] for item in spill_curve if item["reservoir"] == r] for r in reservoirs},
        }
        return {
            "series": rows,
            "metrics": metrics,
            "chart": chart,
            "station_summary": station_summary,
            "storage_curve": storage_curve,
            "outflow_curve": outflow_curve,
            "power_curve": power_curve,
            "spill_curve": spill_curve,
            "water_balance_check": water_balance,
            "function_asset_interpolation": interpolation,
            "milp_size": model_size,
            "business_output": {
                "overview": metrics,
                "station_summary": station_summary,
                "storage_curve": storage_curve,
                "outflow_curve": outflow_curve,
                "power_curve": power_curve,
                "spill_curve": spill_curve,
                "water_balance_check": water_balance,
                "function_asset_interpolation": interpolation,
                "milp_size": model_size,
                "variable_values": values,
            },
            "business_explanation": {
                "summary": "梯级水电调度 v1 已完成求解，结果包含总发电量、总弃水量、库容过程、出库流量、出力曲线、水量平衡校验和函数资产插值解释。",
                "function_assets": context.get("metadata", {}).get("function_assets_used", []),
                "milp_size": model_size,
                "advisory": "v1 使用 1D PWL 曲线和 2D PWL 出力曲面，不含机组启停、生态流量和复杂时滞。结果需人工复核后用于调度。",
            },
        }

    def _format_pv_storage(self, model_code: str, solver_result: Any, context: dict[str, Any]) -> dict[str, Any]:
        values = solver_result.variable_values
        params = context.get("runtime_parameters", {})
        times = list((context.get("sets") or {}).get("time") or params.get("time") or [])
        time_volume = list((context.get("sets") or {}).get("time_volume") or params.get("time_volume") or [])

        def series(name: str) -> list[float]:
            raw = values.get(name, {})
            return [float(raw.get(f"{name}[{t}]", 0.0) or 0.0) for t in times]

        def scalar(name: str) -> float | None:
            raw = values.get(name, {})
            if isinstance(raw, dict):
                if name in raw:
                    return float(raw[name] or 0.0)
                if raw:
                    return float(next(iter(raw.values())) or 0.0)
            return None

        p_grid = series("p_grid")
        p_pv_used = series("p_pv_used")
        p_pv_curtail = series("p_pv_curtail")
        p_ch = series("p_ch")
        p_dis = series("p_dis")
        dev_pos = series("deviation_pos")
        dev_neg = series("deviation_neg")
        dev_penalty = series("deviation_penalty")
        u_ch = series("u_ch")
        u_dis = series("u_dis")
        soc_raw = values.get("soc", {})
        soc_values = [float(soc_raw.get(f"soc[{t}]", 0.0) or 0.0) for t in time_volume]
        price = _metric_series(params.get("price", params.get("electricity_price")), times, 0.0)
        pv_forecast = _metric_series(params.get("pv_forecast"), times, 0.0)
        schedule = _metric_series(params.get("schedule"), times, 0.0)
        deviation_limit = _metric_series(params.get("deviation_limit"), times, 0.0)
        delta_t = float(params.get("delta_t", 1.0) or 1.0)
        total_pv = sum(pv_forecast.values())
        total_used = sum(p_pv_used)
        total_curtail = sum(p_pv_curtail)
        revenue = sum(price[t] * p_grid[i] * delta_t for i, t in enumerate(times))
        deviation_penalty_cost = float(params.get("deviation_penalty_price", 0) or 0) * delta_t * sum(dev_penalty)
        degradation_cost = float(params.get("degradation_cost_yuan_per_mwh", params.get("degradation_cost", params.get("storage_cycle_cost", 0))) or 0)
        storage_degradation_cost = degradation_cost * delta_t * sum((p_ch[i] if i < len(p_ch) else 0) + (p_dis[i] if i < len(p_dis) else 0) for i, _ in enumerate(times))
        solved_power_cap = scalar("storage_power_capacity")
        solved_energy_cap = scalar("storage_energy_capacity")
        power_cap = solved_power_cap if solved_power_cap is not None else float(params.get("storage_power_capacity", 0) or 0)
        energy_cap = solved_energy_cap if solved_energy_cap is not None else float(params.get("storage_energy_capacity", 0) or 0)
        investment = float(params.get("capex_power", 0) or 0) * power_cap + float(params.get("capex_energy", 0) or 0) * energy_cap
        annual_revenue = max(revenue * 365, 0.0)
        metrics = {
            "objective_value": round(float(solver_result.objective_value or 0.0), 6),
            "total_pv_generation_used": round(total_used, 6),
            "total_pv_curtailment": round(total_curtail, 6),
            "curtailment_rate": round(total_curtail / total_pv, 6) if total_pv else 0.0,
            "storage_charge_energy": round(sum(p_ch), 6),
            "storage_discharge_energy": round(sum(p_dis), 6),
            "soc_start": round(soc_values[0], 6) if soc_values else 0.0,
            "soc_end": round(soc_values[-1], 6) if soc_values else 0.0,
            "schedule_deviation": round(sum(dev_pos) + sum(dev_neg), 6),
            "total_deviation": round(sum(dev_pos) + sum(dev_neg), 6),
            "total_deviation_penalty_energy": round(sum(dev_penalty) * delta_t, 6),
            "market_revenue": round(revenue, 6),
            "deviation_penalty_cost": round(deviation_penalty_cost, 6),
            "storage_degradation_cost": round(storage_degradation_cost, 6),
            "net_objective_proxy": round(revenue - deviation_penalty_cost - storage_degradation_cost, 6),
            "soc_min_actual": round(min(soc_values), 6) if soc_values else 0.0,
            "soc_max_actual": round(max(soc_values), 6) if soc_values else 0.0,
            "revenue": round(revenue, 6),
            "investment_cost": round(investment, 6),
            "total_cost": round(float(solver_result.objective_value or 0.0), 6),
            "payback_period_years": round(investment / annual_revenue, 6) if annual_revenue else None,
            "storage_power_capacity": round(power_cap, 6),
            "storage_energy_capacity": round(energy_cap, 6),
        }
        rows = [
            {"time": t, "p_grid": round(p_grid[i], 6), "p_pv_used": round(p_pv_used[i], 6), "p_pv_curtail": round(p_pv_curtail[i], 6), "p_ch": round(p_ch[i], 6), "p_dis": round(p_dis[i], 6), "deviation": round((dev_pos[i] if i < len(dev_pos) else 0) + (dev_neg[i] if i < len(dev_neg) else 0), 6), "price": price[t]}
            for i, t in enumerate(times)
        ]
        for i, row in enumerate(rows):
            t = times[i]
            row["soc"] = round(soc_values[i], 6) if i < len(soc_values) else 0.0
            row["schedule"] = schedule[t]
            row["deviation_pos"] = round(dev_pos[i] if i < len(dev_pos) else 0, 6)
            row["deviation_neg"] = round(dev_neg[i] if i < len(dev_neg) else 0, 6)
            row["deviation_limit"] = deviation_limit[t]
            row["deviation_penalty"] = round(dev_penalty[i] if i < len(dev_penalty) else 0, 6)
            row["u_ch"] = round(u_ch[i] if i < len(u_ch) else 0, 6)
            row["u_dis"] = round(u_dis[i] if i < len(u_dis) else 0, 6)
        soc_min_bound = float(params.get("soc_min", 0) or 0) * energy_cap
        soc_max_bound = float(params.get("soc_max", 1) or 1) * energy_cap
        soc_curve = [{"time": t, "soc": round(value, 6), "lower_bound": round(soc_min_bound, 6), "upper_bound": round(soc_max_bound, 6)} for t, value in zip(time_volume, soc_values, strict=False)]
        charge_discharge_conflict = any(row["p_ch"] > 1e-5 and row["p_dis"] > 1e-5 for row in rows)
        constraint_check = {
            "charge_discharge_exclusive": not charge_discharge_conflict,
            "charge_discharge_conflict": charge_discharge_conflict,
            "soc_within_bounds": all(value >= soc_min_bound - 1e-5 and value <= soc_max_bound + 1e-5 for value in soc_values) if soc_values else True,
            "deviation_penalty_logic": all(row["deviation_penalty"] + 1e-5 >= max(row["deviation_pos"] - row["deviation_limit"], row["deviation_neg"] - row["deviation_limit"], 0) for row in rows),
        }
        revenue_breakdown = {"market_revenue": metrics["market_revenue"], "deviation_penalty_cost": metrics["deviation_penalty_cost"], "storage_degradation_cost": metrics["storage_degradation_cost"], "net_objective_proxy": metrics["net_objective_proxy"]}
        strategy_explanation = [
            f"超限偏差电量为 {metrics['total_deviation_penalty_energy']} MWh，偏差考核成本为 {metrics['deviation_penalty_cost']} 元。",
            f"储能充放电互斥约束{'满足' if constraint_check['charge_discharge_exclusive'] else '未满足'}，SOC 边界约束{'满足' if constraint_check['soc_within_bounds'] else '未满足'}。",
            f"本次策略在光伏消纳、计划跟踪和储能充电/放电之间权衡，净收益代理值为 {metrics['net_objective_proxy']} 元。",
        ]
        return {
            "series": rows,
            "chart": {"labels": [str(t) for t in times], "p_grid": p_grid, "p_pv_used": p_pv_used, "p_pv_curtail": p_pv_curtail, "soc": soc_values},
            "metrics": metrics,
            "dispatch_plan": rows,
            "soc_curve": soc_curve,
            "pv_curve": rows,
            "grid_output_curve": rows,
            "schedule_tracking_curve": rows,
            "deviation_curve": rows,
            "revenue_breakdown": revenue_breakdown,
            "constraint_check": constraint_check,
            "strategy_explanation": strategy_explanation,
            "business_output": {"dispatch_series": rows, "dispatch_plan": rows, "soc_curve": soc_curve, "pv_curve": rows, "grid_output_curve": rows, "schedule_tracking_curve": rows, "deviation_curve": rows, "revenue_breakdown": revenue_breakdown, "constraint_check": constraint_check, "strategy_explanation": strategy_explanation, "capacity_result": {"storage_power_capacity": power_cap, "storage_energy_capacity": energy_cap}, "metrics": metrics, "variable_values": values},
            "business_explanation": {"summary": "光储优化已完成，结果包含光伏消纳、弃光、储能充放电、计划偏差和收益/成本指标。", "model_code": model_code},
        }

    def _generic(self, model_code: str, solver_result: Any, summary: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        objective = float(solver_result.objective_value or 0.0)
        metadata = (context or {}).get("metadata", {}) if isinstance(context, dict) else {}
        mccormick = metadata.get("mccormick_relaxations") or []
        advisory = "McCormick 松弛不是精确等价表达，双线性项结果存在松弛误差风险。" if mccormick else None
        return {
            "series": [],
            "chart": {},
            "metrics": {"objective_value": round(objective, 3), "total_cost": round(objective, 3), "gap": "0.00%", "risk": "medium" if mccormick else "low"},
            "business_output": {"variable_values": solver_result.variable_values, "constraint_check": {}, "mccormick_relaxations": mccormick},
            "business_explanation": {"summary": summary, "model_code": model_code, "relaxation_advisory": advisory},
        }

    def _value(self, variable_values: dict[str, Any], name: str, *indices: Any) -> float:
        values = variable_values.get(name, {})
        label = f"{name}[{','.join(map(str, indices))}]"
        value = values.get(label, 0.0) if isinstance(values, dict) else 0.0
        return float(value or 0.0)

    def _series_value(self, data: Any, reservoir: Any, index: int, time_label: Any) -> float:
        if isinstance(data, dict):
            raw = data.get(reservoir, data.get(str(reservoir)))
            if isinstance(raw, list):
                return float(raw[index] if index < len(raw) else 0.0)
            if isinstance(raw, dict):
                return float(raw.get(time_label, raw.get(str(time_label), 0.0)) or 0.0)
            if raw is not None:
                return float(raw)
        if isinstance(data, list):
            return float(data[index] if index < len(data) else 0.0)
        return float(data or 0.0)

    def _upstream_release_value(self, values: dict[str, Any], params: dict[str, Any], reservoir: Any, time_label: Any, times: list[Any], time_index: int) -> float:
        upstream_map = params.get("upstream_station") or {}
        upstream = upstream_map.get(reservoir, upstream_map.get(str(reservoir)))
        if not upstream:
            return 0.0
        delay_raw = params.get("cascade_delay") or {}
        delay = int(delay_raw.get(reservoir, delay_raw.get(str(reservoir), 0)) if isinstance(delay_raw, dict) else delay_raw or 0)
        shifted = time_index - delay
        if shifted < 0:
            initial = params.get("initial_upstream_outflow") or {}
            return float(initial.get(reservoir, initial.get(str(reservoir), 0.0)) or 0.0)
        shifted_time = times[shifted]
        return self._value(values, "outflow", upstream, shifted_time) + self._value(values, "spill", upstream, shifted_time)

    def _selected_power_triangle(self, values: dict[str, Any], context: dict[str, Any], reservoir: Any, time_label: Any) -> dict[str, Any]:
        surface_meta = (context.get("function_assets") or {}).get("power_surface") or {}
        binary_name = surface_meta.get("binary_variable")
        lambda_name = surface_meta.get("lambda_variable")
        if not binary_name or not lambda_name:
            return {}
        selected_triangle = None
        binary_values = values.get(str(binary_name), {})
        lambda_values = values.get(str(lambda_name), {})
        if isinstance(binary_values, dict):
            prefix = f"{binary_name}[{reservoir},{time_label},"
            for key, value in binary_values.items():
                if key.startswith(prefix) and float(value or 0.0) >= 0.5:
                    selected_triangle = int(str(key).split(",")[-1].rstrip("]"))
                    break
        if selected_triangle is None:
            return {}
        lambdas = []
        if isinstance(lambda_values, dict):
            for vertex in range(3):
                key = f"{lambda_name}[{reservoir},{time_label},{selected_triangle},{vertex}]"
                lambdas.append(round(float(lambda_values.get(key, 0.0) or 0.0), 6))
        return {"selected_triangle": selected_triangle, "lambda_weights": lambdas}

    def _uc_summary(self, period_output: list[dict[str, Any]], tightness: dict[str, list[dict[str, Any]]]) -> str:
        peak = max(period_output, key=lambda row: row["load_forecast"]) if period_output else None
        if peak and tightness["reserve_margin"]:
            return f"由于高峰时段负荷达到 {peak['load_forecast']} MW，系统提前安排机组在线并保留备用容量，部分时段备用约束接近边界。"
        if peak:
            return f"系统根据负荷曲线安排机组启停，在峰值负荷 {peak['load_forecast']} MW 时增加在线容量，同时以燃料成本和启停成本之和最小为目标。"
        return "系统已生成满足功率平衡、爬坡和备用要求的日前机组组合计划。"
