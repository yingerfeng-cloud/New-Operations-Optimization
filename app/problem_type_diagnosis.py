from __future__ import annotations

import ast
import re
import sys
from copy import deepcopy
from typing import Any

from app.services.nonlinear_analyzer import analyze_component_spec, analyze_draft, analyze_expression, build_nonlinear_report


INTEGER_DOMAINS = {"BINARY", "BOOL", "BOOLEAN", "INTEGER", "INTEGERS", "INT", "NONNEGATIVEINTEGERS"}
SOLVER_CAPABILITIES = {
    "highs": ["LP", "MILP", "QP", "MIQP"],
    "appsi_highs": ["LP", "MILP", "QP", "MIQP"],
    "ipopt": ["NLP"],
    "scip": [],
    "scip/bonmin": [],
    "bonmin": [],
}

RECOMMENDED_SOLVERS = {
    "LP": "HiGHS",
    "MILP": "HiGHS",
    "QP": "HiGHS",
    "MIQP": "HiGHS",
    "NLP": "Ipopt",
    "MINLP_RESERVED": None,
}


def normalize_problem_type(problem_type: str | None) -> str:
    value = str(problem_type or "LP").strip().upper()
    if value == "MIP":
        return "MILP"
    if value == "MINLP":
        return "MINLP_RESERVED"
    return value or "LP"


def solver_supports_problem_type(solver_name: str | None, problem_type: str | None) -> bool:
    key = str(solver_name or "highs").lower()
    return normalize_problem_type(problem_type) in SOLVER_CAPABILITIES.get(key, [])


def infer_problem_type_from_draft(draft: dict[str, Any], solver_name: str | None = None) -> dict[str, Any]:
    semantic = draft.get("semantic") or {}
    variables = list(semantic.get("variables") or [])
    variable_details = [_variable_detail(variable, "", "模型语义") for variable in variables]
    components = _resolve_components(draft.get("components") or [])
    for component in components:
        definition = component.get("definition") or {}
        component_id = str(component.get("component_id") or component.get("type") or "")
        component_name = str(definition.get("name") or definition.get("display_name") or component_id)
        for variable in definition.get("variables") or []:
            variables.append(variable)
            variable_details.append(_variable_detail(variable, component_id, component_name))
    constraints = deepcopy(draft.get("generated_constraints") or [])
    if not constraints:
        constraints = _constraints_from_draft(draft, components)
    constraints = [item for item in constraints if _constraint_affects_problem_type(item)]
    objective_terms = deepcopy((draft.get("objective") or {}).get("terms") or [])
    requested = (draft.get("advanced") or {}).get("manual_problem_type_override") or (draft.get("basic_info") or {}).get("problem_type")
    diagnosis = infer_problem_type(
        variables=variables,
        constraints=constraints,
        objective_terms=objective_terms,
        components=components,
        variable_details=variable_details,
        solver_name=solver_name or (draft.get("basic_info") or {}).get("solver"),
        requested_problem_type=requested,
    )
    nonlinear_report = analyze_draft(draft, solver_name=solver_name or (draft.get("basic_info") or {}).get("solver"))
    diagnosis = _apply_nonlinear_diagnosis(diagnosis, nonlinear_report)
    draft["inferred_problem_type"] = diagnosis["inferred_problem_type"]
    draft["problem_type_diagnosis"] = diagnosis
    return diagnosis


def infer_problem_type_from_component_spec(
    component_spec: dict[str, Any],
    *,
    solver_name: str | None = None,
    requested_problem_type: str | None = None,
) -> dict[str, Any]:
    variables = list(component_spec.get("variables") or [])
    variable_details = [_variable_detail(variable, "", "component_spec") for variable in variables]
    components = _resolve_components(component_spec.get("components") or [])
    for component in components:
        definition = component.get("definition") or {}
        component_id = str(component.get("component_id") or component.get("type") or "")
        component_name = str(definition.get("name") or definition.get("display_name") or component_id)
        for variable in definition.get("variables") or []:
            variables.append(variable)
            variable_details.append(_variable_detail(variable, component_id, component_name))
    diagnosis = infer_problem_type(
        variables=variables,
        constraints=[item for item in list(component_spec.get("additional_custom_constraints") or []) if _constraint_affects_problem_type(item)],
        objective_terms=list((component_spec.get("objective") or {}).get("terms") or []),
        components=components,
        variable_details=variable_details,
        solver_name=solver_name,
        requested_problem_type=requested_problem_type or component_spec.get("model_problem_type"),
    )
    nonlinear_report = analyze_component_spec(component_spec, solver_name=solver_name)
    return _apply_nonlinear_diagnosis(diagnosis, nonlinear_report)


def infer_problem_type(
    *,
    variables: list[dict[str, Any]],
    constraints: list[dict[str, Any]],
    objective_terms: list[dict[str, Any]],
    components: list[dict[str, Any]] | None = None,
    variable_details: list[dict[str, Any]] | None = None,
    solver_name: str | None = None,
    requested_problem_type: str | None = None,
) -> dict[str, Any]:
    variable_types = _variable_types(variables)
    variable_names = _variable_names(variables)
    variable_types.extend(_component_field_values(components or [], "variable_types"))
    has_integer = any(_is_integer_type(item) for item in variable_types)
    expression_class = _max_expression_class(
        [_expression_class(item, variable_names) for item in constraints]
        + [_expression_class(item, variable_names) for item in objective_terms]
        + _component_field_values(components or [], "expression_class")
    )
    raw_nonlinear_report = build_nonlinear_report(
        [
            *[
                finding
                for item in constraints
                for finding in _analyze_problem_type_expression(item, variable_names, solver_name, has_integer)
            ],
            *[
                finding
                for item in objective_terms
                for finding in _analyze_problem_type_expression(item, variable_names, solver_name, has_integer)
            ],
        ]
    )
    if any(
        item.get("nonlinear_type") in {"bilinear", "division", "function_1d", "function_2d", "general_nonlinear_function", "high_order_power"}
        and not item.get("converted")
        and not item.get("supported_by_current_solver")
        for item in raw_nonlinear_report.get("relationships") or []
    ):
        expression_class = "nonlinear"
    active_piecewise = [item for item in constraints if _is_active_piecewise(item)]
    if any(str(item.get("piecewise_method") or item.get("compiler") or "").lower() in {"binary_segment", "dcc", "sos2", "milp", "triangulated_milp_exact"} for item in active_piecewise):
        has_integer = True
    if expression_class == "nonlinear":
        inferred = "MINLP_RESERVED" if has_integer else "NLP"
    elif expression_class == "quadratic":
        inferred = "MIQP" if has_integer else "QP"
    else:
        inferred = "MILP" if has_integer else "LP"
    requested = normalize_problem_type(requested_problem_type or inferred)
    integer_details = [item for item in variable_details or [] if item.get("is_integer")]
    effective_solver = solver_name or RECOMMENDED_SOLVERS.get(requested, "HiGHS")
    supported = solver_supports_problem_type(effective_solver, requested)
    warnings = _risk_lines(inferred, requested, solver_name, supported)
    function_usage = _function_asset_usage(components or [])
    result = {
        "inferred_problem_type": inferred,
        "recommended_problem_type": inferred,
        "recommended_solver": RECOMMENDED_SOLVERS.get(inferred, "HiGHS"),
        "requested_problem_type": requested,
        "effective_problem_type": requested,
        "expression_class": expression_class,
        "has_integer_variables": has_integer,
        "variable_types": sorted(set(variable_types or ["continuous"])),
        "integer_variable_details": integer_details,
        "solver": effective_solver,
        "solver_supported": supported,
        "solver_supported_problem_types": SOLVER_CAPABILITIES.get(str(solver_name or "highs").lower(), []),
        "reasons": _reason_lines(inferred, has_integer, expression_class, integer_details),
        "warnings": warnings,
        "function_assets_used": function_usage["function_assets_used"],
        "linearization_strategy": function_usage["linearization_strategy"],
        "nonlinear_diagnostics": raw_nonlinear_report,
        "publish_valid": is_problem_type_override_valid(inferred, requested) and supported and not raw_nonlinear_report.get("has_blocking_nonlinearity", False),
    }
    if inferred == "NLP":
        result["local_optimum_warning"] = True
        result["nlp_pilot"] = True
    if inferred == "MINLP_RESERVED":
        result["minlp_reserved"] = True
        result["publish_valid"] = False
        result["warnings"] = list(result["warnings"]) + ["当前平台暂不支持生产级 MINLP 求解，请选择线性化策略或简化模型。"]
    return result


def validate_problem_type_override(diagnosis: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    inferred = normalize_problem_type(diagnosis.get("inferred_problem_type"))
    requested = normalize_problem_type(diagnosis.get("requested_problem_type") or diagnosis.get("effective_problem_type"))
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if not is_problem_type_override_valid(inferred, requested):
        details = diagnosis.get("integer_variable_details") or []
        first = details[0] if details else {}
        variable_name = first.get("variable_name") or "binary/integer"
        variable_type = str(first.get("variable_type") or "binary").lower()
        zh_type = "二进制" if variable_type in {"binary", "bool", "boolean"} else "整数"
        errors.append(
            {
                "field": "model_draft.basic_info.problem_type",
                "error": f"当前模型包含{zh_type}变量 {variable_name}，系统推荐 {inferred}，不能发布为 {requested}。",
                "actual": requested,
                "expected": inferred,
                "suggestion": "请改用系统推荐类型，或先移除导致问题类型升级的整数变量/二次/非线性表达式。",
            }
        )
    elif inferred == "LP" and requested == "MILP":
        warnings.append(
            {
                "field": "model_draft.basic_info.problem_type",
                "level": "warning",
                "message": "模型实际为 LP，手动指定 MILP 可以发布，但建议使用 LP。",
                "suggestion": "高级设置中将问题类型改为 LP。",
            }
        )
    if not diagnosis.get("solver_supported", True):
        errors.append(
            {
                "field": "solver",
                "error": f"求解器 {diagnosis.get('solver') or 'HiGHS'} 不支持问题类型 {requested}",
                "actual": requested,
                "expected": ", ".join(diagnosis.get("solver_supported_problem_types") or []),
                "suggestion": "请切换求解器，或调整模型使其回到当前求解器支持的问题类型。",
            }
        )
    return errors, warnings


def is_problem_type_override_valid(inferred: str, requested: str) -> bool:
    inferred = normalize_problem_type(inferred)
    requested = normalize_problem_type(requested)
    return inferred == requested or (inferred == "LP" and requested == "MILP")


def component_problem_type_fields(payload: dict[str, Any]) -> dict[str, Any]:
    variables = list(payload.get("variables") or [])
    constraints = [item for item in list(payload.get("generated_constraints") or payload.get("constraints") or []) if _constraint_affects_problem_type(item)]
    terms = list(payload.get("objective_terms") or payload.get("generated_objective_terms") or [])
    variable_types = payload.get("variable_types") or _variable_types(variables) or ["continuous"]
    variable_names = _variable_names(variables)
    expression_class = _max_expression_class([_expression_class(item, variable_names) for item in constraints + terms])
    has_integer = any(_is_integer_type(item) for item in variable_types)
    active_piecewise = [
        item
        for item in constraints
        if _is_active_piecewise(item)
    ]
    if any(str(item.get("piecewise_method") or item.get("compiler") or "").lower() in {"binary_segment", "dcc", "sos2", "milp", "triangulated_milp_exact"} for item in active_piecewise):
        has_integer = True
    if expression_class == "nonlinear":
        effect = "MINLP_RESERVED" if has_integer else "NLP"
    elif expression_class == "quadratic":
        effect = "MIQP" if has_integer else "QP"
    else:
        effect = "MILP" if has_integer else "LP"
    problem_type = normalize_problem_type(payload.get("problem_type") or payload.get("problem_type_effect") or effect)
    return {
        "variable_types": sorted(set(str(item).lower() for item in variable_types)),
        "expression_class": expression_class,
        "problem_type": problem_type,
        "problem_types": [problem_type],
        "solver_capabilities": [problem_type],
        "problem_type_effect": effect,
    }


def _analyze_problem_type_expression(item: dict[str, Any] | str, variable_names: set[str], solver_name: str | None, has_integer: bool) -> list[dict[str, Any]]:
    if isinstance(item, dict):
        expression = str(item.get("expression") or item.get("formula") or item.get("math_constraint") or "")
        if not _constraint_affects_problem_type(item):
            return []
    else:
        expression = str(item or "")
    return analyze_expression(expression, variables=variable_names, solver_name=solver_name, has_integer_variables=has_integer)


def _apply_nonlinear_diagnosis(diagnosis: dict[str, Any], nonlinear_report: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(diagnosis)
    result["nonlinear_diagnostics"] = nonlinear_report
    blocking = bool(nonlinear_report.get("has_blocking_nonlinearity"))
    if blocking:
        has_integer = bool(result.get("has_integer_variables"))
        inferred = "MINLP_RESERVED" if has_integer else "NLP"
        result["inferred_problem_type"] = inferred
        result["recommended_problem_type"] = inferred
        result["recommended_solver"] = RECOMMENDED_SOLVERS.get(inferred, "Ipopt")
        result["expression_class"] = "nonlinear"
        requested = normalize_problem_type(result.get("requested_problem_type") or result.get("effective_problem_type") or inferred)
        result["publish_valid"] = False
        result.setdefault("warnings", [])
        result["warnings"] = list(result["warnings"]) + [
            "存在未转换的非线性表达式，必须先选择 McCormick、PWL 或 NLP/MINLP 预留策略，不能静默交给 HiGHS。"
        ]
        result["solver_supported"] = solver_supports_problem_type(result.get("solver"), requested)
        if inferred == "NLP":
            result["local_optimum_warning"] = True
            result["nlp_pilot"] = True
        if inferred == "MINLP_RESERVED":
            result["minlp_reserved"] = True
            result["publish_valid"] = False
            result["warnings"] = list(result["warnings"]) + ["当前平台暂不支持生产级 MINLP 求解，请选择线性化策略或简化模型。"]
    else:
        if not nonlinear_report.get("count") and not nonlinear_report.get("blocking_items") and result.get("expression_class") == "nonlinear":
            inferred = "MILP" if result.get("has_integer_variables") else "LP"
            result["inferred_problem_type"] = inferred
            result["recommended_problem_type"] = inferred
            result["recommended_solver"] = RECOMMENDED_SOLVERS.get(inferred, "HiGHS")
            result["expression_class"] = "linear"
            requested = normalize_problem_type(result.get("requested_problem_type") or result.get("effective_problem_type") or inferred)
            result["publish_valid"] = is_problem_type_override_valid(inferred, requested) and solver_supports_problem_type(result.get("solver"), requested)
        result["publish_valid"] = bool(result.get("publish_valid", True))
    return result


def _is_active_piecewise(item: dict[str, Any]) -> bool:
    if not isinstance(item, dict) or item.get("enabled", True) is False:
        return False
    if item.get("participates_in_solve") is False:
        return False
    if str(item.get("solve_participation") or "solve_active") in {"display_only", "remark_only", "none"}:
        return False
    expression = str(item.get("expression") or item.get("formula") or "").lower()
    return str(item.get("type") or "").lower() in {"piecewise", "piecewise_2d"} or "piecewise(" in expression or "piecewise_2d(" in expression


def _constraint_affects_problem_type(item: dict[str, Any]) -> bool:
    if not isinstance(item, dict):
        return True
    if item.get("enabled", True) is False or item.get("participates_in_solve") is False:
        return False
    return str(item.get("solve_participation") or "solve_active") not in {"display_only", "remark_only", "none"}


def _resolve_components(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_resolve_component_definition(item) for item in components if item.get("enabled", True) is not False]


def _component_cfg(component: dict[str, Any]) -> dict[str, Any]:
    config = component.get("config") if isinstance(component.get("config"), dict) else {}
    return {**config, **component}


def _resolve_component_definition(component: dict[str, Any]) -> dict[str, Any]:
    cfg = _component_cfg(component)
    component_id = str(cfg.get("type") or cfg.get("component_id") or cfg.get("code") or "")
    definition = deepcopy(component.get("definition") or {})
    if not definition and component_id:
        definition = _custom_component_from_known_stores(component_id)
    if not definition and component_id:
        try:
            from app.model_components.registry import component_definition

            definition = component_definition(component_id)
        except Exception:
            definition = {}
    if definition:
        if component_id in {"function_mapping_component", "piecewise_linear_curve"}:
            strategy = str(cfg.get("solve_strategy") or definition.get("linearization_strategy") or "convex_combination_lp")
            for row in definition.get("generated_constraints") or []:
                row["piecewise_method"] = strategy
                row["compiler"] = strategy
                row["solve_participation"] = "display_only" if strategy == "display_only" else row.get("solve_participation", "solve_active")
                row["participates_in_solve"] = strategy != "display_only"
            if strategy == "binary_segment_milp":
                definition["variable_types"] = ["continuous", "binary"]
                definition["problem_type"] = "MILP"
                definition["problem_types"] = ["MILP"]
                definition["solver_capabilities"] = ["MILP"]
            definition["linearization_strategy"] = strategy
            if cfg.get("function_asset_id") or cfg.get("curve_asset_id"):
                definition["function_asset_id"] = cfg.get("function_asset_id") or cfg.get("curve_asset_id")
        if component_id == "function_mapping_2d_component":
            strategy = str(cfg.get("solve_strategy") or definition.get("linearization_strategy") or "triangulated_milp_exact")
            definition["linearization_strategy"] = strategy
            definition["function_asset_id"] = cfg.get("function_asset_id") or definition.get("function_asset_id")
            if strategy == "triangulated_milp_exact":
                definition["variable_types"] = ["continuous", "binary"]
                definition["problem_type"] = "MILP"
                definition["problem_types"] = ["MILP"]
                definition["solver_capabilities"] = ["MILP"]
            else:
                definition["variable_types"] = ["continuous"]
                definition["problem_type"] = "LP"
                definition["problem_types"] = ["LP"]
                definition["solver_capabilities"] = ["LP"]
                if strategy == "convex_hull_lp_approx":
                    definition.setdefault("warnings", []).append("2D surface uses LP convex hull approximation; it is not exact for general surfaces.")
        problem_fields = component_problem_type_fields(definition)
        definition = {**definition, **problem_fields}
    return {**deepcopy(component), "component_id": component_id, "type": component_id, "definition": definition}


def _function_asset_usage(components: list[dict[str, Any]]) -> dict[str, Any]:
    assets: list[dict[str, Any]] = []
    strategies: list[str] = []
    for component in components:
        component_id = str(component.get("component_id") or component.get("type") or "")
        definition = component.get("definition") or {}
        cfg = _component_cfg(component)
        function_id = cfg.get("function_asset_id") or cfg.get("curve_asset_id") or definition.get("function_asset_id")
        strategy = str(cfg.get("solve_strategy") or definition.get("linearization_strategy") or "")
        if function_id:
            assets.append({"function_asset_id": str(function_id), "component": component_id, "solve_strategy": strategy or "convex_combination_lp"})
        if strategy:
            strategies.append(strategy)
    return {"function_assets_used": assets, "linearization_strategy": sorted(set(strategies))}


def _custom_component_from_known_stores(component_id: str) -> dict[str, Any]:
    stores = []
    for module_name in (
        "app.storage.memory_store",
        "app.api.components",
        "app.model_draft",
        "app.model_components.formula_components",
        "app.services.model_service",
    ):
        module = sys.modules.get(module_name)
        store = getattr(module, "STORE", None)
        if store is not None and all(store is not existing for existing in stores):
            stores.append(store)
    for store in stores:
        try:
            with store.lock:
                component = deepcopy(store.custom_components.get(component_id) or {})
            if component:
                return component
        except Exception:
            continue
    return {}


def _constraints_from_draft(draft: dict[str, Any], components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    by_id = {str(item.get("type") or item.get("component_id")): item for item in components}
    for component in draft.get("components") or []:
        if component.get("enabled", True) is False:
            continue
        component_id = str(component.get("type") or component.get("component_id") or "")
        definition = (by_id.get(component_id) or {}).get("definition") or {}
        rows.extend(definition.get("generated_constraints") or component.get("generated_constraints") or [])
    rows.extend(draft.get("constraints") or [])
    return rows


def _variable_types(variables: list[dict[str, Any]]) -> list[str]:
    values = []
    for variable in variables:
        raw = str(variable.get("domain") or variable.get("type") or variable.get("variable_type") or "continuous")
        values.append("integer" if _is_integer_type(raw) else "continuous")
    return values


def _variable_names(variables: list[dict[str, Any]]) -> set[str]:
    names: set[str] = set()
    for variable in variables:
        name = variable.get("code") or variable.get("name") or variable.get("key")
        if name:
            names.add(str(name))
    return names


def _variable_detail(variable: dict[str, Any], component_id: str, component_name: str) -> dict[str, Any]:
    raw = str(variable.get("type") or variable.get("domain") or variable.get("variable_type") or "continuous").lower()
    return {
        "component_id": component_id,
        "component_name": component_name,
        "variable_name": str(variable.get("code") or variable.get("name") or variable.get("key") or ""),
        "variable_type": raw,
        "is_integer": _is_integer_type(raw),
    }


def _is_integer_type(value: Any) -> bool:
    return str(value or "").replace("_", "").upper() in {item.replace("_", "") for item in INTEGER_DOMAINS}


def _component_field_values(components: list[dict[str, Any]], field: str) -> list[str]:
    values = []
    for component in components:
        definition = component.get("definition") if isinstance(component, dict) else {}
        raw = (definition or component or {}).get(field)
        if isinstance(raw, list):
            values.extend(str(item) for item in raw)
        elif raw:
            values.append(str(raw))
    return values


def _expression_class(item: dict[str, Any] | str, variable_names: set[str] | None = None) -> str:
    if isinstance(item, dict):
        explicit = item.get("expression_class")
        if explicit in {"linear", "quadratic", "nonlinear"}:
            return str(explicit)
        expression = str(item.get("expression") or item.get("formula") or item.get("math_constraint") or "")
    else:
        expression = str(item or "")
    lowered = expression.lower()
    if "delta(" in lowered:
        expression = _expand_delta_expression(expression)
        lowered = expression.lower()
    if "piecewise(" in lowered:
        return "linear"
    if any(token in lowered for token in ("sin(", "cos(", "exp(", "log(", "sqrt(", "**3", "^3")):
        return "nonlinear"
    if "**2" in lowered or "^2" in lowered:
        return "quadratic"
    try:
        tree = ast.parse(_pythonize_expression(expression), mode="eval")
    except SyntaxError:
        return "linear"
    degree = _degree(tree.body, variable_names or set())
    if degree > 2:
        return "nonlinear"
    if degree == 2:
        return "quadratic"
    return "linear"


def _pythonize_expression(expression: str) -> str:
    text = _expand_delta_expression(expression).replace("^", "**")
    text = re.sub(r"[Σ∑]\((.*?)\)", r"sum(\1)", text)
    if any(op in text for op in ("<=", ">=", "==")):
        return text
    return f"{text} == 0"


def _expand_delta_expression(expression: str) -> str:
    def repl(match: re.Match[str]) -> str:
        name = match.group(1)
        return f"({name}[unit,time] - {name}[unit,time-1])"

    return re.sub(r"\bdelta\s*\(\s*([A-Za-z_]\w*)\s*\)", repl, str(expression or ""))


def _degree(node: ast.AST, variable_names: set[str]) -> int:
    if isinstance(node, ast.Expression):
        return _degree(node.body, variable_names)
    if isinstance(node, ast.Compare):
        return max([_degree(node.left, variable_names), *[_degree(item, variable_names) for item in node.comparators]])
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, (ast.Add, ast.Sub)):
            return max(_degree(node.left, variable_names), _degree(node.right, variable_names))
        if isinstance(node.op, ast.Mult):
            return _degree(node.left, variable_names) + _degree(node.right, variable_names)
        if isinstance(node.op, ast.Pow) and isinstance(node.right, ast.Constant):
            return _degree(node.left, variable_names) * int(node.right.value)
        if isinstance(node.op, ast.Div):
            right_degree = _degree(node.right, variable_names)
            return 3 if right_degree else _degree(node.left, variable_names)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == "sum":
            return max((_degree(arg, variable_names) for arg in node.args), default=0)
        return 3
    if isinstance(node, ast.GeneratorExp):
        return _degree(node.elt, variable_names)
    if isinstance(node, ast.Subscript):
        base = node.value.id if isinstance(node.value, ast.Name) else ""
        return 1 if base in variable_names else 0
    if isinstance(node, ast.Name):
        return 1 if node.id in variable_names else 0
    if isinstance(node, ast.Constant):
        return 0
    if isinstance(node, ast.UnaryOp):
        return _degree(node.operand, variable_names)
    return max((_degree(child, variable_names) for child in ast.iter_child_nodes(node)), default=0)


def _max_expression_class(classes: list[str]) -> str:
    rank = {"linear": 1, "quadratic": 2, "nonlinear": 3}
    normalized = [item if item in rank else "linear" for item in classes if item]
    if not normalized:
        return "linear"
    return max(normalized, key=lambda item: rank[item])


def _reason_lines(inferred: str, has_integer: bool, expression_class: str, integer_details: list[dict[str, Any]]) -> list[str]:
    reasons = []
    if integer_details:
        for item in integer_details:
            source = item.get("component_name") or item.get("component_id") or "模型语义"
            reasons.append(f"组件 {source} 引入 {item.get('variable_type')} 变量 {item.get('variable_name')}")
    else:
        reasons.append("检测到 binary/integer 变量" if has_integer else "变量均为连续变量")
    reasons.append({"linear": "约束和目标函数为线性表达式", "quadratic": "存在二次表达式", "nonlinear": "存在非线性表达式"}[expression_class])
    reasons.append(f"因此推荐 {inferred}")
    return reasons


def _risk_lines(inferred: str, requested: str, solver_name: str | None, supported: bool) -> list[str]:
    warnings = []
    if inferred == "LP" and requested == "MILP":
        warnings.append("模型实际为 LP，手动指定 MILP 可发布，但建议使用 LP。")
    elif inferred != requested:
        warnings.append(f"手动指定 {requested} 与系统诊断 {inferred} 不一致，发布前会强校验。")
    if not supported:
        warnings.append(f"求解器 {solver_name or 'HiGHS'} 不支持 {requested}。")
    return warnings
