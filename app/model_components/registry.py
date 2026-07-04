from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.problem_type_diagnosis import component_problem_type_fields


COMPONENT_REGISTRY: dict[str, Any] = {}

COMPONENT_DEPENDENCIES: dict[str, list[str]] = {
    "hydro_volume_bounds": ["hydro_initial_volume"],
    "hydro_outflow_balance": ["hydro_power_flow_conversion"],
    "hydro_outflow_bounds": ["hydro_outflow_balance"],
    "hydro_spill_bounds": ["hydro_outflow_balance"],
    "hydro_cascade_inflow_delay": ["hydro_outflow_balance"],
    "hydro_reservoir_balance": ["hydro_cascade_inflow_delay"],
    "hydro_load_tracking": ["hydro_power_flow_conversion"],
    "hydro_terminal_volume": ["hydro_reservoir_balance"],
    "hydro_ramp_smoothing": ["hydro_power_flow_conversion"],
    "storage_soc_bounds": ["storage_soc_balance"],
    "storage_terminal_soc_tracking": ["storage_soc_balance"],
    "storage_charge_discharge_exclusive": ["storage_soc_balance"],
    "grid_power_limit": ["pv_storage_power_balance"],
}

COMPONENT_OUTPUTS: dict[str, list[str]] = {
    "hydro_initial_volume": ["volume"],
    "hydro_volume_bounds": ["hydro_volume_bounds"],
    "hydro_station_available_capacity": ["station_pmax", "hydro_station_available_capacity"],
    "hydro_power_flow_conversion": ["station_power"],
    "hydro_outflow_balance": ["q_out"],
    "hydro_outflow_bounds": ["hydro_outflow_bounds"],
    "hydro_spill_bounds": ["hydro_spill_bounds"],
    "hydro_cascade_inflow_delay": ["inflow"],
    "hydro_reservoir_balance": ["volume"],
    "hydro_load_tracking": ["load_dev_pos", "load_dev_neg"],
    "hydro_terminal_volume": ["terminal_dev_pos", "terminal_dev_neg"],
    "hydro_ramp_smoothing": ["ramp_abs"],
}

COMPONENT_CONSTRAINT_TYPES: dict[str, str] = {
    "hydro_initial_volume": "initial_state",
    "hydro_volume_bounds": "boundary",
    "hydro_station_available_capacity": "capacity",
    "hydro_power_flow_conversion": "conversion",
    "hydro_outflow_balance": "balance",
    "hydro_outflow_bounds": "boundary",
    "hydro_spill_bounds": "boundary",
    "hydro_cascade_inflow_delay": "derived_expression",
    "hydro_reservoir_balance": "state_transition",
    "hydro_load_tracking": "balance",
    "hydro_terminal_volume": "target_tracking",
    "hydro_ramp_smoothing": "stability",
}

COMPONENT_INDICES: dict[str, list[str]] = {
    "hydro_initial_volume": ["station"],
    "hydro_volume_bounds": ["station", "time_volume"],
    "hydro_station_available_capacity": ["station", "time"],
    "hydro_power_flow_conversion": ["station", "time"],
    "hydro_outflow_balance": ["station", "time"],
    "hydro_outflow_bounds": ["station", "time"],
    "hydro_spill_bounds": ["station", "time"],
    "hydro_cascade_inflow_delay": ["station", "time"],
    "hydro_reservoir_balance": ["station", "time"],
    "hydro_load_tracking": ["time"],
    "hydro_terminal_volume": ["station"],
    "hydro_ramp_smoothing": ["station", "time"],
}

SET_DEFINITIONS: dict[str, dict[str, Any]] = {
    "station": {"code": "station", "name": "电站集合", "type": "normal", "required": True},
    "unit": {"code": "unit", "name": "机组集合", "type": "normal", "required": True},
    "time": {"code": "time", "name": "调度时段", "type": "time_period", "required": True},
    "time_volume": {
        "code": "time_volume",
        "name": "状态时点",
        "type": "state_time",
        "base_set": "time",
        "generation_rule": "horizon_plus_1",
        "required": True,
    },
}

COMPONENT_OBJECTIVE_TERMS: dict[str, list[dict[str, Any]]] = {
    "hydro_load_tracking": [
        {
            "term_id": "load_tracking_penalty",
            "name": "负荷偏差惩罚",
            "expression": "Σ(load_dev_pos[t] + load_dev_neg[t])",
            "weight_key": "load_deviation",
            "weight": 1000,
            "unit": "MW",
            "business_meaning": "尽量跟踪负荷曲线。",
        }
    ],
    "hydro_spill_bounds": [
        {
            "term_id": "spill_penalty",
            "name": "弃水惩罚",
            "expression": "Σ(q_spill[s,t])",
            "weight_key": "spill",
            "weight": 1,
            "unit": "m3/s",
            "business_meaning": "减少无效弃水。",
        }
    ],
    "hydro_ramp_smoothing": [
        {
            "term_id": "ramp_smoothing_penalty",
            "name": "出力平滑惩罚",
            "expression": "Σ(ramp_abs[s,t])",
            "weight_key": "ramp",
            "weight": 0.1,
            "unit": "MW",
            "business_meaning": "减少相邻时段出力波动。",
        }
    ],
    "hydro_terminal_volume": [
        {
            "term_id": "terminal_volume_penalty",
            "name": "期末库容偏差惩罚",
            "expression": "Σ(terminal_dev_pos[s] + terminal_dev_neg[s])",
            "weight_key": "terminal_volume",
            "weight": 500,
            "unit": "million m3",
            "business_meaning": "使期末库容接近目标库容。",
        }
    ],
}

HYDRO_VARIABLES: list[dict[str, Any]] = [
    {"code": "volume", "name": "库容", "dimension": ["station", "time_volume"], "type": "continuous", "lower_bound": 0},
    {"code": "q_gen", "name": "发电流量", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "q_spill", "name": "弃水流量", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "q_out", "name": "下泄流量", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "inflow", "name": "入库流量", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "station_power", "name": "电站出力", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "load_dev_pos", "name": "负荷正偏差", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
    {"code": "load_dev_neg", "name": "负荷负偏差", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
    {"code": "terminal_dev_pos", "name": "末库容正偏差", "dimension": ["station"], "type": "continuous", "lower_bound": 0},
    {"code": "terminal_dev_neg", "name": "末库容负偏差", "dimension": ["station"], "type": "continuous", "lower_bound": 0},
    {"code": "ramp_abs", "name": "出力变化绝对值", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
]

HYDRO_PARAMETERS: list[dict[str, Any]] = [
    {"code": "initial_volume", "name": "初始库容", "dimension": ["station"], "default": 100},
    {"code": "volume_min", "name": "库容下限", "dimension": ["station"], "default": 50},
    {"code": "volume_max", "name": "库容上限", "dimension": ["station"], "default": 200},
    {"code": "station_pmax", "name": "电站可用容量", "dimension": ["station", "time"], "default": 100},
    {"code": "power_conversion", "name": "流量出力转换系数", "dimension": ["station"], "default": 0.38},
    {"code": "outflow_min", "name": "下泄下限", "dimension": ["station"], "default": 0},
    {"code": "outflow_max", "name": "下泄上限", "dimension": ["station"], "default": 500},
    {"code": "spill_max", "name": "弃水上限", "dimension": ["station"], "default": 500},
    {"code": "local_inflow", "name": "区间来水", "dimension": ["station", "time"], "default": 50},
    {"code": "delta_v", "name": "流量库容换算系数", "dimension": [], "default": 0.0009},
    {"code": "load_forecast", "name": "负荷预测", "dimension": ["time"], "default": 100},
    {"code": "target_terminal_volume", "name": "目标末库容", "dimension": ["station"], "default": 100},
    {"code": "unit_pmax", "name": "机组容量", "dimension": ["unit"], "default": 50},
    {"code": "availability", "name": "机组可用率", "dimension": ["unit", "time"], "default": 1},
    {"code": "time_step_seconds", "name": "时间步长", "dimension": [], "default": 900},
    {"code": "units", "name": "电站机组映射", "dimension": ["station"], "default": 1},
    {"code": "edges", "name": "梯级拓扑", "dimension": [], "default": 1},
    {"code": "initial_upstream_outflow", "name": "初始上游下泄", "dimension": [], "default": 1},
]

HYDRO_CONSTRAINT_OVERRIDES: dict[str, list[dict[str, Any]]] = {
    "hydro_initial_volume": [{"expression": "volume[s,0] == initial_volume[s]"}],
    "hydro_volume_bounds": [
        {"constraint_id": "hydro_volume_min", "expression": "volume[s,t] >= volume_min[s]", "indices": ["station", "time_volume"]},
        {"constraint_id": "hydro_volume_max", "expression": "volume[s,t] <= volume_max[s]", "indices": ["station", "time_volume"]},
    ],
    "hydro_station_available_capacity": [{"expression": "station_power[s,t] <= station_pmax[s,t]"}],
    "hydro_power_flow_conversion": [{"expression": "station_power[s,t] == power_conversion[s] * q_gen[s,t]"}],
    "hydro_outflow_balance": [{"expression": "q_out[s,t] == q_gen[s,t] + q_spill[s,t]"}],
    "hydro_outflow_bounds": [
        {"constraint_id": "hydro_outflow_min", "expression": "q_out[s,t] >= outflow_min[s]"},
        {"constraint_id": "hydro_outflow_max", "expression": "q_out[s,t] <= outflow_max[s]"},
    ],
    "hydro_spill_bounds": [
        {"constraint_id": "hydro_spill_min", "expression": "q_spill[s,t] >= 0"},
        {"constraint_id": "hydro_spill_max", "expression": "q_spill[s,t] <= spill_max[s]"},
    ],
    "hydro_cascade_inflow_delay": [{"expression": "inflow[s,t] == local_inflow[s,t]"}],
    "hydro_reservoir_balance": [{"expression": "volume[s,t+1] == volume[s,t] + (inflow[s,t] - q_out[s,t]) * delta_v", "boundary_strategy": "skip_out_of_range"}],
    "hydro_load_tracking": [{"expression": "sum(station_power[s,t] for s in station) + load_dev_pos[t] - load_dev_neg[t] == load_forecast[t]"}],
    "hydro_terminal_volume": [{"expression": "volume[s,2] - target_terminal_volume[s] == terminal_dev_pos[s] - terminal_dev_neg[s]"}],
    "hydro_ramp_smoothing": [
        {"constraint_id": "hydro_ramp_up", "expression": "ramp_abs[s,t] >= station_power[s,t] - station_power[s,t-1]", "boundary_strategy": "skip_first"},
        {"constraint_id": "hydro_ramp_down", "expression": "ramp_abs[s,t] >= station_power[s,t-1] - station_power[s,t]", "boundary_strategy": "skip_first"},
    ],
}

HYDRO_OBJECTIVE_TERM_OVERRIDES: dict[str, list[dict[str, Any]]] = {
    "hydro_load_tracking": [{"term_id": "load_tracking_penalty", "name": "负荷偏差惩罚", "expression": "sum(load_dev_pos[t] + load_dev_neg[t] for t in time)", "weight_key": "load_deviation", "weight": 1000, "unit": "MW"}],
    "hydro_spill_bounds": [{"term_id": "spill_penalty", "name": "弃水惩罚", "expression": "sum(q_spill[s,t] for s in station for t in time)", "weight_key": "spill", "weight": 1, "unit": "m3/s"}],
    "hydro_ramp_smoothing": [{"term_id": "ramp_smoothing_penalty", "name": "爬坡平滑惩罚", "expression": "sum(ramp_abs[s,t] for s in station for t in time)", "weight_key": "ramp", "weight": 0.1, "unit": "MW"}],
    "hydro_terminal_volume": [{"term_id": "terminal_volume_penalty", "name": "末库容偏差惩罚", "expression": "sum(terminal_dev_pos[s] + terminal_dev_neg[s] for s in station)", "weight_key": "terminal_volume", "weight": 500, "unit": "million m3"}],
}


def register_component(component_type: str):
    def decorator(cls):
        instance = cls()
        instance.component_type = component_type
        COMPONENT_REGISTRY[component_type] = instance
        return cls

    return decorator


def get_component_builder(component_type: str):
    if component_type not in COMPONENT_REGISTRY:
        raise RuntimeError(f"不支持的组件类型：{component_type}")
    return COMPONENT_REGISTRY[component_type]


def list_component_types() -> list[str]:
    return sorted(COMPONENT_REGISTRY.keys())


def list_component_catalog() -> list[dict[str, Any]]:
    catalog = [component_definition(component_type, builder) for component_type, builder in COMPONENT_REGISTRY.items()]
    return sorted(catalog, key=lambda item: item["type"])


def component_definition(component_type: str, builder: Any | None = None) -> dict[str, Any]:
    builder = builder or get_component_builder(component_type)
    display_name = getattr(builder, "display_name", component_type)
    description = getattr(builder, "description", "")
    formula = getattr(builder, "formula", "")
    constraint_rows = HYDRO_CONSTRAINT_OVERRIDES.get(component_type) or [{"expression": formula}]
    generated_constraints = []
    for index, row in enumerate(constraint_rows):
        expression = str(row.get("expression") or row.get("formula") or formula)
        generated_constraints.append(
            {
                **deepcopy(row),
                "constraint_id": row.get("constraint_id") or f"{component_type}_generated_{index + 1}",
                "name": row.get("name") or display_name,
                "type": row.get("type") or COMPONENT_CONSTRAINT_TYPES.get(component_type, "business_rule"),
                "formula": expression,
                "expression": expression,
                "business_meaning": row.get("business_meaning") or description,
                "indices": row.get("indices") or COMPONENT_INDICES.get(component_type, []),
            }
        )
    if component_type == "mccormick_bilinear_relaxation_component":
        generated_constraints = [
            {
                "constraint_id": "mccormick_programmatic_envelope",
                "name": display_name,
                "type": "mccormick",
                "formula": "w ~= x * y",
                "expression": "w ~= x * y",
                "business_meaning": description,
                "indices": [],
                "generation_mode": "programmatic",
                "programmatic": True,
                "generated_by": "validate_mccormick_spec",
                "expression_class": "linear",
                "participates_in_solve": True,
                "solve_participation": "generated",
            }
        ]
    required_sets = []
    for code in COMPONENT_INDICES.get(component_type, []):
        if code in SET_DEFINITIONS and code not in {item["code"] for item in required_sets}:
            required_sets.append(deepcopy(SET_DEFINITIONS[code]))
    if component_type in {"function_mapping_component", "piecewise_linear_curve", "function_mapping_2d_component"}:
        generated_constraints = []
    terms = []
    for term in HYDRO_OBJECTIVE_TERM_OVERRIDES.get(component_type) or COMPONENT_OBJECTIVE_TERMS.get(component_type, []):
        terms.append(
            {
                **deepcopy(term),
                "source": "component",
                "source_component": component_type,
                "enabled": True,
                "editable": True,
            }
        )
    item = {
        "component_id": component_type,
        "type": component_type,
        "name": display_name,
        "display_name": display_name,
        "domain": "水电调度" if component_type.startswith("hydro_") else "通用建模",
        "category": getattr(builder, "category", "未分类"),
        "version": "1.0.0",
        "implemented": True,
        "status": "published",
        "required": component_type in {"hydro_power_flow_conversion", "hydro_outflow_balance"},
        "depends_on": COMPONENT_DEPENDENCIES.get(component_type, []),
        "inputs": list(getattr(builder, "required_parameters", [])),
        "parameters": deepcopy(HYDRO_PARAMETERS) if component_type.startswith("hydro_") else [],
        "variables": deepcopy(HYDRO_VARIABLES) if component_type.startswith("hydro_") else [],
        "sets": deepcopy(required_sets),
        "outputs": COMPONENT_OUTPUTS.get(component_type, []),
        "required_sets": required_sets,
        "generated_constraints": generated_constraints,
        "generated_objective_terms": terms,
        **component_problem_type_fields({"constraints": generated_constraints, "objective_terms": terms}),
        "config_schema": {},
        "math_template": {"formula": formula, "business_meaning": description},
        "description": description,
    }
    if component_type in {"hydro_head_calculation"}:
        item.update(
            {
                "implemented": False,
                "enabled": False,
                "status": "reserved",
                "metadata_only": True,
                "required": False,
            }
        )
    if hasattr(builder, "explain"):
        item.update(builder.explain())
    if component_type.startswith("hydro_"):
        item.setdefault("legacy_preset", True)
        item["component_family"] = "legacy preset"
        item.setdefault("can_be_composed_from", _hydro_generic_composition(component_type))
    problem_type = item.get("problem_type") or item.get("problem_type_effect") or "LP"
    item["problem_type"] = problem_type
    item["problem_types"] = list(item.get("problem_types") or item.get("solver_capabilities") or [problem_type])
    item["solver_capabilities"] = list(item.get("solver_capabilities") or item.get("problem_types") or [problem_type])
    item.setdefault("depends_on", COMPONENT_DEPENDENCIES.get(component_type, []))
    item.setdefault("generated_constraints", generated_constraints)
    item.setdefault("generated_objective_terms", terms)
    return item


def _hydro_generic_composition(component_type: str) -> list[str]:
    mapping = {
        "hydro_initial_volume": ["terminal_state_tracking_component"],
        "hydro_volume_bounds": ["capacity_bounds_component"],
        "hydro_station_available_capacity": ["capacity_bounds_component"],
        "hydro_power_flow_conversion": ["balance_equation_component", "function_mapping_component"],
        "hydro_outflow_balance": ["balance_equation_component"],
        "hydro_outflow_bounds": ["capacity_bounds_component"],
        "hydro_spill_bounds": ["capacity_bounds_component"],
        "hydro_cascade_inflow_delay": ["network_delay_flow_component"],
        "hydro_reservoir_balance": ["state_balance_component"],
        "hydro_load_tracking": ["schedule_tracking_component"],
        "hydro_terminal_volume": ["terminal_state_tracking_component"],
        "hydro_ramp_smoothing": ["ramp_smoothing_component"],
    }
    return mapping.get(component_type, [])
