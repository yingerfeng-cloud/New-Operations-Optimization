from __future__ import annotations

import ast
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
        self._validate_parameter_dimensions(model_spec, runtime_parameters, context)
        self._run_precheck_config(model_spec, context)
        self._build_variables(model, model_spec, context)

        components = list(model_spec.get("components", []))
        for component in components:
            builder = self._component_builder(component)
            builder.validate(component, context)
        for component in components:
            builder = self._component_builder(component)
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

    def _component_builder(self, component: dict[str, Any] | str) -> Any:
        if isinstance(component, dict):
            component_type = str(component.get("type") or component.get("component_id"))
        else:
            component_type = str(component)
        try:
            return get_component_builder(component_type)
        except RuntimeError:
            if isinstance(component, dict):
                definition = component.get("definition") or {}
                if definition:
                    return DynamicFormulaComponent(definition)
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

    def _validate_parameter_dimensions(self, model_spec: dict[str, Any], runtime_parameters: dict[str, Any], context: dict[str, Any]) -> None:
        for item in model_spec.get("parameters", []) or []:
            code = str(item.get("code") or item.get("name") or item.get("key") or "")
            dimensions = list(item.get("dimension") or item.get("indices") or [])
            if not code or not dimensions:
                continue
            raw = runtime_parameters.get(code)
            if raw is None:
                raw = item.get("default")
            if raw is None:
                raw = item.get("sample")
            if raw is None:
                raise RuntimeError(f"参数 {code} 缺失，无法按维度 {dimensions} 构建组件化模型。")
            if len(dimensions) == 1 and dimensions[0] in {"time", "time_volume"}:
                set_name = str(dimensions[0])
                expected = len(context.get("sets", {}).get(set_name) or [])
                if isinstance(raw, list):
                    actual = len(raw)
                    if actual != expected:
                        raise RuntimeError(f"参数 {code} 长度不一致：维度 {set_name} 需要 {expected} 个值，实际 {actual} 个。")
                elif isinstance(raw, dict):
                    actual = len(raw)
                    if actual != expected:
                        raise RuntimeError(f"参数 {code} 长度不一致：维度 {set_name} 需要 {expected} 个值，实际 {actual} 个。")
                else:
                    raise RuntimeError(f"参数 {code} 必须提供与 {set_name} 集合等长的数组或字典，实际类型为 {type(raw).__name__}。")

    def _run_precheck_config(self, model_spec: dict[str, Any], context: dict[str, Any]) -> None:
        config = model_spec.get("precheck_config") or model_spec.get("validation_config") or {}
        checks = list(config.get("checks") or [])
        if not checks:
            return
        data = {**(context.get("runtime_parameters") or {}), **(context.get("sets") or {})}
        for item in checks:
            expression = str(item.get("expression") or "").strip()
            if not expression:
                continue
            try:
                passed = bool(self._eval_precheck_expression(expression, data))
            except Exception as exc:
                message = str(item.get("error_message") or item.get("message") or f"参数预校验失败：{expression}")
                raise RuntimeError(f"{message}（预校验表达式无法计算：{exc}）") from exc
            if not passed:
                message = str(item.get("error_message") or item.get("message") or f"参数预校验未通过：{expression}")
                raise RuntimeError(message)

    def _eval_precheck_expression(self, expression: str, data: dict[str, Any]) -> Any:
        return self._eval_precheck_node(ast.parse(expression, mode="eval").body, data, {})

    def _eval_precheck_node(self, node: ast.AST, data: dict[str, Any], local: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in local:
                return local[node.id]
            if node.id in data:
                return data[node.id]
            raise RuntimeError(f"预校验表达式引用了不存在的变量：{node.id}")
        if isinstance(node, ast.UnaryOp):
            value = self._eval_precheck_node(node.operand, data, local)
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp):
            left = self._eval_precheck_node(node.left, data, local)
            right = self._eval_precheck_node(node.right, data, local)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right if right else 0.0
            if isinstance(node.op, ast.Pow):
                return left**right
        if isinstance(node, ast.Compare):
            left = self._eval_precheck_node(node.left, data, local)
            for op, comparator in zip(node.ops, node.comparators, strict=False):
                right = self._eval_precheck_node(comparator, data, local)
                if isinstance(op, ast.Eq):
                    ok = left == right
                elif isinstance(op, ast.NotEq):
                    ok = left != right
                elif isinstance(op, ast.LtE):
                    ok = left <= right
                elif isinstance(op, ast.GtE):
                    ok = left >= right
                elif isinstance(op, ast.Lt):
                    ok = left < right
                elif isinstance(op, ast.Gt):
                    ok = left > right
                else:
                    raise RuntimeError(f"不支持的比较运算：{ast.dump(op)}")
                if not ok:
                    return False
                left = right
            return True
        if isinstance(node, ast.BoolOp):
            values = [bool(self._eval_precheck_node(item, data, local)) for item in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Subscript):
            base = node.value.id if isinstance(node.value, ast.Name) else ""
            if base not in data:
                raise RuntimeError(f"预校验表达式引用了不存在的变量：{base}")
            index = self._eval_precheck_node(node.slice, data, local)
            return self._precheck_item(data[base], index)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            name = node.func.id
            if name in {"sum", "max", "min", "all", "any"}:
                values = self._eval_precheck_generator_values(node, data, local)
                if name == "sum":
                    return sum(values)
                if name == "max":
                    return max(values) if values else 0.0
                if name == "min":
                    return min(values) if values else 0.0
                if name == "all":
                    return all(bool(item) for item in values)
                return any(bool(item) for item in values)
            if name == "abs":
                return abs(self._eval_precheck_node(node.args[0], data, local))
        raise RuntimeError(f"不支持的预校验表达式：{ast.dump(node)}")

    def _eval_precheck_generator_values(self, node: ast.Call, data: dict[str, Any], local: dict[str, Any]) -> list[Any]:
        if not node.args:
            return []
        generator = node.args[0]
        if isinstance(generator, ast.GeneratorExp):
            if len(generator.generators) != 1:
                raise RuntimeError("预校验聚合暂只支持单层 for")
            comp = generator.generators[0]
            if not isinstance(comp.target, ast.Name) or not isinstance(comp.iter, ast.Name):
                raise RuntimeError("预校验聚合迭代器必须是命名集合")
            if comp.iter.id not in data:
                raise RuntimeError(f"预校验表达式引用了不存在的变量：{comp.iter.id}")
            rows = []
            for label in list(data[comp.iter.id] or []):
                next_local = {**local, comp.target.id: label, comp.iter.id: label}
                if comp.ifs and not all(bool(self._eval_precheck_node(item, data, next_local)) for item in comp.ifs):
                    continue
                rows.append(self._eval_precheck_node(generator.elt, data, next_local))
            return rows
        raw = self._eval_precheck_node(generator, data, local)
        if isinstance(raw, dict):
            return list(raw.values())
        if isinstance(raw, list):
            return list(raw)
        return [raw]

    def _precheck_item(self, raw: Any, index: Any) -> Any:
        if isinstance(raw, dict):
            return raw.get(index, raw.get(str(index), 0.0))
        if isinstance(raw, list):
            return raw[int(index)] if int(index) < len(raw) else 0.0
        return raw

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
