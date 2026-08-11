from __future__ import annotations

from copy import deepcopy
from typing import Any

import pyomo.environ as pyo

from app.model_components.registry import register_component


_MISSING = object()


COMPUTE_POWER_SETS = [
    {"code": "time", "name": "调度时段", "type": "time_period", "required": True},
    {
        "code": "time_volume",
        "name": "状态时点",
        "type": "state_time",
        "base_set": "time",
        "generation_rule": "horizon_plus_1",
        "required": True,
    },
    {"code": "workload", "name": "算力任务池", "type": "normal", "required": True},
    {"code": "cluster", "name": "GPU 集群", "type": "normal", "required": True},
]


COMPUTE_POWER_PARAMETERS = [
    {"code": "horizon", "name": "调度时段数", "dimension": [], "unit": "period"},
    {"code": "delta_t", "name": "时间步长", "dimension": [], "unit": "h"},
    {"code": "work_arrival", "name": "任务到达计算量", "dimension": ["workload", "time"], "unit": "GPU·h"},
    {"code": "initial_backlog", "name": "初始任务积压", "dimension": ["workload"], "unit": "GPU·h"},
    {"code": "allowed_backlog", "name": "允许任务积压", "dimension": ["workload", "time_volume"], "unit": "GPU·h"},
    {"code": "slack_limit", "name": "SLA 松弛上限", "dimension": ["workload", "time_volume"], "unit": "GPU·h"},
    {"code": "sla_penalty", "name": "SLA 违约惩罚", "dimension": ["workload"], "unit": "元/GPU·h"},
    {"code": "cluster_compatibility", "name": "任务集群兼容性", "dimension": ["workload", "cluster"], "unit": "0/1"},
    {"code": "execution_cost", "name": "算力执行成本", "dimension": ["workload", "cluster"], "unit": "元/GPU·h"},
    {"code": "gpu_capacity", "name": "GPU 可用容量", "dimension": ["cluster", "time"], "unit": "GPU"},
    {"code": "idle_power", "name": "集群基础功率", "dimension": ["cluster"], "unit": "MW"},
    {"code": "gpu_dynamic_power", "name": "单 GPU 动态功率", "dimension": ["cluster"], "unit": "MW/GPU"},
    {"code": "pue", "name": "集群 PUE", "dimension": ["cluster", "time"], "unit": "p.u."},
    {"code": "initial_cluster_status", "name": "集群初始状态", "dimension": ["cluster"], "unit": "0/1"},
    {"code": "cluster_start_cost", "name": "集群启动成本", "dimension": ["cluster"], "unit": "元/次"},
    {"code": "facility_aux_load", "name": "园区固定辅助负荷", "dimension": ["time"], "unit": "MW"},
    {"code": "pv_forecast", "name": "光伏预测出力", "dimension": ["time"], "unit": "MW"},
    {"code": "electricity_price", "name": "购电价格", "dimension": ["time"], "unit": "元/MWh"},
    {"code": "grid_carbon_factor", "name": "电网碳排因子", "dimension": ["time"], "unit": "tCO2/MWh"},
    {"code": "grid_power_limit", "name": "电网接入上限", "dimension": ["time"], "unit": "MW"},
    {"code": "carbon_price", "name": "碳价格", "dimension": [], "unit": "元/tCO2"},
    {"code": "demand_charge_price", "name": "最大需量价格", "dimension": [], "unit": "元/MW"},
    {"code": "curtailment_penalty", "name": "弃光惩罚", "dimension": [], "unit": "元/MWh"},
    {"code": "storage_power_capacity", "name": "储能功率容量", "dimension": [], "unit": "MW"},
    {"code": "storage_energy_capacity", "name": "储能能量容量", "dimension": [], "unit": "MWh"},
    {"code": "initial_soc", "name": "初始 SOC", "dimension": [], "unit": "MWh"},
    {"code": "soc_min", "name": "SOC 下限", "dimension": [], "unit": "MWh"},
    {"code": "soc_max", "name": "SOC 上限", "dimension": [], "unit": "MWh"},
    {"code": "terminal_soc_target", "name": "期末 SOC 目标", "dimension": [], "unit": "MWh"},
    {"code": "charge_efficiency", "name": "充电效率", "dimension": [], "unit": "p.u."},
    {"code": "discharge_efficiency", "name": "放电效率", "dimension": [], "unit": "p.u."},
    {"code": "storage_degradation_cost", "name": "储能损耗成本", "dimension": [], "unit": "元/MWh"},
    {"code": "terminal_soc_penalty", "name": "期末 SOC 偏差惩罚", "dimension": [], "unit": "元/MWh"},
]


COMPUTE_POWER_VARIABLES = [
    {"code": "work_execute", "name": "任务执行量", "dimension": ["workload", "cluster", "time"], "unit": "GPU·h", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "backlog", "name": "任务积压量", "dimension": ["workload", "time_volume"], "unit": "GPU·h", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "sla_slack", "name": "SLA 松弛量", "dimension": ["workload", "time_volume"], "unit": "GPU·h", "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": "slack_limit"},
    {"code": "cluster_on", "name": "集群运行状态", "dimension": ["cluster", "time"], "unit": "0/1", "domain": "Binary"},
    {"code": "cluster_start", "name": "集群启动状态", "dimension": ["cluster", "time"], "unit": "0/1", "domain": "Binary"},
    {"code": "cluster_gpu_used", "name": "集群 GPU 使用量", "dimension": ["cluster", "time"], "unit": "GPU", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "cluster_power", "name": "集群设施功率", "dimension": ["cluster", "time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "dc_power", "name": "智算园区算力功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "grid_buy", "name": "电网购电功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "pv_used", "name": "光伏利用功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "pv_curtail", "name": "弃光功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "charge", "name": "储能充电功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "discharge", "name": "储能放电功率", "dimension": ["time"], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "soc", "name": "储能 SOC", "dimension": ["time_volume"], "unit": "MWh", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "is_charging", "name": "储能充电状态", "dimension": ["time"], "unit": "0/1", "domain": "Binary"},
    {"code": "is_discharging", "name": "储能放电状态", "dimension": ["time"], "unit": "0/1", "domain": "Binary"},
    {"code": "grid_peak", "name": "最大电网购电功率", "dimension": [], "unit": "MW", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "terminal_soc_dev_pos", "name": "期末 SOC 正偏差", "dimension": [], "unit": "MWh", "domain": "NonNegativeReals", "lower_bound": 0},
    {"code": "terminal_soc_dev_neg", "name": "期末 SOC 负偏差", "dimension": [], "unit": "MWh", "domain": "NonNegativeReals", "lower_bound": 0},
]


PROGRAMMATIC_CONSTRAINTS = [
    ("workload_backlog_balance", "任务积压递推", "backlog[w,t+1] == backlog[w,t] + work_arrival[w,t] - sum(work_execute[w,c,t] for c in cluster)"),
    ("workload_sla_limit", "SLA 与截止时间", "backlog[w,tv] <= allowed_backlog[w,tv] + sla_slack[w,tv]"),
    ("cluster_capacity", "GPU 集群容量", "sum(work_execute[w,c,t] for w in workload) <= gpu_capacity[c,t] * delta_t * cluster_on[c,t]"),
    ("cluster_compatibility", "任务集群兼容性", "work_execute[w,c,t] <= cluster_compatibility[w,c] * gpu_capacity[c,t] * delta_t"),
    ("cluster_power_conversion", "算力功率转换", "cluster_power[c,t] == pue[c,t] * (idle_power[c] * cluster_on[c,t] + gpu_dynamic_power[c] * cluster_gpu_used[c,t])"),
    ("pv_available_balance", "光伏出力分解", "pv_used[t] + pv_curtail[t] == pv_forecast[t]"),
    ("storage_soc_balance", "储能 SOC 递推", "soc[t+1] == soc[t] + charge_efficiency * charge[t] * delta_t - discharge[t] / discharge_efficiency * delta_t"),
    ("storage_exclusivity", "储能充放电互斥", "is_charging[t] + is_discharging[t] <= 1"),
    ("facility_energy_balance", "园区功率平衡", "grid_buy[t] + pv_used[t] + discharge[t] == dc_power[t] + facility_aux_load[t] + charge[t]"),
    ("grid_power_limit", "电网接入与最大需量", "grid_buy[t] <= grid_power_limit[t] and grid_peak >= grid_buy[t]"),
]


def _parameter_dimensions(context: dict[str, Any]) -> dict[str, list[str]]:
    return {
        str(item.get("code") or item.get("key") or item.get("name")): list(item.get("dimension") or item.get("indices") or [])
        for item in (context.get("model_spec") or {}).get("parameters", [])
    }


def _runtime_value(context: dict[str, Any], key: str, *indices: Any, default: Any = _MISSING) -> Any:
    params = context.get("runtime_parameters") or {}
    raw = params.get(key, _MISSING)
    if raw is _MISSING:
        if default is not _MISSING:
            return default
        raise RuntimeError(f"算电协同参数缺失：{key}")
    dimensions = _parameter_dimensions(context).get(key, [])
    current = raw
    for position, index in enumerate(indices):
        if isinstance(current, dict):
            if index in current:
                current = current[index]
            elif str(index) in current:
                current = current[str(index)]
            else:
                raise RuntimeError(f"算电协同参数 {key} 缺少索引 {index}")
        elif isinstance(current, (list, tuple)):
            dimension = dimensions[position] if position < len(dimensions) else ""
            labels = list((context.get("sets") or {}).get(dimension) or [])
            try:
                item_position = labels.index(index) if labels and index in labels else int(index)
                current = current[item_position]
            except (ValueError, TypeError, IndexError) as exc:
                raise RuntimeError(f"算电协同参数 {key} 无法解析索引 {index}") from exc
        elif indices:
            # Scalar parameters are broadcast across requested indices.
            break
    return current


def _number(context: dict[str, Any], key: str, *indices: Any, default: Any = _MISSING) -> float:
    value = _runtime_value(context, key, *indices, default=default)
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        suffix = f"[{','.join(map(str, indices))}]" if indices else ""
        raise RuntimeError(f"算电协同参数 {key}{suffix} 必须是数值，实际为 {value!r}") from exc


def _add_constraint(context: dict[str, Any], name: str, constraint: Any) -> None:
    context.setdefault("constraints", {})[name] = constraint


@register_component("compute_power_coordination_core")
class ComputePowerCoordinationCore:
    display_name = "算电协同联合优化核心组件"
    description = "统一构建算力任务积压、GPU 集群容量与启停、功耗、光伏、储能和电网购电约束。"
    category = "算电协同组件"
    formula = "算力任务排程 + 光伏消纳 + 储能调度 + 电网购电联合平衡"
    required_parameters = [item["code"] for item in COMPUTE_POWER_PARAMETERS]

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        sets = context.get("sets") or {}
        times = list(sets.get("time") or [])
        state_times = list(sets.get("time_volume") or [])
        workloads = list(sets.get("workload") or [])
        clusters = list(sets.get("cluster") or [])
        if not times or not workloads or not clusters:
            raise RuntimeError("算电协同模型的 time、workload 和 cluster 集合不能为空。")
        if len(state_times) != len(times) + 1:
            raise RuntimeError("算电协同模型要求 time_volume 长度等于 time 长度加 1。")
        if _number(context, "delta_t") <= 0:
            raise RuntimeError("delta_t 必须大于 0。")
        charge_efficiency = _number(context, "charge_efficiency")
        discharge_efficiency = _number(context, "discharge_efficiency")
        if not 0 < charge_efficiency <= 1 or not 0 < discharge_efficiency <= 1:
            raise RuntimeError("储能充放电效率必须位于 (0, 1]。")
        soc_min = _number(context, "soc_min")
        soc_max = _number(context, "soc_max")
        initial_soc = _number(context, "initial_soc")
        terminal_soc_target = _number(context, "terminal_soc_target")
        if soc_min < 0 or soc_max < soc_min:
            raise RuntimeError("SOC 上下限不合法。")
        if not soc_min <= initial_soc <= soc_max:
            raise RuntimeError("initial_soc 必须位于 SOC 上下限内。")
        if not soc_min <= terminal_soc_target <= soc_max:
            raise RuntimeError("terminal_soc_target 必须位于 SOC 上下限内。")
        if _number(context, "storage_energy_capacity") < soc_max:
            raise RuntimeError("storage_energy_capacity 不能小于 soc_max。")
        for workload in workloads:
            if _number(context, "initial_backlog", workload) < 0:
                raise RuntimeError(f"任务池 {workload} 的初始积压量不能为负。")
            for state_time in state_times:
                if _number(context, "allowed_backlog", workload, state_time) < 0:
                    raise RuntimeError(f"任务池 {workload} 的允许积压量不能为负。")
                if _number(context, "slack_limit", workload, state_time) < 0:
                    raise RuntimeError(f"任务池 {workload} 的 SLA 松弛上限不能为负。")
            for cluster in clusters:
                compatibility = _number(context, "cluster_compatibility", workload, cluster)
                if compatibility not in {0.0, 1.0}:
                    raise RuntimeError(f"任务池 {workload} 与集群 {cluster} 的兼容性必须为 0 或 1。")
        for cluster in clusters:
            if _number(context, "pue", cluster, times[0]) < 1:
                raise RuntimeError(f"集群 {cluster} 的 PUE 不能小于 1。")
            status = _number(context, "initial_cluster_status", cluster)
            if status not in {0.0, 1.0}:
                raise RuntimeError(f"集群 {cluster} 的初始状态必须为 0 或 1。")

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        times = list(context["sets"]["time"])
        state_times = list(context["sets"]["time_volume"])
        first_time = times[0]
        first_state = state_times[0]
        terminal_state = state_times[-1]
        time_position = {label: position for position, label in enumerate(times)}
        delta_t = _number(context, "delta_t")

        model.compute_initial_backlog = pyo.Constraint(
            model.workload,
            rule=lambda m, w: m.backlog[w, first_state] == _number(context, "initial_backlog", w),
        )

        def backlog_rule(m: Any, w: Any, t: Any) -> Any:
            next_state = state_times[time_position[t] + 1]
            return m.backlog[w, next_state] == m.backlog[w, state_times[time_position[t]]] + _number(context, "work_arrival", w, t) - sum(
                m.work_execute[w, c, t] for c in m.cluster
            )

        model.compute_backlog_balance = pyo.Constraint(model.workload, model.time, rule=backlog_rule)
        model.compute_sla_limit = pyo.Constraint(
            model.workload,
            model.time_volume,
            rule=lambda m, w, tv: m.backlog[w, tv] <= _number(context, "allowed_backlog", w, tv) + m.sla_slack[w, tv],
        )
        model.compute_compatibility = pyo.Constraint(
            model.workload,
            model.cluster,
            model.time,
            rule=lambda m, w, c, t: m.work_execute[w, c, t]
            <= _number(context, "cluster_compatibility", w, c) * _number(context, "gpu_capacity", c, t) * delta_t,
        )
        model.compute_cluster_capacity = pyo.Constraint(
            model.cluster,
            model.time,
            rule=lambda m, c, t: sum(m.work_execute[w, c, t] for w in m.workload)
            <= _number(context, "gpu_capacity", c, t) * delta_t * m.cluster_on[c, t],
        )
        model.compute_gpu_used = pyo.Constraint(
            model.cluster,
            model.time,
            rule=lambda m, c, t: m.cluster_gpu_used[c, t] * delta_t == sum(m.work_execute[w, c, t] for w in m.workload),
        )

        def cluster_start_rule(m: Any, c: Any, t: Any) -> Any:
            position = time_position[t]
            previous = _number(context, "initial_cluster_status", c) if position == 0 else m.cluster_on[c, times[position - 1]]
            return m.cluster_start[c, t] >= m.cluster_on[c, t] - previous

        model.compute_cluster_start = pyo.Constraint(model.cluster, model.time, rule=cluster_start_rule)
        model.compute_cluster_start_link = pyo.Constraint(
            model.cluster,
            model.time,
            rule=lambda m, c, t: m.cluster_start[c, t] <= m.cluster_on[c, t],
        )
        model.compute_cluster_power = pyo.Constraint(
            model.cluster,
            model.time,
            rule=lambda m, c, t: m.cluster_power[c, t]
            == _number(context, "pue", c, t)
            * (
                _number(context, "idle_power", c) * m.cluster_on[c, t]
                + _number(context, "gpu_dynamic_power", c) * m.cluster_gpu_used[c, t]
            ),
        )
        model.compute_dc_power = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.dc_power[t] == sum(m.cluster_power[c, t] for c in m.cluster),
        )

        model.compute_pv_balance = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.pv_used[t] + m.pv_curtail[t] == _number(context, "pv_forecast", t),
        )
        model.compute_initial_soc = pyo.Constraint(expr=model.soc[first_state] == _number(context, "initial_soc"))

        def soc_rule(m: Any, t: Any) -> Any:
            position = time_position[t]
            current_state = state_times[position]
            next_state = state_times[position + 1]
            return m.soc[next_state] == m.soc[current_state] + _number(context, "charge_efficiency") * m.charge[t] * delta_t - m.discharge[t] / _number(
                context, "discharge_efficiency"
            ) * delta_t

        model.compute_soc_balance = pyo.Constraint(model.time, rule=soc_rule)
        model.compute_soc_lower = pyo.Constraint(
            model.time_volume,
            rule=lambda m, tv: m.soc[tv] >= _number(context, "soc_min"),
        )
        model.compute_soc_upper = pyo.Constraint(
            model.time_volume,
            rule=lambda m, tv: m.soc[tv] <= _number(context, "soc_max"),
        )
        model.compute_charge_link = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.charge[t] <= _number(context, "storage_power_capacity") * m.is_charging[t],
        )
        model.compute_discharge_link = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.discharge[t] <= _number(context, "storage_power_capacity") * m.is_discharging[t],
        )
        model.compute_storage_exclusive = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.is_charging[t] + m.is_discharging[t] <= 1,
        )
        model.compute_terminal_soc = pyo.Constraint(
            expr=model.soc[terminal_state] + model.terminal_soc_dev_pos - model.terminal_soc_dev_neg == _number(context, "terminal_soc_target")
        )
        model.compute_energy_balance = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.grid_buy[t] + m.pv_used[t] + m.discharge[t]
            == m.dc_power[t] + _number(context, "facility_aux_load", t) + m.charge[t],
        )
        model.compute_grid_limit = pyo.Constraint(
            model.time,
            rule=lambda m, t: m.grid_buy[t] <= _number(context, "grid_power_limit", t),
        )
        model.compute_grid_peak = pyo.Constraint(model.time, rule=lambda m, t: m.grid_peak >= m.grid_buy[t])

        for name in (
            "compute_initial_backlog",
            "compute_backlog_balance",
            "compute_sla_limit",
            "compute_compatibility",
            "compute_cluster_capacity",
            "compute_gpu_used",
            "compute_cluster_start",
            "compute_cluster_start_link",
            "compute_cluster_power",
            "compute_dc_power",
            "compute_pv_balance",
            "compute_initial_soc",
            "compute_soc_balance",
            "compute_soc_lower",
            "compute_soc_upper",
            "compute_charge_link",
            "compute_discharge_link",
            "compute_storage_exclusive",
            "compute_terminal_soc",
            "compute_energy_balance",
            "compute_grid_limit",
            "compute_grid_peak",
        ):
            _add_constraint(context, name, getattr(model, name))
        context.setdefault("metadata", {})["compute_power_coordination"] = {
            "single_model": True,
            "workload_count": len(list(model.workload)),
            "cluster_count": len(list(model.cluster)),
            "horizon": len(times),
        }

    def explain(self) -> dict[str, Any]:
        constraints = [
            {
                "constraint_id": constraint_id,
                "name": name,
                "expression": expression,
                "formula": expression,
                "dsl_formula": expression,
                "generation_mode": "programmatic",
                "programmatic": True,
                "solve_participation": "solve_active",
                "supported_by_backend": True,
                "business_meaning": name,
            }
            for constraint_id, name, expression in PROGRAMMATIC_CONSTRAINTS
        ]
        return {
            "component_id": "compute_power_coordination_core",
            "type": "compute_power_coordination_core",
            "name": self.display_name,
            "display_name": self.display_name,
            "domain": "算电协同",
            "category": self.category,
            "version": "1.0.0",
            "status": "published",
            "backend_builder": "compute_power_coordination_core",
            "sets": deepcopy(COMPUTE_POWER_SETS),
            "required_sets": deepcopy(COMPUTE_POWER_SETS),
            "parameters": deepcopy(COMPUTE_POWER_PARAMETERS),
            "variables": deepcopy(COMPUTE_POWER_VARIABLES),
            "generated_constraints": constraints,
            "generated_objective_terms": [],
            "problem_type": "MILP",
            "problem_types": ["MILP"],
            "solver_capabilities": ["MILP"],
            "description": self.description,
            "math_template": {"formula": self.formula, "business_meaning": self.description},
            "outputs": ["work_execute", "backlog", "dc_power", "grid_buy", "pv_used", "pv_curtail", "charge", "discharge", "soc"],
        }
