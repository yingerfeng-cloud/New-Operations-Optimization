from __future__ import annotations

from itertools import product
import math
from typing import Any

from app.formulas.service import COMPILER_VERSION


class GenericLinearBuilder:
    def build(self, spec: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        sets = spec.get("sets", {})
        parameters = spec.get("parameters", {})
        variables = spec.get("variables", [])
        constraints = spec.get("constraints", [])
        objective = spec.get("objective", {})
        sense = str(spec.get("sense", "minimize")).lower()
        if spec.get("formula_artifacts"):
            if spec.get("formula_ast_version") != "1.0":
                raise RuntimeError("FORMULA_AST_VERSION_UNSUPPORTED: generic_spec requires formula_ast_version=1.0")
            if spec.get("formula_compiler") != "backend_authoritative_v2":
                raise RuntimeError("FORMULA_COMPILER_NOT_AUTHORITATIVE: only backend_authoritative_v2 artifacts are accepted")
            if spec.get("compiled_fragment_version") != "1.0":
                raise RuntimeError("FORMULA_FRAGMENT_VERSION_UNSUPPORTED: compiled_fragment_version must be 1.0")
            incompatible_artifacts = [
                str(item.get("formula_id") or "unknown")
                for item in spec.get("formula_artifacts", [])
                if str(item.get("compiler_version") or "") != COMPILER_VERSION
            ]
            if incompatible_artifacts:
                raise RuntimeError(
                    f"FORMULA_COMPILER_VERSION_UNSUPPORTED: expected {COMPILER_VERSION}; rejected artifacts: "
                    + ", ".join(incompatible_artifacts)
                )
            objective_mode = str(spec.get("objective_mode") or objective.get("mode") or "single")
            global_direction = str(spec.get("global_direction") or objective.get("global_direction") or sense)
            if objective_mode not in {"single", "weighted_sum"}:
                raise RuntimeError("FORMULA_OBJECTIVE_MODE_UNSUPPORTED: expected single or weighted_sum")
            if global_direction not in {"minimize", "maximize"} or global_direction != sense:
                raise RuntimeError("FORMULA_GLOBAL_DIRECTION_INVALID: objective direction must match generic_spec sense")
            objective_sources = {str(term.get("source_formula_id") or term.get("formula_id") or "") for term in objective.get("terms", [])}
            objective_sources.discard("")
            objective_artifacts = [item for item in spec.get("formula_artifacts", []) if str(item.get("kind") or "") == "objective"]
            if objective_mode == "single" and ((objective_artifacts and len(objective_artifacts) != 1) or len(objective_sources) > 1):
                raise RuntimeError("FORMULA_SINGLE_OBJECTIVE_COUNT_INVALID: single mode requires exactly one objective")
            if objective_mode == "weighted_sum":
                for term in objective.get("terms", []):
                    weight = term.get("objective_weight")
                    effective_sign = term.get("effective_sign")
                    effective_weight = term.get("weight")
                    original_direction = str(term.get("original_direction") or "")
                    if not isinstance(weight, (int, float)) or isinstance(weight, bool) or not math.isfinite(float(weight)):
                        raise RuntimeError("FORMULA_OBJECTIVE_WEIGHT_INVALID: weighted_sum requires explicit finite weights")
                    if effective_sign not in {-1, 1} or original_direction not in {"minimize", "maximize"}:
                        raise RuntimeError("FORMULA_OBJECTIVE_DIRECTION_NORMALIZATION_INVALID")
                    expected_sign = 1 if original_direction == global_direction else -1
                    if effective_sign != expected_sign or not isinstance(effective_weight, (int, float)) or not math.isfinite(float(effective_weight)) or float(effective_weight) != float(weight) * expected_sign:
                        raise RuntimeError("FORMULA_OBJECTIVE_EFFECTIVE_WEIGHT_INVALID")
        if not variables:
            raise RuntimeError("generic_spec.variables is required")
        if not objective:
            raise RuntimeError("generic_spec.objective is required")
        unsupported = [
            cons.get("name", f"constraint_{idx}")
            for idx, cons in enumerate(constraints)
            if str(cons.get("sense", "<=")) not in {"<=", ">=", "=="}
        ]
        if unsupported:
            raise RuntimeError(
                "FORMULA_RELATION_UNSUPPORTED: GenericLinearBuilder only accepts <=, >= and ==; rejected: "
                + ", ".join(map(str, unsupported))
            )

        domain_map = {
            "Reals": pyo.Reals,
            "NonNegativeReals": pyo.NonNegativeReals,
            "Integers": pyo.Integers,
            "NonNegativeIntegers": pyo.NonNegativeIntegers,
            "Binary": pyo.Binary,
        }
        model = pyo.ConcreteModel(name="generic_linear_milp")
        var_map: dict[str, Any] = {}
        business_var_map: dict[str, dict[str, Any]] = {}
        set_positions = {
            name: {str(value): idx for idx, value in enumerate(list(values))}
            for name, values in sets.items()
        }

        def iter_context(names: list[Any]) -> list[dict[str, Any]]:
            if not names:
                return [{}]
            bindings = [
                (str(item.get("alias") or item.get("set")), str(item.get("set")))
                if isinstance(item, dict)
                else (str(item), str(item))
                for item in names
            ]
            values = []
            for _, set_name in bindings:
                if set_name not in sets:
                    raise RuntimeError(f"Unknown set: {set_name}")
                values.append(list(sets[set_name]))
            contexts = []
            for combo in product(*values):
                context: dict[str, Any] = {}
                for (alias, set_name), value in zip(bindings, combo):
                    context[alias] = value
                    context.setdefault(set_name, value)
                contexts.append(context)
            return contexts

        def resolve(tokens: list[Any], context: dict[str, Any]) -> list[Any]:
            resolved: list[Any] = []
            for token in tokens:
                if isinstance(token, str) and token in context:
                    resolved.append(context[token])
                    continue
                if isinstance(token, dict) and token.get("type") == "index_offset":
                    set_name = str(token.get("set"))
                    target_set = str(token.get("target_set") or set_name)
                    if set_name not in context or target_set not in sets:
                        raise RuntimeError(f"Offset index set is not in scope: {set_name}")
                    values = list(sets[target_set])
                    current = context[set_name]
                    try:
                        position = values.index(current) + int(token.get("offset", 0))
                    except ValueError as exc:
                        raise RuntimeError(f"Offset base value is outside set {set_name}: {current}") from exc
                    if position < 0 or position >= len(values):
                        raise RuntimeError(
                            f"FORMULA_INDEX_OFFSET_OUT_OF_RANGE: {set_name} value {current} "
                            f"with offset {int(token.get('offset', 0)):+d} is outside target set {target_set}"
                        )
                    resolved.append(values[position])
                    continue
                resolved.append(token)
            return resolved

        def var_label(base_name: str, keys: list[Any]) -> str:
            return f"{base_name}[{','.join(map(str, keys))}]" if keys else base_name

        def param(name: str, keys: list[Any]) -> float:
            if name not in parameters:
                raise RuntimeError(f"Unknown parameter: {name}")
            value: Any = parameters[name]
            for key in keys:
                if isinstance(value, dict):
                    value = value.get(str(key), value.get(key))
                elif isinstance(value, list):
                    position = self._resolve_list_position(key, set_positions)
                    if position is None or position < 0 or position >= len(value):
                        raise RuntimeError(f"Parameter {name} missing key {key}")
                    value = value[position]
                else:
                    raise RuntimeError(f"Parameter {name} is not indexable")
                if value is None:
                    raise RuntimeError(f"Parameter {name} missing key {key}")
            return float(value)

        def scalar_value(payload: dict[str, Any], context: dict[str, Any]) -> float:
            value = float(payload.get("numeric", payload.get("coef", 1.0)))
            factors = list(payload.get("factors") or payload.get("coef_factors") or [])
            if not factors and payload.get("param"):
                factors = [{"parameter": payload["param"], "indices": payload.get("key", payload.get("param_key", [])), "power": 1}]
            for factor in factors:
                factor_value = param(str(factor.get("parameter")), resolve(list(factor.get("indices") or []), context))
                power = int(factor.get("power", 1))
                if power < 0 and factor_value == 0:
                    raise RuntimeError(f"Parameter {factor.get('parameter')} is zero in denominator")
                value *= factor_value**power
            return value

        for var in variables:
            name = str(var["name"])
            if name.lower() in {"x", "y", "z"}:
                raise RuntimeError("Decision variables must use business semantic names, not x/y/z.")
            domain = domain_map.get(str(var.get("domain", "NonNegativeReals")))
            if domain is None:
                raise RuntimeError(f"Unsupported variable domain: {var.get('domain')}")
            indices = list(var.get("indices", []))
            for context in iter_context(indices):
                keys = [context[idx] for idx in indices]
                label = var_label(name, keys)
                lb = var.get("lb")
                ub = var.get("ub")
                if "lb_param" in var:
                    lb = param(str(var["lb_param"]), resolve(list(var.get("lb_key", indices)), context))
                if "ub_param" in var:
                    ub = param(str(var["ub_param"]), resolve(list(var.get("ub_key", indices)), context))
                component = pyo.Var(domain=domain, bounds=(lb, ub))
                component_name = "var_" + label.replace("[", "_").replace("]", "").replace(",", "_")
                setattr(model, component_name, component)
                var_map[label] = component
                business_var_map[component_name] = {"base": name, "keys": [str(key) for key in keys], "label": label}

        def expr(terms: list[dict[str, Any]], constant: float = 0.0, outer: dict[str, Any] | None = None) -> Any:
            outer = outer or {}
            result: Any = float(constant)
            for term in terms:
                if term.get("enabled") is False:
                    continue
                foreach = list(term.get("aggregate_scope") or term.get("foreach", []))
                for local in iter_context(foreach) if foreach else [{}]:
                    context = {**outer, **local}
                    key_tokens = list(term.get("key", term.get("indices", [])))
                    keys = resolve(key_tokens, context)
                    label = var_label(str(term["var"]), keys)
                    if label not in var_map:
                        raise RuntimeError(f"Unknown variable in expression: {label}")
                    coefficient = term.get("coefficient")
                    if isinstance(coefficient, dict):
                        coef = scalar_value(coefficient, context)
                    elif term.get("coef_factors"):
                        coef = scalar_value({"numeric": term.get("coef", 1.0), "factors": term.get("coef_factors")}, context)
                    elif "coef_param" in term:
                        coef = float(term.get("coef", 1.0)) * param(str(term["coef_param"]), resolve(list(term.get("param_key", key_tokens)), context))
                    else:
                        coef = float(term.get("coef", 1.0))
                    coef *= float(term.get("weight", 1.0))
                    if term.get("sign") == "-":
                        coef *= -1.0
                    result += coef * var_map[label]
            return result

        def param_expr(terms: list[dict[str, Any]], constant: float = 0.0, outer: dict[str, Any] | None = None) -> Any:
            outer = outer or {}
            result: Any = float(constant)
            for term in terms:
                if term.get("factors") is not None or term.get("numeric") is not None:
                    value = scalar_value(term, outer)
                else:
                    key_tokens = list(term.get("key", term.get("param_key", [])))
                    value = param(str(term["param"]), resolve(key_tokens, outer))
                    value *= float(term.get("coef", 1.0))
                if term.get("sign") == "-":
                    value *= -1.0
                result += value
            return result

        formula_trace: dict[str, dict[str, Any]] = {}
        for idx, cons in enumerate(constraints):
            scope = list(cons.get("scope") or cons.get("foreach", []))
            foreach = [str(item.get("set")) if isinstance(item, dict) else str(item) for item in scope]
            for count, context in enumerate(iter_context(scope), start=1):
                lhs = expr(cons.get("terms", []), cons.get("constant", 0.0), context)
                if cons.get("rhs_terms"):
                    rhs = param_expr(list(cons.get("rhs_terms") or []), float(cons.get("rhs", 0.0)), context)
                else:
                    rhs = param(str(cons["rhs_param"]), resolve(list(cons.get("rhs_key", foreach)), context)) if "rhs_param" in cons else float(cons.get("rhs", 0.0))
                cons_sense = str(cons.get("sense", "<="))
                relation = lhs <= rhs if cons_sense == "<=" else lhs >= rhs if cons_sense == ">=" else lhs == rhs
                suffix = "_" + "_".join(map(str, resolve(foreach, context))) if foreach else ""
                component_name = f"con_{cons.get('name', 'c')}{suffix}_{idx}_{count}"
                setattr(model, component_name, pyo.Constraint(expr=relation))
                formula_trace[component_name] = {
                    "source_formula_id": cons.get("source_formula_id") or cons.get("formula_id"),
                    "source_formula_revision": cons.get("source_formula_revision"),
                    "split_sequence": cons.get("split_sequence", 1),
                    "scope_binding": dict(context),
                }

        model.objective = pyo.Objective(expr=expr(objective.get("terms", []), objective.get("constant", 0.0)), sense=pyo.maximize if sense == "maximize" else pyo.minimize)
        model._business_variable_labels = business_var_map
        model._formula_trace = formula_trace
        return model, {"model_code": "generic_linear", "spec": spec, "var_map": var_map, "business_var_map": business_var_map, "formula_trace": formula_trace}

    def _resolve_list_position(self, key: Any, set_positions: dict[str, dict[str, int]]) -> int | None:
        if isinstance(key, int):
            return key
        if isinstance(key, str) and key.isdigit():
            return int(key)
        key_text = str(key)
        for positions in set_positions.values():
            if key_text in positions:
                return positions[key_text]
        return None
