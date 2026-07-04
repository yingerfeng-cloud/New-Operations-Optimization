from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.builders.unit_commitment_builder import unit_commitment_template
from app.model_draft import build_constraints_from_draft, create_model_draft_from_template
from app.model_components.registry import list_component_catalog


TEMPLATE_DISPLAY_NAMES = {
    "unit_commitment_day_ahead": ("日前机组组合优化 Unit Commitment", "日前机组组合优化，生成机组启停、启动和出力计划。"),
    "economic_dispatch": ("经济负荷分配", "已知机组在线状态下分配出力并降低发电成本。"),
    "storage_dispatch": ("储能充放电优化", "根据电价预测优化储能充放电计划。"),
    "renewable_storage_dispatch": ("风光储协同", "优化新能源消纳、弃电和储能配合。"),
    "chp_dispatch": ("热电协同优化", "热电联产机组同时满足电负荷与热负荷。"),
    "cascade_hydro_dispatch": ("梯级水电日前调度优化模型", "梯级水电日前调度，覆盖检修、负荷跟踪、弃水分析和期末库容控制。"),
    "cascade_hydro_dispatch_v1": ("梯级水电调度 v1", "日前/日内梯级水电优化调度，使用 1D PWL + 2D PWL 函数资产构建 MILP。"),
    "pv_storage_capacity_planning": ("光伏场站储能容量配置优化", "光伏场站储能功率与能量容量配置优化。"),
    "pv_storage_day_ahead_dispatch": ("光储协同日前调度", "光储协同日前调度，优化光伏消纳、储能充放电、并网计划跟踪和收益成本。"),
    "pv_storage_intraday_dispatch": ("光储协同日内滚动调度", "光储协同日内滚动调度，使用当前 SOC、最新预测和剩余计划曲线。"),
    "pv_storage_dispatch_v2": ("光储一体化调度 V2", "光储一体化调度 V2，包含偏差考核、充放电互斥、SOC 边界和收益成本项。"),
    "pv_storage_day_ahead_dispatch_v2": ("光储协同日前调度 V2", "光储协同日前调度 V2，包含偏差考核、充放电互斥、SOC 边界和收益成本项。"),
    "pv_storage_intraday_dispatch_v2": ("光储协同日内滚动调度 V2", "光储协同日内滚动调度 V2，支持滚动窗口、SOC 传递和偏差考核。"),
    "nonlinear_hydro_power_demo": ("非线性水电出力 NLP 试点", "连续变量 NLP 样例：power[t] = k * flow[t] * head[t]，用于验证 Ipopt 接入和局部最优风险提示。"),
}


def power_template_library() -> dict[str, dict[str, Any]]:
    templates = {
        "unit_commitment_day_ahead": _with_uc_sample(unit_commitment_template()),
        "economic_dispatch": _economic_dispatch(),
        "storage_dispatch": _storage_dispatch(),
        "renewable_storage_dispatch": _renewable_storage_dispatch(),
        "chp_dispatch": _chp_dispatch(),
        "cascade_hydro_dispatch": _cascade_hydro_dispatch(),
        "cascade_hydro_dispatch_v1": _cascade_hydro_dispatch_v1(),
        "pv_storage_capacity_planning": _pv_storage_capacity_planning(),
        "pv_storage_day_ahead_dispatch": _pv_storage_day_ahead_dispatch(),
        "pv_storage_intraday_dispatch": _pv_storage_intraday_dispatch(),
        "pv_storage_dispatch_v2": _pv_storage_dispatch_v2(),
        "pv_storage_day_ahead_dispatch_v2": _pv_storage_day_ahead_dispatch_v2(),
        "pv_storage_intraday_dispatch_v2": _pv_storage_intraday_dispatch_v2(),
        "nonlinear_hydro_power_demo": _nonlinear_hydro_power_demo(),
    }
    for code, template in templates.items():
        template.setdefault("code", code)
        template.setdefault("model_code", code)
        if code in TEMPLATE_DISPLAY_NAMES:
            name, description = TEMPLATE_DISPLAY_NAMES[code]
            template["name"] = name
            template["display_name"] = name
            template["scenario"] = description
            template["description"] = description
        if code == "pv_storage_intraday_dispatch":
            template["description"] = (
                "光储协同日内滚动调度模板，使用当前 SOC、最新预测和日前计划剩余曲线求解短窗口；"
                "rolling_horizon、current_time 和窗口滚动逻辑由滚动运行服务处理。"
            )
            template.setdefault("ui_metadata", {})["capability_boundary"] = template["description"]
        if code == "pv_storage_capacity_planning":
            _normalize_pv_storage_capacity_template(template)
        _normalize_template_time_sets(template)
        template.setdefault("version", "v1.0")
        template.setdefault("status", "published")
        template.setdefault("tags", ["power", "HiGHS", "Pyomo"])
        draft = create_model_draft_from_template(template)
        template["model_draft"] = draft
        template["sets"] = deepcopy((draft.get("semantic") or {}).get("sets") or template.get("sets") or [])
        template["mathematical_expansion"] = draft["mathematical_expansion"]
        template["draft_constraints"] = build_constraints_from_draft(draft)
        template["objective_config"] = draft["objective"]
        if template.get("build_mode") == "component_based":
            template["component_spec"] = draft["advanced"]["component_spec"]
            template["component_schema"] = {
                **(template.get("component_schema") or {}),
                "components": list_component_catalog(),
            }
    return templates


def _normalize_template_time_sets(template: dict[str, Any]) -> None:
    sample = template.get("sample_runtime_parameters") or {}
    horizon = sample.get("horizon") or len(sample.get("time") or [])
    granularity = None
    if sample.get("time_step_seconds") is not None:
        granularity = float(sample["time_step_seconds"]) / 60
    elif sample.get("delta_t") is not None:
        granularity = float(sample["delta_t"]) * 60
    else:
        granularity = 60

    def normalize(rows: list[dict[str, Any]]) -> None:
        for item in rows or []:
            code = item.get("code") or item.get("key")
            if code == "time":
                item["type"] = "time_period"
                if horizon:
                    item["horizon"] = int(horizon)
                item["time_granularity"] = item.get("time_granularity") or granularity
                item.setdefault("time_unit", "minute")
            elif code in {"time_volume", "state_time", "soc_time"}:
                item["type"] = "state_time"
                item.setdefault("base_set", "time")
                item.setdefault("generation_rule", "horizon_plus_1")

    normalize(template.get("sets") or [])
    component_spec = template.get("component_spec") or {}
    normalize(component_spec.get("sets") or [])


def get_power_templates() -> dict[str, dict[str, Any]]:
    return power_template_library()


def get_template(code: str) -> dict[str, Any]:
    return deepcopy(power_template_library()[code])


def _normalize_pv_storage_capacity_template(template: dict[str, Any]) -> None:
    sample = template.setdefault("sample_runtime_parameters", {})
    sample.pop("storage_power_capacity", None)
    sample.pop("storage_energy_capacity", None)
    sample.setdefault("max_storage_power_capacity", 80)
    sample.setdefault("max_storage_energy_capacity", 160)
    template["parameters"] = [
        param
        for param in template.get("parameters", [])
        if param.get("code") not in {"storage_power_capacity", "storage_energy_capacity"}
    ]
    existing = {param.get("code") for param in template.get("parameters", [])}
    if "max_storage_power_capacity" not in existing:
        template.setdefault("parameters", []).append(
            _param("max_storage_power_capacity", "Max storage power capacity", "MW", [], "asset_limit", sample["max_storage_power_capacity"], {"type": "number", "min": 0})
        )
    if "max_storage_energy_capacity" not in existing:
        template.setdefault("parameters", []).append(
            _param("max_storage_energy_capacity", "Max storage energy capacity", "MWh", [], "asset_limit", sample["max_storage_energy_capacity"], {"type": "number", "min": 0})
        )


def parameter_schema(template: dict[str, Any]) -> list[dict[str, Any]]:
    samples = template.get("sample_runtime_parameters", {})
    rows = []
    for param in template.get("parameters", []):
        code = param["code"]
        rows.append(
            {
                "code": code,
                "name": param.get("name", code),
                "unit": param.get("unit", ""),
                "dimension": param.get("dimension", []),
                "source_system": param.get("source_system", ""),
                "required": param.get("required", True),
                "default": param.get("default"),
                "example": samples.get(code),
                "validation": param.get("validation", {}),
            }
        )
    return rows


def _base(code: str, name: str, scenario: str, tags: list[str]) -> dict[str, Any]:
    return {
        "model_code": code,
        "code": code,
        "name": name,
        "scenario": scenario,
        "version": "v1.0",
        "status": "published",
        "tags": tags,
        "business_objects": [
            {"code": "unit", "name": "机组", "object_type": "unit", "source_system": "EAM"},
            {"code": "time", "name": "时段", "object_type": "time", "source_system": "dispatch_plan"},
        ],
    }


def _param(code: str, name: str, unit: str, dimension: list[str], source: str, sample: Any, validation: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "name": name,
        "unit": unit,
        "dimension": dimension,
        "source_system": source,
        "runtime_injected": True,
        "required": True,
        "default": None,
        "sample": sample,
        "validation": validation or {},
    }


def _var(code: str, name: str, unit: str, dimension: list[str], domain: str = "NonNegativeReals") -> dict[str, Any]:
    return {"code": code, "name": name, "unit": unit, "dimension": dimension, "domain": domain}


def _constraint(code: str, name: str, expression: str, indices: list[str], relaxable: bool = False) -> dict[str, Any]:
    return {"code": code, "name": name, "description": name, "hard": True, "relaxable": relaxable, "expression": expression, "indices": indices}


def _objective(code: str, name: str, sense: str, expression: str) -> dict[str, Any]:
    return {"code": code, "name": name, "sense": sense, "expression": expression, "weights": {}}


def _with_uc_sample(template: dict[str, Any]) -> dict[str, Any]:
    template["name"] = "日前机组组合优化 Unit Commitment"
    template["scenario"] = "日前机组组合优化"
    template["sample_runtime_parameters"] = {
        "horizon": 4,
        "load_forecast": [120, 180, 210, 160],
        "renewable_forecast": [20, 30, 40, 20],
        "initial_unit_status": {"U1": 1, "U2": 0, "U3": 0},
        "initial_unit_output": {"U1": 80, "U2": 0, "U3": 0},
    }
    template["description"] = "Day-ahead unit commitment optimization for unit on/off, startup, and output planning."
    return template


def _economic_dispatch() -> dict[str, Any]:
    sample = {
        "unit": ["U1", "U2", "U3"],
        "horizon": 4,
        "load_forecast": [160, 190, 175, 150],
        "unit_min_output": {"U1": 30, "U2": 20, "U3": 10},
        "unit_max_output": {"U1": 120, "U2": 90, "U3": 70},
        "fuel_cost": {"U1": 220, "U2": 260, "U3": 360},
        "ramp_up_limit": {"U1": 80, "U2": 60, "U3": 50},
        "ramp_down_limit": {"U1": 80, "U2": 60, "U3": 50},
        "initial_unit_output": {"U1": 80, "U2": 50, "U3": 30},
    }
    t = _base("economic_dispatch", "Economic dispatch", "Allocate online unit output while minimizing generation cost.", ["power", "economic_dispatch", "LP"])
    t.update(
        sets=[{"code": "unit", "name": "机组集合", "values": sample["unit"]}, {"code": "time", "name": "时段集合", "values": list(range(4))}],
        parameters=[
            _param("load_forecast", "负荷预测", "MW", ["time"], "forecast", sample["load_forecast"], {"type": "array", "min": 0}),
            _param("unit_min_output", "机组最小出力", "MW", ["unit"], "EAM", sample["unit_min_output"], {"type": "dict", "min": 0}),
            _param("unit_max_output", "机组最大出力", "MW", ["unit"], "EAM", sample["unit_max_output"], {"type": "dict", "min": 0}),
            _param("fuel_cost", "燃料成本", "元/MWh", ["unit"], "cost_system", sample["fuel_cost"], {"type": "dict", "min": 0}),
            _param("ramp_up_limit", "上爬坡限制", "MW/h", ["unit"], "EAM", sample["ramp_up_limit"], {"type": "dict", "min": 0}),
            _param("ramp_down_limit", "下爬坡限制", "MW/h", ["unit"], "EAM", sample["ramp_down_limit"], {"type": "dict", "min": 0}),
        ],
        variables=[_var("unit_output", "机组出力", "MW", ["unit", "time"])],
        constraints=[
            _constraint("power_balance", "功率平衡", "sum(unit_output[unit,time]) == load_forecast[time]", ["time"]),
            _constraint("output_bounds", "Output bounds", "unit_min_output[unit] <= unit_output[unit,time] <= unit_max_output[unit]", ["unit", "time"]),
            _constraint("ramp_limit", "爬坡约束", "delta(unit_output) within ramp limits", ["unit", "time"], True),
        ],
        objectives=[_objective("total_generation_cost_min", "Min total generation cost", "minimize", "sum(fuel_cost[unit]*unit_output[unit,time])")],
        sample_runtime_parameters=sample,
    )
    return t


def _storage_dispatch() -> dict[str, Any]:
    sample = {
        "storage": ["B1"],
        "horizon": 4,
        "electricity_price": [220, 180, 520, 610],
        "storage_capacity": {"B1": 120},
        "soc_min": {"B1": 10},
        "charge_power_max": {"B1": 40},
        "discharge_power_max": {"B1": 40},
        "charge_efficiency": {"B1": 0.94},
        "discharge_efficiency": {"B1": 0.92},
        "initial_soc": {"B1": 50},
    }
    t = _base("storage_dispatch", "Storage dispatch", "Optimize storage charge and discharge from price forecast.", ["power", "storage", "MILP"])
    t.update(
        sets=[{"code": "storage", "name": "储能集合", "values": sample["storage"]}, {"code": "time", "name": "时段集合", "values": list(range(4))}],
        parameters=[
            _param("electricity_price", "电价", "元/MWh", ["time"], "market", sample["electricity_price"], {"type": "array"}),
            _param("storage_capacity", "储能容量", "MWh", ["storage"], "BMS", sample["storage_capacity"], {"type": "dict", "min": 0}),
            _param("charge_power_max", "最大充电功率", "MW", ["storage"], "BMS", sample["charge_power_max"], {"type": "dict", "min": 0}),
            _param("discharge_power_max", "最大放电功率", "MW", ["storage"], "BMS", sample["discharge_power_max"], {"type": "dict", "min": 0}),
            _param("charge_efficiency", "充电效率", "p.u.", ["storage"], "BMS", sample["charge_efficiency"], {"type": "dict", "min": 0, "max": 1}),
            _param("discharge_efficiency", "放电效率", "p.u.", ["storage"], "BMS", sample["discharge_efficiency"], {"type": "dict", "min": 0, "max": 1}),
            _param("initial_soc", "初始SOC", "MWh", ["storage"], "BMS", sample["initial_soc"], {"type": "dict", "min": 0}),
        ],
        variables=[
            _var("storage_charge", "储能充电", "MW", ["storage", "time"]),
            _var("storage_discharge", "储能放电", "MW", ["storage", "time"]),
            _var("storage_soc", "储能SOC", "MWh", ["storage", "time"]),
            _var("charge_status", "充电状态", "0/1", ["storage", "time"], "Binary"),
            _var("discharge_status", "放电状态", "0/1", ["storage", "time"], "Binary"),
        ],
        constraints=[
            _constraint("soc_balance", "SOC平衡", "soc[t]=soc[t-1]+charge*eta-discharge/eta", ["storage", "time"]),
            _constraint("soc_bounds", "SOC边界", "soc_min <= storage_soc <= storage_capacity", ["storage", "time"]),
            _constraint("charge_discharge_exclusive", "充放电互斥", "charge_status + discharge_status <= 1", ["storage", "time"]),
            _constraint("charge_power_bounds", "充电功率边界", "storage_charge <= charge_power_max*charge_status", ["storage", "time"]),
            _constraint("discharge_power_bounds", "放电功率边界", "storage_discharge <= discharge_power_max*discharge_status", ["storage", "time"]),
        ],
        objectives=[_objective("profit_max", "峰谷套利收益最大", "maximize", "sum(price*(discharge-charge))")],
        sample_runtime_parameters=sample,
    )
    return t


def _renewable_storage_dispatch() -> dict[str, Any]:
    sample = {
        "site": ["PV1", "W1"],
        "storage": ["B1"],
        "horizon": 4,
        "renewable_forecast": {"PV1": [20, 80, 50, 5], "W1": [35, 30, 40, 50]},
        "load_forecast": [60, 90, 85, 70],
        "electricity_price": [260, 300, 520, 460],
        "storage_capacity": {"B1": 80},
        "charge_power_max": {"B1": 30},
        "discharge_power_max": {"B1": 30},
        "initial_soc": {"B1": 30},
        "grid_export_limit": [90, 110, 110, 90],
    }
    t = _base("renewable_storage_dispatch", "风光储协同调度", "优化新能源消纳、弃电和储能协同运行。", ["power", "renewable", "storage", "LP"])
    t.update(
        sets=[{"code": "site", "name": "新能源场站集合", "values": sample["site"]}, {"code": "storage", "name": "储能集合", "values": sample["storage"]}, {"code": "time", "name": "时段集合", "values": list(range(4))}],
        parameters=[
            _param("renewable_forecast", "新能源预测出力", "MW", ["site", "time"], "forecast", sample["renewable_forecast"], {"type": "dict"}),
            _param("load_forecast", "负荷预测", "MW", ["time"], "forecast", sample["load_forecast"], {"type": "array"}),
            _param("electricity_price", "电价", "元/MWh", ["time"], "market", sample["electricity_price"], {"type": "array"}),
            _param("storage_capacity", "储能容量", "MWh", ["storage"], "BMS", sample["storage_capacity"], {"type": "dict"}),
            _param("grid_export_limit", "并网容量", "MW", ["time"], "grid", sample["grid_export_limit"], {"type": "array"}),
        ],
        variables=[
            _var("renewable_used", "新能源利用量", "MW", ["site", "time"]),
            _var("renewable_curtailment", "新能源弃电量", "MW", ["site", "time"]),
            _var("storage_charge", "储能充电", "MW", ["storage", "time"]),
            _var("storage_discharge", "储能放电", "MW", ["storage", "time"]),
            _var("storage_soc", "储能SOC", "MWh", ["storage", "time"]),
        ],
        constraints=[
            _constraint("renewable_balance", "新能源出力平衡", "used + curtailment = forecast", ["site", "time"]),
            _constraint("power_balance", "功率平衡", "renewable_used + discharge = load + charge", ["time"], True),
            _constraint("storage_soc_balance", "储能SOC平衡", "soc transition", ["storage", "time"]),
            _constraint("grid_export_limit", "并网容量约束", "export <= limit", ["time"], True),
        ],
        objectives=[_objective("curtailment_min_profit_max", "弃电最小且收益最大", "minimize", "curtailment_penalty*curtailment - price*export")],
        sample_runtime_parameters=sample,
    )
    return t


def _chp_dispatch() -> dict[str, Any]:
    sample = {
        "unit": ["CHP1", "CHP2"],
        "horizon": 4,
        "electric_load": [80, 90, 85, 75],
        "heat_load": [100, 110, 105, 95],
        "fuel_cost": {"CHP1": 240, "CHP2": 300},
        "electric_min": {"CHP1": 20, "CHP2": 10},
        "electric_max": {"CHP1": 90, "CHP2": 70},
        "heat_min": {"CHP1": 30, "CHP2": 20},
        "heat_max": {"CHP1": 120, "CHP2": 90},
        "heat_to_power_ratio_min": {"CHP1": 0.8, "CHP2": 0.7},
        "heat_to_power_ratio_max": {"CHP1": 2.0, "CHP2": 2.5},
    }
    t = _base("chp_dispatch", "CHP dispatch", "Coordinate electric and heat load with CHP units.", ["power", "CHP", "LP"])
    t.update(
        sets=[{"code": "unit", "name": "热电机组", "values": sample["unit"]}, {"code": "time", "name": "时段集合", "values": list(range(4))}],
        parameters=[
            _param("electric_load", "Electric load", "MW", ["time"], "forecast", sample["electric_load"], {"type": "array"}),
            _param("heat_load", "Heat load", "MWth", ["time"], "forecast", sample["heat_load"], {"type": "array"}),
            _param("fuel_cost", "燃料成本", "元/MWh", ["unit"], "cost_system", sample["fuel_cost"], {"type": "dict"}),
            _param("electric_min", "最小电出力", "MW", ["unit"], "EAM", sample["electric_min"], {"type": "dict"}),
            _param("electric_max", "最大电出力", "MW", ["unit"], "EAM", sample["electric_max"], {"type": "dict"}),
            _param("heat_min", "最小热出力", "MWth", ["unit"], "EAM", sample["heat_min"], {"type": "dict"}),
            _param("heat_max", "最大热出力", "MWth", ["unit"], "EAM", sample["heat_max"], {"type": "dict"}),
        ],
        variables=[_var("electric_output", "Electric output", "MW", ["unit", "time"]), _var("heat_output", "Heat output", "MWth", ["unit", "time"])],
        constraints=[
            _constraint("electric_balance", "Electric balance", "sum(electric_output)=electric_load", ["time"]),
            _constraint("heat_balance", "Heat balance", "sum(heat_output)=heat_load", ["time"]),
            _constraint("electric_heat_feasible_region", "Electric-heat feasible region", "ratio_min*P <= H <= ratio_max*P", ["unit", "time"], True),
        ],
        objectives=[_objective("total_cost_min", "Min total cost", "minimize", "sum(fuel_cost*(electric_output+heat_output*0.5))")],
        sample_runtime_parameters=sample,
    )
    return t


def _pv_storage_capacity_planning() -> dict[str, Any]:
    sample = {
        "horizon": 4,
        "time": [0, 1, 2, 3],
        "time_volume": [0, 1, 2, 3, 4],
        "pv_forecast": [20, 100, 80, 10],
        "grid_limit": [70, 70, 70, 70],
        "eta_ch": 0.95,
        "eta_dis": 0.95,
        "delta_t": 1,
        "soc_min": 0.1,
    }
    components = [
        {"type": "pv_available_output"},
        {"type": "storage_capacity_decision"},
        {"type": "storage_soc_balance"},
        {"type": "pv_storage_power_balance"},
        {"type": "grid_power_limit"},
    ]
    return _pv_storage_component_template(
        "pv_storage_capacity_planning",
        "光伏场站储能容量配置优化",
        "Storage sizing optimization for renewable sites, using component library constraints for capacity, curtailment, SOC, and investment benefit.",
        components,
        sample,
        "MILP",
    )


def _pv_storage_day_ahead_dispatch() -> dict[str, Any]:
    sample = {
        "horizon": 4,
        "time": [0, 1, 2, 3],
        "time_volume": [0, 1, 2, 3, 4],
        "pv_forecast": [20, 100, 80, 10],
        "grid_limit": [90, 90, 90, 90],
        "schedule": [40, 80, 70, 30],
        "eta_ch": 0.95,
        "eta_dis": 0.95,
        "delta_t": 1,
    }
    components = [
        {"type": "pv_available_output"},
        {"type": "storage_soc_balance"},
        {"type": "pv_storage_power_balance"},
        {"type": "grid_power_limit"},
        {"type": "schedule_tracking"},
    ]
    return _pv_storage_component_template(
        "pv_storage_day_ahead_dispatch",
        "鍏夊偍协同日前/日内调度优化",
        "PV-storage dispatch optimization for configured storage, PV utilization, charge/discharge, schedule tracking, and economics.",
        components,
        sample,
        "LP",
    )


def _pv_storage_component_template(code: str, name: str, scenario: str, components: list[dict[str, Any]], sample: dict[str, Any], problem_type: str) -> dict[str, Any]:
    component_spec = {
        "model_code": code,
        "build_mode": "component_based",
        "name": name,
        "model_problem_type": problem_type,
        "required_solver_capabilities": ["LP"] if problem_type == "LP" else ["LP", "MILP"],
        "sets": [
            {"code": "time", "name": "调度时段", "values": sample["time"]},
            {"code": "time_volume", "name": "SOC时点", "values": sample["time_volume"]},
        ],
        "variables": [],
        "components": components,
        "objective": {
            "type": "weighted_sum",
            "sense": "minimize",
            "terms": [
                {
                    "term_id": "pv_storage_business_objective",
                    "name": "光储综合收益/成本目标",
                    "expression": "收益、弃光、投资成本和偏差考核按场景权重配置",
                    "weight_key": "pv_storage_business",
                    "solve_participation": "display_only",
                    "supported_by_backend": False,
                    "enabled": True,
                }
            ],
        },
        "ui_language": "zh-CN",
    }
    return {
        "model_code": code,
        "code": code,
        "name": name,
        "scenario": scenario,
        "description": scenario,
        "version": "v1.0",
        "status": "trial",
        "solver": "HiGHS",
        "build_mode": "component_based",
        "model_problem_type": problem_type,
        "problem_type": problem_type,
        "required_solver_capabilities": component_spec["required_solver_capabilities"],
        "tags": ["power", "pv", "storage", "component_based", problem_type],
        "sets": component_spec["sets"],
        "parameters": [
            _param("horizon", "调度时段数", "period", [], "dispatch_plan", sample["horizon"], {"type": "integer", "min": 1}),
            _param("time", "调度时段", "", ["time"], "dispatch_plan", sample["time"], {"type": "array"}),
            _param("time_volume", "SOC时点", "", ["time_volume"], "dispatch_plan", sample["time_volume"], {"type": "array"}),
            _param("pv_forecast", "光伏预测出力", "MW", ["time"], "forecast", sample["pv_forecast"], {"type": "array", "min": 0}),
            _param("grid_limit", "并网限制", "MW", ["time"], "grid", sample["grid_limit"], {"type": "array", "min": 0}),
            _param("schedule", "计划曲线", "MW", ["time"], "dispatch_plan", sample.get("schedule", sample["grid_limit"]), {"type": "array", "min": 0}),
            _param("eta_ch", "充电效率", "p.u.", [], "BMS", sample["eta_ch"], {"type": "number", "min": 0, "max": 1}),
            _param("eta_dis", "放电效率", "p.u.", [], "BMS", sample["eta_dis"], {"type": "number", "min": 0, "max": 1}),
            _param("delta_t", "时间步长", "h", [], "dispatch_plan", sample["delta_t"], {"type": "number", "min": 0}),
            _param("soc_min", "SOC下限比例", "p.u.", [], "BMS", sample.get("soc_min", 0), {"type": "number", "min": 0, "max": 1}),
        ],
        "variables": [],
        "constraints": [_constraint("component_constraints", "组件约束", "Generated from component library as Pyomo constraints", ["time"])],
        "objectives": [_objective("pv_storage_objective", "光储综合目标", "minimize", "weighted_sum")],
        "sample_runtime_parameters": sample,
        "component_spec": component_spec,
        "ui_metadata": {"component_spec_collapsed": True, "recommended_component_source": "component_library"},
    }


def _cascade_hydro_dispatch() -> dict[str, Any]:
    sample = {
        "station": ["S1", "S2", "S3"],
        "horizon": 4,
        "time": [0, 1, 2, 3],
        "time_volume": [0, 1, 2, 3, 4],
        "units": {"S1": ["S1_U1", "S1_U2"], "S2": ["S2_U1"], "S3": ["S3_U1", "S3_U2"]},
        "unit_pmax": {"S1_U1": 100, "S1_U2": 80, "S2_U1": 90, "S3_U1": 70, "S3_U2": 70},
        "availability": {
            "S1_U1": [1, 1, 1, 1],
            "S1_U2": [1, 0, 0, 1],
            "S2_U1": [1, 1, 1, 1],
            "S3_U1": [1, 1, 1, 1],
            "S3_U2": [1, 1, 1, 1],
        },
        "power_conversion": {"S1": 0.38, "S2": 0.34, "S3": 0.30},
        "local_inflow": {"S1": [420, 430, 425, 415], "S2": [80, 80, 85, 82], "S3": [60, 62, 61, 60]},
        "load_forecast": [380, 420, 390, 360],
        "volume_min": {"S1": 80, "S2": 60, "S3": 50},
        "volume_max": {"S1": 160, "S2": 120, "S3": 100},
        "initial_volume": {"S1": 120, "S2": 90, "S3": 75},
        "target_terminal_volume": {"S1": 118, "S2": 88, "S3": 74},
        "outflow_min": {"S1": 80, "S2": 70, "S3": 60},
        "outflow_max": {"S1": 900, "S2": 850, "S3": 800},
        "spill_max": {"S1": 500, "S2": 500, "S3": 500},
        "edges": [
            {"upstream": "S1", "downstream": "S2", "delay_periods": 1},
            {"upstream": "S2", "downstream": "S3", "delay_periods": 1},
        ],
        "initial_upstream_outflow": {"S1->S2": 300, "S2->S3": 260},
        "time_step_seconds": 900,
        "weights": {"load_deviation": 1000, "spill": 1, "ramp": 0.1, "terminal_volume": 500},
    }
    variables = [
        {"name": "station_power", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "q_gen", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "q_spill", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "q_out", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "volume", "indices": ["station", "time_volume"], "domain": "NonNegativeReals"},
        {"name": "load_dev_pos", "indices": ["time"], "domain": "NonNegativeReals"},
        {"name": "load_dev_neg", "indices": ["time"], "domain": "NonNegativeReals"},
        {"name": "terminal_dev_pos", "indices": ["station"], "domain": "NonNegativeReals"},
        {"name": "terminal_dev_neg", "indices": ["station"], "domain": "NonNegativeReals"},
        {"name": "ramp_abs", "indices": ["station", "time"], "domain": "NonNegativeReals"},
    ]
    hydro_order = [
        "hydro_initial_volume",
        "hydro_volume_bounds",
        "hydro_station_available_capacity",
        "hydro_power_flow_conversion",
        "hydro_outflow_balance",
        "hydro_outflow_bounds",
        "hydro_spill_bounds",
        "hydro_cascade_inflow_delay",
        "hydro_reservoir_balance",
        "hydro_load_tracking",
        "hydro_terminal_volume",
        "hydro_ramp_smoothing",
    ]
    catalog_by_id = {item["component_id"]: item for item in list_component_catalog()}
    components = [{"type": component_id} for component_id in hydro_order if component_id in catalog_by_id]
    component_spec = {
        "model_code": "cascade_hydro_dispatch",
        "build_mode": "component_based",
        "name": "梯级水电日前调度优化模型",
        "model_problem_type": "LP",
        "required_solver_capabilities": ["LP"],
        "sets": [
            {"code": "station", "name": "电站清单", "values": sample["station"]},
            {"code": "time", "name": "调度时段", "values": sample["time"]},
            {"code": "time_volume", "name": "库容时点", "values": sample["time_volume"]},
        ],
        "variables": variables,
        "components": components,
        "objective": {
            "type": "weighted_sum",
            "sense": "minimize",
            "weights": sample["weights"],
            "terms": [
                {"term_id": "hydro_load_deviation_penalty", "name": "负荷偏差惩罚", "expression": "sum(load_dev_pos[t] + load_dev_neg[t] for t in time)", "weight_key": "load_deviation", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_spill_penalty", "name": "弃水惩罚", "expression": "sum(q_spill[station,t] for station in station for t in time)", "weight_key": "spill", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_terminal_volume_penalty", "name": "期末库容偏差惩罚", "expression": "sum(terminal_dev_pos[station] + terminal_dev_neg[station] for station in station)", "weight_key": "terminal_volume", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_ramp_penalty", "name": "出力爬坡平滑惩罚", "expression": "sum(ramp_abs[station,t] for station in station for t in time)", "weight_key": "ramp", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
            ],
        },
        "future_extensions": {
            "supports_piecewise_linear": True,
            "supports_binary_variables": True,
            "supports_nonlinear": False,
            "supports_rolling_optimization": False,
        },
        "ui_language": "zh-CN",
    }
    component_catalog = [catalog_by_id[component["type"]] for component in components]
    return {
        "model_code": "cascade_hydro_dispatch",
        "code": "cascade_hydro_dispatch",
        "name": "梯级水电日前调度优化模型",
        "scenario": "Cascade hydro day-ahead dispatch with maintenance, load tracking, spill analysis, and terminal volume control.",
        "description": "Component-based cascade hydro day-ahead dispatch optimization model.",
        "version": "v1.0",
        "status": "trial",
        "solver": "HiGHS",
        "build_mode": "component_based",
        "model_problem_type": "LP",
        "problem_type": "LP",
        "required_solver_capabilities": ["LP"],
        "tags": ["power", "hydro", "cascade", "component_based", "dispatch", "LP"],
        "sets": component_spec["sets"],
        "parameters": [
            _param("station", "电站清单", "", [], "dispatch_plan", sample["station"], {"type": "list"}),
            _param("horizon", "调度时段数", "period", [], "dispatch_plan", sample["horizon"], {"type": "integer", "min": 1}),
            _param("time", "调度时段", "", ["time"], "dispatch_plan", sample["time"], {"type": "array"}),
            _param("time_volume", "库容时点", "", ["time_volume"], "dispatch_plan", sample["time_volume"], {"type": "list"}),
            _param("units", "电站机组清单", "", ["station", "unit"], "EAM", sample["units"], {"type": "dict"}),
            _param("unit_pmax", "机组最大出力", "MW", ["unit"], "EAM", sample["unit_pmax"], {"type": "dict", "min": 0}),
            _param("availability", "机组可用状态", "0/1", ["unit", "time"], "EAM", sample["availability"], {"type": "dict"}),
            _param("power_conversion", "出力转换系数", "MW/(m3/s)", ["station"], "hydrology", sample["power_conversion"], {"type": "dict", "min": 0}),
            _param("local_inflow", "区间来水过程", "m3/s", ["station", "time"], "hydrology", sample["local_inflow"], {"type": "dict"}),
            _param("load_forecast", "系统负荷预测", "MW", ["time"], "forecast", sample["load_forecast"], {"type": "array", "min": 0}),
            _param("volume_min", "最小库容", "million m3", ["station"], "hydrology", sample["volume_min"], {"type": "dict"}),
            _param("volume_max", "最大库容", "million m3", ["station"], "hydrology", sample["volume_max"], {"type": "dict"}),
            _param("initial_volume", "初始库容", "million m3", ["station"], "hydrology", sample["initial_volume"], {"type": "dict"}),
            _param("target_terminal_volume", "目标期末库容", "million m3", ["station"], "hydrology", sample["target_terminal_volume"], {"type": "dict"}),
            _param("outflow_min", "最小下泄流量", "m3/s", ["station"], "dispatch_rule", sample["outflow_min"], {"type": "dict"}),
            _param("outflow_max", "最大下泄流量", "m3/s", ["station"], "dispatch_rule", sample["outflow_max"], {"type": "dict"}),
            _param("spill_max", "弃水上限", "m3/s", ["station"], "dispatch_rule", sample["spill_max"], {"type": "dict"}),
            _param("edges", "梯级拓扑及传播时滞", "", ["edge"], "hydrology", sample["edges"], {"type": "list"}),
            _param("initial_upstream_outflow", "初始上游下泄", "m3/s", ["edge"], "hydrology", sample["initial_upstream_outflow"], {"type": "dict"}),
            _param("time_step_seconds", "时段长度", "s", [], "dispatch_plan", sample["time_step_seconds"], {"type": "integer", "min": 1}),
            _param("weights", "目标函数权重", "", [], "dispatch_rule", sample["weights"], {"type": "dict"}),
        ],
        "variables": [_var(item["name"], _hydro_var_name(item["name"]), _hydro_var_unit(item["name"]), item["indices"], item["domain"]) for item in variables],
        "constraints": [
            _constraint("component_constraints", "Component constraints", "Generated from ordered component list as Pyomo constraints", ["station", "time"]),
        ],
        "objectives": [_objective("weighted_dispatch_objective", "Min weighted load deviation, spill, ramping, and terminal volume deviation", "minimize", "weighted_sum")],
        "component_spec": component_spec,
        "component_schema": {
            "components": component_catalog,
            "field_display": {
                "station": "电站清单 station",
                "units": "电站机组清单 units",
                "availability": "机组可用状态 availability",
                "edges": "梯级拓扑及传播时滞 edges",
            },
        },
        "ui_metadata": {
            "display_build_mode": "组件化自定义 Builder",
            "display_problem_type": "绾挎€ц鍒?LP",
            "solver": "HiGHS",
            "component_catalog": component_catalog,
            "complex_components": {
                "hydro_cascade_inflow_delay": {
                    "description": "Upstream outflow enters downstream inflow after propagation delay.",
                    "公式示例": "inflow[S2,t] = local_inflow[S2,t] + q_out[S1,t-1]",
                    "参数示例": {"upstream": "S1", "downstream": "S2", "delay_periods": 1},
                    "common_error": "initial_upstream_outflow missing S1->S2.",
                },
                "hydro_reservoir_balance": {
                    "description": "Reservoir volume is propagated from inflow, outflow, and period length.",
                    "公式示例": "volume[s,t+1] = volume[s,t] + (inflow[s,t] - q_out[s,t]) * delta_v",
                    "参数示例": {"time_step_seconds": 900},
                    "common_error": "time_volume length must equal horizon + 1.",
                },
            },
        },
        "sample_runtime_parameters": sample,
    }


def _hydro_var_name(code: str) -> str:
    names = {
        "station_power": "电站出力",
        "q_gen": "发电流量",
        "q_spill": "弃水流量",
        "q_out": "下泄流量",
        "volume": "库容",
        "load_dev_pos": "Positive load deviation",
        "load_dev_neg": "Negative load deviation",
        "terminal_dev_pos": "Positive terminal volume deviation",
        "terminal_dev_neg": "Negative terminal volume deviation",
        "ramp_abs": "Absolute ramping",
    }
    return names.get(code, code)


def _hydro_var_unit(code: str) -> str:
    units = {
        "station_power": "MW",
        "q_gen": "m3/s",
        "q_spill": "m3/s",
        "q_out": "m3/s",
        "volume": "million m3",
        "load_dev_pos": "MW",
        "load_dev_neg": "MW",
        "terminal_dev_pos": "million m3",
        "terminal_dev_neg": "million m3",
        "ramp_abs": "MW",
    }
    return units.get(code, "")


def _cascade_hydro_dispatch_v1() -> dict[str, Any]:
    stations = ["R1", "R2"]
    horizon = 24
    time = list(range(horizon))
    inflow_r1 = [92, 95, 98, 102, 108, 112, 116, 120, 118, 114, 110, 106, 104, 102, 100, 98, 96, 94, 92, 90, 88, 90, 92, 94]
    inflow_r2 = [24, 24, 25, 26, 28, 30, 32, 34, 33, 31, 30, 29, 28, 27, 26, 26, 25, 25, 24, 24, 23, 23, 24, 24]
    sample = {
        "reservoir": stations,
        "station": stations,
        "horizon": horizon,
        "time": time,
        "inflow": {"R1": inflow_r1, "R2": inflow_r2},
        "initial_storage": {"R1": 122, "R2": 108},
        "target_final_storage": {"R1": 120, "R2": 108},
        "storage_min": {"R1": 90, "R2": 85},
        "storage_max": {"R1": 160, "R2": 150},
        "outflow_min": {"R1": 45, "R2": 50},
        "outflow_max": {"R1": 155, "R2": 155},
        "power_min": {"R1": 0, "R2": 0},
        "power_max": {"R1": 95, "R2": 95},
        "load_forecast": [82, 80, 78, 76, 78, 82, 90, 98, 110, 116, 120, 118, 112, 108, 104, 106, 114, 122, 128, 124, 116, 104, 94, 88],
        "delta_t": 1.0,
        "cascade_delay": {"R1": 0, "R2": 0},
        "upstream_station": {"R2": "R1"},
        "initial_upstream_outflow": {"R2": 95},
        "penalty_spill": 10.0,
        "penalty_storage_deviation": 500.0,
        "function_asset_bindings": {
            "level_storage": "cascade_hydro_level_storage_v1",
            "tailwater_outflow": "cascade_hydro_tailwater_outflow_v1",
            "power_surface": "cascade_hydro_power_surface_v1",
        },
        "future_extensions": {
            "cascade_delay_mode": "reserved",
            "unit_commitment": False,
            "ecological_flow": "reserved",
            "multi_objective_weights": "reserved",
        },
    }


def _nonlinear_hydro_power_demo() -> dict[str, Any]:
    sample = {
        "horizon": 3,
        "time": [0, 1, 2],
        "k": 0.9,
        "flow_min": 10,
        "flow_max": 100,
        "head_min": 20,
        "head_max": 80,
        "power_max": 5000,
    }
    template = _base("nonlinear_hydro_power_demo", "非线性水电出力 NLP 试点", "NLP pilot demo", ["power", "NLP", "Ipopt", "Pyomo"])
    template.update(
        {
            "build_mode": "domain_builder",
            "problem_type": "NLP",
            "model_problem_type": "NLP",
            "required_solver_capabilities": ["NLP"],
            "solver": "Ipopt",
            "description": "Continuous NLP demo. Ipopt is used only when available; the platform does not claim global optimality.",
            "sets": [{"code": "time", "name": "时段", "values": sample["time"]}],
            "parameters": [
                _param("k", "出力系数", "MW/(m3/s*m)", [], "demo", sample["k"]),
                _param("flow_min", "流量下限", "m3/s", [], "demo", sample["flow_min"]),
                _param("flow_max", "流量上限", "m3/s", [], "demo", sample["flow_max"]),
                _param("head_min", "水头下限", "m", [], "demo", sample["head_min"]),
                _param("head_max", "水头上限", "m", [], "demo", sample["head_max"]),
                _param("power_max", "出力上限", "MW", [], "demo", sample["power_max"]),
            ],
            "variables": [
                _var("flow", "流量", "m3/s", ["time"]),
                _var("head", "水头", "m", ["time"]),
                _var("power", "出力", "MW", ["time"]),
            ],
            "constraints": [
                _constraint("power_balance", "非线性出力关系", "power[t] == k * flow[t] * head[t]", ["time"]),
                _constraint("power_upper", "出力上限", "power[t] <= power_max", ["time"]),
            ],
            "objectives": [_objective("max_power", "最大化总出力", "maximize", "sum(power[t] for t in time)")],
            "sample_runtime_parameters": sample,
            "ui_metadata": {
                "solver_type": "NLP",
                "local_optimum_warning": True,
                "nlp_pilot": True,
            },
        }
    )
    return template
    function_components = [
        {
            "component_id": "cascade_hydro_v1_water_balance",
            "type": "cascade_hydro_v1_water_balance",
            "name": "水量平衡组件",
            "display_name": "水量平衡组件",
            "generated_constraints": [{"constraint_id": "water_balance", "name": "水量平衡约束", "expression": "storage[r,t] = previous_storage[r,t] + (inflow[r,t] + upstream_release[r,t] - outflow[r,t] - spill[r,t]) * delta_t"}],
        },
        {
            "component_id": "function_mapping_component",
            "type": "function_mapping_component",
            "name": "水位库容函数映射",
            "display_name": "水位库容函数映射",
            "function_asset_id": sample["function_asset_bindings"]["level_storage"],
            "x": "storage[r,t]",
            "y": "level[r,t]",
            "indices": [{"set": "reservoir", "alias": "r"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "convex_combination_lp",
            "generated_constraints": [{"constraint_id": "level_storage_mapping", "type": "piecewise", "expression": "level[r,t] == piecewise(storage[r,t], cascade_hydro_level_storage_v1)"}],
            "metadata": {"function_asset_name": "梯级水电样例水位库容曲线 v1", "point_count": 5},
        },
        {
            "component_id": "function_mapping_component",
            "type": "function_mapping_component",
            "name": "尾水位流量函数映射",
            "display_name": "尾水位流量函数映射",
            "function_asset_id": sample["function_asset_bindings"]["tailwater_outflow"],
            "x": "outflow[r,t]",
            "y": "tailwater[r,t]",
            "indices": [{"set": "reservoir", "alias": "r"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "convex_combination_lp",
            "generated_constraints": [{"constraint_id": "tailwater_outflow_mapping", "type": "piecewise", "expression": "tailwater[r,t] == piecewise(outflow[r,t], cascade_hydro_tailwater_outflow_v1)"}],
            "metadata": {"function_asset_name": "梯级水电样例尾水位流量曲线 v1", "point_count": 4},
        },
        {
            "component_id": "cascade_hydro_v1_head_calculation",
            "type": "cascade_hydro_v1_head_calculation",
            "name": "水头计算组件",
            "display_name": "水头计算：head = level - tailwater",
            "generated_constraints": [{"constraint_id": "head_calculation", "name": "水头计算", "expression": "head[r,t] = level[r,t] - tailwater[r,t]"}],
        },
        {
            "component_id": "function_mapping_2d_component",
            "type": "function_mapping_2d_component",
            "name": "二维出力曲面函数映射",
            "display_name": "二维出力曲面函数映射",
            "function_asset_id": sample["function_asset_bindings"]["power_surface"],
            "x": "outflow[r,t]",
            "y": "head[r,t]",
            "z": "power[r,t]",
            "indices": [{"set": "reservoir", "alias": "r"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "triangulated_milp_exact",
            "generated_constraints": [{"constraint_id": "power_surface_mapping", "type": "piecewise_2d", "expression": "power[r,t] == piecewise_2d(outflow[r,t], head[r,t], cascade_hydro_power_surface_v1)", "piecewise_method": "triangulated_milp_exact", "expression_class": "linear"}],
            "metadata": {"function_asset_name": "梯级水电样例出力曲面 v1", "point_count": 3, "triangle_count": 1},
        },
        {
            "component_id": "cascade_hydro_v1_terminal_storage",
            "type": "cascade_hydro_v1_terminal_storage",
            "name": "期末库容约束",
            "display_name": "期末库容约束",
            "generated_constraints": [
                {"constraint_id": "final_storage_deviation_pos", "name": "期末库容正偏差", "expression": "final_storage_deviation[r] >= storage[r,T] - target_final_storage[r]"},
                {"constraint_id": "final_storage_deviation_neg", "name": "期末库容负偏差", "expression": "final_storage_deviation[r] >= target_final_storage[r] - storage[r,T]"},
            ],
        },
    ]
    component_spec = {
        "model_code": "cascade_hydro_dispatch_v1",
        "build_mode": "template_based",
        "model_problem_type": "MILP",
        "required_solver_capabilities": ["MILP"],
        "sets": [
            {"code": "reservoir", "name": "水库/电站集合", "values": stations},
            {"code": "station", "name": "水库/电站集合", "values": stations},
            {"code": "time", "name": "调度时段", "values": time},
        ],
        "variables": [
            {"name": "storage", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "outflow", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "spill", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "level", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "tailwater", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "head", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "power", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "generation", "indices": ["reservoir", "time"], "domain": "NonNegativeReals"},
            {"name": "final_storage_deviation", "indices": ["reservoir"], "domain": "NonNegativeReals"},
        ],
        "components": function_components,
        "function_asset_bindings": sample["function_asset_bindings"],
        "problem_type_diagnosis": {
            "inferred_problem_type": "MILP",
            "recommended_solver": "HiGHS",
            "function_assets_used": [
                {"function_asset_id": sample["function_asset_bindings"]["level_storage"], "component": "水位库容函数映射", "solve_strategy": "convex_combination_lp"},
                {"function_asset_id": sample["function_asset_bindings"]["tailwater_outflow"], "component": "尾水位流量函数映射", "solve_strategy": "convex_combination_lp"},
                {"function_asset_id": sample["function_asset_bindings"]["power_surface"], "component": "二维出力曲面函数映射", "solve_strategy": "triangulated_milp_exact"},
            ],
            "linearization_strategy": ["convex_combination_lp", "triangulated_milp_exact"],
            "estimated_binary_variables": horizon * len(stations),
            "milp_risk": "2D PWL surface introduces triangle-selection binary variables.",
        },
        "objective": {
            "type": "weighted_sum",
            "sense": "maximize",
            "terms": [
                {"term_id": "total_generation", "name": "总发电量", "expression": "sum(generation[r,t] for r in reservoir for t in time)", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
                {"term_id": "spill_penalty", "name": "弃水惩罚", "expression": "penalty_spill * sum(spill[r,t] for r in reservoir for t in time)", "weight": -1, "solve_participation": "solve_active", "supported_by_backend": True},
                {"term_id": "final_storage_penalty", "name": "期末库容偏差惩罚", "expression": "penalty_storage_deviation * sum(final_storage_deviation[r] for r in reservoir)", "weight": -1, "solve_participation": "solve_active", "supported_by_backend": True},
            ],
        },
    }
    t = _base("cascade_hydro_dispatch_v1", "Cascade hydro dispatch v1", "Cascade hydro dispatch with PWL function assets.", ["power", "hydro", "cascade", "MILP", "piecewise_1d", "piecewise_2d"])
    t.update(
        solver="HiGHS",
        build_mode="template_based",
        model_problem_type="MILP",
        problem_type="MILP",
        required_solver_capabilities=["MILP"],
        sets=component_spec["sets"],
        parameters=[
            _param("horizon", "调度时段数", "period", [], "dispatch_plan", sample["horizon"], {"type": "integer", "min": 1}),
            _param("time", "调度时段", "", ["time"], "dispatch_plan", sample["time"], {"type": "array"}),
            _param("inflow", "天然来水", "m3/s", ["reservoir", "time"], "hydrology", sample["inflow"], {"type": "dict", "min": 0}),
            _param("initial_storage", "初始库容", "million m3", ["reservoir"], "hydrology", sample["initial_storage"], {"type": "dict"}),
            _param("target_final_storage", "目标期末库容", "million m3", ["reservoir"], "hydrology", sample["target_final_storage"], {"type": "dict"}),
            _param("storage_min", "库容下限", "million m3", ["reservoir"], "hydrology", sample["storage_min"], {"type": "dict"}),
            _param("storage_max", "库容上限", "million m3", ["reservoir"], "hydrology", sample["storage_max"], {"type": "dict"}),
            _param("outflow_min", "出库流量下限", "m3/s", ["reservoir"], "dispatch_rule", sample["outflow_min"], {"type": "dict"}),
            _param("outflow_max", "出库流量上限", "m3/s", ["reservoir"], "dispatch_rule", sample["outflow_max"], {"type": "dict"}),
            _param("power_min", "出力下限", "MW", ["reservoir"], "dispatch_rule", sample["power_min"], {"type": "dict"}),
            _param("power_max", "出力上限", "MW", ["reservoir"], "dispatch_rule", sample["power_max"], {"type": "dict"}),
            _param("load_forecast", "负荷/发电目标", "MW", ["time"], "forecast", sample["load_forecast"], {"type": "array"}),
            _param("delta_t", "时段长度", "h", [], "dispatch_plan", sample["delta_t"], {"type": "number", "min": 0}),
            _param("cascade_delay", "上下游时滞", "period", ["reservoir"], "hydrology", sample["cascade_delay"], {"type": "dict"}),
            _param("penalty_spill", "弃水惩罚", "", [], "dispatch_rule", sample["penalty_spill"], {"type": "number", "min": 0}),
            _param("penalty_storage_deviation", "期末库容偏差惩罚", "", [], "dispatch_rule", sample["penalty_storage_deviation"], {"type": "number", "min": 0}),
        ],
        variables=[
            _var("storage", "库容", "million m3", ["reservoir", "time"]),
            _var("outflow", "出库流量", "m3/s", ["reservoir", "time"]),
            _var("spill", "弃水", "m3/s", ["reservoir", "time"]),
            _var("level", "上游水位", "m", ["reservoir", "time"]),
            _var("tailwater", "尾水位", "m", ["reservoir", "time"]),
            _var("head", "水头", "m", ["reservoir", "time"]),
            _var("power", "出力", "MW", ["reservoir", "time"]),
            _var("generation", "发电量", "MWh", ["reservoir", "time"]),
            _var("final_storage_deviation", "期末库容偏差", "million m3", ["reservoir"]),
        ],
        constraints=[
            _constraint("water_balance", "水量平衡约束", "storage transition with initial_storage and previous period storage", ["reservoir", "time"]),
            _constraint("storage_bounds", "库容上下限约束", "storage_min <= storage <= storage_max", ["reservoir", "time"]),
            _constraint("outflow_bounds", "出库流量上下限约束", "outflow_min <= outflow <= outflow_max", ["reservoir", "time"]),
            _constraint("level_storage_mapping", "水位库容函数映射", "level = f(storage)", ["reservoir", "time"]),
            _constraint("tailwater_outflow_mapping", "尾水位流量函数映射", "tailwater = f(outflow)", ["reservoir", "time"]),
            _constraint("head_calculation", "水头计算", "head = level - tailwater", ["reservoir", "time"]),
            _constraint("power_surface_mapping", "二维出力曲面函数映射", "power = f(outflow, head)", ["reservoir", "time"]),
            _constraint("generation_calculation", "发电量计算", "generation = power * delta_t", ["reservoir", "time"]),
            _constraint("terminal_storage", "期末库容约束", "final_storage_deviation >= +/- (storage[T] - target)", ["reservoir"]),
            _constraint("spill_nonnegative", "弃水非负约束", "spill >= 0", ["reservoir", "time"]),
        ],
        objectives=[_objective("hydro_generation_max", "最大化总发电量 - 弃水惩罚 - 期末库容偏差惩罚", "maximize", "sum(generation)-penalty_spill*sum(spill)-penalty_storage_deviation*sum(final_storage_deviation)")],
        components=function_components,
        component_spec=component_spec,
        mathematical_components=function_components,
        sample_runtime_parameters=sample,
        ui_metadata={
            "display_problem_type": "MILP",
            "function_assets": "1D PWL + 2D PWL",
            "use_case": "日前/日内水电优化调度",
            "step5_diagnostics": {
                "function_asset_binding_complete": True,
                "piecewise_2d_triangle_count": 1,
                "estimated_binary_variables": horizon * len(stations),
                "milp_risk": "二维出力曲面使用三角剖分精确 MILP，会引入二进制变量。",
            },
        },
    )
    return t


def _pv_storage_capacity_planning() -> dict[str, Any]:
    sample = _pv_storage_base_sample()
    sample.pop("storage_power_capacity", None)
    sample.pop("storage_energy_capacity", None)
    sample.update({"grid_limit": [70, 70, 70, 70], "soc_min": 0, "weights": {"investment": 1, "curtailment": 1, "energy_revenue": 0.2, "storage_cycle": 0.05}, "scenario_options": [{"name": "no_storage", "storage_power_capacity": 0, "storage_energy_capacity": 0}, {"name": "balanced", "storage_power_capacity": 30, "storage_energy_capacity": 60}]})
    return _pv_storage_component_template_v2("pv_storage_capacity_planning", "PV-storage capacity planning", "Storage power and energy capacity planning optimization.", [{"type": "pv_available_output"}, {"type": "storage_capacity_decision"}, {"type": "storage_soc_balance"}, {"type": "pv_storage_power_balance"}, {"type": "grid_power_limit"}], sample, "LP", "capacity")


def _pv_storage_day_ahead_dispatch() -> dict[str, Any]:
    sample = _pv_storage_base_sample()
    sample.update({"grid_limit": [90, 90, 90, 90], "schedule": [40, 80, 70, 30], "storage_power_capacity": 30, "storage_energy_capacity": 60, "initial_soc": 20, "terminal_soc_target": 20, "weights": {"deviation": 1000, "curtailment": 100, "storage_cycle": 1, "energy_revenue": 0.2, "terminal_soc": 200}})
    return _pv_storage_component_template_v2("pv_storage_day_ahead_dispatch", "PV-storage day-ahead dispatch", "Full-day PV-storage dispatch with day-ahead forecast, schedule, and price.", [{"type": "pv_available_output"}, {"type": "storage_soc_balance"}, {"type": "pv_storage_power_balance"}, {"type": "grid_power_limit"}, {"type": "schedule_tracking"}, {"type": "storage_terminal_soc_tracking"}], sample, "LP", "day_ahead")


def _pv_storage_intraday_dispatch() -> dict[str, Any]:
    sample = _pv_storage_base_sample()
    sample.update({"pv_forecast": [60, 85, 45, 20], "grid_limit": [80, 80, 80, 80], "schedule": [55, 75, 50, 25], "price": [320, 500, 420, 300], "storage_power_capacity": 25, "storage_energy_capacity": 50, "initial_soc": 18, "terminal_soc_target": 18, "weights": {"deviation": 1500, "curtailment": 120, "storage_cycle": 1, "energy_revenue": 0.2, "terminal_soc": 300}})
    return _pv_storage_component_template_v2("pv_storage_intraday_dispatch", "PV-storage intraday rolling dispatch", "Intraday rolling-horizon PV-storage dispatch with current SOC and latest forecast.", [{"type": "pv_available_output"}, {"type": "storage_soc_balance"}, {"type": "pv_storage_power_balance"}, {"type": "grid_power_limit"}, {"type": "schedule_tracking"}, {"type": "storage_terminal_soc_tracking"}], sample, "LP", "intraday")


def _pv_storage_dispatch_v2() -> dict[str, Any]:
    return _pv_storage_day_ahead_dispatch_v2(code="pv_storage_dispatch_v2", mode="dispatch_v2")


def _pv_storage_day_ahead_dispatch_v2(code: str = "pv_storage_day_ahead_dispatch_v2", mode: str = "day_ahead_v2") -> dict[str, Any]:
    sample = _pv_storage_base_sample()
    sample.update(
        {
            "grid_limit": [90, 90, 90, 90],
            "schedule": [40, 80, 70, 30],
            "deviation_limit": [2, 2, 2, 2],
            "deviation_penalty_price": 500,
            "storage_power_capacity": 30,
            "storage_energy_capacity": 60,
            "initial_soc": 20,
            "terminal_time": 4,
            "terminal_soc_target": 20,
            "soc_min": 0.2,
            "soc_max": 0.9,
            "storage_cycle_cost": 1,
            "degradation_cost_yuan_per_mwh": 2,
            "weights": {"curtailment": 100, "deviation": 100, "deviation_penalty_cost": 1, "storage_cycle": 1, "battery_degradation": 1, "energy_revenue": 0.2, "terminal_soc": 200},
        }
    )
    components = [
        {"type": "pv_available_output"},
        {"type": "storage_soc_balance"},
        {"type": "storage_soc_bounds"},
        {"type": "pv_storage_power_balance"},
        {"type": "grid_power_limit"},
        {"type": "schedule_tracking"},
        {"type": "deviation_penalty_component"},
        {"type": "storage_charge_discharge_exclusive"},
        {"type": "storage_terminal_soc_tracking"},
    ]
    description = "PV-storage dispatch V2: schedule tracking, allowed deviation band, excess deviation penalty, charge/discharge exclusivity, SOC bounds, and revenue/cost terms. The exclusivity component makes the model MILP."
    return _pv_storage_component_template_v2(code, "PV storage dispatch V2", description, components, sample, "MILP", mode)


def _pv_storage_intraday_dispatch_v2() -> dict[str, Any]:
    template = _pv_storage_day_ahead_dispatch_v2(code="pv_storage_intraday_dispatch_v2", mode="intraday_v2")
    sample = template["sample_runtime_parameters"]
    sample.update({"pv_forecast": [60, 85, 45, 20], "grid_limit": [80, 80, 80, 80], "schedule": [55, 75, 50, 25], "price": [320, 500, 420, 300], "storage_power_capacity": 25, "storage_energy_capacity": 50, "initial_soc": 18, "terminal_soc_target": 18})
    template["component_spec"]["objective"]["weights"] = sample.get("weights", {})
    return template


def _pv_storage_base_sample() -> dict[str, Any]:
    return {"horizon": 4, "time": [0, 1, 2, 3], "time_volume": [0, 1, 2, 3, 4], "pv_forecast": [20, 100, 80, 10], "grid_limit": [80, 80, 80, 80], "schedule": [40, 80, 70, 30], "price": [300, 300, 450, 500], "deviation_limit": [0, 0, 0, 0], "deviation_penalty_price": 1, "eta_ch": 0.95, "eta_dis": 0.95, "delta_t": 1, "initial_soc": 0, "terminal_time": 4, "terminal_soc_target": 0, "storage_power_capacity": 30, "storage_energy_capacity": 60, "soc_min": 0.1, "soc_max": 1.0, "capex_power": 1000, "capex_energy": 500, "curtailment_penalty": 100, "storage_cycle_cost": 1, "degradation_cost_yuan_per_mwh": 0}


def _pv_storage_component_template_v2(code: str, name: str, scenario: str, components: list[dict[str, Any]], sample: dict[str, Any], problem_type: str, mode: str) -> dict[str, Any]:
    component_spec = {"model_code": code, "build_mode": "component_based", "name": name, "model_problem_type": problem_type, "required_solver_capabilities": [problem_type], "sets": [{"code": "time", "name": "调度时段", "values": sample["time"]}, {"code": "time_volume", "name": "SOC时点", "values": sample["time_volume"]}], "variables": [], "components": components, "objective": {"type": "weighted_sum", "sense": "minimize", "terms": _pv_storage_objective_terms_v2(mode), "weights": sample.get("weights", {})}, "ui_language": "zh-CN", "dispatch_mode": mode}
    params = [
        _param("horizon", "调度时段数", "period", [], "dispatch_plan", sample["horizon"], {"type": "integer", "min": 1}),
        _param("time", "调度时段", "", ["time"], "dispatch_plan", sample["time"], {"type": "array"}),
        _param("time_volume", "SOC时点", "", ["time_volume"], "dispatch_plan", sample["time_volume"], {"type": "array"}),
        _param("pv_forecast", "光伏预测出力", "MW", ["time"], "forecast", sample["pv_forecast"], {"type": "array", "min": 0}),
        _param("grid_limit", "并网闄愬埗", "MW", ["time"], "grid", sample["grid_limit"], {"type": "array", "min": 0}),
        _param("schedule", "计划曲线", "MW", ["time"], "dispatch_plan", sample.get("schedule", sample["grid_limit"]), {"type": "array", "min": 0}),
        _param("price", "电价", "元/MWh", ["time"], "market", sample["price"], {"type": "array"}),
        _param("storage_power_capacity", "储能功率容量", "MW", [], "asset", sample.get("storage_power_capacity", 30), {"type": "number", "min": 0}),
        _param("storage_energy_capacity", "储能能量容量", "MWh", [], "asset", sample.get("storage_energy_capacity", 60), {"type": "number", "min": 0}),
        _param("initial_soc", "初始SOC", "MWh", [], "BMS", sample.get("initial_soc", 0), {"type": "number", "min": 0}),
        _param("terminal_time", "期末时点", "", [], "dispatch_plan", sample.get("terminal_time", sample["horizon"]), {"type": "integer", "min": 0}),
        _param("terminal_soc_target", "期末SOC目标", "MWh", [], "dispatch_plan", sample.get("terminal_soc_target", 0), {"type": "number", "min": 0}),
        _param("capex_power", "功率投资成本", "元/MW", [], "finance", sample.get("capex_power", 1000), {"type": "number", "min": 0}),
        _param("capex_energy", "容量投资成本", "元/MWh", [], "finance", sample.get("capex_energy", 500), {"type": "number", "min": 0}),
        _param("curtailment_penalty", "弃光惩罚", "元/MWh", [], "dispatch_plan", sample.get("curtailment_penalty", 100), {"type": "number", "min": 0}),
        _param("storage_cycle_cost", "充放电循环成本", "yuan/MWh", [], "asset", sample.get("storage_cycle_cost", 1), {"type": "number", "min": 0}),
        _param("eta_ch", "充电效率", "p.u.", [], "BMS", sample["eta_ch"], {"type": "number", "min": 0, "max": 1}),
        _param("eta_dis", "放电效率", "p.u.", [], "BMS", sample["eta_dis"], {"type": "number", "min": 0, "max": 1}),
        _param("delta_t", "时间步长", "h", [], "dispatch_plan", sample["delta_t"], {"type": "number", "min": 0}),
        _param("soc_min", "SOC下限比例", "p.u.", [], "BMS", sample.get("soc_min", 0), {"type": "number", "min": 0, "max": 1}),
    ]
    params = _with_pv_storage_v2_parameters(code, sample, params)
    return {"model_code": code, "code": code, "name": name, "scenario": scenario, "description": scenario, "version": "v1.1", "status": "trial", "solver": "HiGHS", "build_mode": "component_based", "model_problem_type": problem_type, "problem_type": problem_type, "required_solver_capabilities": component_spec["required_solver_capabilities"], "tags": ["power", "pv", "storage", "component_based", mode, problem_type], "sets": component_spec["sets"], "parameters": params, "variables": [], "constraints": [_constraint("component_constraints", "组件约束", "Generated from component library as Pyomo constraints", ["time"])], "objectives": [_objective("pv_storage_objective", "光储综合目标", "minimize", "weighted_sum")], "sample_runtime_parameters": sample, "component_spec": component_spec, "ui_metadata": {"component_spec_collapsed": True, "recommended_component_source": "component_library", "dispatch_mode": mode, "scenario_compare_enabled": code == "pv_storage_capacity_planning"}}


def _pv_storage_objective_terms_v2(mode: str) -> list[dict[str, Any]]:
    common = [
        {"term_id": "curtailment_penalty", "name": "弃光惩罚", "expression": "curtailment_penalty * sum(p_pv_curtail[t] for t in time)", "weight_key": "curtailment", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
        {"term_id": "energy_revenue", "name": "售电收益", "expression": "- price[t] * p_grid[t]", "weight_key": "energy_revenue", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
        {"term_id": "storage_cycle_cost", "name": "充放电循环成本", "expression": "storage_cycle_cost * sum(p_ch[t] + p_dis[t] for t in time)", "weight_key": "storage_cycle", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
    ]
    if mode != "capacity":
        common.append({"term_id": "battery_degradation_cost", "name": "battery degradation cost", "expression": "degradation_cost_yuan_per_mwh * sum(p_ch[t] + p_dis[t] for t in time)", "weight_key": "battery_degradation", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True})
    if mode == "capacity":
        return [{"term_id": "investment_cost", "name": "投资成本", "expression": "capex_power * storage_power_capacity + capex_energy * storage_energy_capacity", "weight_key": "investment", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}, *common]
    return [{"term_id": "schedule_deviation_penalty", "name": "计划偏差惩罚", "expression": "sum(deviation_pos[t] + deviation_neg[t] for t in time)", "weight_key": "deviation", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}, *common, {"term_id": "terminal_soc_penalty", "name": "期末SOC偏差惩罚", "expression": "terminal_soc_dev_pos + terminal_soc_dev_neg", "weight_key": "terminal_soc", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True}]


def _with_pv_storage_v2_parameters(code: str, sample: dict[str, Any], params: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if code not in {"pv_storage_dispatch_v2", "pv_storage_day_ahead_dispatch_v2", "pv_storage_intraday_dispatch_v2"}:
        return params
    existing = {item.get("code") for item in params}
    additions = [
        {
            "code": "deviation_limit",
            "name": "允许偏差",
            "type": "array",
            "dimension": ["time"],
            "unit": "MW",
            "source_system": "dispatch_plan",
            "runtime_injected": True,
            "required": True,
            "default": sample.get("deviation_limit", [2, 2, 2, 2]),
            "sample": sample.get("deviation_limit", [2, 2, 2, 2]),
            "description": "每个时段允许的计划偏差范围，超过该范围的偏差计入考核。",
            "validation": {"type": "array", "min": 0, "length_matches": "time"},
        },
        {
            "code": "deviation_penalty_price",
            "name": "偏差考核单价",
            "type": "number",
            "dimension": [],
            "unit": "元/MWh",
            "source_system": "dispatch_plan",
            "runtime_injected": True,
            "required": True,
            "default": sample.get("deviation_penalty_price", 500),
            "sample": sample.get("deviation_penalty_price", 500),
            "description": "超限偏差对应的考核价格。",
            "validation": {"type": "number", "min": 0},
        },
        {
            "code": "soc_max",
            "name": "SOC 上限比例",
            "type": "number",
            "dimension": [],
            "unit": "p.u.",
            "source_system": "BMS",
            "runtime_injected": True,
            "required": True,
            "default": sample.get("soc_max", 0.9),
            "sample": sample.get("soc_max", 0.9),
            "description": "储能 SOC 上限比例。",
            "validation": {"type": "number", "min": 0, "max": 1, "greater_than": "soc_min"},
        },
        {
            "code": "degradation_cost_yuan_per_mwh",
            "name": "电池寿命损耗成本",
            "type": "number",
            "dimension": [],
            "unit": "元/MWh",
            "source_system": "asset",
            "runtime_injected": True,
            "required": True,
            "default": sample.get("degradation_cost_yuan_per_mwh", 2),
            "sample": sample.get("degradation_cost_yuan_per_mwh", 2),
            "description": "按充放电吞吐电量计算的电池寿命或损耗成本。",
            "validation": {"type": "number", "min": 0},
        },
    ]
    return [*params, *[item for item in additions if item["code"] not in existing]]


