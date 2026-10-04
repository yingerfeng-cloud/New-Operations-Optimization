from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.model_components.formula_contracts import formula_expression, participation_fields, synchronize_formula_fields


COMPONENT_REGISTRY: dict[str, Any] = {}

COMPONENT_OUTPUTS: dict[str, list[str]] = {
    "hydro_initial_volume": ["volume"],
    "hydro_volume_bounds": ["hydro_volume_bounds"],
    "hydro_station_available_capacity": ["station_pmax", "hydro_station_available_capacity"],
    "hydro_power_flow_conversion": ["station_power"],
    "hydro_generation_flow_bounds": ["q_gen"],
    "hydro_outflow_balance": ["q_out"],
    "hydro_outflow_bounds": ["hydro_outflow_bounds"],
    "hydro_ecological_flow": ["hydro_ecological_flow"],
    "hydro_head_calculation": ["head"],
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
    "hydro_generation_flow_bounds": "boundary",
    "hydro_outflow_balance": "balance",
    "hydro_outflow_bounds": "boundary",
    "hydro_ecological_flow": "boundary",
    "hydro_head_calculation": "conversion",
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
    "hydro_generation_flow_bounds": ["station", "time"],
    "hydro_outflow_balance": ["station", "time"],
    "hydro_outflow_bounds": ["station", "time"],
    "hydro_ecological_flow": ["station", "time"],
    "hydro_head_calculation": ["station", "time"],
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
    {"code": "load_dev_pos", "name": "超出负荷目标的正偏差（超发）", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
    {"code": "load_dev_neg", "name": "低于负荷目标的负偏差（缺额）", "dimension": ["time"], "type": "continuous", "lower_bound": 0},
    {"code": "terminal_dev_pos", "name": "末库容正偏差", "dimension": ["station"], "type": "continuous", "lower_bound": 0},
    {"code": "terminal_dev_neg", "name": "末库容负偏差", "dimension": ["station"], "type": "continuous", "lower_bound": 0},
    {"code": "ramp_abs", "name": "出力变化绝对值", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "forebay_level", "name": "上游水位", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "tailwater_level", "name": "尾水位", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
    {"code": "head", "name": "净水头", "dimension": ["station", "time"], "type": "continuous", "lower_bound": 0},
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
    {"code": "edges", "name": "梯级拓扑", "dimension": ["edge"], "default": 1},
    {"code": "initial_upstream_outflow", "name": "初始上游下泄", "dimension": ["edge"], "default": 1},
    {"code": "gen_flow_min", "name": "发电流量下限", "dimension": ["station"], "default": 0},
    {"code": "gen_flow_max", "name": "发电流量上限", "dimension": ["station"], "default": 160},
    {"code": "ecological_flow_min", "name": "生态下泄下限", "dimension": ["station"], "default": 0},
    {"code": "head_loss", "name": "水头损失", "dimension": ["station"], "default": 0},
]

# These symbols are produced inside the component builder from other runtime
# inputs.  They are part of the formula-analysis symbol table, but are not
# user-facing bindings: asking the user to bind them would incorrectly turn a
# derived value into a required input.
HYDRO_DERIVED_PARAMETERS: dict[str, list[dict[str, Any]]] = {
    "hydro_station_available_capacity": [
        {"code": "station_pmax", "name": "电站可用容量", "dimension": ["station", "time"], "derived": True},
    ],
    "hydro_reservoir_balance": [
        {"code": "delta_v", "name": "流量库容换算系数", "dimension": [], "derived": True},
    ],
}

HYDRO_CONSTRAINT_OVERRIDES: dict[str, list[dict[str, Any]]] = {
    "hydro_initial_volume": [{"expression": "volume[s,0] == initial_volume[s]"}],
    "hydro_volume_bounds": [
        {"constraint_id": "hydro_volume_min", "name": "库容下限约束", "expression": "volume[s,t] >= volume_min[s]", "indices": ["station", "time_volume"]},
        {"constraint_id": "hydro_volume_max", "name": "库容上限约束", "expression": "volume[s,t] <= volume_max[s]", "indices": ["station", "time_volume"]},
    ],
    "hydro_station_available_capacity": [{"expression": "station_power[s,t] <= station_pmax[s,t]"}],
    "hydro_power_flow_conversion": [{"expression": "station_power[s,t] == power_conversion[s] * q_gen[s,t]"}],
    "hydro_generation_flow_bounds": [
        {"constraint_id": "hydro_gen_flow_min", "name": "发电流量下限约束", "expression": "q_gen[s,t] >= gen_flow_min[s]"},
        {"constraint_id": "hydro_gen_flow_max", "name": "发电流量上限约束", "expression": "q_gen[s,t] <= gen_flow_max[s]"},
    ],
    "hydro_outflow_balance": [{"expression": "q_out[s,t] == q_gen[s,t] + q_spill[s,t]"}],
    "hydro_outflow_bounds": [
        {"constraint_id": "hydro_outflow_min", "name": "下泄流量下限约束", "expression": "q_out[s,t] >= outflow_min[s]"},
        {"constraint_id": "hydro_outflow_max", "name": "下泄流量上限约束", "expression": "q_out[s,t] <= outflow_max[s]"},
    ],
    "hydro_spill_bounds": [
        {"constraint_id": "hydro_spill_min", "name": "弃水非负约束", "expression": "q_spill[s,t] >= 0"},
        {"constraint_id": "hydro_spill_max", "name": "弃水上限约束", "expression": "q_spill[s,t] <= spill_max[s]"},
    ],
    "hydro_ecological_flow": [{"expression": "q_out[s,t] >= ecological_flow_min[s]"}],
    "hydro_head_calculation": [{"expression": "head[s,t] == forebay_level[s,t] - tailwater_level[s,t] - head_loss[s]"}],
    "hydro_cascade_inflow_delay": [{"expression": "inflow[s,t] == local_inflow[s,t]"}],
    "hydro_reservoir_balance": [{
        "expression": "volume[s,tv+1] == volume[s,tv] + (inflow[s,t] - q_out[s,t]) * delta_v",
        "scope": [{"alias": "s", "set": "station"}, {"alias": "t", "set": "time"}, {"alias": "tv", "set": "time_volume"}],
        "boundary_strategy": "skip_last",
    }],
    "hydro_load_tracking": [{"expression": "sum(station_power[s,t] for s in station) - load_forecast[t] == load_dev_pos[t] - load_dev_neg[t]"}],
    "hydro_terminal_volume": [{"expression": "volume[s,2] - target_terminal_volume[s] == terminal_dev_pos[s] - terminal_dev_neg[s]"}],
    "hydro_ramp_smoothing": [
        {"constraint_id": "hydro_ramp_up", "name": "出力上爬坡约束", "expression": "ramp_abs[s,t] >= station_power[s,t] - station_power[s,t-1]", "boundary_strategy": "skip_first"},
        {"constraint_id": "hydro_ramp_down", "name": "出力下爬坡约束", "expression": "ramp_abs[s,t] >= station_power[s,t-1] - station_power[s,t]", "boundary_strategy": "skip_first"},
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
    # Import lazily: problem_type_diagnosis reads formula contracts from this
    # package, while importing the component package registers all builders.
    # Keeping this dependency at module scope makes a direct solver-router
    # import depend on import order and can leave both modules half-initialized.
    from app.problem_type_diagnosis import component_problem_type_fields

    builder = builder or get_component_builder(component_type)
    display_name = getattr(builder, "display_name", component_type)
    description = getattr(builder, "description", "")
    formula = getattr(builder, "formula", "")
    constraint_rows = HYDRO_CONSTRAINT_OVERRIDES.get(component_type) or [{"expression": formula}]
    generated_constraints = []
    for index, row in enumerate(constraint_rows):
        expression = formula_expression(row) or str(formula)
        generated_constraints.append(
            {
                **synchronize_formula_fields(deepcopy(row), expression),
                "constraint_id": row.get("constraint_id") or f"{component_type}_generated_{index + 1}",
                "name": row.get("name") or display_name,
                "type": row.get("type") or COMPONENT_CONSTRAINT_TYPES.get(component_type, "business_rule"),
                **participation_fields(row),
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
                "dsl_formula": "w ~= x * y",
                "expression": "w ~= x * y",
                "business_meaning": description,
                "indices": [],
                "generation_mode": "programmatic",
                "programmatic": True,
                "generated_by": "validate_mccormick_spec",
                "expression_class": "linear",
                **participation_fields("solve_active"),
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
                **participation_fields(term),
                "editable": True,
            }
        )
    parameter_by_code = {
        str(row.get("code") or row.get("key") or row.get("name")): row
        for row in HYDRO_PARAMETERS
    }
    required_parameter_codes = list(getattr(builder, "required_parameters", []))
    component_parameters = []
    for code in required_parameter_codes:
        row = parameter_by_code.get(str(code))
        if not row:
            continue
        component_parameters.append({**deepcopy(row), "required": True})
    if component_type == "hydro_head_calculation":
        component_parameters.append({**deepcopy(parameter_by_code["head_loss"]), "required": False})
    item = {
        "component_id": component_type,
        "type": component_type,
        "name": display_name,
        "display_name": display_name,
        "domain": "水电调度" if component_type.startswith("hydro_") else "通用建模",
        "category": getattr(builder, "category", "未分类"),
        "version": "1.0.0",
        "status": "published",
        "backend_builder": component_type,
        "required": component_type in {"hydro_power_flow_conversion", "hydro_outflow_balance"},
        "depends_on": list(getattr(builder, "depends_on", [])),
        "inputs": list(getattr(builder, "required_parameters", [])),
        # A component's parameter contract should describe only the inputs it
        # consumes.  The old catalog copied the entire hydro model parameter
        # catalog into every component, which made version validation report
        # unrelated fields (for example station_pmax and delta_v) as missing
        # bindings even though they are derived at build time.
        "parameters": component_parameters if component_type.startswith("hydro_") else [],
        "derived_parameters": deepcopy(HYDRO_DERIVED_PARAMETERS.get(component_type, [])),
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
    if hasattr(builder, "explain"):
        item.update(builder.explain())
    component_label = str(item.get("display_name") or item.get("name") or display_name)
    for schema_key in ("sets", "required_sets", "parameters", "variables"):
        rows = item.get(schema_key) or []
        item[schema_key] = [
            {
                **deepcopy(row),
                "name": row.get("name") or row.get("code") or row.get("key") or f"{schema_key}_{index + 1}",
            }
            if isinstance(row, dict)
            else {"code": str(row), "name": str(row)}
            for index, row in enumerate(rows)
        ]
    for formula_key, id_key in (("generated_constraints", "constraint_id"), ("generated_objective_terms", "term_id")):
        rows = item.get(formula_key) or []
        normalized_rows = []
        for index, row in enumerate(rows):
            normalized = deepcopy(row) if isinstance(row, dict) else {"expression": str(row)}
            formula_code = str(normalized.get(id_key) or normalized.get("code") or f"{component_type}_{formula_key}_{index + 1}")
            normalized[id_key] = formula_code
            normalized["name"] = normalized.get("name") or (component_label if len(rows) == 1 else f"{component_label} · {formula_code}")
            normalized_rows.append(normalized)
        item[formula_key] = normalized_rows
    if component_type.startswith("hydro_"):
        item["component_family"] = "hydro preset"
        item.setdefault("can_be_composed_from", _hydro_generic_composition(component_type))
    problem_type = item.get("problem_type") or item.get("problem_type_effect") or "LP"
    item["problem_type"] = problem_type
    item["problem_types"] = list(item.get("problem_types") or item.get("solver_capabilities") or [problem_type])
    item["solver_capabilities"] = list(item.get("solver_capabilities") or item.get("problem_types") or [problem_type])
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
