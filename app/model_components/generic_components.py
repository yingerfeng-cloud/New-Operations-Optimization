from __future__ import annotations

from typing import Any

from app.model_components.formula_components import DynamicFormulaComponent
from app.model_components.registry import register_component


TIME_SET = [{"code": "time", "type": "time_period", "required": True, "values": [0, 1, 2]}]
STATE_TIME_SET = [
    {"code": "time", "type": "time_period", "required": True, "values": [0, 1, 2]},
    {"code": "time_volume", "type": "state_time", "base_set": "time", "generation_rule": "horizon_plus_1", "required": True, "values": [0, 1, 2, 3]},
]


class GenericFormulaBackedComponent:
    category = "通用建模组件"
    required_parameters: list[str] = []
    definition: dict[str, Any] = {}

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        return None

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        definition = {**self.explain(), "component_id": self.component_type}
        if not definition.get("variables"):
            definition["variables"] = (context.get("model_spec") or {}).get("variables") or []
        DynamicFormulaComponent(definition).build(model, spec, context)

    def explain(self) -> dict[str, Any]:
        return {
            **self.definition,
            "formula": self.formula,
            "implemented": True,
            "domain": "通用运筹优化",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
        }


@register_component("state_balance_component")
class StateBalanceComponent(GenericFormulaBackedComponent):
    display_name = "状态递推组件"
    description = "通用库存、库容、SOC 等状态在相邻时段之间的递推平衡。"
    formula = "state[t+1] == state[t] + inflow[t] - outflow[t]"
    definition = {
        "sets": STATE_TIME_SET,
        "variables": [
            {"code": "state", "dimension": ["time_volume"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "inflow", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "outflow", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "parameters": [{"code": "state_loss", "dimension": [], "default": 0}],
        "generated_constraints": [
            {"constraint_id": "state_balance_eq", "indices": [{"set": "time", "alias": "t"}], "expression": "state[t+1] == state[t] + inflow[t] - outflow[t] - state_loss", "boundary_strategy": "skip_last"}
        ],
    }


@register_component("balance_equation_component")
class BalanceEquationComponent(GenericFormulaBackedComponent):
    display_name = "平衡方程组件"
    description = "通用供需、物料、功率或流量平衡。"
    formula = "supply[t] + slack_pos[t] - slack_neg[t] == demand[t]"
    definition = {
        "sets": TIME_SET,
        "parameters": [{"code": "demand", "dimension": ["time"], "default": 1}],
        "variables": [
            {"code": "supply", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "slack_pos", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "slack_neg", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "generated_constraints": [{"constraint_id": "balance_eq", "indices": [{"set": "time", "alias": "t"}], "expression": "supply[t] + slack_pos[t] - slack_neg[t] == demand[t]"}],
    }


@register_component("network_delay_flow_component")
class NetworkDelayFlowComponent(GenericFormulaBackedComponent):
    display_name = "网络延迟流组件"
    description = "通用网络边上的上游出流到下游入流延迟关系。"
    formula = "downstream_inflow[t] == upstream_outflow[t-delay]"
    definition = {
        "sets": TIME_SET,
        "variables": [
            {"code": "upstream_outflow", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "downstream_inflow", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "generated_constraints": [{"constraint_id": "network_delay_eq", "indices": [{"set": "time", "alias": "t"}], "expression": "downstream_inflow[t] == upstream_outflow[t-1]", "boundary_strategy": "skip_first"}],
    }


@register_component("terminal_state_tracking_component")
class TerminalStateTrackingComponent(GenericFormulaBackedComponent):
    display_name = "期末状态跟踪组件"
    description = "通过正负偏差变量跟踪期末状态目标。"
    formula = "state[T] + dev_pos - dev_neg == target"
    definition = {
        "sets": STATE_TIME_SET,
        "parameters": [{"code": "terminal_time", "dimension": [], "default": 3}, {"code": "terminal_target", "dimension": [], "default": 0}],
        "variables": [
            {"code": "state", "dimension": ["time_volume"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "terminal_dev_pos", "dimension": [], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "terminal_dev_neg", "dimension": [], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "generated_constraints": [{"constraint_id": "terminal_state_tracking_eq", "indices": [], "expression": "state[terminal_time] + terminal_dev_pos - terminal_dev_neg == terminal_target"}],
        "generated_objective_terms": [{"term_id": "terminal_state_penalty", "expression": "terminal_dev_pos + terminal_dev_neg", "weight_key": "terminal_state", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}],
    }


@register_component("schedule_tracking_component")
class ScheduleTrackingComponent(GenericFormulaBackedComponent):
    display_name = "计划曲线跟踪组件"
    description = "通过正负偏差变量跟踪给定计划、负荷或排程曲线。"
    formula = "actual[t] + dev_pos[t] - dev_neg[t] == schedule[t]"
    definition = {
        "sets": TIME_SET,
        "parameters": [{"code": "schedule", "dimension": ["time"], "default": 1}],
        "variables": [
            {"code": "actual", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "dev_pos", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "dev_neg", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "generated_constraints": [{"constraint_id": "schedule_tracking_eq", "indices": [{"set": "time", "alias": "t"}], "expression": "actual[t] + dev_pos[t] - dev_neg[t] == schedule[t]"}],
        "generated_objective_terms": [{"term_id": "schedule_tracking_penalty", "expression": "sum(dev_pos[t] + dev_neg[t] for t in time)", "weight_key": "deviation", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}],
    }


@register_component("ramp_smoothing_component")
class RampSmoothingComponent(GenericFormulaBackedComponent):
    display_name = "爬坡平滑组件"
    description = "用绝对值辅助变量限制或惩罚相邻时段变量波动。"
    formula = "ramp_abs[t] >= value[t] - value[t-1]"
    definition = {
        "sets": TIME_SET,
        "variables": [
            {"code": "value", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
            {"code": "ramp_abs", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0},
        ],
        "generated_constraints": [
            {"constraint_id": "ramp_up", "indices": [{"set": "time", "alias": "t"}], "expression": "ramp_abs[t] >= value[t] - value[t-1]", "boundary_strategy": "skip_first"},
            {"constraint_id": "ramp_down", "indices": [{"set": "time", "alias": "t"}], "expression": "ramp_abs[t] >= value[t-1] - value[t]", "boundary_strategy": "skip_first"},
        ],
        "generated_objective_terms": [{"term_id": "ramp_smoothing_penalty", "expression": "sum(ramp_abs[t] for t in time)", "weight_key": "ramp", "weight": 1, "solve_participation": "solve_active", "supported_by_backend": True}],
    }


@register_component("capacity_bounds_component")
class CapacityBoundsComponent(GenericFormulaBackedComponent):
    display_name = "容量上下界组件"
    description = "通用变量容量、安全边界或资源上限约束。"
    formula = "lower_bound[t] <= bounded_value[t] <= upper_bound[t]"
    definition = {
        "sets": TIME_SET,
        "parameters": [{"code": "lower_bound", "dimension": ["time"], "default": 0}, {"code": "upper_bound", "dimension": ["time"], "default": 100}],
        "variables": [{"code": "bounded_value", "dimension": ["time"], "domain": "NonNegativeReals", "lower_bound": 0}],
        "generated_constraints": [
            {"constraint_id": "capacity_lower_bound", "indices": [{"set": "time", "alias": "t"}], "expression": "bounded_value[t] >= lower_bound[t]"},
            {"constraint_id": "capacity_upper_bound", "indices": [{"set": "time", "alias": "t"}], "expression": "bounded_value[t] <= upper_bound[t]"},
        ],
    }
