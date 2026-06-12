from __future__ import annotations

import re
from typing import Any

from app.model_components.validators import validate_hydro_runtime_parameters

FORMULA_NOT_GENERATED = "公式未生成，请检查左端变量、右端参数和索引配置"
TRIVIAL_ZERO_CONSTRAINT_RE = re.compile(r"^\s*(?:∀\s*[^：:]+[：:]\s*)?0\s*(?:>=|<=|==)\s*0\s*$")
DISPLAY_ONLY_MODES = {"display_only", "remark_only", "none"}


def _first_non_blank(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _is_display_only(item: dict[str, Any]) -> bool:
    return str(item.get("solve_participation") or item.get("participation") or "solve_active") in DISPLAY_ONLY_MODES


def _is_trivial_zero_constraint(formula: str) -> bool:
    return bool(TRIVIAL_ZERO_CONSTRAINT_RE.match(str(formula or "").strip()))


def _constraint_term_text(term: dict[str, Any]) -> str:
    var = str(term.get("var") or "").strip()
    if not var:
        return FORMULA_NOT_GENERATED
    key = list(term.get("key") or [])
    param_key = list(term.get("param_key") or [])
    var_part = f"{var}[{','.join(map(str, key))}]" if key else var
    coef = f"{term['coef_param']}[{','.join(map(str, param_key))}]" if term.get("coef_param") and param_key else term.get("coef_param", term.get("coef", 1))
    body = var_part if str(coef) == "1" else f"{coef} * {var_part}"
    foreach = list(term.get("foreach") or [])
    return f"sum({body} for {' for '.join(f'{dim} in {dim}' for dim in foreach)})" if foreach else body


def _constraint_rhs_text(constraint: dict[str, Any]) -> str:
    if "rhs_param" not in constraint and "rhs" not in constraint:
        return FORMULA_NOT_GENERATED
    if constraint.get("rhs_param"):
        rhs = str(constraint["rhs_param"])
        rhs_key = list(constraint.get("rhs_key") or [])
        return f"{rhs}[{','.join(map(str, rhs_key))}]" if rhs_key else rhs
    return str(constraint.get("rhs"))


def constraint_display_formula(constraint: dict[str, Any]) -> str:
    formula = _first_non_blank(
        constraint.get("formula"),
        constraint.get("expression"),
        constraint.get("dsl"),
        constraint.get("math_expression"),
        constraint.get("generated_formula"),
        constraint.get("display_formula"),
        constraint.get("math_constraint"),
        constraint.get("expr"),
    )
    if formula and not _is_trivial_zero_constraint(formula):
        return formula
    terms = [_constraint_term_text(term) for term in constraint.get("terms", []) or []]
    if not terms or FORMULA_NOT_GENERATED in terms:
        return FORMULA_NOT_GENERATED
    relation = str(constraint.get("sense") or constraint.get("relation_type") or "<=")
    left = " + ".join(terms)
    if relation == "non_negative":
        return f"{left} >= 0"
    rhs = _constraint_rhs_text(constraint)
    if rhs == FORMULA_NOT_GENERATED:
        return FORMULA_NOT_GENERATED
    generated = f"{left} {relation} {rhs}"
    return FORMULA_NOT_GENERATED if _is_trivial_zero_constraint(generated) else generated


def objective_term_formula(term: dict[str, Any]) -> str:
    formula = _first_non_blank(term.get("formula"), term.get("expression"), term.get("dsl"), term.get("math_expression"), term.get("generated_formula"), term.get("display_formula"), term.get("expr"))
    if formula and formula != "0":
        return formula
    var = str(term.get("var") or "").strip()
    if not var:
        return FORMULA_NOT_GENERATED
    key = list(term.get("key") or [])
    param_key = list(term.get("param_key") or [])
    var_part = f"{var}[{','.join(map(str, key))}]" if key else var
    coef = f"{term['coef_param']}[{','.join(map(str, param_key))}]" if term.get("coef_param") and param_key else term.get("coef_param", term.get("coef", 1))
    body = var_part if str(coef) == "1" else f"{coef} * {var_part}"
    foreach = list(term.get("foreach") or [])
    return f"sum({body} for {' for '.join(f'{dim} in {dim}' for dim in foreach)})" if foreach else body


class RuntimeParameterValidator:
    def validate_semantic_and_generic(self, semantic_spec: dict[str, Any], generic_spec: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        semantic_spec = semantic_spec or {}
        generic_spec = generic_spec or {}
        sets = semantic_spec.get("sets") or []
        params = semantic_spec.get("parameters") or []
        variables = semantic_spec.get("variables") or []
        set_keys = {str(item.get("key") or item.get("code")) for item in sets if item.get("key") or item.get("code")}
        param_keys = {str(item.get("math_param") or item.get("key") or item.get("code")) for item in params if item.get("math_param") or item.get("key") or item.get("code")}
        var_keys = {str(item.get("math_var") or item.get("key") or item.get("code") or item.get("name")) for item in variables if item.get("math_var") or item.get("key") or item.get("code") or item.get("name")}
        var_dims = {str(item.get("math_var") or item.get("key") or item.get("code") or item.get("name")): list(item.get("dimension") or []) for item in variables if item.get("math_var") or item.get("key") or item.get("code") or item.get("name")}
        param_dims = {str(item.get("math_param") or item.get("key") or item.get("code")): list(item.get("dimension") or []) for item in params if item.get("math_param") or item.get("key") or item.get("code")}
        generic_sets = generic_spec.get("sets") or {}

        def check_generic_set(field: str, index: Any, require_non_empty: bool = False) -> None:
            name = str(index)
            if name not in generic_sets:
                errors.append({"field": f"generic_spec.sets.{name}", "error": "missing generic set", "expected": "present", "actual": None, "source": field})
                return
            if require_non_empty and not list(generic_sets.get(name) or []):
                errors.append({"field": f"generic_spec.sets.{name}", "error": "empty generic set", "expected": "non-empty", "actual": []})

        if generic_spec and not set_keys:
            errors.append({"field": "semantic_spec.sets", "error": "missing semantic sets", "expected": ">=1", "actual": 0})
        if generic_spec and not var_keys:
            errors.append({"field": "semantic_spec.variables", "error": "missing semantic variables", "expected": ">=1", "actual": 0})

        for variable in generic_spec.get("variables", []) or []:
            name = str(variable.get("name", ""))
            if name.lower() in {"x", "y", "z"}:
                errors.append({"field": f"generic_spec.variables.{name}", "error": "anonymous variable name is forbidden", "expected": "business semantic variable name", "actual": name})
            if name and name not in var_keys:
                errors.append({"field": f"generic_spec.variables.{name}", "error": "variable not defined in semantic_spec", "expected": sorted(var_keys), "actual": name})
            for index in variable.get("indices", []) or []:
                if str(index) not in set_keys:
                    errors.append({"field": f"{name}.indices", "error": "unknown set", "expected": sorted(set_keys), "actual": index})
                check_generic_set(f"{name}.indices", index, True)
            for key in ("ub_param", "lb_param"):
                if variable.get(key) and str(variable[key]) not in param_keys:
                    errors.append({"field": f"{name}.{key}", "error": "unknown parameter", "expected": sorted(param_keys), "actual": variable[key]})
                if variable.get(key):
                    invalid = [dim for dim in param_dims.get(str(variable[key]), []) if dim not in list(variable.get("indices", []) or [])]
                    if invalid:
                        errors.append({"field": f"{name}.{key}", "error": "parameter dimension mismatch", "expected": list(variable.get("indices", []) or []), "actual": param_dims.get(str(variable[key]), [])})
            if variable.get("lb") is not None and variable.get("ub") is not None and float(variable["lb"]) > float(variable["ub"]):
                errors.append({"field": f"{name}.bounds", "error": "lower bound greater than upper bound", "expected": "<= ub", "actual": variable["lb"]})

        for constraint in generic_spec.get("constraints", []) or []:
            cname = str(constraint.get("name", "constraint"))
            raw_formula = _first_non_blank(constraint.get("formula"), constraint.get("expression"), constraint.get("display_formula"), constraint.get("math_expression"), constraint.get("math_constraint"))
            if _is_display_only(constraint) and _is_trivial_zero_constraint(raw_formula):
                continue
            formula = constraint_display_formula(constraint)
            if formula == FORMULA_NOT_GENERATED:
                errors.append({"field": f"{cname}.formula", "error": FORMULA_NOT_GENERATED, "expected": "left variable, relation, rhs parameter/constant and indices", "actual": None})
            if not _is_display_only(constraint) and _is_trivial_zero_constraint(formula):
                errors.append({"field": f"{cname}.formula", "error": "trivial zero constraint is forbidden", "expected": "non-empty mathematical expression", "actual": formula})
            relation = str(constraint.get("sense", "<="))
            if relation not in {"<=", ">=", "=="} and constraint.get("compile_status") not in {"unsupported", "pending_linearization"}:
                errors.append({"field": f"{cname}.compile_status", "error": "complex relation must be marked unsupported or pending_linearization", "expected": ["unsupported", "pending_linearization"], "actual": constraint.get("compile_status")})
            for index in constraint.get("foreach", []) or []:
                if str(index) not in set_keys:
                    errors.append({"field": f"{cname}.foreach", "error": "unknown set", "expected": sorted(set_keys), "actual": index})
                check_generic_set(f"{cname}.foreach", index, True)
            for term in constraint.get("terms", []) or []:
                if term.get("var") and str(term["var"]) not in var_keys:
                    errors.append({"field": f"{cname}.terms.var", "error": "unknown variable", "expected": sorted(var_keys), "actual": term["var"]})
                if term.get("var") and str(term["var"]) in var_dims:
                    expected_key = var_dims[str(term["var"])]
                    actual_key = list(term.get("key") or [])
                    if expected_key and actual_key != expected_key:
                        errors.append({"field": f"{cname}.terms.key", "error": "variable key mismatch", "expected": expected_key, "actual": actual_key})
                for index in list(term.get("key") or []) + list(term.get("foreach") or []):
                    if str(index) not in set_keys:
                        errors.append({"field": f"{cname}.terms.key", "error": "unknown set", "expected": sorted(set_keys), "actual": index})
                    check_generic_set(f"{cname}.terms", index, True)
                if term.get("coef_param") and str(term["coef_param"]) not in param_keys:
                    errors.append({"field": f"{cname}.terms.coef_param", "error": "unknown parameter", "expected": sorted(param_keys), "actual": term["coef_param"]})
                if term.get("coef_param"):
                    scope = list(term.get("key", []) or []) + list(term.get("foreach", []) or []) + list(constraint.get("foreach", []) or [])
                    invalid = [dim for dim in param_dims.get(str(term["coef_param"]), []) if dim not in scope]
                    if invalid:
                        errors.append({"field": f"{cname}.terms.coef_param", "error": "parameter dimension mismatch", "expected": scope, "actual": param_dims.get(str(term["coef_param"]), [])})
            if constraint.get("rhs_param") and str(constraint["rhs_param"]) not in param_keys:
                errors.append({"field": f"{cname}.rhs_param", "error": "unknown parameter", "expected": sorted(param_keys), "actual": constraint["rhs_param"]})
            for index in constraint.get("rhs_key", []) or []:
                if str(index) not in set_keys:
                    errors.append({"field": f"{cname}.rhs_key", "error": "unknown set", "expected": sorted(set_keys), "actual": index})
                check_generic_set(f"{cname}.rhs_key", index, True)
            if constraint.get("rhs_param"):
                invalid = [dim for dim in param_dims.get(str(constraint["rhs_param"]), []) if dim not in list(constraint.get("foreach", []) or [])]
                if invalid:
                    errors.append({"field": f"{cname}.rhs_param", "error": "parameter dimension mismatch", "expected": list(constraint.get("foreach", []) or []), "actual": param_dims.get(str(constraint["rhs_param"]), [])})

        objective = generic_spec.get("objective") or {}
        terms = objective.get("terms") or []
        if generic_spec and not terms:
            errors.append({"field": "generic_spec.objective.terms", "error": "missing objective terms", "expected": ">=1", "actual": 0})
        for term in terms:
            formula = objective_term_formula(term)
            if formula == FORMULA_NOT_GENERATED:
                errors.append({"field": "generic_spec.objective.terms.formula", "error": "objective term formula not generated", "expected": "variable with coefficient and indices", "actual": None})
            if term.get("var") and str(term["var"]) not in var_keys:
                errors.append({"field": "generic_spec.objective.terms.var", "error": "unknown variable", "expected": sorted(var_keys), "actual": term["var"]})
            if term.get("var") and str(term["var"]) in var_dims:
                expected_key = var_dims[str(term["var"])]
                actual_key = list(term.get("key") or [])
                if expected_key and actual_key != expected_key:
                    errors.append({"field": "generic_spec.objective.terms.key", "error": "variable key mismatch", "expected": expected_key, "actual": actual_key})
            if term.get("coef_param") and str(term["coef_param"]) not in param_keys:
                errors.append({"field": "generic_spec.objective.terms.coef_param", "error": "unknown parameter", "expected": sorted(param_keys), "actual": term["coef_param"]})
            for index in list(term.get("key") or []) + list(term.get("foreach") or []) + list(term.get("param_key") or []):
                if str(index) not in set_keys:
                    errors.append({"field": "generic_spec.objective.terms.key", "error": "unknown set", "expected": sorted(set_keys), "actual": index})
                check_generic_set("generic_spec.objective.terms", index, True)
            if term.get("coef_param"):
                scope = list(term.get("key", []) or term.get("foreach", []) or [])
                invalid = [dim for dim in param_dims.get(str(term["coef_param"]), []) if dim not in scope]
                if invalid:
                    errors.append({"field": "generic_spec.objective.terms.coef_param", "error": "parameter dimension mismatch", "expected": scope, "actual": param_dims.get(str(term["coef_param"]), [])})
        return errors

    def validate(self, semantic_spec: dict[str, Any], runtime_parameters: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        model_code = semantic_spec.get("model_code") or semantic_spec.get("code")
        build_mode = semantic_spec.get("build_mode") or (semantic_spec.get("component_spec") or {}).get("build_mode")
        if build_mode == "component_based":
            return self._validate_component_based(semantic_spec, runtime_parameters)
        if model_code == "unit_commitment_day_ahead":
            errors.extend(self._validate_unit_commitment(runtime_parameters))
        else:
            errors.extend(self._validate_by_template(semantic_spec, runtime_parameters))
        for param in semantic_spec.get("parameters", []):
            code = str(param.get("math_param") or param.get("code") or param.get("key") or "")
            if not code or code not in runtime_parameters:
                continue
            rule = param.get("validation") or {}
            value = runtime_parameters[code]
            expected_type = rule.get("type")
            if expected_type == "array" and not isinstance(value, list):
                errors.append({"field": code, "error": "type mismatch", "expected": "array", "actual": type(value).__name__})
            if expected_type == "dict" and not isinstance(value, dict):
                errors.append({"field": code, "error": "type mismatch", "expected": "dict", "actual": type(value).__name__})
        return errors

    def _validate_component_based(self, semantic_spec: dict[str, Any], params: dict[str, Any]) -> list[dict[str, Any]]:
        model_code = semantic_spec.get("model_code") or semantic_spec.get("code")
        try:
            if model_code == "cascade_hydro_dispatch":
                validate_hydro_runtime_parameters(params)
            else:
                self._validate_component_runtime_shape(semantic_spec, params)
        except RuntimeError as exc:
            return [{"field": "runtime_parameters", "error": str(exc), "expected": "组件化模型参数校验通过", "actual": "校验失败"}]
        return []

    def _validate_component_runtime_shape(self, semantic_spec: dict[str, Any], params: dict[str, Any]) -> None:
        component_spec = semantic_spec.get("component_spec") or {}
        set_lengths = self._semantic_set_lengths(semantic_spec)
        param_defs = list(semantic_spec.get("parameters", []) or [])
        param_defs.extend(component_spec.get("parameters") or [])
        for param in param_defs:
            code = str(param.get("math_param") or param.get("code") or param.get("key") or "")
            if not code:
                continue
            validation = param.get("validation") or {}
            required = bool(validation.get("required", param.get("required", True)))
            if required and code not in params:
                raise RuntimeError(f"component runtime parameter error: missing required parameter {code}.")
            if code not in params:
                continue
            expected_type = str(validation.get("type") or "").lower()
            value = params[code]
            if expected_type in {"array", "list"} and not isinstance(value, list):
                raise RuntimeError(f"component runtime parameter error: {code} must be an array, got {type(value).__name__}.")
            if expected_type in {"array", "list"} and isinstance(value, list):
                if validation.get("length_matches") and len(value) != len(params.get(str(validation["length_matches"]), [])):
                    raise RuntimeError(f"组件化模型参数错误：{code} 长度必须与 {validation['length_matches']} 一致。")
                if validation.get("min") is not None and any(float(item) < float(validation["min"]) for item in value):
                    raise RuntimeError(f"组件化模型参数错误：{code} 不得小于 {validation['min']}。")
            if expected_type == "dict" and not isinstance(value, dict):
                raise RuntimeError(f"component runtime parameter error: {code} must be a dict, got {type(value).__name__}.")
            dimensions = list(param.get("dimension") or param.get("indices") or [])
            self._validate_value_matches_dimensions(code, value, dimensions, set_lengths)
            if expected_type in {"number", "integer"}:
                numeric = float(value)
                if validation.get("min") is not None and numeric < float(validation["min"]):
                    raise RuntimeError(f"组件化模型参数错误：{code} 不得小于 {validation['min']}。")
                if validation.get("max") is not None and numeric > float(validation["max"]):
                    raise RuntimeError(f"组件化模型参数错误：{code} 不得大于 {validation['max']}。")
                if validation.get("greater_than") and numeric <= float(params.get(str(validation["greater_than"]), 0)):
                    raise RuntimeError(f"组件化模型参数错误：{code} 必须大于 {validation['greater_than']}。")

    def _semantic_set_lengths(self, semantic_spec: dict[str, Any]) -> dict[str, int]:
        lengths: dict[str, int] = {}
        for item in list(semantic_spec.get("sets") or []) + list((semantic_spec.get("component_spec") or {}).get("sets") or []):
            code = str(item.get("code") or item.get("key") or "")
            members = item.get("members") or item.get("values") or []
            if code and isinstance(members, list) and members:
                lengths[code] = len(members)
            elif code and item.get("horizon") is not None:
                lengths[code] = int(item["horizon"]) + (1 if item.get("type") == "state_time" else 0)
        return lengths

    def _validate_value_matches_dimensions(self, code: str, value: Any, dimensions: list[str], set_lengths: dict[str, int]) -> None:
        if not dimensions:
            if isinstance(value, (list, dict)):
                raise RuntimeError(f"参数 {code} 维度错误：该参数为标量，但实际提供了数组。")
            return
        expected_lengths = [set_lengths.get(str(dim)) for dim in dimensions]
        if len(dimensions) == 1 and expected_lengths[0] is not None:
            expected = int(expected_lengths[0])
            if isinstance(value, list) and len(value) != expected:
                raise RuntimeError(f"参数 {code} 维度不匹配：当前 {dimensions[0]} 集合长度为 {expected}，但实际提供 {len(value)} 个值。")
            if isinstance(value, dict) and len(value) != expected:
                raise RuntimeError(f"参数 {code} 维度不匹配：当前 {dimensions[0]} 集合长度为 {expected}，但实际提供 {len(value)} 个值。")
            return
        if len(dimensions) == 2 and all(item is not None for item in expected_lengths):
            first, second = int(expected_lengths[0]), int(expected_lengths[1])
            if isinstance(value, list) and len(value) != first:
                raise RuntimeError(f"参数 {code} 维度不匹配：第一维应为 {first}。")
            if isinstance(value, dict) and len(value) != first:
                raise RuntimeError(f"参数 {code} 维度不匹配：第一维应为 {first}。")
            rows = value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else []
            for row in rows:
                if isinstance(row, (list, dict)) and len(row) != second:
                    raise RuntimeError(f"参数 {code} 维度不匹配：第二维 {dimensions[1]} 应为 {second}。")

    def _validate_by_template(self, semantic_spec: dict[str, Any], params: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        horizon = int(params.get("horizon") or len(params.get("time", [])) or 4)
        set_values = {}
        for item in semantic_spec.get("sets", []):
            key = item.get("key") or item.get("code")
            if key:
                set_values[str(key)] = list(params.get(str(key), item.get("values", [])))
        for param in semantic_spec.get("parameters", []):
            code = str(param.get("code") or param.get("math_param") or param.get("key") or "")
            if not code:
                continue
            validation = param.get("validation") or {}
            required = bool(validation.get("required", param.get("required", True)))
            if required and code not in params:
                errors.append({"field": code, "error": "missing required parameter", "expected": "present", "actual": None})
                continue
            if code not in params:
                continue
            value = params[code]
            dimensions = list(param.get("dimension", []))
            expected_type = validation.get("type")
            if expected_type == "array":
                if not isinstance(value, list):
                    errors.append({"field": code, "error": "type mismatch", "expected": "array", "actual": type(value).__name__})
                elif len(value) != horizon:
                    errors.append({"field": code, "error": "length mismatch", "expected": horizon, "actual": len(value)})
                continue
            if expected_type == "dict":
                if not isinstance(value, dict):
                    errors.append({"field": code, "error": "type mismatch", "expected": "dict", "actual": type(value).__name__})
                    continue
                self._check_dimension_keys(errors, code, value, dimensions, set_values, horizon)
                continue
            if dimensions == ["time"]:
                if isinstance(value, list):
                    if len(value) != horizon:
                        errors.append({"field": code, "error": "length mismatch", "expected": horizon, "actual": len(value)})
                elif isinstance(value, dict):
                    self._check_dimension_keys(errors, code, value, dimensions, set_values, horizon)
                else:
                    errors.append({"field": code, "error": "type mismatch", "expected": "array or dict", "actual": type(value).__name__})
                continue
            if dimensions:
                if not isinstance(value, dict):
                    errors.append({"field": code, "error": "type mismatch", "expected": "dict", "actual": type(value).__name__})
                else:
                    self._check_dimension_keys(errors, code, value, dimensions, set_values, horizon)
        return errors

    def _check_dimension_keys(
        self,
        errors: list[dict[str, Any]],
        code: str,
        value: dict[str, Any],
        dimensions: list[str],
        set_values: dict[str, list[Any]],
        horizon: int,
    ) -> None:
        if len(dimensions) == 1 and dimensions[0] in set_values:
            expected = set_values[dimensions[0]]
            missing = [item for item in expected if item not in value and str(item) not in value]
            if missing:
                errors.append({"field": code, "error": "missing keys", "expected": expected, "actual": sorted(value.keys())})
            return
        if len(dimensions) == 2:
            first, second = dimensions
            first_values = set_values.get(first, list(value.keys()))
            second_values = set_values.get(second, [])
            for first_item in first_values:
                nested = value.get(first_item, value.get(str(first_item)))
                if second == "time" and isinstance(nested, list):
                    if len(nested) != horizon:
                        errors.append({"field": f"{code}[{first_item}]", "error": "length mismatch", "expected": horizon, "actual": len(nested)})
                elif isinstance(nested, dict):
                    missing = [item for item in second_values if item not in nested and str(item) not in nested]
                    if missing:
                        errors.append({"field": f"{code}[{first_item}]", "error": "missing keys", "expected": second_values, "actual": sorted(nested.keys())})
                else:
                    errors.append({"field": f"{code}[{first_item}]", "error": "type mismatch", "expected": "dict", "actual": type(nested).__name__})

    def _validate_unit_commitment(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        units = list(params.get("unit", params.get("units", ["U1", "U2", "U3"])))
        horizon = int(params.get("horizon") or len(params.get("time", [])) or len(params.get("load_forecast", [])) or 24)

        self._check_series_length(errors, params, "load_forecast", horizon)
        self._check_series_length(errors, params, "renewable_forecast", horizon)
        for field in (
            "unit_min_output",
            "unit_max_output",
            "fuel_cost",
            "startup_cost",
            "ramp_up_limit",
            "ramp_down_limit",
            "initial_unit_status",
            "initial_unit_output",
        ):
            if field in params:
                self._check_unit_dict(errors, params[field], field, units)

        min_output = params.get("unit_min_output", {})
        max_output = params.get("unit_max_output", {})
        if isinstance(min_output, dict) and isinstance(max_output, dict):
            for unit in units:
                min_value = self._lookup_number(min_output, unit, 0.0)
                max_value = self._lookup_number(max_output, unit, 0.0)
                if min_value > max_value:
                    errors.append(
                        {
                            "field": f"unit_min_output[{unit}]",
                            "error": "min greater than max",
                            "expected": f"<= unit_max_output[{unit}]",
                            "actual": min_value,
                        }
                    )

        status = params.get("initial_unit_status", {})
        if isinstance(status, dict):
            for unit in units:
                value = status.get(unit, status.get(str(unit), 0))
                if value not in {0, 1, 0.0, 1.0, True, False}:
                    errors.append({"field": f"initial_unit_status[{unit}]", "error": "binary expected", "expected": [0, 1], "actual": value})

        for field in ("load_forecast", "renewable_forecast"):
            value = params.get(field)
            if isinstance(value, list):
                for index, item in enumerate(value):
                    if not isinstance(item, (int, float)) or item < 0:
                        errors.append({"field": f"{field}[{index}]", "error": "non-negative number expected", "expected": ">= 0", "actual": item})
        return errors

    def _check_series_length(self, errors: list[dict[str, Any]], params: dict[str, Any], field: str, horizon: int) -> None:
        if field not in params:
            return
        value = params[field]
        if isinstance(value, list) and len(value) != horizon:
            errors.append({"field": field, "error": "length mismatch", "expected": horizon, "actual": len(value)})

    def _check_unit_dict(self, errors: list[dict[str, Any]], value: Any, field: str, units: list[str]) -> None:
        if not isinstance(value, dict):
            errors.append({"field": field, "error": "type mismatch", "expected": "dict", "actual": type(value).__name__})
            return
        missing = [unit for unit in units if unit not in value and str(unit) not in value]
        if missing:
            errors.append({"field": field, "error": "missing unit keys", "expected": units, "actual": sorted(value.keys())})

    def _lookup_number(self, value: dict[str, Any], key: str, default: float) -> float:
        return float(value.get(key, value.get(str(key), default)))
