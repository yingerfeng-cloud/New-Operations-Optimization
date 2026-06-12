from __future__ import annotations

import ast
from copy import deepcopy
from typing import Any


UNSUPPORTED_FORMULA_MESSAGE = "当前公式仅完成展示，尚不能编译为通用线性求解结构。"


class FormulaCompileError(RuntimeError):
    pass


def compile_generic_formula_spec(generic_spec: dict[str, Any], semantic_spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = deepcopy(generic_spec or {})
    if not spec:
        return spec
    compiler = _LinearDslCompiler(spec, semantic_spec or {})
    constraints = []
    for index, constraint in enumerate(spec.get("constraints") or []):
        constraints.append(compiler.compile_constraint(constraint, index))
    spec["constraints"] = constraints
    objective = deepcopy(spec.get("objective") or {})
    terms = []
    for index, term in enumerate(objective.get("terms") or []):
        terms.extend(compiler.compile_objective_term(term, index))
    objective["terms"] = terms
    spec["objective"] = objective
    return spec


class _LinearDslCompiler:
    def __init__(self, spec: dict[str, Any], semantic_spec: dict[str, Any]) -> None:
        self.spec = spec
        self.sets = set(str(key) for key in (spec.get("sets") or {}).keys())
        self.variables = {
            str(item.get("name") or item.get("code") or item.get("key")): list(item.get("indices") or item.get("dimension") or [])
            for item in (spec.get("variables") or [])
        }
        semantic_params = semantic_spec.get("parameters") or []
        self.parameters = {
            str(item.get("math_param") or item.get("code") or item.get("key") or item.get("name")): list(item.get("dimension") or [])
            for item in semantic_params
            if item.get("math_param") or item.get("code") or item.get("key") or item.get("name")
        }
        for key, value in (spec.get("parameters") or {}).items():
            self.parameters.setdefault(str(key), self._infer_param_dims(str(key), value))

    def compile_constraint(self, constraint: dict[str, Any], index: int) -> dict[str, Any]:
        row = deepcopy(constraint)
        if row.get("terms") and ("rhs_param" in row or "rhs" in row):
            return row
        formula = _formula_text(row)
        if not formula:
            return row
        try:
            parsed = ast.parse(formula, mode="eval").body
            if not isinstance(parsed, ast.Compare) or len(parsed.ops) != 1:
                raise FormulaCompileError("constraint formula must contain one relation")
            sense = _sense(parsed.ops[0])
            lhs = self._linear_expr(parsed.left, {})
            rhs = self._rhs(parsed.comparators[0], {})
            terms = lhs["terms"]
            if not terms:
                raise FormulaCompileError("constraint left side has no variable terms")
            foreach = _free_sets(terms, rhs)
            row.update(
                {
                    "name": row.get("name") or row.get("constraint_id") or f"formula_constraint_{index + 1}",
                    "foreach": row.get("foreach") or foreach,
                    "terms": terms,
                    "sense": row.get("sense") or sense,
                    "compile_status": "compiled",
                }
            )
            if rhs.get("rhs_param"):
                row["rhs_param"] = rhs["rhs_param"]
                row["rhs_key"] = rhs.get("rhs_key", [])
                row.pop("rhs", None)
            else:
                row["rhs"] = rhs.get("rhs", 0.0)
            return row
        except Exception as exc:
            row["compile_status"] = "unsupported"
            row["compile_error"] = str(exc)
            return row

    def compile_objective_term(self, term: dict[str, Any], index: int) -> list[dict[str, Any]]:
        row = deepcopy(term)
        if row.get("var"):
            return [row]
        formula = _formula_text(row)
        if not formula:
            return [row]
        try:
            parsed = ast.parse(formula, mode="eval").body
            terms = self._linear_expr(parsed, {})["terms"]
            if not terms:
                raise FormulaCompileError("objective has no variable terms")
            result = []
            for offset, compiled in enumerate(terms, start=1):
                compiled.update(
                    {
                        **{k: deepcopy(v) for k, v in row.items() if k not in {"foreach", "key", "param_key", "coef", "coef_param", "var"}},
                        **compiled,
                        "term_id": row.get("term_id") or row.get("code") or f"formula_objective_{index + 1}_{offset}",
                        "name": row.get("name") or row.get("term_id") or f"formula objective {index + 1}",
                        "compile_status": "compiled",
                    }
                )
                result.append(compiled)
            return result
        except Exception as exc:
            row["compile_status"] = "unsupported"
            row["compile_error"] = str(exc)
            return [row]

    def _linear_expr(self, node: ast.AST, aliases: dict[str, str]) -> dict[str, Any]:
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            expr = self._linear_expr(node.operand, aliases)
            for term in expr["terms"]:
                term["coef"] = -float(term.get("coef", 1.0)) if "coef_param" not in term else term.get("coef", -1.0)
                if "coef_param" in term:
                    term["sign"] = "-" if term.get("sign") != "-" else "+"
            expr["constant"] = -float(expr.get("constant", 0.0))
            return expr
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
            left = self._linear_expr(node.left, aliases)
            right = self._linear_expr(node.right, aliases)
            if isinstance(node.op, ast.Sub):
                for term in right["terms"]:
                    if "coef_param" in term:
                        term["sign"] = "-" if term.get("sign") != "-" else "+"
                    else:
                        term["coef"] = -float(term.get("coef", 1.0))
                right["constant"] = -float(right.get("constant", 0.0))
            return {"terms": left["terms"] + right["terms"], "constant": float(left.get("constant", 0.0)) + float(right.get("constant", 0.0))}
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            left_var = self._single_var_term(node.left, aliases)
            right_var = self._single_var_term(node.right, aliases)
            if left_var and right_var:
                raise FormulaCompileError("nonlinear variable product")
            if left_var:
                return {"terms": [self._attach_coef(left_var, node.right, aliases)], "constant": 0.0}
            if right_var:
                return {"terms": [self._attach_coef(right_var, node.left, aliases)], "constant": 0.0}
            raise FormulaCompileError("multiplication without variable is not supported")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "sum":
            if not node.args or not isinstance(node.args[0], ast.GeneratorExp):
                raise FormulaCompileError("sum must use generator expression")
            gen = node.args[0]
            next_aliases = dict(aliases)
            foreach: list[str] = []
            for comp in gen.generators:
                if not isinstance(comp.target, ast.Name):
                    raise FormulaCompileError("sum loop target must be a name")
                set_name = _node_name(comp.iter)
                if set_name not in self.sets:
                    raise FormulaCompileError(f"unknown set {set_name}")
                next_aliases[comp.target.id] = set_name
                foreach.append(set_name)
            expr = self._linear_expr(gen.elt, next_aliases)
            for term in expr["terms"]:
                term["foreach"] = _unique(list(term.get("foreach") or []) + foreach)
            return expr
        var_term = self._single_var_term(node, aliases)
        if var_term:
            return {"terms": [var_term], "constant": 0.0}
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return {"terms": [], "constant": float(node.value)}
        raise FormulaCompileError(f"unsupported expression: {ast.unparse(node)}")

    def _single_var_term(self, node: ast.AST, aliases: dict[str, str]) -> dict[str, Any] | None:
        ref = self._reference(node, aliases)
        if not ref or ref["name"] not in self.variables:
            return None
        return {"var": ref["name"], "key": ref["key"], "coef": 1.0}

    def _attach_coef(self, term: dict[str, Any], node: ast.AST, aliases: dict[str, str]) -> dict[str, Any]:
        result = deepcopy(term)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            result["coef"] = float(result.get("coef", 1.0)) * float(node.value)
            return result
        ref = self._reference(node, aliases)
        if ref and ref["name"] in self.parameters:
            result.pop("coef", None)
            result["coef_param"] = ref["name"]
            result["param_key"] = ref["key"]
            return result
        raise FormulaCompileError("coefficient must be a constant or parameter reference")

    def _rhs(self, node: ast.AST, aliases: dict[str, str]) -> dict[str, Any]:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return {"rhs": float(node.value)}
        ref = self._reference(node, aliases)
        if ref and ref["name"] in self.parameters:
            return {"rhs_param": ref["name"], "rhs_key": ref["key"]}
        raise FormulaCompileError("rhs must be a constant or parameter reference")

    def _reference(self, node: ast.AST, aliases: dict[str, str]) -> dict[str, Any] | None:
        if isinstance(node, ast.Name):
            return {"name": node.id, "key": []}
        if not isinstance(node, ast.Subscript):
            return None
        name = _node_name(node.value)
        raw_keys = _subscript_items(node.slice)
        keys = [aliases.get(_node_name(item), _node_name(item)) for item in raw_keys]
        return {"name": name, "key": keys}

    def _infer_param_dims(self, key: str, value: Any) -> list[str]:
        if key in self.parameters:
            return self.parameters[key]
        if isinstance(value, dict):
            return []
        return []


def _formula_text(row: dict[str, Any]) -> str:
    for key in ("dsl_formula", "dsl", "formula", "expression", "math_expression", "display_formula"):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _sense(op: ast.cmpop) -> str:
    if isinstance(op, ast.LtE):
        return "<="
    if isinstance(op, ast.GtE):
        return ">="
    if isinstance(op, ast.Eq):
        return "=="
    raise FormulaCompileError("unsupported relation")


def _node_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Constant):
        return str(node.value)
    return ast.unparse(node)


def _subscript_items(node: ast.AST) -> list[ast.AST]:
    if isinstance(node, ast.Tuple):
        return list(node.elts)
    return [node]


def _free_sets(terms: list[dict[str, Any]], rhs: dict[str, Any]) -> list[str]:
    aggregated: set[str] = set()
    used: list[str] = []
    for term in terms:
        aggregated.update(str(item) for item in term.get("foreach") or [])
        used.extend(str(item) for item in term.get("key") or [])
        used.extend(str(item) for item in term.get("param_key") or [])
    used.extend(str(item) for item in rhs.get("rhs_key") or [])
    return _unique([item for item in used if item not in aggregated])


def _unique(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result
