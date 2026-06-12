from __future__ import annotations

import re
from typing import Any

import pyomo.environ as pyo

import app.model_components  # noqa: F401
from app.model_components.context import create_component_context
from app.model_components.formula_components import DynamicFormulaComponent, load_library_component
from app.model_components.objective_components import build_weighted_objective
from app.model_components.registry import get_component_builder
from app.model_components.solver_capabilities import check_solver_capability


DOMAIN_MAP = {
    "NonNegativeReals": pyo.NonNegativeReals,
    "Reals": pyo.Reals,
    "Binary": pyo.Binary,
    "Integers": pyo.Integers,
    "NonNegativeIntegers": pyo.NonNegativeIntegers,
}


class ComponentModelBuilder:
    def build(self, model_spec: dict[str, Any], runtime_parameters: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        solver_name = runtime_parameters.get("solver", "highs")
        required = model_spec.get("required_solver_capabilities", ["LP"])
        required_list = [str(item).upper() for item in list(required)]
        solver_route_warnings = []
        if any(item in {"NLP", "MINLP"} for item in required_list) and str(solver_name or "").lower() not in {"ipopt", "bonmin"}:
            solver_route_warnings.append(
                f"Model requires {', '.join(required_list)}; IPOPT/Bonmin route is reserved but not forced during build."
            )
        else:
            check_solver_capability(str(solver_name), required_list)
        context = create_component_context(model_spec, runtime_parameters)
        if solver_route_warnings:
            context.setdefault("metadata", {}).setdefault("solver_route_warnings", []).extend(solver_route_warnings)
        model = pyo.ConcreteModel(name=model_spec.get("model_code", "component_model"))
        self._build_sets(model, model_spec, runtime_parameters, context)
        self._build_variables(model, model_spec, context)

        components = list(model_spec.get("components", []))
        for component in components:
            builder = self._component_builder(str(component.get("type") or component.get("component_id")))
            builder.validate(component, context)
        for component in components:
            builder = self._component_builder(str(component.get("type") or component.get("component_id")))
            builder.build(model, component, context)

        self._build_pv_storage_capacity_guards(model, context)
        self._build_additional_custom_constraints(model, model_spec)
        build_weighted_objective(model, model_spec.get("objective", {}), context)
        model._component_context = context
        return model, {
            "model_code": model_spec.get("model_code"),
            "build_mode": "component_based",
            "component_types": [component.get("type") for component in components],
            "context": context,
            **context,
        }

    def _component_builder(self, component_type: str) -> Any:
        try:
            return get_component_builder(component_type)
        except RuntimeError:
            definition = load_library_component(component_type)
            if not definition or definition.get("status") not in {"published", "trial", "tested"}:
                raise RuntimeError(f"组件 {component_type} 未发布或不存在，不能参与模型 dry-run。")
            if definition.get("enabled", True) is False:
                raise RuntimeError(f"组件 {component_type} 已停用，不能参与模型 dry-run。")
            return DynamicFormulaComponent(definition)

    def _build_sets(self, model: Any, model_spec: dict[str, Any], runtime_parameters: dict[str, Any], context: dict[str, Any]) -> None:
        set_names = self._required_set_names(model_spec)
        declared_sets = {
            str(item.get("name") or item.get("code") or item.get("key")): item
            for item in model_spec.get("sets", []) or []
            if item.get("name") or item.get("code") or item.get("key")
        }
        for set_name in set_names:
            values = self._set_values(set_name, declared_sets.get(set_name, {}), runtime_parameters)
            if not values:
                raise RuntimeError(f"组件化模型集合 {set_name} 不能为空。")
            setattr(model, set_name, pyo.Set(initialize=values, ordered=True))
            context["sets"][set_name] = values

    def _build_variables(self, model: Any, model_spec: dict[str, Any], context: dict[str, Any]) -> None:
        for variable in model_spec.get("variables", []) or []:
            name = str(variable.get("code") or variable.get("name"))
            indices = list(variable.get("indices") or variable.get("dimension") or [])
            domain_name = str(variable.get("domain") or "NonNegativeReals")
            if domain_name not in DOMAIN_MAP:
                raise RuntimeError(f"不支持的变量域：{domain_name}")
            index_sets = [getattr(model, index_name) for index_name in indices]
            bounds = self._variable_bounds(variable, context)
            pyomo_var = pyo.Var(*index_sets, within=DOMAIN_MAP[domain_name], bounds=bounds) if index_sets else pyo.Var(within=DOMAIN_MAP[domain_name], bounds=bounds)
            setattr(model, name, pyomo_var)
            context["variables"][name] = pyomo_var

    def _variable_bounds(self, variable: dict[str, Any], context: dict[str, Any]) -> Any:
        lower = variable.get("lower_bound", variable.get("lb", None))
        upper = variable.get("upper_bound", variable.get("ub", None))
        if lower is None and upper is None:
            return None
        indices = list(variable.get("indices") or variable.get("dimension") or [])

        def resolve(raw: Any, *values: Any) -> Any:
            if raw is None:
                return None
            if isinstance(raw, (int, float)):
                return raw
            if isinstance(raw, str):
                try:
                    return float(raw)
                except ValueError:
                    value = (context.get("runtime_parameters") or {}).get(raw)
                    if value is None:
                        return None
                    for index in values:
                        if isinstance(value, dict):
                            value = value.get(index, value.get(str(index)))
                        elif isinstance(value, list):
                            pos = int(index) if isinstance(index, int) or str(index).isdigit() else 0
                            value = value[pos]
                        else:
                            break
                    return value
            return raw

        if not indices:
            return (resolve(lower), resolve(upper))

        def bound_rule(_m: Any, *values: Any) -> tuple[Any, Any]:
            return (resolve(lower, *values), resolve(upper, *values))

        return bound_rule

    def _required_set_names(self, model_spec: dict[str, Any]) -> list[str]:
        names: list[str] = []
        for variable in model_spec.get("variables", []) or []:
            for index_name in list(variable.get("indices") or variable.get("dimension") or []):
                if index_name not in names:
                    names.append(str(index_name))
        for item in model_spec.get("sets", []) or []:
            name = item.get("name") or item.get("code") or item.get("key")
            if name and str(name) not in names:
                names.append(str(name))
        return names

    def _set_values(self, set_name: str, set_spec: dict[str, Any], runtime_parameters: dict[str, Any]) -> list[Any]:
        if set_name == "time":
            horizon = int(runtime_parameters.get("horizon") or len(runtime_parameters.get("time", [])) or 0)
            return list(runtime_parameters.get("time") or range(horizon))
        if set_name == "time_volume":
            horizon = int(runtime_parameters.get("horizon") or len(runtime_parameters.get("time", [])) or 0)
            return list(runtime_parameters.get("time_volume") or range(horizon + 1))
        runtime_value = runtime_parameters.get(set_name)
        if isinstance(runtime_value, (list, tuple)):
            return list(runtime_value)
        if set_spec.get("values"):
            return list(set_spec.get("values") or [])
        return []

    def _build_additional_custom_constraints(self, model: Any, model_spec: dict[str, Any]) -> None:
        constraints = model_spec.get("additional_custom_constraints") or []
        for index, item in enumerate(constraints):
            if item.get("enabled") is False:
                continue
            expression = str(item.get("expression") or "").strip()
            if not expression:
                continue
            name = str(item.get("name") or f"additional_custom_constraint_{index + 1}")
            relation = self._parse_simple_boundary_expression_strict(model, expression)
            setattr(model, self._safe_component_name(model, name, index), pyo.Constraint(expr=relation))

    def _build_pv_storage_capacity_guards(self, model: Any, context: dict[str, Any]) -> None:
        if not all(hasattr(model, name) for name in ("storage_power_capacity", "storage_energy_capacity", "p_ch", "p_dis")):
            return
        if "storage_capacity_decision" not in set(context.get("metadata", {}).get("reserved_components", [])) and not any(
            component == "storage_capacity_decision" for component in context.get("metadata", {}).get("component_types", [])
        ):
            component_types = {str(item.get("type") or item.get("component_id")) for item in (context.get("model_spec") or {}).get("components", [])}
            if "storage_capacity_decision" not in component_types:
                return
        delta_t = float(context["runtime_parameters"].get("delta_t", 1.0))
        max_power_capacity = float(context["runtime_parameters"].get("max_storage_power_capacity", 1_000_000.0))
        max_energy_capacity = float(context["runtime_parameters"].get("max_storage_energy_capacity", 1_000_000.0))

        def charge_rule(m: Any, t: Any) -> Any:
            return m.p_ch[t] * delta_t <= m.storage_energy_capacity

        def discharge_rule(m: Any, t: Any) -> Any:
            return m.p_dis[t] * delta_t <= m.storage_energy_capacity

        def power_capacity_bound_rule(m: Any) -> Any:
            return m.storage_power_capacity <= max_power_capacity

        def energy_capacity_bound_rule(m: Any) -> Any:
            return m.storage_energy_capacity <= max_energy_capacity

        model.pv_storage_charge_energy_capacity_guard = pyo.Constraint(model.time, rule=charge_rule)
        model.pv_storage_discharge_energy_capacity_guard = pyo.Constraint(model.time, rule=discharge_rule)
        model.pv_storage_power_capacity_upper_guard = pyo.Constraint(rule=power_capacity_bound_rule)
        model.pv_storage_energy_capacity_upper_guard = pyo.Constraint(rule=energy_capacity_bound_rule)
        context["constraints"]["pv_storage_charge_energy_capacity_guard"] = model.pv_storage_charge_energy_capacity_guard
        context["constraints"]["pv_storage_discharge_energy_capacity_guard"] = model.pv_storage_discharge_energy_capacity_guard
        context["constraints"]["pv_storage_power_capacity_upper_guard"] = model.pv_storage_power_capacity_upper_guard
        context["constraints"]["pv_storage_energy_capacity_upper_guard"] = model.pv_storage_energy_capacity_upper_guard

    def _parse_simple_boundary_expression_strict(self, model: Any, expression: str) -> Any:
        match = re.fullmatch(r"\s*([A-Za-z_]\w*)\s*\[([^\]]+)\]\s*(<=|>=|==)\s*(-?\d+(?:\.\d+)?)\s*", expression)
        if not match:
            raise RuntimeError(f"附加自定义约束表达式不合法：当前仅支持单变量边界表达式，例如 station_power[S1,0] <= 120；不支持 sum、通配符或复杂表达式。实际表达式：{expression}")
        variable_name, raw_indices, operator, raw_rhs = match.groups()
        if not hasattr(model, variable_name):
            raise RuntimeError(f"附加自定义约束引用了不存在的变量：{variable_name}")
        variable = getattr(model, variable_name)
        indices = tuple(self._parse_index_token(token.strip()) for token in raw_indices.split(","))
        if len(indices) != int(variable.dim()):
            raise RuntimeError(f"附加自定义约束索引维度不匹配：{variable_name} 需要 {variable.dim()} 维索引，实际为 {len(indices)} 维。")
        try:
            var_ref = variable[indices] if len(indices) > 1 else variable[indices[0]]
        except Exception as exc:
            raise RuntimeError(f"附加自定义约束引用了不存在的索引：{variable_name}[{raw_indices}]") from exc
        rhs = float(raw_rhs)
        if operator == "<=":
            return var_ref <= rhs
        if operator == ">=":
            return var_ref >= rhs
        return var_ref == rhs

    def _parse_simple_boundary_expression(self, model: Any, expression: str) -> Any:
        match = re.fullmatch(r"\s*([A-Za-z_]\w*)\s*\[([^\]]+)\]\s*(<=|>=|==)\s*(-?\d+(?:\.\d+)?)\s*", expression)
        if not match:
            raise RuntimeError(f"附加自定义约束仅支持简单边界表达式，例如 station_power[S1,20] <= 120：{expression}")
        variable_name, raw_indices, operator, raw_rhs = match.groups()
        if not hasattr(model, variable_name):
            raise RuntimeError(f"附加自定义约束引用了不存在的变量：{variable_name}")
        variable = getattr(model, variable_name)
        indices = tuple(self._parse_index_token(token.strip()) for token in raw_indices.split(","))
        var_ref = variable[indices] if len(indices) > 1 else variable[indices[0]]
        rhs = float(raw_rhs)
        if operator == "<=":
            return var_ref <= rhs
        if operator == ">=":
            return var_ref >= rhs
        return var_ref == rhs

    def _parse_index_token(self, token: str) -> Any:
        if re.fullmatch(r"-?\d+", token):
            return int(token)
        if re.fullmatch(r"-?\d+\.\d+", token):
            return float(token)
        return token.strip("\"'")

    def _safe_component_name(self, model: Any, name: str, index: int) -> str:
        cleaned = re.sub(r"\W+", "_", name).strip("_")
        if not cleaned or cleaned[0].isdigit():
            cleaned = f"additional_custom_constraint_{index + 1}"
        if hasattr(model, cleaned):
            cleaned = f"{cleaned}_{index + 1}"
        return cleaned
