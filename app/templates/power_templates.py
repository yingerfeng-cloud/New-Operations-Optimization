from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.business_scenarios import business_scenario_by_id, scenario_id_for_template
from app.builders.unit_commitment_builder import unit_commitment_template
from app.model_draft import build_constraints_from_draft, create_model_draft_from_template
from app.model_components.compute_power_components import (
    COMPUTE_POWER_PARAMETERS,
    COMPUTE_POWER_SETS,
    COMPUTE_POWER_VARIABLES,
)
from app.model_components.registry import list_component_catalog


TEMPLATE_DISPLAY_NAMES = {
    "unit_commitment_day_ahead": ("日前机组组合优化 Unit Commitment", "日前机组组合优化，生成机组启停、启动和出力计划。"),
    "economic_dispatch": ("经济调度", "已知机组在线状态下分配出力并降低发电成本。"),
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
    "contract_spot_exposure_v1": ("中长期合约分解与现货暴露控制模型", "面向售电公司和用电侧主体，生成中长期合约分解与现货暴露控制建议。"),
    "retail_da_spot_bidding_v1": ("售电公司日前现货申报优化模型", "面向售电公司日前现货场景，生成可解释、可审批、可复盘的申报策略建议。"),
    "compute_power_coordination_day_ahead_v1": ("智算园区日前算电协同联合优化模型", "在单次 MILP 求解中联合生成算力任务、GPU 集群、光伏、储能和电网购电计划。"),
}

# These built-in models have enabled Agent Skill packages and are part of the
# production Agent routing/evaluation contract.  Trial templates remain
# explicit-model-id only and must not be exposed as formal API Skills.
PUBLISHED_AGENT_TEMPLATE_CODES = {
    "cascade_hydro_dispatch",
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
        "contract_spot_exposure_v1": _contract_spot_exposure_v1(),
        "retail_da_spot_bidding_v1": _retail_da_spot_bidding_v1(),
        "compute_power_coordination_day_ahead_v1": _compute_power_coordination_day_ahead_v1(),
    }
    for code, template in templates.items():
        template.setdefault("code", code)
        template.setdefault("model_code", code)
        template["scenario_id"] = scenario_id_for_template(code)
        scenario = business_scenario_by_id(template["scenario_id"])
        template["scenario_name"] = scenario.get("label") if scenario else ""
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
        template.setdefault("ui_metadata", {})["description"] = template.get("description", template.get("scenario", ""))
        template["ui_metadata"]["scenario_id"] = template.get("scenario_id")
        template["ui_metadata"]["documentation_source"] = "template_definition"
        if code == "pv_storage_capacity_planning":
            _normalize_pv_storage_capacity_template(template)
        _normalize_template_time_sets(template)
        apply_time_dimension_metadata(template)
        template.setdefault("version", "v1.0")
        template.setdefault("status", "published")
        if code in PUBLISHED_AGENT_TEMPLATE_CODES:
            template["status"] = "published"
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
            apply_time_dimension_metadata(template)
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


def apply_time_dimension_metadata(template: dict[str, Any]) -> dict[str, Any]:
    explicit_metadata = deepcopy((template.get("ui_metadata") or {}).get("time_dimension") or {})
    code = str(template.get("model_code") or template.get("code") or "")
    sample = template.get("sample_runtime_parameters") or {}
    horizon = int(sample.get("horizon") or len(sample.get("time") or []) or 0)
    has_time = bool(sample.get("time") or any((item.get("code") or item.get("key")) == "time" for item in template.get("sets") or []))
    has_state_time = bool(sample.get("time_volume") or any((item.get("code") or item.get("key")) == "time_volume" for item in template.get("sets") or []))
    runtime_variable_codes = {
        "unit_commitment_day_ahead",
        "economic_dispatch",
        "storage_dispatch",
        "renewable_storage_dispatch",
        "chp_dispatch",
        "cascade_hydro_dispatch",
        "cascade_hydro_dispatch_v1",
        "pv_storage_day_ahead_dispatch",
        "pv_storage_intraday_dispatch",
        "pv_storage_dispatch_v2",
        "pv_storage_day_ahead_dispatch_v2",
        "pv_storage_intraday_dispatch_v2",
    }
    if not has_time:
        metadata = {"enabled": False, "policy": "not_applicable", "editable": False}
    elif code in runtime_variable_codes:
        metadata = {
            "enabled": True,
            "policy": "runtime_variable",
            "default_horizon": horizon or None,
            "time_set": "time",
            "state_time_set": "time_volume" if has_state_time else None,
            "interval_minutes": 60,
            "editable": True,
            "derive_from": None,
        }
    else:
        metadata = {
            "enabled": True,
            "policy": "fixed",
            "default_horizon": horizon or None,
            "time_set": "time",
            "state_time_set": "time_volume" if has_state_time else None,
            "editable": False,
        }
    metadata = {"schema_version": 1, **metadata, **explicit_metadata}
    template.setdefault("ui_metadata", {})["time_dimension"] = metadata
    if template.get("component_spec"):
        template["component_spec"].setdefault("ui_metadata", {})["time_dimension"] = deepcopy(metadata)
    if template.get("generic_spec"):
        template["generic_spec"].setdefault("ui_metadata", {})["time_dimension"] = deepcopy(metadata)
    return template


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


def _param(
    code: str,
    name: str,
    unit: str,
    dimension: list[str],
    source: str,
    sample: Any,
    validation: dict[str, Any] | None = None,
    default_policy: str | None = None,
) -> dict[str, Any]:
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
        **({"default_policy": default_policy} if default_policy else {}),
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
        "unit": ["U1", "U2", "U3"],
        "horizon": 4,
        "load_forecast": [120, 180, 210, 160],
        "renewable_forecast": [20, 30, 40, 20],
        "unit_min_output": {"U1": 50, "U2": 30, "U3": 20},
        "unit_max_output": {"U1": 180, "U2": 120, "U3": 80},
        "ramp_up_limit": {"U1": 80, "U2": 60, "U3": 40},
        "ramp_down_limit": {"U1": 80, "U2": 60, "U3": 40},
        "fuel_cost": {"U1": 280, "U2": 330, "U3": 420},
        "startup_cost": {"U1": 6000, "U2": 3500, "U3": 1500},
        "reserve_ratio": 0.1,
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
            _param("unit_min_output", "机组最小出力", "MW", ["unit"], "EAM", sample["unit_min_output"], {"type": "dict", "min": 0}, "default_allowed"),
            _param("unit_max_output", "机组最大出力", "MW", ["unit"], "EAM", sample["unit_max_output"], {"type": "dict", "min": 0}),
            _param("fuel_cost", "燃料成本", "元/MWh", ["unit"], "cost_system", sample["fuel_cost"], {"type": "dict", "min": 0}),
            _param("ramp_up_limit", "上爬坡限制", "MW/h", ["unit"], "EAM", sample["ramp_up_limit"], {"type": "dict", "min": 0}, "default_allowed"),
            _param("ramp_down_limit", "下爬坡限制", "MW/h", ["unit"], "EAM", sample["ramp_down_limit"], {"type": "dict", "min": 0}, "default_allowed"),
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
            _param("charge_efficiency", "充电效率", "p.u.", ["storage"], "BMS", sample["charge_efficiency"], {"type": "dict", "min": 0, "max": 1}, "default_allowed"),
            _param("discharge_efficiency", "放电效率", "p.u.", ["storage"], "BMS", sample["discharge_efficiency"], {"type": "dict", "min": 0, "max": 1}, "default_allowed"),
            _param("initial_soc", "初始SOC", "MWh", ["storage"], "BMS", sample["initial_soc"], {"type": "dict", "min": 0}, "default_allowed"),
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
        "hydro_power_mode": "linear",
        "load_tracking_mode": "soft",
        "objective_mode": "comprehensive",
        "terminal_storage_mode": "soft",
        "ramp_smoothing_enabled": True,
        "gen_flow_min": {"S1": 0, "S2": 0, "S3": 0},
        "gen_flow_max": {"S1": 900, "S2": 850, "S3": 800},
        "ecological_flow_min": {"S1": 80, "S2": 70, "S3": 60},
        "head_min": {"S1": 35, "S2": 35, "S3": 35},
        "head_max": {"S1": 65, "S2": 65, "S3": 65},
        "head_loss": {"S1": 0, "S2": 0, "S3": 0},
        "electricity_price": 300,
        "function_asset_bindings": {
            "level_storage": "cascade_hydro_level_storage_v1",
            "tailwater_outflow": "cascade_hydro_tailwater_outflow_v1",
            "power_flow_1d": "cascade_hydro_power_flow_v1",
            "power_surface": "cascade_hydro_power_surface_v1",
        },
        "weights": {"load_deviation": 1000, "spill": 1, "ramp": 0.1, "terminal_volume": 500, "generation": 1, "revenue": 1},
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
        {"name": "forebay_level", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "tailwater_level", "indices": ["station", "time"], "domain": "NonNegativeReals"},
        {"name": "head", "indices": ["station", "time"], "domain": "NonNegativeReals"},
    ]
    hydro_order = [
        "hydro_initial_volume",
        "hydro_volume_bounds",
        "hydro_station_available_capacity",
        "hydro_generation_flow_bounds",
        "hydro_outflow_balance",
        "hydro_outflow_bounds",
        "hydro_ecological_flow",
        "hydro_spill_bounds",
        "hydro_cascade_inflow_delay",
        "hydro_reservoir_balance",
        "hydro_load_tracking",
        "hydro_terminal_volume",
        "hydro_ramp_smoothing",
    ]
    catalog_by_id = {item["component_id"]: item for item in list_component_catalog()}
    components = [{"type": component_id} for component_id in hydro_order if component_id in catalog_by_id]
    components.insert(3, {"type": "hydro_power_flow_conversion", "enabled_when": {"parameter": "hydro_power_mode", "equals": "linear"}})
    components.insert(4, {
        "type": "function_mapping_component",
        "name": "一维严格流量出力映射",
        "function_asset_binding_key": "power_flow_1d",
        "function_asset_id": sample["function_asset_bindings"]["power_flow_1d"],
        "x": "q_gen[s,t]", "y": "station_power[s,t]",
        "indices": [{"set": "station", "alias": "s"}, {"set": "time", "alias": "t"}],
        "solve_strategy": "segment_binary",
        "domain_bounds": {"x_min_param": "gen_flow_min", "x_max_param": "gen_flow_max"},
        "out_of_domain_policy": "reject",
        "enabled_when": {"parameter": "hydro_power_mode", "equals": "pwl_1d"},
    })
    components[5:5] = [
        {
            "type": "function_mapping_component", "name": "水位库容严格 PWL 映射",
            "function_asset_binding_key": "level_storage", "function_asset_id": sample["function_asset_bindings"]["level_storage"],
            "x": "volume[s,t]", "y": "forebay_level[s,t]",
            "indices": [{"set": "station", "alias": "s"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "segment_binary",
            "domain_bounds": {"x_min_param": "volume_min", "x_max_param": "volume_max"},
            "out_of_domain_policy": "reject", "enabled_when": {"parameter": "hydro_power_mode", "equals": "pwl_2d"},
        },
        {
            "type": "function_mapping_component", "name": "尾水位流量严格 PWL 映射",
            "function_asset_binding_key": "tailwater_outflow", "function_asset_id": sample["function_asset_bindings"]["tailwater_outflow"],
            "x": "q_out[s,t]", "y": "tailwater_level[s,t]",
            "indices": [{"set": "station", "alias": "s"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "segment_binary",
            "domain_bounds": {"x_min_param": "outflow_min", "x_max_param": "outflow_max"},
            "out_of_domain_policy": "reject", "enabled_when": {"parameter": "hydro_power_mode", "equals": "pwl_2d"},
        },
        {"type": "hydro_head_calculation", "enabled_when": {"parameter": "hydro_power_mode", "equals": "pwl_2d"}},
        {
            "type": "function_mapping_2d_component", "name": "二维多三角片出力曲面",
            "function_asset_binding_key": "power_surface", "function_asset_id": sample["function_asset_bindings"]["power_surface"],
            "x": "q_gen[s,t]", "y": "head[s,t]", "z": "station_power[s,t]",
            "indices": [{"set": "station", "alias": "s"}, {"set": "time", "alias": "t"}],
            "solve_strategy": "triangulated_milp_exact",
            "domain_bounds": {"x_min_param": "gen_flow_min", "x_max_param": "gen_flow_max", "y_min_param": "head_min", "y_max_param": "head_max"},
            "out_of_domain_policy": "reject", "enabled_when": {"parameter": "hydro_power_mode", "equals": "pwl_2d"},
        },
    ]
    for component in components:
        if component.get("type") == "hydro_ramp_smoothing":
            component["enabled_when"] = {"parameter": "ramp_smoothing_enabled", "equals": True}
    component_spec = {
        "model_code": "cascade_hydro_dispatch",
        "build_mode": "component_based",
        "runtime_normalizer": "cascade_hydro",
        "name": "梯级水电日前调度优化模型",
        "model_problem_type": "LP",
        "required_solver_capabilities": ["LP"],
        "sets": [
            {"code": "station", "name": "电站清单", "values": sample["station"]},
            {"code": "unit", "name": "机组清单", "values": [unit for units in sample["units"].values() for unit in units]},
            {"code": "edge", "name": "梯级连接", "values": [f"{item['upstream']}->{item['downstream']}" for item in sample["edges"]]},
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
                {"term_id": "hydro_spill_penalty", "name": "弃水惩罚", "expression": "sum(q_spill[s,t] for s in station for t in time)", "weight_key": "spill", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_terminal_volume_penalty", "name": "期末库容偏差惩罚", "expression": "sum(terminal_dev_pos[s] + terminal_dev_neg[s] for s in station)", "weight_key": "terminal_volume", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_ramp_penalty", "name": "出力爬坡平滑惩罚", "expression": "sum(ramp_abs[s,t] for s in station for t in time)", "weight_key": "ramp", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_generation_value", "name": "发电量价值", "expression": "sum(station_power[s,t] for s in station for t in time)", "weight_key": "generation", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
                {"term_id": "hydro_revenue_value", "name": "发电收益", "expression": "sum(station_power[s,t] for s in station for t in time)", "weight_key": "revenue", "solve_participation": "solve_active", "supported_by_backend": True, "enabled": True},
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
        "version": "v1.1",
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
            _param("units", "电站机组清单", "", ["station"], "EAM", sample["units"], {"type": "dict"}),
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
            _param("hydro_power_mode", "水电出力关系", "", [], "dispatch_rule", sample["hydro_power_mode"], {"type": "string", "enum": ["linear", "pwl_1d", "pwl_2d"]}),
            _param("load_tracking_mode", "负荷跟踪模式", "", [], "dispatch_rule", sample["load_tracking_mode"], {"type": "string", "enum": ["disabled", "soft", "hard"]}),
            _param("objective_mode", "目标函数模式", "", [], "dispatch_rule", sample["objective_mode"], {"type": "string", "enum": ["generation_max", "revenue_max", "load_tracking", "comprehensive"]}),
            _param("terminal_storage_mode", "期末库容模式", "", [], "dispatch_rule", sample["terminal_storage_mode"], {"type": "string", "enum": ["soft", "hard"]}),
            _param("ramp_smoothing_enabled", "启用出力平滑", "", [], "dispatch_rule", sample["ramp_smoothing_enabled"], {"type": "boolean"}),
            _param("gen_flow_min", "最小发电流量", "m3/s", ["station"], "hydrology", sample["gen_flow_min"], {"type": "dict", "min": 0}),
            _param("gen_flow_max", "最大发电流量", "m3/s", ["station"], "hydrology", sample["gen_flow_max"], {"type": "dict", "min": 0}),
            _param("ecological_flow_min", "最小生态下泄", "m3/s", ["station"], "dispatch_rule", sample["ecological_flow_min"], {"type": "dict", "min": 0}),
            _param("head_min", "最小净水头", "m", ["station"], "hydrology", sample["head_min"], {"type": "dict"}),
            _param("head_max", "最大净水头", "m", ["station"], "hydrology", sample["head_max"], {"type": "dict"}),
            _param("head_loss", "水头损失", "m", ["station"], "hydrology", sample["head_loss"], {"type": "dict", "min": 0}),
            _param("electricity_price", "电价", "CNY/MWh", [], "market", sample["electricity_price"], {"type": "number"}),
            _param("function_asset_bindings", "函数资产绑定", "", [], "function_asset", sample["function_asset_bindings"], {"type": "dict"}),
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
            "display_problem_type": "线性规划 LP",
            "solver": "HiGHS",
            "runtime_validation": {
                "error_prefix": "梯级水电模型参数错误",
                "dimension_labels": {"unit": "机组"},
            },
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
                    "公式示例": "volume[s,tv+1] = volume[s,tv] + (inflow[s,t] - q_out[s,t]) * delta_v",
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
        "load_dev_pos": "超出负荷目标的正偏差（超发）",
        "load_dev_neg": "低于负荷目标的负偏差（缺额）",
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
    """Backward-compatible alias for the unified cascade hydro component model."""
    template = deepcopy(_cascade_hydro_dispatch())
    template.update(
        {
            "model_code": "cascade_hydro_dispatch_v1",
            "code": "cascade_hydro_dispatch_v1",
            "name": "梯级水电调度 v1（兼容入口）",
            "description": "Deprecated compatibility alias; use cascade_hydro_dispatch with hydro_power_mode=pwl_2d for new models.",
            "deprecated": True,
            "replacement_model_code": "cascade_hydro_dispatch",
            "version": "v1-compatible",
            "model_problem_type": "MILP",
            "problem_type": "MILP",
            "required_solver_capabilities": ["MILP"],
            "tags": ["power", "hydro", "cascade", "deprecated", "pwl_2d", "MILP"],
        }
    )
    sample = deepcopy(template["sample_runtime_parameters"])
    sample.update(
        {
            "hydro_power_mode": "pwl_2d",
            "load_tracking_mode": "soft",
            "objective_mode": "comprehensive",
            "station": ["R1", "R2"],
            "reservoir": ["R1", "R2"],
            "horizon": 24,
            "time": list(range(24)),
            "time_volume": list(range(25)),
            "local_inflow": {
                "R1": [92, 95, 98, 102, 108, 112, 116, 120, 118, 114, 110, 106, 104, 102, 100, 98, 96, 94, 92, 90, 88, 90, 92, 94],
                "R2": [24, 24, 25, 26, 28, 30, 32, 34, 33, 31, 30, 29, 28, 27, 26, 26, 25, 25, 24, 24, 23, 23, 24, 24],
            },
            "initial_volume": {"R1": 122, "R2": 108},
            "target_terminal_volume": {"R1": 120, "R2": 108},
            "volume_min": {"R1": 90, "R2": 85},
            "volume_max": {"R1": 160, "R2": 150},
            "outflow_min": {"R1": 40, "R2": 40},
            "outflow_max": {"R1": 160, "R2": 160},
            "gen_flow_min": {"R1": 40, "R2": 40},
            "gen_flow_max": {"R1": 160, "R2": 160},
            "spill_max": {"R1": 120, "R2": 120},
            "ecological_flow_min": {"R1": 40, "R2": 40},
            "head_min": {"R1": 35, "R2": 35},
            "head_max": {"R1": 65, "R2": 65},
            "head_loss": {"R1": 0, "R2": 0},
            "units": {"R1": ["R1_U1"], "R2": ["R2_U1"]},
            "unit_pmax": {"R1_U1": 95, "R2_U1": 95},
            "availability": {"R1_U1": [1] * 24, "R2_U1": [1] * 24},
            "power_conversion": {"R1": 0.4, "R2": 0.4},
            "load_forecast": [82, 80, 78, 76, 78, 82, 90, 98, 110, 116, 120, 118, 112, 108, 104, 106, 114, 122, 128, 124, 116, 104, 94, 88],
            "edges": [{"upstream": "R1", "downstream": "R2", "delay_periods": 0}],
            "initial_upstream_outflow": {"R1->R2": 95},
            "time_step_seconds": 3600,
            "delta_t": 1.0,
            "electricity_price": 300,
            "weights": {"load_deviation": 1000, "spill": 10, "ramp": 0.1, "terminal_volume": 500, "generation": 1, "revenue": 1},
        }
    )
    sample.update(
        {
            "inflow": deepcopy(sample["local_inflow"]),
            "initial_storage": deepcopy(sample["initial_volume"]),
            "target_final_storage": deepcopy(sample["target_terminal_volume"]),
            "storage_min": deepcopy(sample["volume_min"]),
            "storage_max": deepcopy(sample["volume_max"]),
            "power_min": {"R1": 0, "R2": 0},
            "power_max": {"R1": 95, "R2": 95},
            "cascade_delay": {"R1": 0, "R2": 0},
            "upstream_station": {"R2": "R1"},
            "penalty_spill": 10.0,
            "penalty_storage_deviation": 500.0,
        }
    )
    template["sample_runtime_parameters"] = sample
    template["component_spec"] = deepcopy(template["component_spec"])
    template["component_spec"]["runtime_defaults"] = {"hydro_power_mode": "pwl_2d", "load_tracking_mode": "soft"}
    template["component_spec"]["name"] = template["name"]
    alias_sets = {
        "station": sample["station"],
        "unit": ["R1_U1", "R2_U1"],
        "edge": ["R1->R2"],
        "time": sample["time"],
        "time_volume": sample["time_volume"],
    }
    for set_spec in template["component_spec"].get("sets") or []:
        code = set_spec.get("code") or set_spec.get("name")
        if code in alias_sets:
            set_spec["values"] = deepcopy(alias_sets[code])
    template["ui_metadata"] = {
        **(template.get("ui_metadata") or {}),
        "display_build_mode": "组件化 Builder（统一模型兼容入口）",
        "deprecated": True,
        "replacement_model_code": "cascade_hydro_dispatch",
        "migration_defaults": {"hydro_power_mode": "pwl_2d"},
    }
    return template




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


def _quarter_hour_time_labels(horizon: int = 96) -> list[str]:
    return [f"{(index * 15) // 60:02d}:{(index * 15) % 60:02d}" for index in range(horizon)]


def _market_load_curve(horizon: int = 96) -> list[float]:
    curve = []
    for index in range(horizon):
        hour = index / 4
        if hour < 6:
            value = 78 + 2.5 * hour
        elif hour < 12:
            value = 93 + 6.5 * (hour - 6)
        elif hour < 17:
            value = 132 - 1.2 * (hour - 12)
        elif hour < 21:
            value = 132 + 7.5 * (hour - 17)
        else:
            value = 162 - 13 * (hour - 21)
        curve.append(round(value, 3))
    return curve


def _market_price_curve(horizon: int = 96) -> list[float]:
    curve = []
    for index in range(horizon):
        hour = index / 4
        if hour < 6:
            value = 180 + 8 * hour
        elif hour < 11:
            value = 260 + 28 * (hour - 6)
        elif hour < 17:
            value = 420 + 10 * (hour - 11)
        elif hour < 21:
            value = 520 + 48 * (hour - 17)
        else:
            value = 520 - 38 * (hour - 21)
        curve.append(round(value, 3))
    return curve


def _market_contract_spot_sample(horizon: int = 96) -> dict[str, Any]:
    time = list(range(horizon))
    load = _market_load_curve(horizon)
    price = _market_price_curve(horizon)
    contract_ratio = 0.76
    return {
        "horizon": horizon,
        "time": time,
        "time_labels": _quarter_hour_time_labels(horizon),
        "delta_t": 0.25,
        "load_forecast": load,
        "contract_total": round(sum(load) * contract_ratio, 3),
        "contract_price": 360,
        "spot_price_forecast": price,
        "max_exposure_ratio": [0.4 for _ in time],
        "deviation_penalty": [round(45 + max(0.0, p - 420) * 0.18, 3) for p in price],
    }


def _market_retail_da_sample(horizon: int = 96) -> dict[str, Any]:
    time = list(range(horizon))
    load = _market_load_curve(horizon)
    price = _market_price_curve(horizon)
    contract_energy = [round(value * (0.74 + (0.04 if 8 <= index / 4 <= 20 else 0.0)), 3) for index, value in enumerate(load)]
    flex_up = []
    flex_down = []
    for index, value in enumerate(load):
        hour = index / 4
        flex_up.append(round(value * (0.13 if hour < 6 or hour >= 22 else 0.06), 3))
        flex_down.append(round(value * (0.14 if 17 <= hour < 21 else 0.05), 3))
    return {
        "horizon": horizon,
        "time": time,
        "time_volume": list(range(horizon + 1)),
        "time_labels": _quarter_hour_time_labels(horizon),
        "delta_t": 0.25,
        "load_forecast": load,
        "spot_price_forecast": price,
        "contract_energy": contract_energy,
        "contract_price": [360 for _ in time],
        "bid_min": [0 for _ in time],
        "bid_max": [round(value * 0.6, 3) for value in load],
        "deviation_penalty": [round(420 + max(0.0, p - 450) * 0.5, 3) for p in price],
        "storage_capacity": 180,
        "storage_soc_init": 90,
        "storage_soc_min": 30,
        "storage_soc_max": 160,
        "terminal_soc_target": 90,
        "terminal_soc_penalty": 1200,
        "charge_max": 80,
        "discharge_max": 80,
        "charge_efficiency": 0.95,
        "discharge_efficiency": 0.92,
        "storage_cycle_cost": 8,
        "flex_up": flex_up,
        "flex_down": flex_down,
        "cut_limit": [0 for _ in time],
        "shift_cost": [round(10 + (6 if 17 <= index / 4 < 21 else 0), 3) for index in time],
        "cut_cost": [1000 for _ in time],
    }


def _contract_spot_exposure_v1() -> dict[str, Any]:
    sample = _market_contract_spot_sample()
    template = _base(
        "contract_spot_exposure_v1",
        "中长期合约分解与现货暴露控制模型",
        "中长期合约分解与现货暴露控制，生成可审批的合约使用曲线和现货暴露建议。",
        ["power", "market_trading", "spot", "contract", "LP", "HiGHS"],
    )
    sets = [{"code": "time", "name": "交易时段", "values": sample["time"]}]
    parameters = [
        _param("horizon", "优化时段数", "period", [], "trading_plan", sample["horizon"], {"type": "integer", "min": 1}),
        _param("time", "交易时段", "", ["time"], "trading_plan", sample["time"], {"type": "array"}),
        _param("time_labels", "交易时段标签", "", ["time"], "trading_plan", sample["time_labels"], {"type": "array"}),
        _param("delta_t", "时间步长", "h", [], "trading_plan", sample["delta_t"], {"type": "number", "min": 0}),
        _param("load_forecast", "负荷预测", "MWh", ["time"], "forecast", sample["load_forecast"], {"type": "array", "min": 0}),
        _param("contract_total", "中长期合约总电量", "MWh", [], "contract", sample["contract_total"], {"type": "number", "min": 0}),
        _param("contract_price", "中长期合约价格", "元/MWh", [], "contract", sample["contract_price"], {"type": "number", "min": 0}),
        _param("spot_price_forecast", "现货价格预测", "元/MWh", ["time"], "market", sample["spot_price_forecast"], {"type": "array", "min": 0}),
        _param("max_exposure_ratio", "最大现货暴露比例", "p.u.", ["time"], "risk_control", sample["max_exposure_ratio"], {"type": "array", "min": 0, "max": 1}),
        _param("deviation_penalty", "暴露风险惩罚", "元/MWh", ["time"], "risk_control", sample["deviation_penalty"], {"type": "array", "min": 0}),
    ]
    variables = [
        {**_var("contract_use", "中长期合约使用电量", "MWh", ["time"]), "lower_bound": 0},
        {**_var("spot_exposure", "现货暴露电量", "MWh", ["time"]), "lower_bound": 0},
    ]
    component_definition = {
        "component_id": "contract_spot_exposure_formula_block",
        "type": "contract_spot_exposure_formula_block",
        "name": "中长期合约现货暴露通用公式约束",
        "status": "published",
        "enabled": True,
        "sets": sets,
        "parameters": parameters,
        "variables": variables,
        "generated_constraints": [
            {"constraint_id": "energy_balance", "name": "合约与现货暴露平衡", "indices": [{"set": "time", "alias": "t"}], "expression": "contract_use[t] + spot_exposure[t] == load_forecast[t]"},
            {"constraint_id": "contract_total_balance", "name": "合约总电量一致", "indices": [], "expression": "sum(contract_use[t] for t in time) == contract_total"},
            {"constraint_id": "spot_exposure_limit", "name": "现货暴露比例上限", "indices": [{"set": "time", "alias": "t"}], "expression": "spot_exposure[t] <= max_exposure_ratio[t] * load_forecast[t]"},
        ],
    }
    objective_terms = [
        {
            "term_id": "total_expected_cost",
            "name": "合约成本、现货预期成本与暴露风险惩罚",
            "weight_key": "contract_spot_total_expected_cost",
            "weight": 1,
            "solve_participation": "solve_active",
            "supported_by_backend": True,
            "expression": "sum(contract_price * contract_use[t] + spot_price_forecast[t] * spot_exposure[t] + deviation_penalty[t] * spot_exposure[t] for t in time)",
        }
    ]
    component_spec = {
        "model_code": "contract_spot_exposure_v1",
        "build_mode": "component_based",
        "name": "中长期合约分解与现货暴露控制模型",
        "model_problem_type": "LP",
        "required_solver_capabilities": ["LP"],
        "sets": sets,
        "parameters": parameters,
        "variables": variables,
        "components": [{"type": "contract_spot_exposure_formula_block", "version": "1.0.0", "definition": {**component_definition, "version": "1.0.0"}}],
        "objective": {"type": "weighted_sum", "sense": "minimize", "terms": objective_terms, "weights": {}},
        "output_contract": {
            "series_index_set": "time",
            "execution_policy": "advisory_only",
            "requires_human_review": True,
            "series_fields": [
                {"key": "time_label", "expression": "time_labels[t]"},
                {"key": "load_forecast", "expression": "load_forecast[t]"},
                {"key": "contract_use", "expression": "contract_use[t]"},
                {"key": "spot_exposure", "expression": "spot_exposure[t]"},
                {"key": "spot_exposure_ratio", "expression": "spot_exposure[t] / load_forecast[t]"},
                {"key": "max_exposure_ratio", "expression": "max_exposure_ratio[t]"},
                {"key": "contract_price", "expression": "contract_price"},
                {"key": "spot_price_forecast", "expression": "spot_price_forecast[t]"},
                {"key": "deviation_penalty", "expression": "deviation_penalty[t]"},
            ],
            "curves": [
                {"key": "contract_use_curve", "fields": {"contract_use": "contract_use[t]"}},
                {"key": "spot_exposure_curve", "fields": {"spot_exposure": "spot_exposure[t]"}},
                {"key": "spot_exposure_ratio_curve", "fields": {"spot_exposure_ratio": "spot_exposure[t] / load_forecast[t]", "max_exposure_ratio": "max_exposure_ratio[t]"}},
            ],
            "chart_fields": ["load_forecast", "contract_use", "spot_exposure", "spot_exposure_ratio"],
        },
        "metrics_config": {
            "metrics": [
                {"key": "total_contract_cost", "expression": "sum(contract_price * contract_use[t] for t in time)"},
                {"key": "total_spot_expected_cost", "expression": "sum(spot_price_forecast[t] * spot_exposure[t] for t in time)"},
                {"key": "total_risk_penalty", "expression": "sum(deviation_penalty[t] * spot_exposure[t] for t in time)"},
                {"key": "total_expected_cost", "expression": "total_contract_cost + total_spot_expected_cost + total_risk_penalty"},
                {"key": "total_contract_energy", "expression": "sum(contract_use[t] for t in time)"},
                {"key": "total_spot_exposure", "expression": "sum(spot_exposure[t] for t in time)"},
                {"key": "contract_total_gap", "expression": "abs(sum(contract_use[t] for t in time) - contract_total)"},
                {"key": "max_spot_exposure_violation", "expression": "max(spot_exposure[t] - max_exposure_ratio[t] * load_forecast[t] for t in time)"},
            ],
            "business_metrics": ["total_contract_cost", "total_spot_expected_cost", "total_risk_penalty", "total_expected_cost", "contract_total_gap", "max_spot_exposure_violation"],
            "lists": [
                {
                    "key": "high_risk_periods",
                    "foreach": "time",
                    "where_all": ["spot_exposure[t] / load_forecast[t] >= max_exposure_ratio[t] * 0.9", "spot_exposure[t] > 0.000001"],
                    "fields": {"spot_exposure": "spot_exposure[t]", "spot_exposure_ratio": "spot_exposure[t] / load_forecast[t]", "max_exposure_ratio": "max_exposure_ratio[t]"},
                }
            ],
        },
        "constraint_check_config": {
            "tolerance": 1e-5,
            "include_metrics": ["contract_total_gap", "max_spot_exposure_violation"],
            "checks": [
                {"key": "contract_total_satisfied", "expression": "contract_total_gap <= tolerance"},
                {"key": "spot_exposure_within_limit", "expression": "max_spot_exposure_violation <= tolerance"},
            ],
        },
        "precheck_config": {
            "checks": [
                {
                    "key": "max_exposure_ratio_range",
                    "expression": "all(0 <= max_exposure_ratio[t] <= 1 for t in time)",
                    "error_message": "现货最大暴露比例必须全部位于 0 到 1 之间，请检查 max_exposure_ratio。",
                },
                {
                    "key": "load_forecast_non_negative",
                    "expression": "all(load_forecast[t] >= 0 for t in time)",
                    "error_message": "负荷预测不能为负，请检查 load_forecast。",
                },
                {
                    "key": "contract_total_not_exceed_load",
                    "expression": "contract_total <= sum(load_forecast[t] for t in time)",
                    "error_message": "中长期合约总电量不能超过预测总负荷，否则无法满足合约分解约束。",
                },
                {
                    "key": "contract_total_covers_min_required_contract",
                    "expression": "contract_total >= sum((1 - max_exposure_ratio[t]) * load_forecast[t] for t in time)",
                    "error_message": "中长期合约总电量低于现货暴露上限约束要求的最低合约电量，模型不可行，请提高 contract_total 或放宽 max_exposure_ratio。",
                },
            ],
        },
        "explanation_config": {
            "summary": "中长期合约分解与现货暴露控制模型已完成求解，结果包含合约使用曲线、现货暴露曲线、暴露比例和成本拆解。",
            "advisory": "平台只生成策略建议，不替代电力交易平台、不执行申报、不自动下单。",
            "execution_policy": "advisory_only",
            "requires_human_review": True,
            "strategy_templates": [
                "合约总电量按约束分解为 {total_contract_energy} MWh，现货暴露合计 {total_spot_exposure} MWh。",
                "预期总成本为 {total_expected_cost} 元，其中合约成本 {total_contract_cost} 元、现货预期成本 {total_spot_expected_cost} 元、风险惩罚 {total_risk_penalty} 元。",
                "本结果仅作为中长期合约分解和现货暴露控制建议，需人工审批后再在外部交易系统处理。",
            ],
            "approval_items": [
                "复核负荷预测、合约总电量和现货价格预测来源。",
                "复核高风险时段的现货暴露比例是否符合公司风控策略。",
                "确认平台不执行申报、不连接交易平台、不自动下单。",
            ],
        },
    }
    template.update(
        {
            "build_mode": "component_based",
            "problem_type": "LP",
            "model_problem_type": "LP",
            "required_solver_capabilities": ["LP"],
            "solver": "HiGHS",
            "business_objects": [
                {"code": "retailer", "name": "售电公司", "object_type": "market_participant", "source_system": "market_data"},
                {"code": "time", "name": "交易时段", "object_type": "time", "source_system": "trading_plan"},
            ],
            "sets": sets,
            "parameters": parameters,
            "variables": variables,
            "constraints": [
                _constraint("energy_balance", "合约与现货暴露平衡", "contract_use[time] + spot_exposure[time] = load_forecast[time]", ["time"]),
                _constraint("contract_total_balance", "合约总电量一致", "sum(contract_use[time]) = contract_total", ["time"]),
                _constraint("spot_exposure_limit", "现货暴露比例上限", "spot_exposure[time] <= max_exposure_ratio[time] * load_forecast[time]", ["time"]),
            ],
            "objectives": [
                _objective(
                    "total_expected_cost_min",
                    "最小化合约成本、现货预期成本与暴露风险惩罚",
                    "minimize",
                    "sum(contract_price*contract_use[t] + spot_price_forecast[t]*spot_exposure[t] + deviation_penalty[t]*spot_exposure[t])",
                )
            ],
            "sample_runtime_parameters": sample,
            "component_spec": component_spec,
            "output_contract": component_spec["output_contract"],
            "metrics_config": component_spec["metrics_config"],
            "constraint_check_config": component_spec["constraint_check_config"],
            "precheck_config": component_spec["precheck_config"],
            "explanation_config": component_spec["explanation_config"],
            "ui_metadata": {
                "execution_policy": "advisory_only",
                "requires_human_review": True,
                "capability_boundary": "平台只生成合约分解和现货暴露控制建议，不连接交易平台、不执行申报、不自动下单。",
                "generic_modeling_template": True,
            },
        }
    )
    return template


def _retail_da_spot_bidding_v1() -> dict[str, Any]:
    sample = _market_retail_da_sample()
    template = _base(
        "retail_da_spot_bidding_v1",
        "售电公司日前现货申报优化模型",
        "售电公司日前现货申报优化，协同合约电量、储能、可调负荷和偏差风险生成策略建议。",
        ["power", "market_trading", "spot", "retail", "MILP", "HiGHS"],
    )
    sets = [
        {"code": "time", "name": "日前交易时段", "values": sample["time"]},
        {"code": "time_volume", "name": "储能SOC时点", "type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1", "values": sample["time_volume"]},
    ]
    parameters = [
        _param("horizon", "优化时段数", "period", [], "trading_plan", sample["horizon"], {"type": "integer", "min": 1}),
        _param("time", "日前交易时段", "", ["time"], "trading_plan", sample["time"], {"type": "array"}),
        _param("time_volume", "储能SOC时点", "", ["time_volume"], "trading_plan", sample["time_volume"], {"type": "array"}),
        _param("time_labels", "日前交易时段标签", "", ["time"], "trading_plan", sample["time_labels"], {"type": "array"}),
        _param("delta_t", "时间步长", "h", [], "trading_plan", sample["delta_t"], {"type": "number", "min": 0}),
        _param("load_forecast", "负荷预测", "MWh", ["time"], "forecast", sample["load_forecast"], {"type": "array", "min": 0}),
        _param("spot_price_forecast", "日前现货价格预测", "元/MWh", ["time"], "market", sample["spot_price_forecast"], {"type": "array", "min": 0}),
        _param("contract_energy", "中长期合约分时电量", "MWh", ["time"], "contract", sample["contract_energy"], {"type": "array", "min": 0}),
        _param("contract_price", "中长期合约分时价格", "元/MWh", ["time"], "contract", sample["contract_price"], {"type": "array", "min": 0}),
        _param("bid_min", "日前现货申报下限", "MWh", ["time"], "risk_control", sample["bid_min"], {"type": "array", "min": 0}),
        _param("bid_max", "日前现货申报上限", "MWh", ["time"], "risk_control", sample["bid_max"], {"type": "array", "min": 0}),
        _param("deviation_penalty", "偏差风险惩罚", "元/MWh", ["time"], "risk_control", sample["deviation_penalty"], {"type": "array", "min": 0}),
        _param("storage_capacity", "储能容量", "MWh", [], "BMS", sample["storage_capacity"], {"type": "number", "min": 0}),
        _param("storage_soc_init", "初始SOC", "MWh", [], "BMS", sample["storage_soc_init"], {"type": "number", "min": 0}),
        _param("storage_soc_min", "SOC下限", "MWh", [], "BMS", sample["storage_soc_min"], {"type": "number", "min": 0}),
        _param("storage_soc_max", "SOC上限", "MWh", [], "BMS", sample["storage_soc_max"], {"type": "number", "min": 0}),
        _param("terminal_soc_target", "期末SOC目标", "MWh", [], "BMS", sample["terminal_soc_target"], {"type": "number", "min": 0}),
        _param("terminal_soc_penalty", "期末SOC偏差惩罚", "元/MWh", [], "risk_control", sample["terminal_soc_penalty"], {"type": "number", "min": 0}),
        _param("charge_max", "最大充电功率", "MW", [], "BMS", sample["charge_max"], {"type": "number", "min": 0}),
        _param("discharge_max", "最大放电功率", "MW", [], "BMS", sample["discharge_max"], {"type": "number", "min": 0}),
        _param("charge_efficiency", "充电效率", "p.u.", [], "BMS", sample["charge_efficiency"], {"type": "number", "min": 0, "max": 1}),
        _param("discharge_efficiency", "放电效率", "p.u.", [], "BMS", sample["discharge_efficiency"], {"type": "number", "min": 0, "max": 1}),
        _param("storage_cycle_cost", "储能循环成本", "元/MWh", [], "asset", sample["storage_cycle_cost"], {"type": "number", "min": 0}),
        _param("flex_up", "负荷可上调空间", "MWh", ["time"], "load_flex", sample["flex_up"], {"type": "array", "min": 0}),
        _param("flex_down", "负荷可下调空间", "MWh", ["time"], "load_flex", sample["flex_down"], {"type": "array", "min": 0}),
        _param("cut_limit", "可削减负荷上限", "MWh", ["time"], "load_flex", sample["cut_limit"], {"type": "array", "min": 0}),
        _param("shift_cost", "负荷转移成本", "元/MWh", ["time"], "load_flex", sample["shift_cost"], {"type": "array", "min": 0}),
        _param("cut_cost", "负荷削减成本", "元/MWh", ["time"], "load_flex", sample["cut_cost"], {"type": "array", "min": 0}),
    ]
    variables = [
        {**_var("spot_buy", "日前现货购电申报建议", "MWh", ["time"]), "lower_bound": "bid_min", "upper_bound": "bid_max"},
        {**_var("charge", "储能充电功率", "MW", ["time"]), "lower_bound": 0, "upper_bound": "charge_max"},
        {**_var("discharge", "储能放电功率", "MW", ["time"]), "lower_bound": 0, "upper_bound": "discharge_max"},
        {**_var("soc", "储能SOC", "MWh", ["time_volume"]), "lower_bound": "storage_soc_min", "upper_bound": "storage_soc_max"},
        {**_var("is_charging", "充电状态", "0/1", ["time"], "Binary")},
        {**_var("is_discharging", "放电状态", "0/1", ["time"], "Binary")},
        {**_var("load_shift_out", "负荷移出电量", "MWh", ["time"]), "lower_bound": 0, "upper_bound": "flex_down"},
        {**_var("load_shift_in", "负荷移入电量", "MWh", ["time"]), "lower_bound": 0, "upper_bound": "flex_up"},
        {**_var("load_cut", "负荷削减电量", "MWh", ["time"]), "lower_bound": 0, "upper_bound": "cut_limit"},
        {**_var("deviation_short", "短缺偏差", "MWh", ["time"]), "lower_bound": 0},
        {**_var("deviation_long", "多余偏差", "MWh", ["time"]), "lower_bound": 0},
        {**_var("terminal_soc_dev_pos", "期末SOC正偏差", "MWh", []), "lower_bound": 0},
        {**_var("terminal_soc_dev_neg", "期末SOC负偏差", "MWh", []), "lower_bound": 0},
    ]
    component_definition = {
        "component_id": "retail_da_spot_bidding_formula_block",
        "type": "retail_da_spot_bidding_formula_block",
        "name": "日前现货申报通用公式约束",
        "status": "published",
        "enabled": True,
        "sets": sets,
        "parameters": parameters,
        "variables": variables,
        "generated_constraints": [
            {"constraint_id": "energy_balance", "name": "电量平衡", "indices": [{"set": "time", "alias": "t"}], "expression": "contract_energy[t] + spot_buy[t] + discharge[t] * delta_t + deviation_short[t] == load_forecast[t] + load_shift_in[t] - load_shift_out[t] - load_cut[t] + charge[t] * delta_t + deviation_long[t]"},
            {"constraint_id": "soc_initial", "name": "储能初始SOC", "indices": [], "expression": "soc[0] == storage_soc_init"},
            {"constraint_id": "soc_transition", "name": "储能SOC递推", "indices": [{"set": "time", "alias": "t"}], "expression": "soc[t+1] == soc[t] + charge[t] * charge_efficiency * delta_t - discharge[t] / discharge_efficiency * delta_t", "boundary_strategy": "skip_out_of_range"},
            {"constraint_id": "charge_binary_link", "name": "充电状态联动", "indices": [{"set": "time", "alias": "t"}], "expression": "charge[t] <= is_charging[t] * charge_max"},
            {"constraint_id": "discharge_binary_link", "name": "放电状态联动", "indices": [{"set": "time", "alias": "t"}], "expression": "discharge[t] <= is_discharging[t] * discharge_max"},
            {"constraint_id": "charge_discharge_mutex", "name": "充放电互斥", "indices": [{"set": "time", "alias": "t"}], "expression": "is_charging[t] + is_discharging[t] <= 1"},
            {"constraint_id": "shift_energy_balance", "name": "负荷转移总量守恒", "indices": [], "expression": "sum(load_shift_out[t] for t in time) == sum(load_shift_in[t] for t in time)"},
            {"constraint_id": "terminal_soc_tracking", "name": "期末SOC偏差约束", "indices": [], "expression": "soc[horizon] + terminal_soc_dev_pos - terminal_soc_dev_neg == terminal_soc_target"},
        ],
    }
    objective_terms = [
        {
            "term_id": "total_expected_cost",
            "name": "合约、现货、储能、可调负荷和偏差风险总成本",
            "weight_key": "retail_da_total_expected_cost",
            "weight": 1,
            "solve_participation": "solve_active",
            "supported_by_backend": True,
            "expression": "sum(contract_price[t] * contract_energy[t] + spot_price_forecast[t] * spot_buy[t] + storage_cycle_cost * (charge[t] + discharge[t]) * delta_t + shift_cost[t] * (load_shift_in[t] + load_shift_out[t]) + cut_cost[t] * load_cut[t] + deviation_penalty[t] * (deviation_short[t] + deviation_long[t]) for t in time) + terminal_soc_penalty * (terminal_soc_dev_pos + terminal_soc_dev_neg)",
        }
    ]
    component_spec = {
        "model_code": "retail_da_spot_bidding_v1",
        "build_mode": "component_based",
        "name": "售电公司日前现货申报优化模型",
        "model_problem_type": "MILP",
        "required_solver_capabilities": ["MILP"],
        "sets": sets,
        "parameters": parameters,
        "variables": variables,
        "components": [{"type": "retail_da_spot_bidding_formula_block", "version": "1.0.0", "definition": {**component_definition, "version": "1.0.0"}}],
        "objective": {"type": "weighted_sum", "sense": "minimize", "terms": objective_terms, "weights": {}},
        "output_contract": {
            "series_index_set": "time",
            "execution_policy": "advisory_only",
            "requires_human_review": True,
            "series_fields": [
                {"key": "time_label", "expression": "time_labels[t]"},
                {"key": "spot_buy", "expression": "spot_buy[t]"},
                {"key": "contract_energy", "expression": "contract_energy[t]"},
                {"key": "load_forecast", "expression": "load_forecast[t]"},
                {"key": "adjusted_load", "expression": "load_forecast[t] + load_shift_in[t] - load_shift_out[t] - load_cut[t]"},
                {"key": "charge", "expression": "charge[t]"},
                {"key": "discharge", "expression": "discharge[t]"},
                {"key": "soc", "expression": "soc[t]"},
                {"key": "load_shift_out", "expression": "load_shift_out[t]"},
                {"key": "load_shift_in", "expression": "load_shift_in[t]"},
                {"key": "load_cut", "expression": "load_cut[t]"},
                {"key": "deviation_short", "expression": "deviation_short[t]"},
                {"key": "deviation_long", "expression": "deviation_long[t]"},
                {"key": "spot_price_forecast", "expression": "spot_price_forecast[t]"},
            ],
            "curves": [
                {"key": "spot_buy_curve", "fields": {"spot_buy": "spot_buy[t]"}},
                {"key": "contract_energy_curve", "fields": {"contract_energy": "contract_energy[t]"}},
                {"key": "load_forecast_curve", "fields": {"load_forecast": "load_forecast[t]"}},
                {"key": "adjusted_load_curve", "fields": {"adjusted_load": "load_forecast[t] + load_shift_in[t] - load_shift_out[t] - load_cut[t]"}},
                {"key": "charge_curve", "fields": {"charge": "charge[t]"}},
                {"key": "discharge_curve", "fields": {"discharge": "discharge[t]"}},
                {"key": "soc_curve", "fields": {"soc": "soc[t]"}},
                {"key": "load_shift_out_curve", "fields": {"load_shift_out": "load_shift_out[t]"}},
                {"key": "load_shift_in_curve", "fields": {"load_shift_in": "load_shift_in[t]"}},
                {"key": "load_cut_curve", "fields": {"load_cut": "load_cut[t]"}},
                {"key": "deviation_short_curve", "fields": {"deviation_short": "deviation_short[t]"}},
                {"key": "deviation_long_curve", "fields": {"deviation_long": "deviation_long[t]"}},
            ],
            "chart_fields": ["spot_buy", "contract_energy", "load_forecast", "adjusted_load", "soc"],
        },
        "metrics_config": {
            "metrics": [
                {"key": "average_spot_price", "name": "平均现货价格", "expression": "avg(spot_price_forecast)"},
                {"key": "contract_cost", "name": "合约成本", "expression": "sum(contract_price[t] * contract_energy[t] for t in time)"},
                {"key": "spot_purchase_cost", "name": "现货购电成本", "expression": "sum(spot_price_forecast[t] * spot_buy[t] for t in time)"},
                {"key": "storage_cycle_cost_total", "name": "储能循环总成本", "expression": "sum(storage_cycle_cost * (charge[t] + discharge[t]) * delta_t for t in time)"},
                {"key": "flex_load_cost", "name": "可调负荷成本", "expression": "sum(shift_cost[t] * (load_shift_in[t] + load_shift_out[t]) for t in time)"},
                {"key": "cut_load_cost", "name": "负荷削减成本", "expression": "sum(cut_cost[t] * load_cut[t] for t in time)"},
                {"key": "deviation_risk_cost", "name": "偏差风险成本", "expression": "sum(deviation_penalty[t] * (deviation_short[t] + deviation_long[t]) for t in time)"},
                {"key": "total_expected_cost", "name": "预期总成本", "expression": "contract_cost + spot_purchase_cost + storage_cycle_cost_total + flex_load_cost + cut_load_cost + deviation_risk_cost + terminal_soc_penalty * (terminal_soc_dev_pos + terminal_soc_dev_neg)"},
                {"key": "total_spot_buy_energy", "name": "现货购电总量", "expression": "sum(spot_buy[t] for t in time)"},
                {"key": "total_load_cut", "name": "负荷削减总量", "expression": "sum(load_cut[t] for t in time)"},
                {"key": "deviation_short_total", "name": "短缺偏差总量", "expression": "sum(deviation_short[t] for t in time)"},
                {"key": "deviation_long_total", "name": "富余偏差总量", "expression": "sum(deviation_long[t] for t in time)"},
                {"key": "terminal_soc_penalty_cost", "name": "期末 SOC 偏差成本", "expression": "terminal_soc_penalty * (terminal_soc_dev_pos + terminal_soc_dev_neg)"},
                {"key": "shift_balance_gap", "name": "负荷转移平衡差", "expression": "abs(sum(load_shift_out[t] for t in time) - sum(load_shift_in[t] for t in time))"},
                {"key": "soc_min_actual", "name": "实际最低 SOC", "expression": "min(soc[tv] for tv in time_volume)"},
                {"key": "soc_max_actual", "name": "实际最高 SOC", "expression": "max(soc[tv] for tv in time_volume)"},
                {"key": "charge_discharge_conflict_count", "name": "充放电冲突次数", "expression": "sum(charge[t] > 0.000001 and discharge[t] > 0.000001 for t in time)"},
                {"key": "terminal_soc_gap", "name": "期末 SOC 偏差", "expression": "abs(soc[horizon] - terminal_soc_target)"},
            ],
            "business_metrics": [
                "total_expected_cost",
                "contract_cost",
                "spot_purchase_cost",
                "storage_cycle_cost_total",
                "flex_load_cost",
                "cut_load_cost",
                "deviation_risk_cost",
                "terminal_soc_penalty_cost",
                "total_load_cut",
                "shift_balance_gap",
                "soc_min_actual",
                "soc_max_actual",
                "charge_discharge_conflict_count",
                "terminal_soc_gap",
            ],
            "lists": [
                {"key": "high_price_periods", "foreach": "time", "where": "spot_price_forecast[t] >= average_spot_price", "fields": {"spot_price_forecast": "spot_price_forecast[t]"}},
                {"key": "high_exposure_periods", "foreach": "time", "where": "spot_buy[t] / load_forecast[t] >= 0.3 or deviation_short[t] > 0.000001 or deviation_long[t] > 0.000001", "fields": {"spot_buy": "spot_buy[t]", "exposure_ratio": "spot_buy[t] / load_forecast[t]", "deviation_short": "deviation_short[t]", "deviation_long": "deviation_long[t]"}},
            ],
            "objects": [
                {"key": "risk_summary", "source": "risk_summary", "metric_fields": ["deviation_risk_cost"], "static": {"advisory_only": True}},
                {"key": "day_ahead_bid_advice", "source": "series"},
                {"key": "cost_breakdown", "source": "cost_breakdown", "fields": ["contract_cost", "spot_purchase_cost", "storage_cycle_cost_total", "flex_load_cost", "cut_load_cost", "deviation_risk_cost", "terminal_soc_penalty_cost", "total_expected_cost"]},
                {"key": "imbalance_risk", "source": "metrics", "fields": ["deviation_short_total", "deviation_long_total", "deviation_risk_cost"]},
            ],
        },
        "constraint_check_config": {
            "tolerance": 1e-5,
            "include_metrics": ["shift_balance_gap", "soc_min_actual", "soc_max_actual", "charge_discharge_conflict_count", "terminal_soc_gap"],
            "checks": [
                {"key": "load_shift_energy_balanced", "expression": "shift_balance_gap <= tolerance"},
                {"key": "soc_within_bounds", "expression": "soc_min_actual >= storage_soc_min - tolerance and soc_max_actual <= storage_soc_max + tolerance"},
                {"key": "charge_discharge_exclusive", "expression": "charge_discharge_conflict_count <= tolerance"},
                {"key": "terminal_soc_satisfied", "expression": "terminal_soc_gap <= tolerance"},
            ],
        },
        "explanation_config": {
            "summary": "售电公司日前现货申报优化模型已完成求解，结果包含申报建议、合约电量、储能充放电、可调负荷调整、偏差风险和成本拆解。",
            "advisory": "平台只生成策略建议，不替代电力交易平台、不执行申报、不自动下单。",
            "execution_policy": "advisory_only",
            "requires_human_review": True,
            "strategy_templates": [
                "日前现货建议申报电量合计 {total_spot_buy_energy} MWh，预期总成本 {total_expected_cost} 元。",
                "成本拆分为合约成本 {contract_cost} 元、现货购电成本 {spot_purchase_cost} 元、储能循环成本 {storage_cycle_cost_total} 元、可调负荷转移成本 {flex_load_cost} 元、削减成本 {cut_load_cost} 元、偏差风险成本 {deviation_risk_cost} 元、期末SOC偏差成本 {terminal_soc_penalty_cost} 元。",
                "本结果仅为售电公司日前现货申报优化建议，必须经人工审批后在外部交易系统处理。",
            ],
            "approval_items": [
                "复核负荷预测、合约分时电量、日前价格预测和申报上下限。",
                "复核储能 SOC、充放电互斥和可调负荷调整是否满足业务约束。",
                "确认平台不执行申报、不连接交易平台、不自动下单。",
            ],
        },
    }
    template.update(
        {
            "build_mode": "component_based",
            "problem_type": "MILP",
            "model_problem_type": "MILP",
            "required_solver_capabilities": ["MILP"],
            "solver": "HiGHS",
            "business_objects": [
                {"code": "retailer", "name": "售电公司", "object_type": "market_participant", "source_system": "market_data"},
                {"code": "storage", "name": "储能资源", "object_type": "storage", "source_system": "BMS"},
                {"code": "time", "name": "日前交易时段", "object_type": "time", "source_system": "trading_plan"},
            ],
            "sets": sets,
            "parameters": parameters,
            "variables": variables,
            "constraints": [
                _constraint("energy_balance", "电量平衡", "contract_energy + spot_buy + discharge*delta_t + deviation_short = adjusted_load + charge*delta_t + deviation_long", ["time"]),
                _constraint("bid_bounds", "现货申报上下限", "bid_min[time] <= spot_buy[time] <= bid_max[time]", ["time"]),
                _constraint("soc_balance", "储能SOC递推", "soc[t] = soc[t-1] + charge*eta*delta_t - discharge/eta*delta_t", ["time"]),
                _constraint("soc_bounds", "储能SOC上下限", "storage_soc_min <= soc[time] <= storage_soc_max", ["time"]),
                _constraint("charge_discharge_exclusive", "储能充放电互斥", "is_charging[time] + is_discharging[time] <= 1", ["time"]),
                _constraint("flex_load_bounds", "可调负荷边界", "load_shift_out <= flex_down, load_shift_in <= flex_up, load_cut <= cut_limit", ["time"]),
                _constraint("shift_energy_balance", "负荷转移总量守恒", "sum(load_shift_out[time]) = sum(load_shift_in[time])", ["time"]),
                _constraint("terminal_soc_tracking", "期末SOC偏差约束", "soc[horizon] + terminal_soc_dev_pos - terminal_soc_dev_neg = terminal_soc_target", []),
            ],
            "objectives": [
                _objective(
                    "total_expected_cost_min",
                    "最小化合约成本、现货购电成本、储能循环成本、负荷调整成本和偏差风险成本",
                    "minimize",
                    "sum(contract_price[t]*contract_energy[t] + spot_price_forecast[t]*spot_buy[t] + storage_cycle_cost*(charge[t]+discharge[t])*delta_t + shift_cost[t]*(load_shift_in[t]+load_shift_out[t]) + cut_cost[t]*load_cut[t] + deviation_penalty[t]*(deviation_short[t]+deviation_long[t])) + terminal_soc_penalty*(terminal_soc_dev_pos+terminal_soc_dev_neg)",
                )
            ],
            "sample_runtime_parameters": sample,
            "component_spec": component_spec,
            "output_contract": component_spec["output_contract"],
            "metrics_config": component_spec["metrics_config"],
            "constraint_check_config": component_spec["constraint_check_config"],
            "explanation_config": component_spec["explanation_config"],
            "ui_metadata": {
                "execution_policy": "advisory_only",
                "requires_human_review": True,
                "capability_boundary": "平台只生成日前现货申报策略建议，不连接交易平台、不执行申报、不自动下单。",
                "generic_modeling_template": True,
            },
        }
    )
    return template


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


def _pv_storage_metric_definitions() -> list[dict[str, str]]:
    return [
        {"key": "objective_value", "name": "目标函数值"},
        {"key": "total_pv_generation_used", "name": "光伏消纳总量"},
        {"key": "total_pv_curtailment", "name": "弃光总量"},
        {"key": "curtailment_rate", "name": "弃光率"},
        {"key": "storage_charge_energy", "name": "储能充电量"},
        {"key": "storage_discharge_energy", "name": "储能放电量"},
        {"key": "soc_start", "name": "期初 SOC"},
        {"key": "soc_end", "name": "期末 SOC"},
        {"key": "schedule_deviation", "name": "计划偏差"},
        {"key": "total_deviation", "name": "总偏差量"},
        {"key": "total_deviation_penalty_energy", "name": "超限偏差电量"},
        {"key": "market_revenue", "name": "市场收益"},
        {"key": "deviation_penalty_cost", "name": "偏差考核成本"},
        {"key": "storage_degradation_cost", "name": "储能衰减成本"},
        {"key": "net_objective_proxy", "name": "净收益代理值"},
        {"key": "soc_min_actual", "name": "实际最低 SOC"},
        {"key": "soc_max_actual", "name": "实际最高 SOC"},
        {"key": "revenue", "name": "收益"},
        {"key": "investment_cost", "name": "投资成本"},
        {"key": "total_cost", "name": "总成本"},
        {"key": "payback_period_years", "name": "投资回收期"},
        {"key": "storage_power_capacity", "name": "储能功率容量"},
        {"key": "storage_energy_capacity", "name": "储能能量容量"},
    ]


def _pv_storage_component_template_v2(code: str, name: str, scenario: str, components: list[dict[str, Any]], sample: dict[str, Any], problem_type: str, mode: str) -> dict[str, Any]:
    component_spec = {"model_code": code, "build_mode": "component_based", "name": name, "model_problem_type": problem_type, "required_solver_capabilities": [problem_type], "sets": [{"code": "time", "name": "调度时段", "values": sample["time"]}, {"code": "time_volume", "name": "SOC时点", "values": sample["time_volume"]}], "variables": [], "components": components, "objective": {"type": "weighted_sum", "sense": "minimize", "terms": _pv_storage_objective_terms_v2(mode), "weights": sample.get("weights", {})}, "metrics_config": {"metrics": _pv_storage_metric_definitions()}, "ui_language": "zh-CN", "dispatch_mode": mode}
    params = [
        _param("horizon", "调度时段数", "period", [], "dispatch_plan", sample["horizon"], {"type": "integer", "min": 1}),
        _param("time", "调度时段", "", ["time"], "dispatch_plan", sample["time"], {"type": "array"}),
        _param("time_volume", "SOC时点", "", ["time_volume"], "dispatch_plan", sample["time_volume"], {"type": "array"}),
        _param("pv_forecast", "光伏预测出力", "MW", ["time"], "forecast", sample["pv_forecast"], {"type": "array", "min": 0}),
        _param("grid_limit", "并网限制", "MW", ["time"], "grid", sample["grid_limit"], {"type": "array", "min": 0}),
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


def _compute_power_coordination_day_ahead_v1() -> dict[str, Any]:
    code = "compute_power_coordination_day_ahead_v1"
    horizon = 24
    time = list(range(horizon))
    time_volume = list(range(horizon + 1))
    workload = ["inference", "urgent_training", "flexible_training", "batch_processing"]
    cluster = ["realtime_gpu", "training_gpu_a", "training_gpu_b"]
    inference_arrival = [220, 210, 205, 200, 200, 210, 230, 260, 290, 320, 340, 350, 345, 340, 335, 340, 360, 390, 420, 440, 410, 360, 300, 250]
    sample = {
        "horizon": horizon,
        "time": time,
        "time_volume": time_volume,
        "time_labels": [f"{hour:02d}:00" for hour in time],
        "workload": workload,
        "cluster": cluster,
        "delta_t": 1.0,
        "work_arrival": {
            "inference": inference_arrival,
            "urgent_training": [0 for _ in time],
            "flexible_training": [0 for _ in time],
            "batch_processing": [0 for _ in time],
        },
        "initial_backlog": {
            "inference": 0,
            "urgent_training": 1200,
            "flexible_training": 3000,
            "batch_processing": 1400,
        },
        "allowed_backlog": {
            "inference": [0 for _ in time_volume],
            "urgent_training": [1200 for _ in range(17)] + [0 for _ in range(8)],
            "flexible_training": [3000 for _ in range(23)] + [1500, 0],
            "batch_processing": [1400 for _ in range(24)] + [0],
        },
        "slack_limit": {
            "inference": [0 for _ in time_volume],
            "urgent_training": [200 for _ in time_volume],
            "flexible_training": [300 for _ in time_volume],
            "batch_processing": [300 for _ in time_volume],
        },
        "sla_penalty": {
            "inference": 1_000_000,
            "urgent_training": 5000,
            "flexible_training": 1200,
            "batch_processing": 800,
        },
        "cluster_compatibility": {
            "inference": {"realtime_gpu": 1, "training_gpu_a": 1, "training_gpu_b": 0},
            "urgent_training": {"realtime_gpu": 0, "training_gpu_a": 1, "training_gpu_b": 1},
            "flexible_training": {"realtime_gpu": 0, "training_gpu_a": 1, "training_gpu_b": 1},
            "batch_processing": {"realtime_gpu": 0, "training_gpu_a": 1, "training_gpu_b": 1},
        },
        "execution_cost": {
            "inference": {"realtime_gpu": 0.8, "training_gpu_a": 1.4, "training_gpu_b": 2.0},
            "urgent_training": {"realtime_gpu": 0, "training_gpu_a": 0.7, "training_gpu_b": 0.9},
            "flexible_training": {"realtime_gpu": 0, "training_gpu_a": 0.5, "training_gpu_b": 0.65},
            "batch_processing": {"realtime_gpu": 0, "training_gpu_a": 0.35, "training_gpu_b": 0.45},
        },
        "gpu_capacity": {
            "realtime_gpu": [500 for _ in time],
            "training_gpu_a": [800 for _ in time],
            "training_gpu_b": [650 for _ in time],
        },
        "idle_power": {"realtime_gpu": 0.12, "training_gpu_a": 0.18, "training_gpu_b": 0.15},
        "gpu_dynamic_power": {"realtime_gpu": 0.00075, "training_gpu_a": 0.00072, "training_gpu_b": 0.00078},
        "pue": {
            "realtime_gpu": [1.24 for _ in time],
            "training_gpu_a": [1.28 for _ in time],
            "training_gpu_b": [1.30 for _ in time],
        },
        "initial_cluster_status": {"realtime_gpu": 1, "training_gpu_a": 0, "training_gpu_b": 0},
        "cluster_start_cost": {"realtime_gpu": 30, "training_gpu_a": 60, "training_gpu_b": 50},
        "facility_aux_load": [0.35 for _ in time],
        "pv_forecast": [0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.5, 0.9, 1.25, 1.55, 1.7, 1.6, 1.35, 0.95, 0.55, 0.2, 0.05, 0, 0, 0, 0, 0],
        "electricity_price": [270, 250, 240, 235, 240, 260, 310, 380, 460, 520, 480, 430, 390, 370, 410, 480, 560, 680, 760, 720, 610, 500, 400, 320],
        "grid_carbon_factor": [0.58, 0.58, 0.57, 0.57, 0.56, 0.55, 0.53, 0.50, 0.47, 0.43, 0.40, 0.38, 0.36, 0.35, 0.36, 0.39, 0.43, 0.48, 0.52, 0.55, 0.57, 0.58, 0.59, 0.59],
        "grid_power_limit": [4.0 for _ in time],
        "carbon_price": 80,
        "demand_charge_price": 120,
        "curtailment_penalty": 100,
        "storage_power_capacity": 1.0,
        "storage_energy_capacity": 3.0,
        "initial_soc": 1.5,
        "soc_min": 0.3,
        "soc_max": 2.7,
        "terminal_soc_target": 1.5,
        "charge_efficiency": 0.95,
        "discharge_efficiency": 0.93,
        "storage_degradation_cost": 25,
        "terminal_soc_penalty": 500,
        "weights": {
            "grid_energy_cost": 1,
            "demand_charge": 1,
            "carbon_cost": 1,
            "storage_degradation": 1,
            "cluster_start": 1,
            "compute_execution": 1,
            "sla_violation": 1,
            "pv_curtailment": 1,
            "compute_terminal_soc": 1,
        },
    }

    set_definitions = []
    for item in COMPUTE_POWER_SETS:
        values = sample.get(item["code"], [])
        set_definitions.append({**deepcopy(item), "values": deepcopy(values)})

    parameter_meta = {item["code"]: item for item in COMPUTE_POWER_PARAMETERS}
    parameter_order = [
        "horizon",
        "time",
        "time_volume",
        "time_labels",
        "workload",
        "cluster",
        "delta_t",
        "work_arrival",
        "initial_backlog",
        "allowed_backlog",
        "slack_limit",
        "sla_penalty",
        "cluster_compatibility",
        "execution_cost",
        "gpu_capacity",
        "idle_power",
        "gpu_dynamic_power",
        "pue",
        "initial_cluster_status",
        "cluster_start_cost",
        "facility_aux_load",
        "pv_forecast",
        "electricity_price",
        "grid_carbon_factor",
        "grid_power_limit",
        "carbon_price",
        "demand_charge_price",
        "curtailment_penalty",
        "storage_power_capacity",
        "storage_energy_capacity",
        "initial_soc",
        "soc_min",
        "soc_max",
        "terminal_soc_target",
        "charge_efficiency",
        "discharge_efficiency",
        "storage_degradation_cost",
        "terminal_soc_penalty",
        "weights",
    ]
    extra_meta = {
        "time": {"name": "调度时段", "unit": "", "dimension": ["time"], "source": "dispatch_plan", "validation": {"type": "array"}},
        "time_volume": {"name": "状态时点", "unit": "", "dimension": ["time_volume"], "source": "dispatch_plan", "validation": {"type": "array"}},
        "time_labels": {"name": "时段标签", "unit": "", "dimension": ["time"], "source": "dispatch_plan", "validation": {"type": "array"}},
        "workload": {"name": "算力任务池", "unit": "", "dimension": ["workload"], "source": "scheduler", "validation": {"type": "array"}},
        "cluster": {"name": "GPU 集群", "unit": "", "dimension": ["cluster"], "source": "resource_manager", "validation": {"type": "array"}},
        "weights": {"name": "目标权重", "unit": "", "dimension": [], "source": "decision_policy", "validation": {"type": "dict"}},
    }
    source_by_code = {
        "work_arrival": "scheduler",
        "initial_backlog": "scheduler",
        "allowed_backlog": "scheduler",
        "slack_limit": "scheduler",
        "sla_penalty": "sla_policy",
        "cluster_compatibility": "resource_manager",
        "execution_cost": "cost_system",
        "gpu_capacity": "resource_manager",
        "idle_power": "dcim",
        "gpu_dynamic_power": "dcim",
        "pue": "dcim",
        "initial_cluster_status": "resource_manager",
        "cluster_start_cost": "cost_system",
        "facility_aux_load": "dcim",
        "pv_forecast": "forecast",
        "electricity_price": "market",
        "grid_carbon_factor": "carbon_data",
        "grid_power_limit": "grid",
        "initial_soc": "bms",
        "soc_min": "bms",
        "soc_max": "bms",
        "terminal_soc_target": "dispatch_plan",
        "charge_efficiency": "bms",
        "discharge_efficiency": "bms",
    }
    parameters = []
    for parameter_code in parameter_order:
        if parameter_code in extra_meta:
            meta = extra_meta[parameter_code]
        else:
            definition = parameter_meta[parameter_code]
            meta = {
                "name": definition["name"],
                "unit": definition.get("unit", ""),
                "dimension": definition.get("dimension", []),
                "source": source_by_code.get(parameter_code, "decision_policy"),
                "validation": {"type": "dict" if isinstance(sample[parameter_code], dict) else "array" if isinstance(sample[parameter_code], list) else "number"},
            }
            if parameter_code == "horizon":
                meta["validation"] = {"type": "integer", "min": 1}
            elif parameter_code in {"charge_efficiency", "discharge_efficiency"}:
                meta["validation"] = {"type": "number", "min": 0.000001, "max": 1}
            elif parameter_code not in {"electricity_price"} and meta["validation"]["type"] == "number":
                meta["validation"]["min"] = 0
        parameters.append(
            _param(
                parameter_code,
                meta["name"],
                meta["unit"],
                list(meta["dimension"]),
                meta["source"],
                sample[parameter_code],
                meta["validation"],
            )
        )

    objective_terms = [
        {"term_id": "grid_energy_cost", "name": "购电成本", "expression": "sum(electricity_price[t] * grid_buy[t] * delta_t for t in time)", "weight_key": "grid_energy_cost", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "demand_charge_cost", "name": "最大需量成本", "expression": "demand_charge_price * grid_peak", "weight_key": "demand_charge", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "carbon_cost", "name": "碳排成本", "expression": "sum(grid_carbon_factor[t] * carbon_price * grid_buy[t] * delta_t for t in time)", "weight_key": "carbon_cost", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "storage_degradation_cost", "name": "储能损耗成本", "expression": "storage_degradation_cost * sum((charge[t] + discharge[t]) * delta_t for t in time)", "weight_key": "storage_degradation", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "cluster_start_cost", "name": "集群启动成本", "expression": "sum(cluster_start_cost[c] * cluster_start[c,t] for c in cluster for t in time)", "weight_key": "cluster_start", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "compute_execution_cost", "name": "算力执行成本", "expression": "sum(execution_cost[w,c] * work_execute[w,c,t] for w in workload for c in cluster for t in time)", "weight_key": "compute_execution", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "sla_violation_cost", "name": "SLA 违约成本", "expression": "sum(sla_penalty[w] * sla_slack[w,tv] for w in workload for tv in time_volume)", "weight_key": "sla_violation", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "pv_curtailment_cost", "name": "弃光成本", "expression": "curtailment_penalty * sum(pv_curtail[t] * delta_t for t in time)", "weight_key": "pv_curtailment", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
        {"term_id": "terminal_soc_cost", "name": "期末 SOC 偏差成本", "expression": "terminal_soc_penalty * (terminal_soc_dev_pos + terminal_soc_dev_neg)", "weight_key": "compute_terminal_soc", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True},
    ]

    output_contract = {
        "series_index_set": "time",
        "execution_policy": "advisory_only",
        "requires_human_review": True,
        "series_fields": [
            {"key": "time_label", "expression": "time_labels[t]"},
            {"key": "compute_executed", "expression": "sum(sum(work_execute[w,c,t] for w in workload) for c in cluster)"},
            {"key": "total_backlog", "expression": "sum(backlog[w,t] for w in workload)"},
            {"key": "gpu_used", "expression": "sum(cluster_gpu_used[c,t] for c in cluster)"},
            {"key": "gpu_capacity", "expression": "sum(gpu_capacity[c,t] for c in cluster)"},
            {"key": "dc_power", "expression": "dc_power[t]"},
            {"key": "facility_load", "expression": "dc_power[t] + facility_aux_load[t]"},
            {"key": "grid_buy", "expression": "grid_buy[t]"},
            {"key": "pv_used", "expression": "pv_used[t]"},
            {"key": "pv_curtail", "expression": "pv_curtail[t]"},
            {"key": "charge", "expression": "charge[t]"},
            {"key": "discharge", "expression": "discharge[t]"},
            {"key": "soc", "expression": "soc[t]"},
            {"key": "electricity_price", "expression": "electricity_price[t]"},
            {"key": "grid_carbon_factor", "expression": "grid_carbon_factor[t]"},
        ],
        "curves": [
            {"key": "compute_schedule_curve", "fields": {"compute_executed": "sum(sum(work_execute[w,c,t] for w in workload) for c in cluster)", "total_backlog": "sum(backlog[w,t] for w in workload)", "gpu_used": "sum(cluster_gpu_used[c,t] for c in cluster)"}},
            {"key": "power_supply_curve", "fields": {"facility_load": "dc_power[t] + facility_aux_load[t]", "grid_buy": "grid_buy[t]", "pv_used": "pv_used[t]", "pv_curtail": "pv_curtail[t]"}},
            {"key": "storage_curve", "fields": {"charge": "charge[t]", "discharge": "discharge[t]", "soc": "soc[t]"}},
        ],
        "chart_fields": ["compute_executed", "total_backlog", "gpu_used", "facility_load", "grid_buy", "pv_used", "charge", "discharge", "soc"],
        "static_business_output": {
            "single_model_joint_optimization": True,
            "model_scope": "算力任务、GPU 集群、光伏、储能和电网购电在同一次 MILP 求解中联合决策。",
        },
    }

    metric_definitions = [
        {"key": "total_operating_cost", "name": "总运营成本", "expression": "objective_value"},
        {"key": "grid_energy_cost", "name": "购电成本", "expression": "sum(electricity_price[t] * grid_buy[t] * delta_t for t in time)"},
        {"key": "demand_charge_cost", "name": "最大需量成本", "expression": "demand_charge_price * grid_peak"},
        {"key": "carbon_emission", "name": "碳排放量", "expression": "sum(grid_carbon_factor[t] * grid_buy[t] * delta_t for t in time)"},
        {"key": "carbon_cost", "name": "碳成本", "expression": "carbon_price * carbon_emission"},
        {"key": "storage_degradation_cost_total", "name": "储能损耗成本", "expression": "storage_degradation_cost * sum((charge[t] + discharge[t]) * delta_t for t in time)"},
        {"key": "compute_execution_cost", "name": "算力执行成本", "expression": "sum(sum(sum(execution_cost[w,c] * work_execute[w,c,t] for t in time) for c in cluster) for w in workload)"},
        {"key": "cluster_start_cost_total", "name": "集群启动成本", "expression": "sum(sum(cluster_start_cost[c] * cluster_start[c,t] for t in time) for c in cluster)"},
        {"key": "sla_penalty_cost", "name": "SLA 违约成本", "expression": "sum(sum(sla_penalty[w] * sla_slack[w,tv] for tv in time_volume) for w in workload)"},
        {"key": "curtailment_cost", "name": "弃光成本", "expression": "curtailment_penalty * sum(pv_curtail[t] * delta_t for t in time)"},
        {"key": "terminal_soc_penalty_cost", "name": "期末 SOC 偏差成本", "expression": "terminal_soc_penalty * (terminal_soc_dev_pos + terminal_soc_dev_neg)"},
        {"key": "total_grid_energy", "name": "电网购电量", "expression": "sum(grid_buy[t] * delta_t for t in time)"},
        {"key": "grid_peak", "name": "最大购电功率", "expression": "grid_peak"},
        {"key": "total_compute_executed", "name": "总计算执行量", "expression": "sum(sum(sum(work_execute[w,c,t] for t in time) for c in cluster) for w in workload)"},
        {"key": "terminal_backlog", "name": "日终任务积压", "expression": "sum(backlog[w,horizon] for w in workload)"},
        {"key": "total_sla_slack", "name": "SLA 松弛总量", "expression": "sum(sum(sla_slack[w,tv] for tv in time_volume) for w in workload)"},
        {"key": "inference_sla_violation", "name": "在线推理 SLA 违约量", "expression": "sum(sla_slack['inference',tv] for tv in time_volume)"},
        {"key": "average_gpu_utilization", "name": "GPU 平均利用率", "expression": "sum(sum(cluster_gpu_used[c,t] for c in cluster) for t in time) / sum(sum(gpu_capacity[c,t] for c in cluster) for t in time)"},
        {"key": "total_pv_forecast_energy", "name": "可用光伏电量", "expression": "sum(pv_forecast[t] * delta_t for t in time)"},
        {"key": "total_pv_used_energy", "name": "光伏消纳电量", "expression": "sum(pv_used[t] * delta_t for t in time)"},
        {"key": "total_pv_curtailment", "name": "弃光电量", "expression": "sum(pv_curtail[t] * delta_t for t in time)"},
        {"key": "pv_utilization_rate", "name": "光伏消纳率", "expression": "total_pv_used_energy / total_pv_forecast_energy"},
        {"key": "total_facility_energy", "name": "园区用电量", "expression": "sum((dc_power[t] + facility_aux_load[t]) * delta_t for t in time)"},
        {"key": "green_energy_share", "name": "绿电用能占比", "expression": "total_pv_used_energy / total_facility_energy"},
        {"key": "soc_min_actual", "name": "实际最低 SOC", "expression": "min(soc[tv] for tv in time_volume)"},
        {"key": "soc_max_actual", "name": "实际最高 SOC", "expression": "max(soc[tv] for tv in time_volume)"},
        {"key": "terminal_soc_gap", "name": "期末 SOC 偏差", "expression": "abs(soc[horizon] - terminal_soc_target)"},
        {"key": "charge_discharge_conflict_count", "name": "充放电冲突次数", "expression": "sum(charge[t] > 0.000001 and discharge[t] > 0.000001 for t in time)"},
        {"key": "cluster_start_count", "name": "集群启动次数", "expression": "sum(sum(cluster_start[c,t] for t in time) for c in cluster)"},
    ]
    business_metrics = [item["key"] for item in metric_definitions]
    metrics_config = {
        "metrics": metric_definitions,
        "business_metrics": business_metrics,
        "lists": [
            {"key": "high_gpu_utilization_periods", "foreach": "time", "where": "sum(cluster_gpu_used[c,t] for c in cluster) / sum(gpu_capacity[c,t] for c in cluster) >= 0.95", "fields": {"gpu_used": "sum(cluster_gpu_used[c,t] for c in cluster)", "gpu_capacity": "sum(gpu_capacity[c,t] for c in cluster)"}},
            {"key": "grid_limit_binding_periods", "foreach": "time", "where": "grid_buy[t] >= grid_power_limit[t] - 0.000001", "fields": {"grid_buy": "grid_buy[t]", "grid_power_limit": "grid_power_limit[t]"}},
            {"key": "soc_boundary_periods", "foreach": "time", "where": "soc[t] <= soc_min + 0.000001 or soc[t] >= soc_max - 0.000001", "fields": {"soc": "soc[t]"}},
            {"key": "curtailment_periods", "foreach": "time", "where": "pv_curtail[t] > 0.000001", "fields": {"pv_curtail": "pv_curtail[t]", "pv_forecast": "pv_forecast[t]"}},
        ],
        "objects": [
            {"key": "dispatch_plan", "source": "series"},
            {"key": "cost_breakdown", "source": "cost_breakdown", "fields": ["grid_energy_cost", "demand_charge_cost", "carbon_cost", "storage_degradation_cost_total", "compute_execution_cost", "cluster_start_cost_total", "sla_penalty_cost", "curtailment_cost", "terminal_soc_penalty_cost", "total_operating_cost"]},
            {"key": "risk_summary", "source": "risk_summary", "metric_fields": ["terminal_backlog", "inference_sla_violation", "grid_peak", "soc_min_actual", "soc_max_actual"], "static": {"advisory_only": True}},
        ],
    }
    constraint_check_config = {
        "tolerance": 1e-5,
        "include_metrics": ["terminal_backlog", "inference_sla_violation", "charge_discharge_conflict_count", "terminal_soc_gap", "soc_min_actual", "soc_max_actual"],
        "checks": [
            {"key": "terminal_backlog_cleared", "expression": "terminal_backlog <= tolerance"},
            {"key": "inference_sla_satisfied", "expression": "inference_sla_violation <= tolerance"},
            {"key": "charge_discharge_exclusive", "expression": "charge_discharge_conflict_count <= tolerance"},
            {"key": "soc_within_bounds", "expression": "soc_min_actual >= soc_min - tolerance and soc_max_actual <= soc_max + tolerance"},
            {"key": "terminal_soc_satisfied", "expression": "terminal_soc_gap <= tolerance"},
        ],
    }
    explanation_config = {
        "summary": "智算园区日前算电协同联合优化已完成，结果包含算力任务、GPU 集群、光伏、储能和电网购电的一体化计划。",
        "advisory": "平台输出为辅助决策建议，不自动下发 GPU 调度、储能控制或购电指令。",
        "execution_policy": "advisory_only",
        "requires_human_review": True,
        "strategy_templates": [
            "本次联合优化执行计算量 {total_compute_executed} GPU·h，日终任务积压 {terminal_backlog} GPU·h。",
            "电网购电量 {total_grid_energy} MWh，最大购电功率 {grid_peak} MW，光伏消纳率 {pv_utilization_rate}。",
            "总运营成本 {total_operating_cost} 元，其中购电成本 {grid_energy_cost} 元、碳成本 {carbon_cost} 元、SLA 违约成本 {sla_penalty_cost} 元。",
        ],
        "approval_items": [
            "复核任务到达量、允许积压曲线和 SLA 罚值是否对应真实业务规则。",
            "复核 GPU 容量、兼容性、PUE 与单 GPU 功耗参数。",
            "复核光伏、电价、碳因子、储能 SOC 和电网接入边界。",
            "确认结果仅作为辅助决策建议，经人工审批后再由外部系统执行。",
        ],
    }

    component_spec = {
        "model_code": code,
        "build_mode": "component_based",
        "name": "智算园区日前算电协同联合优化模型",
        "model_problem_type": "MILP",
        "required_solver_capabilities": ["MILP"],
        "sets": deepcopy(set_definitions),
        "parameters": deepcopy(parameters),
        "variables": deepcopy(COMPUTE_POWER_VARIABLES),
        "components": [{"type": "compute_power_coordination_core", "version": "1.0.0"}],
        "objective": {"type": "weighted_sum", "sense": "minimize", "terms": objective_terms, "weights": sample["weights"]},
        "output_contract": output_contract,
        "metrics_config": metrics_config,
        "constraint_check_config": constraint_check_config,
        "explanation_config": explanation_config,
        "ui_language": "zh-CN",
    }

    return {
        "model_code": code,
        "code": code,
        "name": "智算园区日前算电协同联合优化模型",
        "scenario": "单园区算力任务、GPU 集群、光伏、储能和电网购电联合优化。",
        "description": "通过单次 MILP 求解生成 24 小时算力排程、集群启停、用电、光伏消纳和储能计划。",
        "version": "v1.1",
        "status": "published",
        "solver": "HiGHS",
        "build_mode": "component_based",
        "problem_type": "MILP",
        "model_problem_type": "MILP",
        "required_solver_capabilities": ["MILP"],
        "tags": ["compute_power", "data_center", "pv", "storage", "MILP", "HiGHS", "component_based"],
        "business_objects": [
            {"code": "workload", "name": "算力任务池", "object_type": "compute_workload", "source_system": "scheduler"},
            {"code": "cluster", "name": "GPU 集群", "object_type": "compute_cluster", "source_system": "resource_manager"},
            {"code": "storage", "name": "园区储能", "object_type": "storage", "source_system": "bms"},
            {"code": "grid", "name": "电网接入点", "object_type": "grid_connection", "source_system": "grid"},
            {"code": "time", "name": "调度时段", "object_type": "time", "source_system": "dispatch_plan"},
        ],
        "sets": set_definitions,
        "parameters": parameters,
        "variables": deepcopy(COMPUTE_POWER_VARIABLES),
        "constraints": [
            _constraint("workload_balance", "任务到达、执行与积压递推", "backlog[w,t+1] = backlog[w,t] + arrival[w,t] - executed[w,t]", ["workload", "time"]),
            _constraint("sla_deadline", "SLA 与截止时间", "backlog[w,tv] <= allowed_backlog[w,tv] + sla_slack[w,tv]", ["workload", "time_volume"]),
            _constraint("cluster_capacity", "GPU 容量和兼容性", "executed <= compatible capacity", ["workload", "cluster", "time"]),
            _constraint("compute_power", "算力功率转换", "cluster_power = PUE * (idle_power + gpu_dynamic_power)", ["cluster", "time"]),
            _constraint("pv_storage", "光伏与储能状态", "PV balance and SOC transition", ["time"]),
            _constraint("facility_balance", "园区功率平衡", "grid + PV + discharge = compute + auxiliary + charge", ["time"]),
        ],
        "objectives": [_objective("compute_power_joint_cost_min", "算电协同综合成本最小", "minimize", "购电、需量、碳排、储能、集群启停、算力执行、SLA 与弃光成本")],
        "sample_runtime_parameters": sample,
        "component_spec": component_spec,
        "output_contract": output_contract,
        "metrics_config": metrics_config,
        "constraint_check_config": constraint_check_config,
        "explanation_config": explanation_config,
        "ui_metadata": {
            "component_spec_collapsed": True,
            "recommended_component_source": "component_library",
            "time_dimension": {
                "enabled": True,
                "policy": "fixed",
                "default_horizon": horizon,
                "time_set": "time",
                "state_time_set": "time_volume",
                "editable": False,
                "interval_minutes": 60,
                "delta_t": 1,
                "label_set": "time_labels",
                "label_generation": "auto",
                "label_format": "HH:mm",
            },
            "single_model_joint_optimization": True,
            "execution_policy": "advisory_only",
            "requires_human_review": True,
            "capability_boundary": "当前模板面向单园区聚合任务池的日前联合优化，不包含跨园区迁移和自动控制下发。",
        },
    }


