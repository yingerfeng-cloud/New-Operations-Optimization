from __future__ import annotations

from typing import Any


class ResultInterpreter:
    def interpret(self, semantic_spec: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        variable_values = result.get("variable_values", {}) or {}
        business_variables = self._business_variables(semantic_spec, variable_values)
        explanation = self._explain(semantic_spec, result, business_variables)
        return {
            "business_variables": business_variables,
            "explanation": explanation,
        }

    def _business_variables(self, semantic_spec: dict[str, Any], variable_values: dict[str, Any]) -> dict[str, Any]:
        variables = semantic_spec.get("variables", []) or []
        names = {
            str(item.get("math_var") or item.get("code") or item.get("key") or item.get("name")): item
            for item in variables
            if item.get("math_var") or item.get("code") or item.get("key") or item.get("name")
        }
        output: dict[str, Any] = {}
        for name, values in variable_values.items():
            meta = names.get(name, {})
            label = str(meta.get("name") or name)
            dimensions = list(meta.get("dimension") or [])
            rows = []
            if isinstance(values, dict):
                for key, value in values.items():
                    row = {"value": value, "variable": name, "variable_name": label, "unit_name": meta.get("unit", "")}
                    parts = self._parse_key(str(key), name)
                    for idx, dim in enumerate(dimensions):
                        row[dim] = parts[idx] if idx < len(parts) else ""
                    rows.append(row)
            output[name] = {"name": label, "dimension": dimensions, "rows": rows}
        if {"unit_on", "unit_startup"}.intersection(output):
            output["unit_commitment_plan"] = self._unit_commitment_plan(output)
        return output

    def _explain(self, semantic_spec: dict[str, Any], result: dict[str, Any], business_variables: dict[str, Any]) -> str:
        scenario = str(semantic_spec.get("model_code") or semantic_spec.get("code") or semantic_spec.get("scenario") or "").lower()
        objective = result.get("objective_value")
        status = str(result.get("status") or "").upper()
        if status in {"FAILED", "TIMEOUT", "CANCELLED"}:
            solver_route_error = self._solver_route_error(result)
            if solver_route_error:
                error_code = str(solver_route_error.get("error_code") or "").upper()
                recommended_solver = str(solver_route_error.get("recommended_solver") or result.get("recommended_solver") or "").lower()
                if error_code == "SOLVER_UNAVAILABLE" and recommended_solver == "ipopt":
                    return "优化模型求解失败：Ipopt 求解器不可用。请安装 Ipopt 并确保 ipopt 可执行文件在 PATH 中，或改用线性化模型。"
            error_text = str(result.get("error") or result.get("message") or result.get("termination_condition") or "求解失败")
            if "ipopt" in error_text.lower() and any(key in error_text.lower() for key in ["not found", "unavailable", "missing"]):
                return "优化模型求解失败：Ipopt 求解器不可用。请安装 Ipopt 并确保 ipopt 可执行文件在 PATH 中，或改用线性化模型。"
            return f"优化模型求解失败，状态为 {status}。原因：{error_text}。请修正求解器环境、输入参数或模型约束后重新求解。"
        if "unit_commitment" in scenario:
            return self._explain_unit_commitment(objective, business_variables)
        if "economic_dispatch" in scenario or "经济" in scenario or business_variables.get("unit_output"):
            return self._explain_economic_dispatch(objective, business_variables)
        business_explanation = result.get("business_explanation")
        if isinstance(business_explanation, dict):
            parts = []
            summary = business_explanation.get("summary")
            if summary:
                parts.append(str(summary))
            strategy = business_explanation.get("strategy_explanation")
            if isinstance(strategy, list):
                parts.extend(str(item) for item in strategy if item)
            elif strategy:
                parts.append(str(strategy))
            advisory = business_explanation.get("advisory")
            if advisory:
                parts.append(str(advisory))
            if parts:
                return "\n".join(parts)
        if isinstance(business_explanation, str) and business_explanation.strip():
            return business_explanation
        if "cascade_hydro_dispatch" in scenario or "梯级水电" in scenario:
            return self._explain_cascade_hydro(result)
        if "storage_dispatch" in scenario and "renewable" not in scenario:
            return self._explain_storage_dispatch(objective, business_variables)
        if "renewable_storage" in scenario:
            return self._explain_renewable_storage(objective, business_variables)
        if "chp" in scenario or "电热" in scenario:
            return self._explain_chp(objective, business_variables)
        return f"优化模型已完成求解，目标函数值为 {objective}。结果已按业务变量结构返回，建议结合约束校核后人工确认执行方案。"

    def _solver_route_error(self, result: dict[str, Any]) -> dict[str, Any]:
        raw_result = result.get("raw_result") if isinstance(result.get("raw_result"), dict) else {}
        route_error = raw_result.get("solver_route_error") if isinstance(raw_result.get("solver_route_error"), dict) else None
        if route_error is None and isinstance(result.get("solver_route_error"), dict):
            route_error = result.get("solver_route_error")
        return dict(route_error or {})

    def _explain_economic_dispatch(self, objective: Any, business_variables: dict[str, Any]) -> str:
        unit_output = business_variables.get("unit_output", {}).get("rows", [])
        by_unit: dict[str, float] = {}
        total_output = 0.0
        for row in unit_output:
            unit = str(row.get("unit") or row.get("resource") or "-")
            value = float(row.get("value") or 0)
            by_unit[unit] = by_unit.get(unit, 0.0) + value
            total_output += value
        ordered = sorted(by_unit.items(), key=lambda item: item[1], reverse=True)
        lead = ordered[0][0] if ordered else "低成本机组"
        return (
            f"经济调度优化已完成，总发电成本为 {objective}。结果显示 {lead} 承担主要出力，"
            "低成本机组优先满发或接近上限，高成本机组用于补足剩余负荷。"
            f"本次计划总出力约 {round(total_output, 4)}，用于满足各时段负荷需求。"
        )

    def _explain_unit_commitment(self, objective: Any, business_variables: dict[str, Any]) -> str:
        plan = business_variables.get("unit_commitment_plan", {}).get("rows", [])
        startups = [row for row in plan if float(row.get("startup") or 0) >= 0.5]
        shutdowns = [row for row in plan if float(row.get("shutdown") or 0) >= 0.5]
        online_units = sorted({row.get("unit") for row in plan if float(row.get("unit_on") or 0) >= 0.5})
        online_text = f"在线机组包括 {', '.join(map(str, online_units))}" if online_units else "未识别到在线机组"
        return (
            f"日前机组组合优化已完成，目标函数值为 {objective}。{online_text}，"
            f"启停计划中包含 {len(startups)} 次启动动作和 {len(shutdowns)} 次停机动作。"
            "结果已生成机组启停、分时段出力和启动计划，可用于调度复核；"
            "平台不会自动下发生产控制指令，所有方案必须经人工确认。"
        )

    def _explain_storage_dispatch(self, objective: Any, business_variables: dict[str, Any]) -> str:
        charge = business_variables.get("storage_charge", {}).get("rows", [])
        discharge = business_variables.get("storage_discharge", {}).get("rows", [])
        soc = business_variables.get("storage_soc", {}).get("rows", [])
        total_charge = sum(float(row.get("value") or 0) for row in charge)
        total_discharge = sum(float(row.get("value") or 0) for row in discharge)
        soc_values = [float(row.get("value") or 0) for row in soc]
        soc_text = f"SOC 在 {min(soc_values):.2f} 到 {max(soc_values):.2f} 之间变化" if soc_values else "SOC 曲线已返回"
        return (
            f"储能充放电优化已完成，目标函数值为 {objective}。计划体现低价时段充电、高价时段放电的峰谷套利逻辑，"
            f"累计充电 {round(total_charge, 4)}、累计放电 {round(total_discharge, 4)}，{soc_text}。"
            "建议结合电池循环次数和安全边界后人工确认执行。"
        )

    def _explain_renewable_storage(self, objective: Any, business_variables: dict[str, Any]) -> str:
        used = business_variables.get("renewable_used", {}).get("rows", [])
        curtailment = business_variables.get("renewable_curtailment", {}).get("rows", [])
        used_total = sum(float(row.get("value") or 0) for row in used)
        curtailed_total = sum(float(row.get("value") or 0) for row in curtailment)
        return (
            f"风光储协同优化已完成，目标函数值为 {objective}。新能源利用量约 {round(used_total, 4)}，"
            f"弃风弃光量约 {round(curtailed_total, 4)}。储能优先吸纳富余新能源，并在并网约束允许范围内提高消纳率。"
        )

    def _explain_chp(self, objective: Any, business_variables: dict[str, Any]) -> str:
        electric = business_variables.get("electric_output", {}).get("rows", [])
        heat = business_variables.get("heat_output", {}).get("rows", [])
        electric_total = sum(float(row.get("value") or 0) for row in electric)
        heat_total = sum(float(row.get("value") or 0) for row in heat)
        return (
            f"电热协同优化已完成，燃料成本目标值为 {objective}。电出力合计约 {round(electric_total, 4)}，"
            f"热出力合计约 {round(heat_total, 4)}。结果同时满足电负荷、热负荷和热电耦合可行域约束。"
        )

    def _explain_cascade_hydro(self, result: dict[str, Any]) -> str:
        metrics = result.get("metrics") or {}
        station_summary = (result.get("business_output") or {}).get("station_summary") or result.get("station_summary") or []
        spill_rows = [row for row in station_summary if float(row.get("spill_volume_million_m3") or row.get("spill_m3s_sum") or 0) > 1e-6]
        terminal_text = "；".join(
            f"{row.get('station')} 期末偏差 {round(float(row.get('terminal_volume_deviation_million_m3') or 0), 4)}"
            for row in station_summary
        )
        spill_text = "、".join(str(row.get("station")) for row in spill_rows) if spill_rows else "无明显弃水电站"
        return (
            "梯级水电调度优化已完成。"
            f"总发电量约 {metrics.get('total_generation_MWh', 0)} MWh，"
            f"总弃水量约 {metrics.get('total_spill_million_m3', metrics.get('total_spill_m3s_sum', 0))} 百万立方米，"
            f"总负荷绝对偏差约 {metrics.get('total_abs_load_deviation_MW', 0)} MW。"
            f"期末库容与目标库容偏差：{terminal_text or '未返回期末库容摘要'}。"
            f"弃水情况：{spill_text}。"
            "检修可用容量已通过 availability 折算到电站出力上限；上游下泄已按传播时滞影响下游入库。"
            "该结果作为调度辅助建议，需调度人员结合实际水情、电网计划和安全边界复核。"
        )

    def _parse_key(self, key: str, variable_name: str) -> list[str]:
        prefix = f"{variable_name}["
        if key.startswith(prefix) and key.endswith("]"):
            key = key[len(prefix) : -1]
        return [part.strip() for part in key.split(",") if part.strip()]

    def _unit_commitment_plan(self, variables: dict[str, Any]) -> dict[str, Any]:
        on_rows = variables.get("unit_on", {}).get("rows", [])
        startup_rows = variables.get("unit_startup", {}).get("rows", [])
        output_rows = variables.get("unit_output", {}).get("rows", [])
        startup_map = {(row.get("unit"), row.get("time")): row.get("value") for row in startup_rows}
        output_map = {(row.get("unit"), row.get("time")): row.get("value") for row in output_rows}
        previous_on: dict[str, float] = {}
        plan = []
        for row in sorted(on_rows, key=lambda item: (str(item.get("time")), str(item.get("unit")))):
            unit = str(row.get("unit"))
            time = str(row.get("time"))
            unit_on = float(row.get("value") or 0)
            previous = previous_on.get(unit, 0.0)
            shutdown = 1 if previous >= 0.5 and unit_on < 0.5 else 0
            previous_on[unit] = unit_on
            plan.append(
                {
                    "unit": unit,
                    "time": time,
                    "unit_on": round(unit_on),
                    "startup": round(float(startup_map.get((unit, time), 0) or 0)),
                    "shutdown": shutdown,
                    "unit_output": output_map.get((unit, time), 0),
                }
            )
        return {"name": "机组启停计划", "dimension": ["unit", "time"], "rows": plan}


result_interpreter = ResultInterpreter()
