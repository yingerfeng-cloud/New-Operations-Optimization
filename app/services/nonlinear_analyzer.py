from __future__ import annotations

import ast
import math
import re
from copy import deepcopy
from typing import Any


GENERAL_NONLINEAR_FUNCTIONS = {"exp", "log", "sin", "cos", "sqrt", "tan"}
LINEARIZED_COMPONENT_TYPES = {
    "function_mapping_component",
    "piecewise_linear_curve",
    "function_mapping_2d_component",
    "mccormick_bilinear_relaxation_component",
}


def analyze_expression(
    expression: str,
    *,
    variables: set[str] | list[str] | None = None,
    parameters: set[str] | list[str] | None = None,
    source: str | None = None,
    converted: bool = False,
    solver_name: str | None = "HiGHS",
    has_integer_variables: bool = False,
) -> list[dict[str, Any]]:
    text = _expand_delta_expression(str(expression or "")).strip()
    if not text:
        return []
    variable_names = set(str(item) for item in variables or [])
    parameter_names = set(str(item) for item in parameters or [])
    try:
        tree = ast.parse(_pythonize_expression(text), mode="eval")
    except SyntaxError:
        return []
    if not variable_names:
        variable_names = _infer_variable_names(tree) - parameter_names
    else:
        variable_names -= parameter_names
    findings: list[dict[str, Any]] = []
    _visit(tree.body, text, variable_names, findings, source, converted, solver_name, has_integer_variables)
    return _deduplicate(findings)


def analyze_component_spec(component_spec: dict[str, Any], *, solver_name: str | None = "HiGHS") -> dict[str, Any]:
    variables = _variables_from_component_spec(component_spec)
    variable_names = {item["name"] for item in variables if item.get("name")}
    parameter_names = _parameter_names_from_component_spec(component_spec)
    has_integer = any(str(item.get("domain") or "").lower() in {"binary", "integer", "integers"} for item in variables)
    relationships: list[dict[str, Any]] = []
    relationships.extend(_relationships_from_linearized_components(component_spec, solver_name=solver_name))

    for source, row in _iter_solve_active_expressions(component_spec):
        if _is_linearization_expression(row):
            continue
        expression = str(row.get("expression") or row.get("formula") or "")
        relationships.extend(
            analyze_expression(
                expression,
                variables=variable_names,
                parameters=parameter_names,
                source=source,
                solver_name=solver_name,
                has_integer_variables=has_integer,
            )
        )

    return build_nonlinear_report(relationships)


def analyze_draft(draft: dict[str, Any], *, solver_name: str | None = "HiGHS") -> dict[str, Any]:
    semantic = draft.get("semantic") or {}
    variable_names = {str(item.get("code") or item.get("name")) for item in semantic.get("variables") or [] if item.get("code") or item.get("name")}
    parameter_names = {str(item.get("code") or item.get("name")) for item in semantic.get("parameters") or [] if item.get("code") or item.get("name")}
    has_integer = any(_is_integer_variable(item) for item in semantic.get("variables") or [])
    relationships: list[dict[str, Any]] = []
    for index, formula in enumerate(draft.get("formulas") or []):
        if formula.get("solve_participation") == "preview_only":
            continue
        relationships.extend(
            analyze_expression(
                str(formula.get("dsl_formula") or formula.get("expression") or ""),
                variables=variable_names,
                parameters=parameter_names,
                source=f"model_draft.formulas[{index}]",
                solver_name=solver_name,
                has_integer_variables=has_integer,
            )
        )
    component_spec = (draft.get("advanced") or {}).get("component_spec") or draft.get("component_spec") or {}
    if component_spec:
        component_spec = {
            **component_spec,
            "parameters": list(component_spec.get("parameters") or semantic.get("parameters") or []),
            "variables": list(component_spec.get("variables") or semantic.get("variables") or []),
        }
        relationships.extend(analyze_component_spec(component_spec, solver_name=solver_name).get("relationships") or [])
    return build_nonlinear_report(relationships)


def build_nonlinear_report(relationships: list[dict[str, Any]]) -> dict[str, Any]:
    deduped = _deduplicate(relationships)
    blocking = [item for item in deduped if item.get("blocking")]
    warnings = [item for item in deduped if not item.get("blocking") and item.get("risk_level") in {"medium", "high"}]
    return {
        "count": len(deduped),
        "relationships": deduped,
        "blocking_items": blocking,
        "warning_items": warnings,
        "has_blocking_nonlinearity": bool(blocking),
        "converted_count": sum(1 for item in deduped if item.get("converted")),
        "message": "存在未转换的非线性表达式，禁止交给 HiGHS 静默求解。" if blocking else "未发现阻断发布的未转换非线性表达式。",
    }


def has_unconverted_nonlinearity(report: dict[str, Any] | None) -> bool:
    return bool((report or {}).get("has_blocking_nonlinearity"))


def _visit(
    node: ast.AST,
    expression: str,
    variables: set[str],
    findings: list[dict[str, Any]],
    source: str | None,
    converted: bool,
    solver_name: str | None,
    has_integer_variables: bool,
) -> None:
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, ast.Mult):
            factors = _flatten_mult(node)
            var_factors = [factor for factor in factors if _degree(factor, variables) > 0]
            if len(var_factors) >= 2:
                pair = var_factors[:2]
                findings.append(
                    _finding(
                        expression=expression,
                        nonlinear_type="bilinear",
                        involved_variables=[_node_text(item) for item in pair],
                        source=source,
                        converted=converted,
                        supported=False,
                        strategies=["mccormick_relaxation", "piecewise_2d", "nlp_reserved"],
                        risk="high",
                        message="检测到变量乘变量，HiGHS 不能直接求解。建议选择 McCormick 松弛或二维 PWL。",
                    )
                )
        elif isinstance(node.op, ast.Div) and _degree(node.right, variables) > 0:
            findings.append(
                _finding(
                    expression=expression,
                    nonlinear_type="division",
                    involved_variables=_variables_in_node(node, variables),
                    source=source,
                    converted=converted,
                    supported=False,
                    strategies=["piecewise_1d", "piecewise_2d", "nlp_reserved"],
                    risk="high",
                    message="检测到变量出现在分母中，HiGHS 不能直接求解除法非线性。",
                )
            )
        elif isinstance(node.op, ast.Pow) and _degree(node.left, variables) > 0:
            exponent = _constant_number(node.right)
            if exponent == 2:
                findings.append(
                    _finding(
                        expression=expression,
                        nonlinear_type="quadratic",
                        involved_variables=_variables_in_node(node.left, variables),
                        source=source,
                        converted=converted,
                        supported=not has_integer_variables and _solver_supports_qp(solver_name),
                        strategies=["qp", "piecewise_1d"],
                        risk="medium",
                        message="检测到二次项 x^2，可选择 QP 或一维 PWL 线性化。",
                    )
                )
            else:
                findings.append(
                    _finding(
                        expression=expression,
                        nonlinear_type="high_order_power",
                        involved_variables=_variables_in_node(node.left, variables),
                        source=source,
                        converted=converted,
                        supported=False,
                        strategies=["piecewise_1d", "nlp_reserved"],
                        risk="high",
                        message="检测到高次幂项，当前 HiGHS 路径不能直接求解。",
                    )
                )
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        fn = node.func.id
        arg_vars = [_variables_in_node(arg, variables) for arg in node.args]
        involved = sorted({item for group in arg_vars for item in group})
        if fn in GENERAL_NONLINEAR_FUNCTIONS and involved:
            findings.append(
                _finding(
                    expression=expression,
                    nonlinear_type="general_nonlinear_function",
                    involved_variables=involved,
                    source=source,
                    converted=converted,
                    supported=False,
                    strategies=["nlp_reserved"],
                    risk="high",
                    message=f"检测到 {fn}(...) 一般非线性函数，本阶段仅保留 NLP 预留策略。",
                )
            )
        elif fn not in {"sum", "min", "max"} and involved:
            nonlinear_type = "function_2d" if len(node.args) >= 2 else "function_1d"
            strategies = ["piecewise_2d"] if nonlinear_type == "function_2d" else ["piecewise_1d"]
            findings.append(
                _finding(
                    expression=expression,
                    nonlinear_type=nonlinear_type,
                    involved_variables=involved,
                    source=source,
                    converted=converted or fn in {"piecewise", "piecewise_2d"},
                    supported=converted or fn in {"piecewise", "piecewise_2d"},
                    strategies=strategies,
                    risk="low" if converted or fn in {"piecewise", "piecewise_2d"} else "medium",
                    message="检测到函数资产映射，建议使用分段线性组件承载。" if not converted else "函数资产已通过分段线性组件转换。",
                )
            )
    for child in ast.iter_child_nodes(node):
        _visit(child, expression, variables, findings, source, converted, solver_name, has_integer_variables)


def _relationships_from_linearized_components(component_spec: dict[str, Any], *, solver_name: str | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, component in enumerate(component_spec.get("components") or []):
        cfg = _component_cfg(component)
        component_type = str(cfg.get("type") or cfg.get("component_id") or "")
        source = f"component_spec.components[{index}]"
        if component_type in {"function_mapping_component", "piecewise_linear_curve"} and cfg.get("x") and cfg.get("y"):
            rows.append(
                _finding(
                    expression=f"{cfg.get('y')} == f({cfg.get('x')})",
                    nonlinear_type="function_1d",
                    involved_variables=[str(cfg.get("x"))],
                    source=source,
                    converted=True,
                    supported=True,
                    strategies=["piecewise_1d"],
                    risk="low",
                    message="一维函数资产已通过 piecewise_1d 组件转换，可由 HiGHS 路径求解。",
                )
            )
        if component_type == "function_mapping_2d_component" and cfg.get("x") and cfg.get("y") and cfg.get("z"):
            rows.append(
                _finding(
                    expression=f"{cfg.get('z')} == f({cfg.get('x')}, {cfg.get('y')})",
                    nonlinear_type="function_2d",
                    involved_variables=[str(cfg.get("x")), str(cfg.get("y"))],
                    source=source,
                    converted=True,
                    supported=True,
                    strategies=["piecewise_2d"],
                    risk="medium",
                    message="二维函数资产已通过 piecewise_2d 组件转换；注意 MILP 规模风险。",
                )
            )
        if component_type == "mccormick_bilinear_relaxation_component":
            bounds_ok = all(_is_finite_number(cfg.get(key)) for key in ("x_lower", "x_upper", "y_lower", "y_upper"))
            rows.append(
                _finding(
                    expression=f"{cfg.get('w')} ~= {cfg.get('x')} * {cfg.get('y')}",
                    nonlinear_type="bilinear",
                    involved_variables=[str(cfg.get("x")), str(cfg.get("y"))],
                    source=source,
                    converted=bounds_ok,
                    supported=bounds_ok,
                    strategies=["mccormick_relaxation"],
                    risk="medium" if bounds_ok else "high",
                    message="双线性项已使用 McCormick 松弛；这是松弛而非精确等价，结果存在松弛误差风险。"
                    if bounds_ok
                    else "McCormick 松弛缺少有限上下界，发布前必须补齐 x/y 的上下界。",
                )
            )
    return rows


def _iter_solve_active_expressions(component_spec: dict[str, Any]):
    for index, row in enumerate(component_spec.get("additional_custom_constraints") or []):
        if _is_solve_active(row):
            yield f"component_spec.additional_custom_constraints[{index}]", row
    for index, term in enumerate((component_spec.get("objective") or {}).get("terms") or []):
        if _is_solve_active(term):
            yield f"component_spec.objective.terms[{index}]", term
    for component_index, component in enumerate(component_spec.get("components") or []):
        cfg = _component_cfg(component)
        if str(cfg.get("type") or cfg.get("component_id") or "") in LINEARIZED_COMPONENT_TYPES:
            continue
        for key in ("generated_constraints", "constraints"):
            for row_index, row in enumerate(component.get(key) or []):
                if _is_solve_active(row):
                    yield f"component_spec.components[{component_index}].{key}[{row_index}]", row
        for key in ("generated_objective_terms", "objective_terms"):
            for row_index, row in enumerate(component.get(key) or []):
                if _is_solve_active(row):
                    yield f"component_spec.components[{component_index}].{key}[{row_index}]", row


def _variables_from_component_spec(component_spec: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for variable in component_spec.get("variables") or []:
        name = str(variable.get("name") or variable.get("code") or "")
        domain = str(variable.get("domain") or variable.get("type") or variable.get("variable_type") or "")
        rows.append({"name": name, "domain": domain})
    return rows


def _parameter_names_from_component_spec(component_spec: dict[str, Any]) -> set[str]:
    names = set()
    for parameter in component_spec.get("parameters") or []:
        for field in ("code", "name", "key"):
            name = parameter.get(field)
            if name:
                names.add(str(name))
    return names


def _finding(**kwargs: Any) -> dict[str, Any]:
    supported = bool(kwargs.pop("supported"))
    converted = bool(kwargs.get("converted"))
    nonlinear_type = kwargs.get("nonlinear_type")
    return {
        **kwargs,
        "supported_by_current_solver": supported,
        "recommended_strategy": kwargs.pop("strategies"),
        "blocking": not supported and not converted and nonlinear_type != "quadratic",
    }


def _component_cfg(component: dict[str, Any]) -> dict[str, Any]:
    config = component.get("config") if isinstance(component.get("config"), dict) else {}
    return {**config, **{key: value for key, value in component.items() if key != "config"}}


def _is_linearization_expression(row: dict[str, Any]) -> bool:
    row_type = str(row.get("type") or "").lower()
    expression = str(row.get("expression") or row.get("formula") or "").lower()
    return row_type in {"piecewise", "piecewise_2d", "mccormick"} or "piecewise(" in expression or "piecewise_2d(" in expression


def _is_solve_active(row: dict[str, Any]) -> bool:
    if not isinstance(row, dict) or row.get("enabled", True) is False or row.get("participates_in_solve") is False:
        return False
    return str(row.get("solve_participation") or "solve_active") not in {"display_only", "remark_only", "none", "preview_only"}


def _pythonize_expression(expression: str) -> str:
    text = _expand_delta_expression(expression).replace("^", "**")
    text = re.sub(r"\bΣ\s*\(", "sum(", text)
    return text


def _expand_delta_expression(expression: str) -> str:
    def repl(match: re.Match[str]) -> str:
        name = match.group(1)
        return f"({name}[unit,time] - {name}[unit,time-1])"

    return re.sub(r"\bdelta\s*\(\s*([A-Za-z_]\w*)\s*\)", repl, str(expression or ""))


def _flatten_mult(node: ast.AST) -> list[ast.AST]:
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
        return [*_flatten_mult(node.left), *_flatten_mult(node.right)]
    return [node]


def _degree(node: ast.AST, variables: set[str]) -> int:
    if isinstance(node, ast.Expression):
        return _degree(node.body, variables)
    if isinstance(node, ast.Compare):
        return max([_degree(node.left, variables), *[_degree(item, variables) for item in node.comparators]])
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, (ast.Add, ast.Sub)):
            return max(_degree(node.left, variables), _degree(node.right, variables))
        if isinstance(node.op, ast.Mult):
            return _degree(node.left, variables) + _degree(node.right, variables)
        if isinstance(node.op, ast.Div):
            return 3 if _degree(node.right, variables) else _degree(node.left, variables)
        if isinstance(node.op, ast.Pow):
            exponent = _constant_number(node.right)
            return int(_degree(node.left, variables) * exponent) if exponent is not None else 3
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in {"sum", "min", "max"}:
            return max((_degree(arg, variables) for arg in node.args), default=0)
        return 3 if any(_degree(arg, variables) for arg in node.args) else 0
    if isinstance(node, ast.GeneratorExp):
        return _degree(node.elt, variables)
    if isinstance(node, ast.Subscript):
        return 1 if _subscript_base(node) in variables else 0
    if isinstance(node, ast.Name):
        return 1 if node.id in variables else 0
    if isinstance(node, ast.UnaryOp):
        return _degree(node.operand, variables)
    return max((_degree(child, variables) for child in ast.iter_child_nodes(node)), default=0)


def _variables_in_node(node: ast.AST, variables: set[str]) -> list[str]:
    found = []
    for child in ast.walk(node):
        if isinstance(child, ast.Subscript) and _subscript_base(child) in variables:
            found.append(_node_text(child))
        elif isinstance(child, ast.Name) and child.id in variables:
            found.append(child.id)
    return sorted(set(found))


def _infer_variable_names(tree: ast.AST) -> set[str]:
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript):
            base = _subscript_base(node)
            if base:
                names.add(base)
    return names


def _subscript_base(node: ast.Subscript) -> str:
    return node.value.id if isinstance(node.value, ast.Name) else ""


def _constant_number(node: ast.AST) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    return None


def _node_text(node: ast.AST) -> str:
    try:
        return ast.unparse(node).replace("**", "^")
    except Exception:
        return type(node).__name__


def _solver_supports_qp(solver_name: str | None) -> bool:
    return str(solver_name or "highs").lower() in {"highs", "appsi_highs", "highsappsi"}


def _is_integer_variable(variable: dict[str, Any]) -> bool:
    value = str(variable.get("variableType") or variable.get("variable_type") or variable.get("domain") or variable.get("type") or "").lower()
    return value in {"binary", "integer", "integers"}


def _is_finite_number(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _deduplicate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    result = []
    for row in rows:
        key = (
            row.get("source"),
            row.get("expression"),
            row.get("nonlinear_type"),
            tuple(row.get("involved_variables") or []),
            row.get("converted"),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(deepcopy(row))
    return result
