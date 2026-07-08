from __future__ import annotations

import ast
import itertools
import re
from copy import deepcopy
from typing import Any

import pyomo.environ as pyo

from app.storage.memory_store import STORE
from app.problem_type_diagnosis import component_problem_type_fields
from app.model_components.solver_capabilities import normalize_capabilities


RELATION_OPS = (ast.Eq, ast.LtE, ast.GtE)
ARITHMETIC_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
UNARY_OPS = (ast.UAdd, ast.USub)
ALLOWED_FUNCTIONS = {"sum", "min", "max", "abs", "log", "exp", "sqrt", "piecewise"}
SCIENTIFIC_FUNCTIONS = {"log", "exp", "sqrt"}
PIECEWISE_STRICT_VALIDATION = False
DEFAULT_INDEX_ALIASES = {"time": "t", "time_volume": "tv", "unit": "u", "station": "s", "edge": "e", "scenario": "sc"}
BOUNDARY_STRATEGIES = {"normal", "skip_first", "skip_last", "use_initial_value", "use_terminal_value", "skip_out_of_range"}
DISPLAY_ONLY_MODES = {"display_only", "remark_only", "none"}


def validate_component_definition(component: dict[str, Any]) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    component_id = str(component.get("component_id") or component.get("type") or "")
    if not component_id:
        errors.append(_error("component_id", "组件编码不能为空", "请填写唯一英文编码，例如 storage_soc_balance。"))
    if not re.fullmatch(r"[A-Za-z_]\w*", component_id or ""):
        errors.append(_error("component_id", "组件编码只能包含字母、数字和下划线，且不能以数字开头", "请使用 snake_case 编码。"))

    if errors:
        return {"valid": False, "errors": errors}
    status = str(component.get("status") or "").lower()
    if component.get("metadata_only") is True or status in {"reserved", "planned"}:
        return {
            "valid": True,
            "status": status or "reserved",
            "metadata_only": True,
            "implemented": False,
            "enabled": False,
            "errors": [],
        }

    symbols = _symbol_table(component)
    for section, rows in (("constraints", component.get("constraints") or component.get("generated_constraints") or []), ("objective_terms", component.get("objective_terms") or component.get("generated_objective_terms") or [])):
        for index, item in enumerate(rows):
            if _is_programmatic_generated(item):
                continue
            expression = str(item.get("expression") or item.get("formula") or "").strip()
            if not expression:
                continue
            if section == "constraints":
                errors.extend(_validate_boundary_strategy(expression, item, f"{section}[{index}].boundary_strategy"))
                if PIECEWISE_STRICT_VALIDATION and _contains_piecewise(expression) and _is_solve_active(item):
                    errors.append(
                        _error(
                            f"{section}[{index}].expression",
                            "piecewise 约束当前仅支持 display_only 或 participates_in_solve=false",
                            "请将分段线性约束标记为 display_only，或先实现并声明 piecewise_compiler='pyomo_piecewise'。",
                        )
                    )
            if section == "objective_terms" and not _has_relation(expression):
                expression = f"{expression} == 0"
            errors.extend(validate_formula_expression(expression, symbols, f"{section}[{index}].expression"))

    errors.extend(_validate_piecewise_component(component))
    dependency_errors = _validate_dependencies(component)
    errors.extend(dependency_errors)
    if not errors and not _component_uses_only_programmatic_constraints(component):
        errors.extend(validate_component_compiles(component))
    return {"valid": not errors, "errors": errors}


def validate_component_compiles(component: dict[str, Any]) -> list[dict[str, Any]]:
    normalized = normalize_component_payload(component)
    model_spec = _compile_test_model_spec(normalized)
    runtime_parameters = _compile_test_runtime_parameters(normalized, model_spec)
    try:
        model = pyo.ConcreteModel(name=f"{normalized['component_id']}_compile_check")
        context = {
            "sets": {},
            "parameters": {},
            "variables": {},
            "derived_parameters": {},
            "derived_expressions": {},
            "constraints": {},
            "metadata": {"model_code": "component_compile_check", "build_mode": "component_based"},
            "runtime_parameters": runtime_parameters,
            "model_spec": model_spec,
        }
        for item in model_spec["sets"]:
            set_name = item["code"]
            values = item.get("values") or runtime_parameters.get(set_name) or [0, 1, 2]
            setattr(model, set_name, pyo.Set(initialize=values, ordered=True))
            context["sets"][set_name] = list(values)
        for variable in model_spec["variables"]:
            name = str(variable.get("name") or variable.get("code"))
            dims = list(variable.get("indices") or variable.get("dimension") or [])
            domain = pyo.Binary if str(variable.get("domain") or variable.get("type")).lower() in {"binary", "bool", "boolean"} else pyo.NonNegativeReals
            index_sets = [getattr(model, dim) for dim in dims]
            setattr(model, name, pyo.Var(*index_sets, within=domain) if index_sets else pyo.Var(within=domain))
            context["variables"][name] = getattr(model, name)
        DynamicFormulaComponent(normalized).build(model, {"type": normalized["component_id"]}, context)
        return []
    except Exception as exc:
        return [_error("formula_compile", f"公式可校验但无法编译为 Pyomo 约束：{exc}", "请检查索引别名、边界策略、变量维度和参数维度。")]


def validate_formula_expression(expression: str, symbols: dict[str, set[str]], field: str = "expression") -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        return [_error(field, f"公式语法错误：{exc.msg}", "请检查括号、索引和关系符。")]
    body = tree.body
    if not isinstance(body, ast.Compare) or len(body.ops) != 1 or not isinstance(body.ops[0], RELATION_OPS):
        errors.append(_error(field, "公式必须包含且只能包含一个 <=、>= 或 == 关系符", "请写成 lhs <= rhs、lhs >= rhs 或 lhs == rhs。"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS:
                allowed = ", ".join(f"{name}(...)" for name in sorted(ALLOWED_FUNCTIONS))
                errors.append(_error(field, "公式包含非法函数调用", f"当前仅允许 {allowed}。"))
        elif isinstance(node, ast.BinOp) and not isinstance(node.op, ARITHMETIC_OPS):
            errors.append(_error(field, "公式包含不支持的运算符", "当前仅允许 +、-、*、/。"))
        elif isinstance(node, ast.UnaryOp) and not isinstance(node.op, UNARY_OPS):
            errors.append(_error(field, "公式包含不支持的一元运算符", "当前仅允许正负号。"))
        elif isinstance(node, ast.BoolOp | ast.IfExp | ast.Attribute | ast.Lambda | ast.Dict | ast.ListComp | ast.SetComp):
            errors.append(_error(field, "公式包含不安全或不支持的 Python 结构", "请使用受限 DSL，不允许访问属性、条件表达式或推导式。"))
        elif isinstance(node, ast.Name):
            _validate_name(node.id, symbols, field, errors)
        elif isinstance(node, ast.Subscript):
            base = _subscript_base(node)
            if base and base not in symbols["variables"] and base not in symbols["parameters"]:
                errors.append(_error(field, f"变量或参数 {base} 不存在", "请先在变量或参数定义中新增该编码，或修改公式引用。"))
    if _contains_unsafe_text(expression):
        errors.append(_error(field, "公式包含不安全关键字", "不允许 import、eval、exec、open、文件、网络或系统调用。"))
    if _contains_nonlinear_product(tree, symbols["variables"]):
        errors.append(_error(field, "当前阶段仅支持线性公式，检测到变量与变量相乘", "请改写为线性约束或使用 Big-M 线性化。"))
    _refresh_formula_function_suggestions(errors)
    return errors


def load_library_component(component_type: str) -> dict[str, Any] | None:
    with STORE.lock:
        component = deepcopy(STORE.custom_components.get(component_type) or {})
    if not component:
        return None
    return normalize_component_payload(component)


def normalize_component_payload(payload: dict[str, Any]) -> dict[str, Any]:
    component_id = str(payload.get("component_id") or payload.get("type") or "").strip()
    constraints = deepcopy(payload.get("constraints") or payload.get("generated_constraints") or [])
    objective_terms = deepcopy(payload.get("objective_terms") or payload.get("generated_objective_terms") or [])
    variables = deepcopy(payload.get("variables") or [])
    parameters = [_normalize_schema_item(item, "parameter") for item in deepcopy(payload.get("parameters") or payload.get("inputs") or [])]
    sets = [_normalize_schema_item(item, "set") for item in deepcopy(payload.get("sets") or [])]
    generated_constraints = []
    for index, item in enumerate(constraints):
        constraint_id = item.get("constraint_id") or item.get("code") or f"{component_id}_constraint_{index + 1}"
        expression = item.get("expression") or item.get("formula") or ""
        boundary_strategy = item.get("boundary_strategy") or _default_boundary_strategy(str(expression))
        solve_participation = item.get("solve_participation")
        participates = item.get("participates_in_solve", True)
        if solve_participation in {"display_only", "remark_only", "none"}:
            participates = False
        generated_constraints.append(
            {
                **item,
                "constraint_id": constraint_id,
                "name": item.get("name") or constraint_id,
                "formula": expression,
                "expression": expression,
                "enabled": item.get("enabled", True),
                "participates_in_solve": participates,
                "solve_participation": solve_participation or ("solve_active" if participates else "display_only"),
                "boundary_strategy": boundary_strategy,
                "source_component": component_id,
            }
        )
    generated_terms = []
    for index, item in enumerate(objective_terms):
        term_id = item.get("term_id") or item.get("code") or f"{component_id}_objective_{index + 1}"
        generated_terms.append(
            {
                **item,
                "term_id": term_id,
                "name": item.get("name") or term_id,
                "source": "component",
                "source_component": component_id,
                "enabled": item.get("enabled", True),
                "editable": True,
                "supported_by_backend": item.get("supported_by_backend", False),
                "solve_participation": item.get("solve_participation", "display_only"),
                "expression": item.get("expression") or item.get("formula") or "",
            }
        )
    problem_fields = component_problem_type_fields({**payload, "variables": variables, "constraints": generated_constraints, "objective_terms": generated_terms})
    problem_types = normalize_capabilities(list(payload.get("problem_types") or payload.get("solver_capabilities") or problem_fields["problem_types"]))
    solver_capabilities = normalize_capabilities(list(payload.get("solver_capabilities") or payload.get("problem_types") or problem_fields["solver_capabilities"]))
    return {
        **deepcopy(payload),
        "component_id": component_id,
        "type": component_id,
        "display_name": payload.get("display_name") or payload.get("name") or component_id,
        "sets": sets,
        "required_sets": [_normalize_schema_item(item, "set") for item in deepcopy(payload.get("required_sets") or sets)],
        "parameters": parameters,
        "variables": variables,
        "constraints": constraints,
        "objective_terms": objective_terms,
        "generated_constraints": generated_constraints,
        "generated_objective_terms": generated_terms,
        "variable_types": problem_fields["variable_types"],
        "expression_class": problem_fields["expression_class"],
        "problem_type": problem_types[0],
        "problem_types": problem_types,
        "solver_capabilities": solver_capabilities,
        "problem_type_effect": problem_fields["problem_type_effect"],
        "depends_on": list(payload.get("depends_on") or payload.get("dependencies") or []),
        "dependencies": list(payload.get("dependencies") or payload.get("depends_on") or []),
    }


class DynamicFormulaComponent:
    def __init__(self, definition: dict[str, Any]) -> None:
        self.definition = normalize_component_payload(definition)
        self.component_type = self.definition["component_id"]

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        result = validate_component_definition(self.definition)
        if not result["valid"]:
            raise RuntimeError("；".join(item["message"] for item in result["errors"]))

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        for index, constraint in enumerate(self.definition.get("generated_constraints") or []):
            if constraint.get("enabled", True) is False or constraint.get("participates_in_solve", True) is False:
                continue
            expression = str(constraint.get("expression") or constraint.get("formula") or "").strip()
            if not expression:
                continue
            indices = list(constraint.get("indices") or [])
            name = _safe_name(f"{self.component_type}_{constraint.get('constraint_id') or index + 1}")
            if _is_piecewise_constraint(constraint):
                self._build_piecewise_constraint(model, context, constraint, name, indices)
                continue
            pyomo_constraint = self._build_constraint(model, context, expression, indices)
            setattr(model, name, pyomo_constraint)
            context["constraints"][name] = pyomo_constraint

    def _build_constraint(self, model: Any, context: dict[str, Any], expression: str, indices: list[str]) -> Any:
        tree = ast.parse(expression, mode="eval").body
        index_specs = _normalize_index_specs(indices)
        index_sets = [getattr(model, item["set"]) for item in index_specs]
        aggregate_bound = _aggregate_bound_compare(tree)

        if aggregate_bound:
            call_node, other_node, relation_op = aggregate_bound
            generator = call_node.args[0]
            loop_specs: list[tuple[str, str, list[Any]]] = []
            for comp in generator.generators:
                if not isinstance(comp.target, ast.Name) or comp.ifs:
                    raise RuntimeError("min/max 生成式仅支持无 if 条件的单变量遍历")
                set_name = _name_from_node(comp.iter)
                if set_name not in context["sets"]:
                    raise RuntimeError(f"min/max 引用了不存在的集合：{set_name}")
                loop_specs.append((comp.target.id, set_name, list(context["sets"][set_name])))
            aggregate_sets = [getattr(model, set_name) for _, set_name, _ in loop_specs]

            def aggregate_rule(m: Any, *values: Any) -> Any:
                local_indices: dict[str, Any] = {}
                outer_values = values[: len(index_specs)]
                loop_values = values[len(index_specs) :]
                for item, value in zip(index_specs, outer_values, strict=False):
                    local_indices[item["set"]] = value
                    local_indices[item["alias"]] = value
                for (alias, set_name, _), value in zip(loop_specs, loop_values, strict=False):
                    local_indices[set_name] = value
                    local_indices[alias] = value
                left = _eval_formula_node(generator.elt, m, context, local_indices)
                right = _eval_formula_node(other_node, m, context, local_indices)
                if isinstance(relation_op, ast.GtE):
                    return left >= right
                if isinstance(relation_op, ast.LtE):
                    return left <= right
                return left == right

            return pyo.Constraint(*(index_sets + aggregate_sets), rule=aggregate_rule) if index_sets or aggregate_sets else pyo.Constraint(rule=lambda m: aggregate_rule(m))

        def rule(m: Any, *values: Any) -> Any:
            local_indices: dict[str, Any] = {}
            for item, value in zip(index_specs, values, strict=False):
                local_indices[item["set"]] = value
                local_indices[item["alias"]] = value
            try:
                return _eval_formula_node(tree, m, context, local_indices)
            except IndexError:
                return pyo.Constraint.Skip
            except KeyError as exc:
                raise RuntimeError(f"公式引用缺少索引或参数：{exc}") from exc

        if index_sets:
            return pyo.Constraint(*index_sets, rule=rule)
        return pyo.Constraint(rule=lambda m: rule(m))

    def _build_piecewise_constraint(self, model: Any, context: dict[str, Any], constraint: dict[str, Any], name: str, indices: list[str]) -> None:
        parsed = _parse_piecewise_constraint(constraint, str(constraint.get("expression") or constraint.get("formula") or ""))
        if not parsed:
            raise RuntimeError("piecewise constraint must use y == piecewise(x, curve), or provide x/y/curve fields")
        y_node, x_node, curve_name = parsed
        points = _curve_points_for_context(self.definition, curve_name, context)
        _assert_valid_curve_points(points, field=f"{curve_name}.points")
        point_count = len(points)
        point_set_name = _safe_name(f"{name}_points")
        setattr(model, point_set_name, pyo.RangeSet(0, point_count - 1))
        point_set = getattr(model, point_set_name)
        index_specs = _normalize_index_specs(indices)
        index_sets = [getattr(model, item["set"]) for item in index_specs]
        lambda_name = _safe_name(f"{name}_lambda")
        if index_sets:
            setattr(model, lambda_name, pyo.Var(*index_sets, point_set, bounds=(0, 1)))
        else:
            setattr(model, lambda_name, pyo.Var(point_set, bounds=(0, 1)))
        lambda_var = getattr(model, lambda_name)

        def scoped_indices(values: tuple[Any, ...]) -> dict[str, Any]:
            scoped: dict[str, Any] = {}
            for item, value in zip(index_specs, values, strict=False):
                scoped[item["set"]] = value
                scoped[item["alias"]] = value
            return scoped

        def lam(values: tuple[Any, ...], point_index: int) -> Any:
            return lambda_var[(*values, point_index)] if values else lambda_var[point_index]

        def lambda_sum_rule(_m: Any, *values: Any) -> Any:
            return sum(lam(values, i) for i in range(point_count)) == 1

        def x_rule(_m: Any, *values: Any) -> Any:
            scoped = scoped_indices(values)
            return _eval_formula_node(x_node, model, context, scoped) == sum(float(points[i][0]) * lam(values, i) for i in range(point_count))

        def y_rule(_m: Any, *values: Any) -> Any:
            scoped = scoped_indices(values)
            return _eval_formula_node(y_node, model, context, scoped) == sum(float(points[i][1]) * lam(values, i) for i in range(point_count))

        sum_name = _safe_name(f"{name}_lambda_sum")
        x_name = _safe_name(f"{name}_x_link")
        y_name = _safe_name(f"{name}_y_link")
        if index_sets:
            setattr(model, sum_name, pyo.Constraint(*index_sets, rule=lambda_sum_rule))
            setattr(model, x_name, pyo.Constraint(*index_sets, rule=x_rule))
            setattr(model, y_name, pyo.Constraint(*index_sets, rule=y_rule))
        else:
            setattr(model, sum_name, pyo.Constraint(rule=lambda m: lambda_sum_rule(m)))
            setattr(model, x_name, pyo.Constraint(rule=lambda m: x_rule(m)))
            setattr(model, y_name, pyo.Constraint(rule=lambda m: y_rule(m)))
        context["constraints"][sum_name] = getattr(model, sum_name)
        context["constraints"][x_name] = getattr(model, x_name)
        context["constraints"][y_name] = getattr(model, y_name)
        context["metadata"].setdefault("piecewise_constraints", []).append(
            {
                "constraint_id": constraint.get("constraint_id") or name,
                "curve": curve_name,
                "interpolation": "linear",
                "compiler": "convex_combination_lp",
                "points": points,
            }
        )


def _eval_formula_node(node: ast.AST, model: Any, context: dict[str, Any], local_indices: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_formula_node(node.body, model, context, local_indices)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in local_indices:
            return local_indices[node.id]
        params = context["runtime_parameters"]
        if node.id in params:
            return params[node.id]
        if hasattr(model, node.id) and node.id in context.get("variables", {}):
            return getattr(model, node.id)
        return _parameter_default(context, node.id)
    if isinstance(node, ast.UnaryOp):
        value = _eval_formula_node(node.operand, model, context, local_indices)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        left = _eval_formula_node(node.left, model, context, local_indices)
        right = _eval_formula_node(node.right, model, context, local_indices)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow):
            return left**right
    if isinstance(node, ast.Compare):
        left = _eval_formula_node(node.left, model, context, local_indices)
        right = _eval_formula_node(node.comparators[0], model, context, local_indices)
        op = node.ops[0]
        if isinstance(op, ast.Eq):
            return left == right
        if isinstance(op, ast.LtE):
            return left <= right
        if isinstance(op, ast.GtE):
            return left >= right
    if isinstance(node, ast.Subscript):
        base = _subscript_base(node)
        indices = _eval_subscript_indices(node.slice, model, context, local_indices)
        params = context["runtime_parameters"]
        if base in params:
            value = params.get(base, _parameter_default(context, base))
            return _lookup_parameter(value, indices, context)
        if hasattr(model, base) and base in context.get("variables", {}):
            pyomo_obj = getattr(model, base)
            try:
                return pyomo_obj[tuple(indices)] if len(indices) > 1 else pyomo_obj[indices[0]]
            except KeyError as exc:
                raise IndexError(indices) from exc
        value = params.get(base, _parameter_default(context, base))
        return _lookup_parameter(value, indices, context)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"sum", "min", "max"}:
        return _eval_aggregate_call(node, model, context, local_indices)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "abs":
        if len(node.args) != 1:
            raise RuntimeError("abs only supports abs(expr)")
        return abs(_eval_formula_node(node.args[0], model, context, local_indices))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SCIENTIFIC_FUNCTIONS:
        if len(node.args) != 1:
            raise RuntimeError(f"{node.func.id} only supports {node.func.id}(expr)")
        value = _eval_formula_node(node.args[0], model, context, local_indices)
        return {"log": pyo.log, "exp": pyo.exp, "sqrt": pyo.sqrt}[node.func.id](value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "piecewise":
        raise RuntimeError("piecewise() must be compiled as a type=piecewise constraint")
    raise RuntimeError(f"不支持的公式节点：{type(node).__name__}")


def _eval_aggregate_call(node: ast.Call, model: Any, context: dict[str, Any], local_indices: dict[str, Any]) -> Any:
    if len(node.args) != 1 or not isinstance(node.args[0], ast.GeneratorExp):
        raise RuntimeError("sum 仅支持 sum(expr for i in set) 形式")
    generator = node.args[0]
    loops: list[tuple[str, list[Any]]] = []
    for comp in generator.generators:
        if not isinstance(comp.target, ast.Name) or comp.ifs:
            raise RuntimeError("sum 生成式仅支持单变量遍历且不支持 if 条件")
        set_name = _name_from_node(comp.iter)
        if set_name not in context["sets"]:
            raise RuntimeError(f"sum 引用了不存在的集合：{set_name}")
        loops.append((comp.target.id, list(context["sets"][set_name])))
    values_list = []
    for values in itertools.product(*[items for _, items in loops]):
        scoped = {**local_indices, **dict(zip([name for name, _ in loops], values, strict=False))}
        values_list.append(_eval_formula_node(generator.elt, model, context, scoped))
    if node.func.id == "min":
        return min(values_list)
    if node.func.id == "max":
        return max(values_list)
    return sum(values_list)


def _eval_subscript_indices(node: ast.AST, model: Any, context: dict[str, Any], local_indices: dict[str, Any]) -> list[Any]:
    if isinstance(node, ast.Tuple):
        return [_eval_index(item, model, context, local_indices) for item in node.elts]
    return [_eval_index(node, model, context, local_indices)]


def _eval_index(node: ast.AST, model: Any, context: dict[str, Any], local_indices: dict[str, Any]) -> Any:
    value = _eval_formula_node(node, model, context, local_indices)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _lookup_parameter(value: Any, indices: list[Any], context: dict[str, Any]) -> Any:
    if not indices:
        return value
    current = value
    if isinstance(current, list) and len(indices) == 1:
        idx = indices[0]
        if isinstance(idx, int):
            if idx < 0 or idx >= len(current):
                raise IndexError(idx)
            return current[idx]
        for set_values in context["sets"].values():
            if idx in set_values:
                pos = list(set_values).index(idx)
                if pos < len(current):
                    return current[pos]
    for index in indices:
        if isinstance(current, dict):
            if index in current:
                current = current[index]
            elif str(index) in current:
                current = current[str(index)]
            else:
                raise KeyError(index)
        elif isinstance(current, list):
            pos = int(index)
            if pos < 0 or pos >= len(current):
                raise IndexError(pos)
            current = current[pos]
        else:
            raise KeyError(index)
    return current


def _parameter_default(context: dict[str, Any], name: str) -> Any:
    for item in (context.get("model_spec") or {}).get("parameters", []) or []:
        code = item.get("code") or item.get("name") or item.get("key")
        if code == name and item.get("default") is not None:
            return item["default"]
    return 1


def _symbol_table(component: dict[str, Any]) -> dict[str, set[str]]:
    sets = {str(item.get("code") or item.get("name") or item.get("key")) for item in [_normalize_schema_item(row, "set") for row in component.get("sets", []) or []] if item}
    parameters = {str(item.get("code") or item.get("name") or item.get("key")) for item in [_normalize_schema_item(row, "parameter") for row in ((component.get("parameters", []) or component.get("inputs", []) or []))] if item}
    variables = {str(item.get("code") or item.get("name") or item.get("key")) for item in [_normalize_schema_item(row, "variable") for row in component.get("variables", []) or []] if item}
    curves = {str(item.get("code") or item.get("name") or item.get("key")) for item in [_normalize_schema_item(row, "curve") for row in ((component.get("curves", []) or component.get("piecewise_curves", []) or []))] if item}
    indices = {"t", "s", "u", "i", "j", "k", "scenario", "time", "station", "unit", *sets}
    for constraint in component.get("constraints", []) or component.get("generated_constraints", []) or []:
        for item in _normalize_index_specs(list(constraint.get("indices") or [])):
            indices.add(item["set"])
            indices.add(item["alias"])
    return {"sets": sets, "parameters": parameters | curves, "variables": variables, "indices": indices}


def _normalize_schema_item(item: Any, kind: str) -> dict[str, Any]:
    if isinstance(item, dict):
        row = deepcopy(item)
    elif isinstance(item, str):
        row = {"code": item, "name": item}
    else:
        row = {"code": str(item), "name": str(item)}
    code = str(row.get("code") or row.get("key") or row.get("name") or "")
    row.setdefault("code", code)
    row.setdefault("key", code)
    row.setdefault("name", code)
    if kind == "set":
        if code == "time":
            row.setdefault("type", "time_period")
        if code in {"time_volume", "soc_time", "state_time"}:
            row.setdefault("type", "state_time")
            row.setdefault("base_set", "time")
            row.setdefault("generation_rule", "horizon_plus_1")
    return row


def _validate_name(name: str, symbols: dict[str, set[str]], field: str, errors: list[dict[str, Any]]) -> None:
    if name in ALLOWED_FUNCTIONS or name in symbols["indices"] or name in symbols["sets"] or name in symbols["parameters"] or name in symbols["variables"]:
        return
    errors.append(_error(field, f"变量、参数或索引 {name} 不存在", "请先定义该变量/参数/集合索引，或修改公式引用。"))


def _refresh_formula_function_suggestions(errors: list[dict[str, Any]]) -> None:
    allowed = ", ".join(f"{name}(...)" for name in sorted(ALLOWED_FUNCTIONS))
    for error in errors:
        if "函数调用" in str(error.get("message") or "") or "非法函数" in str(error.get("message") or ""):
            error["message"] = "公式包含非法函数调用"
            error["suggestion"] = f"当前仅允许 {allowed}。"


def _validate_dependencies(component: dict[str, Any]) -> list[dict[str, Any]]:
    errors = []
    for dependency in list(component.get("depends_on") or component.get("dependencies") or []):
        with STORE.lock:
            exists = dependency in STORE.custom_components
        if not exists:
            try:
                from app.model_components.registry import component_definition

                component_definition(str(dependency))
                exists = True
            except RuntimeError:
                exists = False
        if not exists:
            errors.append(_error("dependencies", f"依赖组件 {dependency} 不存在", "请先发布依赖组件，或删除该依赖。"))
    return errors


def _validate_boundary_strategy(expression: str, item: dict[str, Any], field: str) -> list[dict[str, Any]]:
    strategy = str(item.get("boundary_strategy") or _default_boundary_strategy(expression) or "normal")
    if strategy not in BOUNDARY_STRATEGIES:
        return [_error(field, f"边界策略 {strategy} 不合法", "请使用 normal、skip_first、skip_last、use_initial_value 或 use_terminal_value。")]
    errors: list[dict[str, Any]] = []
    if _contains_forward_time(expression) and strategy not in {"skip_last", "use_terminal_value", "skip_out_of_range"}:
        errors.append(_error(field, "公式包含 t+1，必须明确末时段边界策略", "请设置 boundary_strategy=skip_last 或 use_terminal_value。"))
    if _contains_backward_time(expression) and strategy not in {"skip_first", "use_initial_value", "skip_out_of_range"}:
        errors.append(_error(field, "公式包含 t-1，必须明确首时段边界策略", "请设置 boundary_strategy=skip_first 或 use_initial_value。"))
    return errors


def _default_boundary_strategy(expression: str) -> str:
    if _contains_forward_time(expression):
        return "skip_last"
    if _contains_backward_time(expression):
        return "skip_first"
    return "normal"


def _contains_forward_time(expression: str) -> bool:
    return bool(re.search(r"(?:\[|,)\s*(?:t|time)\s*\+\s*1\s*(?:\]|,)", expression))


def _contains_backward_time(expression: str) -> bool:
    return bool(re.search(r"(?:\[|,)\s*(?:t|time)\s*-\s*1\s*(?:\]|,)", expression))


def _contains_piecewise(expression: str) -> bool:
    return "piecewise(" in expression.lower()


def _is_solve_active(item: dict[str, Any]) -> bool:
    if item.get("enabled", True) is False:
        return False
    if item.get("participates_in_solve") is False:
        return False
    return item.get("solve_participation", "solve_active") not in DISPLAY_ONLY_MODES


def _is_piecewise_constraint(item: dict[str, Any]) -> bool:
    return str(item.get("type") or "").lower() == "piecewise" or _contains_piecewise(str(item.get("expression") or item.get("formula") or ""))


def _validate_piecewise_component(component: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for source_key in ("parameters", "inputs", "curves", "piecewise_curves"):
        for index, item in enumerate(component.get(source_key) or []):
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or item.get("param_type") or "").lower()
            if source_key not in {"curves", "piecewise_curves"} and item_type not in {"piecewise_curve", "curve"}:
                continue
            if str(item.get("interpolation") or "linear").lower() != "linear":
                errors.append(_error(f"{source_key}[{index}].interpolation", "piecewise curve only supports linear interpolation", "Set interpolation to linear."))
            if item.get("runtime_injected"):
                continue
            try:
                _assert_valid_curve_points(item.get("points"), field=f"{source_key}[{index}].points")
            except ValueError as exc:
                errors.append(_error(f"{source_key}[{index}].points", str(exc), "Provide at least two numeric [x,y] points with strictly increasing x."))
    for index, item in enumerate(component.get("constraints") or component.get("generated_constraints") or []):
        if _is_piecewise_constraint(item) and _is_solve_active(item):
            errors.extend(_validate_piecewise_constraint(component, item, index))
    return errors


def _validate_piecewise_constraint(component: dict[str, Any], item: dict[str, Any], index: int) -> list[dict[str, Any]]:
    parsed = _parse_piecewise_constraint(item, str(item.get("expression") or item.get("formula") or ""))
    if not parsed:
        return [_error(f"constraints[{index}].expression", "piecewise constraint must use y == piecewise(x, curve)", "Use structured x/y/curve fields or the piecewise DSL.")]
    y_node, x_node, curve_name = parsed
    errors: list[dict[str, Any]] = []
    symbols = _symbol_table(component)
    for label, node in (("x", x_node), ("y", y_node)):
        base = _node_variable_base(node)
        if base not in symbols["variables"]:
            errors.append(_error(f"constraints[{index}].{label}", f"piecewise {label} variable does not exist: {base or ast.unparse(node)}", "Define continuous x/y variables first."))
            continue
        variable = _find_schema_item(component.get("variables") or [], base)
        if variable and _is_integer_type(variable.get("type") or variable.get("domain") or variable.get("variable_type")):
            errors.append(_error(f"constraints[{index}].{label}", f"piecewise {label} variable must be continuous", "Change variable type to continuous."))
    curve = _find_curve_definition(component, curve_name)
    if not curve:
        errors.append(_error(f"constraints[{index}].curve", f"piecewise curve parameter does not exist: {curve_name}", "Define a type=piecewise_curve parameter."))
    elif not curve.get("runtime_injected"):
        try:
            _assert_valid_curve_points(curve.get("points"), field=f"{curve_name}.points")
        except ValueError as exc:
            errors.append(_error(f"constraints[{index}].curve", str(exc), "Fix curve points before publish."))
    interpolation = str(item.get("interpolation") or (curve or {}).get("interpolation") or "linear").lower()
    if interpolation != "linear":
        errors.append(_error(f"constraints[{index}].interpolation", "solve_active piecewise only supports linear interpolation", "Change to linear or mark the constraint display_only."))
    return errors


def _parse_piecewise_constraint(item: dict[str, Any], expression: str) -> tuple[ast.AST, ast.AST, str] | None:
    if item.get("x") and item.get("y") and item.get("curve"):
        return ast.parse(str(item["y"]), mode="eval").body, ast.parse(str(item["x"]), mode="eval").body, str(item["curve"])
    if not expression:
        return None
    try:
        body = ast.parse(expression, mode="eval").body
    except SyntaxError:
        return None
    if not isinstance(body, ast.Compare) or len(body.ops) != 1 or not isinstance(body.ops[0], ast.Eq):
        return None
    lhs = body.left
    rhs = body.comparators[0]
    if isinstance(rhs, ast.Call) and isinstance(rhs.func, ast.Name) and rhs.func.id == "piecewise" and len(rhs.args) >= 2:
        return lhs, rhs.args[0], _name_from_node(rhs.args[1])
    if isinstance(lhs, ast.Call) and isinstance(lhs.func, ast.Name) and lhs.func.id == "piecewise" and len(lhs.args) >= 2:
        return rhs, lhs.args[0], _name_from_node(lhs.args[1])
    return None


def _curve_points_for_context(component: dict[str, Any], curve_name: str, context: dict[str, Any]) -> list[list[float]]:
    runtime = context.get("runtime_parameters") or {}
    if curve_name in runtime:
        raw = runtime[curve_name]
        if isinstance(raw, dict):
            return list(raw.get("points") or raw.get("curve_points") or [])
        return list(raw or [])
    curve = _find_curve_definition(component, curve_name)
    if curve:
        return list(curve.get("points") or [])
    raise RuntimeError(f"piecewise curve parameter missing: {curve_name}")


def _assert_valid_curve_points(points: Any, *, field: str) -> None:
    if not isinstance(points, list) or not points:
        raise ValueError(f"{field}: curve points cannot be empty")
    if len(points) < 2:
        raise ValueError(f"{field}: curve points require at least two points")
    previous_x: float | None = None
    for idx, point in enumerate(points):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError(f"{field}[{idx}]: point must be [x, y]")
        x, y = point
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise ValueError(f"{field}[{idx}]: x/y must be numeric")
        if previous_x is not None and float(x) <= previous_x:
            raise ValueError(f"{field}[{idx}]: x values must be strictly increasing and unique")
        previous_x = float(x)


def _find_curve_definition(component: dict[str, Any], curve_name: str) -> dict[str, Any] | None:
    for source_key in ("parameters", "inputs", "curves", "piecewise_curves"):
        for item in component.get(source_key) or []:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("name") or item.get("key") or "")
            item_type = str(item.get("type") or item.get("param_type") or "").lower()
            if code == curve_name and (source_key in {"curves", "piecewise_curves"} or item_type in {"piecewise_curve", "curve"}):
                return item
    return None


def _find_schema_item(rows: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    for item in rows:
        if str(item.get("code") or item.get("name") or item.get("key") or "") == code:
            return item
    return None


def _is_integer_type(value: Any) -> bool:
    return str(value or "").lower() in {"binary", "bool", "boolean", "integer", "int", "integers"}


def _node_variable_base(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Subscript):
        return _subscript_base(node)
    return ""


def _contains_unsafe_text(expression: str) -> bool:
    lowered = expression.lower()
    return any(token in lowered for token in ("__", "import", "eval", "exec", "open(", "os.", "sys.", "subprocess", "socket", "requests"))


def _is_programmatic_generated(item: dict[str, Any]) -> bool:
    return bool(item.get("programmatic") or str(item.get("generation_mode") or "").lower() in {"programmatic", "generated"})


def _component_uses_only_programmatic_constraints(component: dict[str, Any]) -> bool:
    rows = list(component.get("constraints") or component.get("generated_constraints") or [])
    return bool(rows) and all(isinstance(item, dict) and _is_programmatic_generated(item) for item in rows)


def _contains_nonlinear_product(tree: ast.AST, variable_names: set[str]) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            if _node_has_variable(node.left, variable_names) and _node_has_variable(node.right, variable_names):
                return True
    return False


def _aggregate_bound_compare(node: ast.AST) -> tuple[ast.Call, ast.AST, ast.cmpop] | None:
    if not isinstance(node, ast.Compare) or len(node.ops) != 1 or len(node.comparators) != 1:
        return None
    op = node.ops[0]
    left = node.left
    right = node.comparators[0]
    if isinstance(left, ast.Call) and isinstance(left.func, ast.Name):
        if left.func.id == "min" and isinstance(op, (ast.GtE, ast.Eq)) and _is_simple_generator_call(left):
            return left, right, op
        if left.func.id == "max" and isinstance(op, (ast.LtE, ast.Eq)) and _is_simple_generator_call(left):
            return left, right, op
    if isinstance(right, ast.Call) and isinstance(right.func, ast.Name):
        if right.func.id == "min" and isinstance(op, (ast.LtE, ast.Eq)) and _is_simple_generator_call(right):
            return right, left, ast.GtE() if isinstance(op, ast.LtE) else op
        if right.func.id == "max" and isinstance(op, (ast.GtE, ast.Eq)) and _is_simple_generator_call(right):
            return right, left, ast.LtE() if isinstance(op, ast.GtE) else op
    return None


def _is_simple_generator_call(node: ast.Call) -> bool:
    return len(node.args) == 1 and isinstance(node.args[0], ast.GeneratorExp)


def _node_has_variable(node: ast.AST, variable_names: set[str]) -> bool:
    if isinstance(node, ast.Subscript):
        return _subscript_base(node) in variable_names
    return any(isinstance(child, ast.Subscript) and _subscript_base(child) in variable_names for child in ast.walk(node))


def _subscript_base(node: ast.Subscript) -> str:
    if isinstance(node.value, ast.Name):
        return node.value.id
    return ""


def _name_from_node(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    raise RuntimeError("集合引用必须是名称")


def _has_relation(expression: str) -> bool:
    return any(op in expression for op in ("<=", ">=", "=="))


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"\W+", "_", name).strip("_")
    if not cleaned or cleaned[0].isdigit():
        return "component_formula_constraint"
    return cleaned


def _error(field: str, message: str, suggestion: str) -> dict[str, str]:
    return {"field": field, "message": message, "suggestion": suggestion}


def _normalize_index_specs(indices: list[Any]) -> list[dict[str, str]]:
    result = []
    for item in indices:
        if isinstance(item, dict):
            set_name = str(item.get("set") or item.get("code") or item.get("name") or "")
            alias = str(item.get("alias") or DEFAULT_INDEX_ALIASES.get(set_name, set_name))
        else:
            set_name = str(item)
            alias = DEFAULT_INDEX_ALIASES.get(set_name, set_name)
        if set_name:
            result.append({"set": set_name, "alias": alias})
    return result


def _compile_test_model_spec(component: dict[str, Any]) -> dict[str, Any]:
    sets = []
    seen_sets = set()
    for item in component.get("sets") or []:
        code = str(item.get("code") or item.get("name") or item.get("key") or "")
        if code and code not in seen_sets:
            sets.append({**item, "code": code, "values": item.get("values") or _default_set_values(code)})
            seen_sets.add(code)
    for variable in component.get("variables") or []:
        for dim in variable.get("dimension") or variable.get("indices") or []:
            if dim not in seen_sets:
                sets.append({"code": dim, "values": _default_set_values(str(dim))})
                seen_sets.add(dim)
    return {
        "sets": sets,
        "parameters": component.get("parameters") or [],
        "variables": [
            {
                **variable,
                "name": variable.get("code") or variable.get("name"),
                "indices": variable.get("indices") or variable.get("dimension") or [],
                "domain": _compile_variable_domain(variable),
            }
            for variable in component.get("variables") or []
        ],
    }


def _compile_test_runtime_parameters(component: dict[str, Any], model_spec: dict[str, Any]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for item in model_spec["sets"]:
        params[item["code"]] = list(item.get("values") or _default_set_values(item["code"]))
    for param in component.get("parameters") or []:
        code = str(param.get("code") or param.get("name") or param.get("key") or "")
        if not code:
            continue
        if str(param.get("type") or param.get("param_type") or "").lower() in {"piecewise_curve", "curve"}:
            params[code] = param.get("points") or [[0, 0], [1, 1]]
            continue
        default = param.get("default")
        if default is None:
            default = param.get("default_value")
        if default is None:
            default = param.get("sample", 1)
        params[code] = _default_value_for_dimensions(list(param.get("dimension") or []), params, default)
    return params


def _default_value_for_dimensions(dimensions: list[str], params: dict[str, Any], value: Any) -> Any:
    if not dimensions:
        return value
    if len(dimensions) == 1:
        values = params.get(dimensions[0]) or _default_set_values(dimensions[0])
        if isinstance(value, list):
            if len(value) == len(values):
                return list(value)
            if len(value) == 1:
                return [value[0] for _ in values]
            if value:
                result = list(value)
                while len(result) < len(values):
                    result.extend(value)
                return result[: len(values)]
        if isinstance(value, dict):
            return value
        if dimensions[0] in {"time", "time_volume"}:
            return [value for _ in values]
        return {str(item): value for item in values}
    first = dimensions[0]
    rest = dimensions[1:]
    return {
        str(item): _default_value_for_dimensions(rest, params, value)
        for item in params.get(first, _default_set_values(first))
    }


def _default_set_values(code: str) -> list[Any]:
    if code == "time":
        return [0, 1, 2]
    if code == "time_volume":
        return [0, 1, 2, 3]
    if code == "unit":
        return ["U1", "U2"]
    if code == "station":
        return ["S1", "S2"]
    if code == "edge":
        return ["E1"]
    return [0, 1, 2]


def _compile_variable_domain(variable: dict[str, Any]) -> str:
    raw = str(variable.get("domain") or variable.get("type") or "continuous").lower()
    if raw in {"binary", "bool", "boolean"}:
        return "Binary"
    if raw in {"integer", "int"}:
        return "Integers"
    return "NonNegativeReals"
