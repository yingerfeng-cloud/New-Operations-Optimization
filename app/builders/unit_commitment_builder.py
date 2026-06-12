from __future__ import annotations

from typing import Any


def unit_commitment_template() -> dict[str, Any]:
    return {
        "model_code": "unit_commitment_day_ahead",
        "industry": "power",
        "scenario": "day-ahead unit commitment",
        "business_objects": [
            {"code": "thermal_unit", "name": "机组", "object_type": "unit", "source_system": "EAM"},
            {"code": "dispatch_time", "name": "时段", "object_type": "time", "source_system": "dispatch_plan"},
            {"code": "system_load", "name": "系统负荷", "object_type": "load", "source_system": "forecast"},
            {"code": "renewable_site", "name": "新能源场站", "object_type": "renewable_site", "source_system": "renewable_forecast"},
        ],
        "sets": [
            {"code": "unit", "name": "机组集合", "values": ["U1", "U2", "U3"], "source_system": "EAM"},
            {"code": "time", "name": "时段集合", "values": list(range(24)), "source_system": "dispatch_plan"},
        ],
        "parameters": [
            {"code": "load_forecast", "name": "负荷预测", "unit": "MW", "dimension": ["time"], "source_system": "forecast", "runtime_injected": True, "validation": {"type": "array", "length_ref": "horizon", "min": 0}},
            {"code": "renewable_forecast", "name": "新能源预测", "unit": "MW", "dimension": ["time"], "source_system": "renewable_forecast", "runtime_injected": True, "validation": {"type": "array", "length_ref": "horizon", "min": 0}},
            {"code": "unit_min_output", "name": "机组最小出力", "unit": "MW", "dimension": ["unit"], "source_system": "EAM", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "unit_max_output", "name": "机组最大出力", "unit": "MW", "dimension": ["unit"], "source_system": "EAM", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "ramp_up_limit", "name": "上爬坡限制", "unit": "MW/h", "dimension": ["unit"], "source_system": "EAM", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "ramp_down_limit", "name": "下爬坡限制", "unit": "MW/h", "dimension": ["unit"], "source_system": "EAM", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "fuel_cost", "name": "燃料成本", "unit": "元/MWh", "dimension": ["unit"], "source_system": "cost_system", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "startup_cost", "name": "启停成本", "unit": "元/次", "dimension": ["unit"], "source_system": "cost_system", "runtime_injected": False, "validation": {"type": "dict", "min": 0}},
            {"code": "initial_unit_status", "name": "初始启停状态", "unit": "0/1", "dimension": ["unit"], "source_system": "realtime", "runtime_injected": True, "validation": {"type": "dict", "binary": True}},
        ],
        "variables": [
            {"code": "unit_output", "name": "机组出力", "unit": "MW", "dimension": ["unit", "time"], "domain": "NonNegativeReals"},
            {"code": "unit_on", "name": "机组开停机状态", "unit": "0/1", "dimension": ["unit", "time"], "domain": "Binary"},
            {"code": "unit_startup", "name": "机组启动状态", "unit": "0/1", "dimension": ["unit", "time"], "domain": "Binary"},
        ],
        "constraints": [
            {"code": "power_balance", "name": "功率平衡", "description": "总出力加新能源预测满足系统负荷", "hard": True, "relaxable": False, "expression": "sum(unit_output[unit,time]) + renewable_forecast[time] >= load_forecast[time]", "indices": ["time"]},
            {"code": "ramp_limit", "name": "爬坡约束", "description": "相邻时段机组出力变化不能超过爬坡能力", "hard": True, "relaxable": True, "expression": "-ramp_down_limit[unit] <= delta(unit_output) <= ramp_up_limit[unit]", "indices": ["unit", "time"]},
            {"code": "startup_logic", "name": "启动逻辑", "description": "停机转在线时必须触发启动变量", "hard": True, "relaxable": False, "expression": "unit_startup[unit,time] >= unit_on[unit,time] - unit_on[unit,time-1]", "indices": ["unit", "time"]},
            {"code": "reserve_margin", "name": "备用约束", "description": "在线容量满足负荷和备用要求", "hard": True, "relaxable": True, "expression": "sum(unit_max_output[unit]*unit_on[unit,time]) + renewable_forecast[time] >= load_forecast[time]*(1+reserve_ratio)", "indices": ["time"]},
        ],
        "objectives": [
            {"code": "total_cost_min", "name": "总成本最小", "sense": "minimize", "expression": "sum(fuel_cost[unit]*unit_output[unit,time] + startup_cost[unit]*unit_startup[unit,time])", "weights": {"fuel_cost": 1.0, "startup_cost": 1.0}},
            {"code": "renewable_curtailment_min", "name": "弃新能源最小", "sense": "minimize", "expression": "minimize curtailment", "weights": {}},
            {"code": "carbon_emission_min", "name": "碳排放最小", "sense": "minimize", "expression": "minimize emission", "weights": {}},
            {"code": "profit_max", "name": "收益最大", "sense": "maximize", "expression": "maximize profit", "weights": {}},
        ],
    }


def build_unit_commitment_model(data: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    import pyomo.environ as pyo

    units = list(data.get("unit", data.get("units", ["U1", "U2", "U3"])))
    horizon = int(data.get("horizon") or len(data.get("time", [])) or len(data.get("load_forecast", [])) or 24)
    times = list(data.get("time", list(range(horizon))))[:horizon] or list(range(horizon))

    load = _series_param(data.get("load_forecast"), times, 180.0)
    renewable = _series_param(data.get("renewable_forecast"), times, 0.0)
    p_min = _dict_param(data.get("unit_min_output"), units, 20.0)
    p_max = _dict_param(data.get("unit_max_output"), units, 100.0)
    fuel_cost = _dict_param(data.get("fuel_cost"), units, 280.0)
    startup_cost = _dict_param(data.get("startup_cost"), units, 1200.0)
    ramp_up = _dict_param(data.get("ramp_up_limit"), units, 50.0)
    ramp_down = _dict_param(data.get("ramp_down_limit"), units, 50.0)
    initial_status = _dict_param(data.get("initial_unit_status"), units, 0.0)
    initial_output = _dict_param(data.get("initial_unit_output"), units, 0.0)
    reserve_ratio = float(data.get("reserve_ratio", 0.1))

    model = pyo.ConcreteModel(name="unit_commitment_day_ahead")
    model.U = pyo.Set(initialize=units)
    model.T = pyo.RangeSet(0, len(times) - 1)
    model.unit_output = pyo.Var(model.U, model.T, within=pyo.NonNegativeReals)
    model.unit_on = pyo.Var(model.U, model.T, within=pyo.Binary)
    model.unit_startup = pyo.Var(model.U, model.T, within=pyo.Binary)

    def power_balance_rule(m: Any, t: int) -> Any:
        return sum(m.unit_output[u, t] for u in m.U) + float(renewable[times[t]]) >= float(load[times[t]])

    def min_output_rule(m: Any, u: str, t: int) -> Any:
        return m.unit_output[u, t] >= float(p_min[u]) * m.unit_on[u, t]

    def max_output_rule(m: Any, u: str, t: int) -> Any:
        return m.unit_output[u, t] <= float(p_max[u]) * m.unit_on[u, t]

    def startup_logic_rule(m: Any, u: str, t: int) -> Any:
        previous_on = float(initial_status[u]) if t == 0 else m.unit_on[u, t - 1]
        return m.unit_startup[u, t] >= m.unit_on[u, t] - previous_on

    def ramp_up_rule(m: Any, u: str, t: int) -> Any:
        previous_output = float(initial_output[u]) if t == 0 else m.unit_output[u, t - 1]
        return m.unit_output[u, t] - previous_output <= float(ramp_up[u])

    def ramp_down_rule(m: Any, u: str, t: int) -> Any:
        previous_output = float(initial_output[u]) if t == 0 else m.unit_output[u, t - 1]
        return previous_output - m.unit_output[u, t] <= float(ramp_down[u])

    def reserve_margin_rule(m: Any, t: int) -> Any:
        return sum(float(p_max[u]) * m.unit_on[u, t] for u in m.U) + float(renewable[times[t]]) >= float(load[times[t]]) * (1.0 + reserve_ratio)

    model.power_balance = pyo.Constraint(model.T, rule=power_balance_rule)
    model.output_min_bound = pyo.Constraint(model.U, model.T, rule=min_output_rule)
    model.output_max_bound = pyo.Constraint(model.U, model.T, rule=max_output_rule)
    model.startup_logic = pyo.Constraint(model.U, model.T, rule=startup_logic_rule)
    model.ramp_up_limit = pyo.Constraint(model.U, model.T, rule=ramp_up_rule)
    model.ramp_down_limit = pyo.Constraint(model.U, model.T, rule=ramp_down_rule)
    model.reserve_margin = pyo.Constraint(model.T, rule=reserve_margin_rule)
    model.objective = pyo.Objective(
        expr=sum(model.unit_output[u, t] * float(fuel_cost[u]) + model.unit_startup[u, t] * float(startup_cost[u]) for u in model.U for t in model.T),
        sense=pyo.minimize,
    )
    context = {
        "model_code": "unit_commitment_day_ahead",
        "units": units,
        "times": times,
        "load": load,
        "renewable": renewable,
        "p_min": p_min,
        "p_max": p_max,
        "fuel_cost": fuel_cost,
        "startup_cost": startup_cost,
        "ramp_up": ramp_up,
        "ramp_down": ramp_down,
        "reserve_ratio": reserve_ratio,
    }
    return model, context


def _series_param(value: Any, times: list[Any], default: float) -> dict[Any, float]:
    if isinstance(value, list):
        return {t: float(value[i]) if i < len(value) else default for i, t in enumerate(times)}
    if isinstance(value, dict):
        return {t: float(value.get(str(t), value.get(t, default))) for t in times}
    return {t: default for t in times}


def _dict_param(value: Any, keys: list[str], default: float) -> dict[str, float]:
    if isinstance(value, dict):
        return {key: float(value.get(str(key), value.get(key, default))) for key in keys}
    return {key: default for key in keys}
