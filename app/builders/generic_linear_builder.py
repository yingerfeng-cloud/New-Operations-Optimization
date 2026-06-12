from __future__ import annotations

from itertools import product
from typing import Any


class GenericLinearBuilder:
    def build(self, spec: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        import pyomo.environ as pyo

        sets = spec.get("sets", {})
        parameters = spec.get("parameters", {})
        variables = spec.get("variables", [])
        constraints = spec.get("constraints", [])
        objective = spec.get("objective", {})
        sense = str(spec.get("sense", "minimize")).lower()
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
                "generic_spec contains unsupported relationship types pending linearization: "
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

        def iter_context(names: list[str]) -> list[dict[str, Any]]:
            if not names:
                return [{}]
            values = []
            for name in names:
                if name not in sets:
                    raise RuntimeError(f"Unknown set: {name}")
                values.append(list(sets[name]))
            return [dict(zip(names, combo)) for combo in product(*values)]

        def resolve(tokens: list[Any], context: dict[str, Any]) -> list[Any]:
            return [context[token] if isinstance(token, str) and token in context else token for token in tokens]

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
                foreach = list(term.get("foreach", []))
                for local in iter_context(foreach) if foreach else [{}]:
                    context = {**outer, **local}
                    key_tokens = list(term.get("key", term.get("indices", [])))
                    keys = resolve(key_tokens, context)
                    label = var_label(str(term["var"]), keys)
                    if label not in var_map:
                        raise RuntimeError(f"Unknown variable in expression: {label}")
                    coef = param(str(term["coef_param"]), resolve(list(term.get("param_key", key_tokens)), context)) if "coef_param" in term else float(term.get("coef", 1.0))
                    coef *= float(term.get("weight", 1.0))
                    if term.get("sign") == "-":
                        coef *= -1.0
                    result += coef * var_map[label]
            return result

        for idx, cons in enumerate(constraints):
            foreach = list(cons.get("foreach", []))
            for count, context in enumerate(iter_context(foreach), start=1):
                lhs = expr(cons.get("terms", []), cons.get("constant", 0.0), context)
                rhs = param(str(cons["rhs_param"]), resolve(list(cons.get("rhs_key", foreach)), context)) if "rhs_param" in cons else float(cons.get("rhs", 0.0))
                cons_sense = str(cons.get("sense", "<="))
                relation = lhs <= rhs if cons_sense == "<=" else lhs >= rhs if cons_sense == ">=" else lhs == rhs
                suffix = "_" + "_".join(map(str, resolve(foreach, context))) if foreach else ""
                setattr(model, f"con_{cons.get('name', 'c')}{suffix}_{idx}_{count}", pyo.Constraint(expr=relation))

        model.objective = pyo.Objective(expr=expr(objective.get("terms", []), objective.get("constant", 0.0)), sense=pyo.maximize if sense == "maximize" else pyo.minimize)
        model._business_variable_labels = business_var_map
        return model, {"model_code": "generic_linear", "spec": spec, "var_map": var_map, "business_var_map": business_var_map}

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
