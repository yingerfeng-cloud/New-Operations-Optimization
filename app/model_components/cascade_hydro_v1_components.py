from __future__ import annotations

from typing import Any

from app.model_components.registry import register_component


class CascadeHydroV1MetadataComponent:
    display_name = ""
    category = "梯级水电调度 v1"
    description = ""
    formula = ""
    required_parameters: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        return None

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        context["metadata"].setdefault("cascade_hydro_v1_metadata_components", []).append(self.component_type)

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "description": self.description,
            "generated_constraints": [],
            "generated_objective_terms": [],
            "variables": [],
            "parameters": [],
            "sets": [],
            "problem_type": "LP",
            "problem_types": ["LP"],
            "solver_capabilities": ["LP"],
            "metadata_only": True,
        }


@register_component("cascade_hydro_v1_water_balance")
class CascadeHydroV1WaterBalanceComponent(CascadeHydroV1MetadataComponent):
    display_name = "水量平衡组件"
    description = "v1 专用水量平衡展示组件；真实约束由 cascade_hydro_dispatch_v1 专用 Pyomo builder 生成。"
    formula = "storage[r,t] = previous_storage[r,t] + (inflow + upstream_release - outflow - spill) * delta_t"


@register_component("cascade_hydro_v1_head_calculation")
class CascadeHydroV1HeadCalculationComponent(CascadeHydroV1MetadataComponent):
    display_name = "水头计算组件"
    description = "v1 专用水头计算展示组件；真实约束由 cascade_hydro_dispatch_v1 专用 Pyomo builder 生成。"
    formula = "head[r,t] = level[r,t] - tailwater[r,t]"


@register_component("cascade_hydro_v1_terminal_storage")
class CascadeHydroV1TerminalStorageComponent(CascadeHydroV1MetadataComponent):
    display_name = "期末库容约束"
    description = "v1 专用期末库容偏差展示组件；真实约束由 cascade_hydro_dispatch_v1 专用 Pyomo builder 生成。"
    formula = "final_storage_deviation[r] >= +/- (storage[r,T] - target_final_storage[r])"
