from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Iterable

from app.schemas.formula import FormulaAnalyzeRequest


AST_VERSION = "1.0"
COMPILER_VERSION = "2.0.0"
MAX_AST_NODES = 2_000
MAX_AST_DEPTH = 256
MAX_AGGREGATE_DEPTH = 4
MAX_EXPANDED_CONSTRAINTS = 100_000
MAX_EXPANDED_TERMS = 1_000_000
ALLOWED_FUNCTIONS = {"sum", "min", "max", "abs", "piecewise", "log", "exp", "sqrt"}
RELATION_NAMES = {ast.LtE: "<=", ast.GtE: ">=", ast.Eq: "==", ast.Lt: "<", ast.Gt: ">"}
ARITHMETIC_NAMES = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/", ast.Pow: "**"}


@dataclass
class Symbol:
    code: str
    kind: str
    dimensions: list[str] = field(default_factory=list)
    unit: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScalarFactor:
    parameter: str
    indices: list[Any]
    power: int = 1


@dataclass
class ScalarTerm:
    numeric: float = 1.0
    factors: list[ScalarFactor] = field(default_factory=list)

    def multiplied(self, other: "ScalarTerm") -> "ScalarTerm":
        merged: dict[tuple[str, str], ScalarFactor] = {}
        for factor in [*self.factors, *other.factors]:
            key = (factor.parameter, repr(factor.indices))
            if key not in merged:
                merged[key] = ScalarFactor(factor.parameter, list(factor.indices), factor.power)
            else:
                merged[key].power += factor.power
        return ScalarTerm(self.numeric * other.numeric, [item for item in merged.values() if item.power])

    def negated(self) -> "ScalarTerm":
        return ScalarTerm(-self.numeric, list(self.factors))


@dataclass
class VariableTerm:
    variable: str
    indices: list[Any]
    coefficient: ScalarTerm = field(default_factory=ScalarTerm)
    aggregate_scope: list[dict[str, str]] = field(default_factory=list)

    def scaled(self, scalar: ScalarTerm) -> "VariableTerm":
        return VariableTerm(self.variable, list(self.indices), self.coefficient.multiplied(scalar), list(self.aggregate_scope))


@dataclass
class LinearExpression:
    terms: list[VariableTerm] = field(default_factory=list)
    scalars: list[ScalarTerm] = field(default_factory=list)

    def negated(self) -> "LinearExpression":
        return LinearExpression(
            [term.scaled(ScalarTerm(-1.0)) for term in self.terms],
            [term.negated() for term in self.scalars],
        )


class FormulaFailure(RuntimeError):
    def __init__(self, code: str, message: str, node: ast.AST | None = None, *, stage: str = "compile", fix_hint: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.node = node
        self.stage = stage
        self.fix_hint = fix_hint


class FormulaAnalyzer:
    def __init__(self, request: FormulaAnalyzeRequest) -> None:
        self.request = request
        self.source = request.formula
        self.diagnostics: list[dict[str, Any]] = []
        self.sets = _normalize_sets(request.symbols.get("sets"))
        self.parameters = _normalize_symbols(request.symbols.get("parameters"), "parameter")
        self.variables = _normalize_symbols(request.symbols.get("variables"), "variable")
        self.scope = [{"alias": row.alias, "set": row.set} for row in request.scope]
        self.aliases = {row["alias"]: row["set"] for row in self.scope}
        self.references: list[dict[str, Any]] = []

    def run(self, *, compile_requested: bool, expand_requested: bool = False) -> dict[str, Any]:
        if self.request.ast_version != AST_VERSION:
            self._diagnostic(
                "FORMULA_AST_VERSION_UNSUPPORTED",
                "error",
                "syntax",
                f"不支持 AST 版本 {self.request.ast_version}，当前版本为 {AST_VERSION}。",
                expected=AST_VERSION,
                actual=self.request.ast_version,
                fix_hint="将 ast_version 更新为服务端声明的版本。",
            )
            return self._result(None, None, "unsupported", compile_requested)
        self._validate_scope_contract()
        try:
            tree = ast.parse(self.source, mode="eval")
        except SyntaxError as exc:
            start = _line_col_to_offset(self.source, exc.lineno or 1, max((exc.offset or 1) - 1, 0))
            self._diagnostic(
                "FORMULA_SYNTAX_ERROR",
                "error",
                "syntax",
                f"公式语法错误：{exc.msg}",
                start=start,
                end=min(start + 1, len(self.source)),
                fix_hint="检查括号、索引、生成式和关系运算符。",
            )
            return self._result(None, None, "unsupported", compile_requested)

        nodes = list(ast.walk(tree))
        if len(nodes) > MAX_AST_NODES:
            self._diagnostic("FORMULA_TOO_COMPLEX", "error", "syntax", "公式 AST 节点数量超过安全上限。", actual=len(nodes), expected=MAX_AST_NODES)
            return self._result(None, None, "unsupported", compile_requested)
        depth = _max_ast_depth(tree)
        if depth > MAX_AST_DEPTH:
            self._diagnostic("FORMULA_AST_DEPTH_EXCEEDED", "error", "syntax", "公式 AST 深度超过安全上限。", actual=depth, expected=MAX_AST_DEPTH)
            return self._result(None, None, "unsupported", compile_requested)
        aggregate_depth = _max_aggregate_depth(tree)
        if aggregate_depth > MAX_AGGREGATE_DEPTH:
            self._diagnostic("FORMULA_AGGREGATE_DEPTH_EXCEEDED", "error", "syntax", "聚合嵌套层数超过安全上限。", actual=aggregate_depth, expected=MAX_AGGREGATE_DEPTH)
            return self._result(None, None, "unsupported", compile_requested)
        self._security_check(tree)
        self._validate_formula_shape(tree.body)
        self._validate_symbols(tree.body, dict(self.aliases))
        self._validate_units(tree.body, dict(self.aliases))
        expression_class = self._classify(tree.body)
        capability = _capability(expression_class)

        compiled_fragment: dict[str, Any] | None = None
        should_compile = compile_requested and self.request.participation == "solve_active"
        if should_compile and not self._has_errors():
            if expression_class not in {"constant", "linear"}:
                recommendation = capability.get("recommended_transformation")
                self._diagnostic(
                    "FORMULA_CLASS_NOT_DIRECTLY_COMPILABLE",
                    "error",
                    "classification",
                    f"{expression_class} 表达式不能直接进入通用线性 Builder。",
                    node=tree.body,
                    actual=expression_class,
                    expected="linear",
                    fix_hint=_recommendation_text(recommendation),
                )
            else:
                try:
                    compiled_fragment = self._compile(tree.body)
                except FormulaFailure as exc:
                    self._diagnostic(exc.code, "error", exc.stage, exc.message, node=exc.node, fix_hint=exc.fix_hint)
        elif compile_requested and self.request.participation == "preview_only":
            self._diagnostic(
                "FORMULA_PREVIEW_ONLY_EXCLUDED",
                "info",
                "compile",
                "preview_only 公式已完成语法与语义分析，但不会生成求解片段。",
            )

        normalized = _safe_unparse(tree.body)
        estimated = self._estimate_expansion(compiled_fragment)
        if compiled_fragment is not None and (
            estimated["constraint_count"] > MAX_EXPANDED_CONSTRAINTS
            or estimated["term_count"] > MAX_EXPANDED_TERMS
        ):
            self._diagnostic(
                "FORMULA_EXPANSION_LIMIT_EXCEEDED",
                "error",
                "compile",
                "预计展开规模超过单公式安全上限，已阻止生成求解结构。",
                actual=estimated,
                expected={"constraint_count": MAX_EXPANDED_CONSTRAINTS, "term_count": MAX_EXPANDED_TERMS},
                fix_hint="缩小作用域集合、拆分公式或改用专用稀疏组件。",
            )
            compiled_fragment = None
        if expand_requested and compiled_fragment is not None:
            compiled_fragment["expansion_preview"] = self._expansion_preview(compiled_fragment)
        return self._result(tree, compiled_fragment, expression_class, compile_requested, normalized, capability, estimated)

    def _security_check(self, tree: ast.AST) -> None:
        allowed_nodes = (
            ast.Expression, ast.BinOp, ast.UnaryOp, ast.Compare, ast.Call, ast.Name,
            ast.Constant, ast.Subscript, ast.Tuple, ast.GeneratorExp, ast.comprehension,
            ast.Load, ast.Store, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow,
            ast.USub, ast.UAdd, ast.LtE, ast.GtE, ast.Eq, ast.Lt, ast.Gt,
        )
        for node in ast.walk(tree):
            if not isinstance(node, allowed_nodes):
                self._diagnostic("FORMULA_UNSAFE_NODE", "error", "syntax", f"不允许的 AST 节点：{type(node).__name__}", node=node, fix_hint="仅使用公式 DSL 支持的算术、索引、聚合和函数。")
            if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS):
                self._diagnostic("FORMULA_FUNCTION_UNSUPPORTED", "error", "syntax", "函数调用不在安全白名单中。", node=node, actual=_safe_unparse(node.func), expected=sorted(ALLOWED_FUNCTIONS))

    def _validate_formula_shape(self, node: ast.AST) -> None:
        if self.request.formula_type == "constraint":
            if not isinstance(node, ast.Compare):
                self._diagnostic("FORMULA_RELATION_REQUIRED", "error", "syntax", "约束公式必须包含 <=、>= 或 == 关系。", node=node)
            elif any(isinstance(op, (ast.Lt, ast.Gt)) for op in node.ops):
                self._diagnostic(
                    "FORMULA_STRICT_INEQUALITY_UNSUPPORTED",
                    "error",
                    "classification",
                    "LP/MILP 求解器不能直接表达严格不等式 < 或 >。",
                    node=node,
                    actual=[RELATION_NAMES[type(op)] for op in node.ops],
                    expected=["<=", ">=", "=="],
                    fix_hint="请改用 <= 或 >=；不得在未显式配置容差时自动转换。",
                )
            elif any(type(op) not in RELATION_NAMES for op in node.ops):
                self._diagnostic("FORMULA_RELATION_UNSUPPORTED", "error", "syntax", "关系运算符不受支持。", node=node)
        elif self.request.formula_type == "objective" and isinstance(node, ast.Compare):
            self._diagnostic("FORMULA_OBJECTIVE_HAS_RELATION", "error", "syntax", "目标函数不能包含关系运算符。", node=node)
        if self.request.formula_type == "objective" and self.request.participation == "solve_active" and not self.request.objective_direction:
            self._diagnostic(
                "FORMULA_OBJECTIVE_DIRECTION_REQUIRED",
                "error",
                "classification",
                "参与求解的目标函数必须显式指定 minimize 或 maximize。",
                node=node,
                fix_hint="在目标配置中选择最小化或最大化。",
            )

    def _validate_scope_contract(self) -> None:
        seen: set[str] = set()
        for item in self.scope:
            alias, set_code = item["alias"], item["set"]
            if alias in seen:
                self._diagnostic("FORMULA_SCOPE_ALIAS_DUPLICATE", "error", "dimension", f"作用域别名重复：{alias}", expected="unique alias", actual=alias)
            seen.add(alias)
            if set_code not in self.sets:
                self._diagnostic("FORMULA_SCOPE_SET_UNKNOWN", "error", "dimension", f"作用域集合不存在：{set_code}", symbol_code=set_code)

    def _validate_symbols(self, node: ast.AST, aliases: dict[str, str]) -> None:
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"sum", "min", "max"}:
            if len(node.args) == 1 and isinstance(node.args[0], ast.GeneratorExp):
                generator = node.args[0]
                local = dict(aliases)
                for comp in generator.generators:
                    if comp.ifs:
                        self._diagnostic("FORMULA_CONDITIONAL_AGGREGATE_UNSUPPORTED", "error", "classification", "条件聚合尚未支持。", node=comp, fix_hint="拆分集合或使用显式组件表达条件。")
                    if not isinstance(comp.target, ast.Name) or not isinstance(comp.iter, ast.Name):
                        self._diagnostic("FORMULA_AGGREGATE_SCOPE_INVALID", "error", "dimension", "聚合必须写成 `for alias in set`。", node=comp)
                        continue
                    alias, set_code = comp.target.id, comp.iter.id
                    if set_code not in self.sets:
                        self._diagnostic("FORMULA_SET_UNKNOWN", "error", "symbol", f"集合不存在：{set_code}", node=comp.iter, symbol_code=set_code)
                    if alias in local or alias in self.parameters or alias in self.variables:
                        self._diagnostic("FORMULA_INDEX_ALIAS_CONFLICT", "error", "dimension", f"聚合索引别名冲突：{alias}", node=comp.target)
                    local[alias] = set_code
                self._validate_symbols(generator.elt, local)
                return
        if isinstance(node, ast.Subscript):
            code = _base_name(node.value)
            symbol = self.variables.get(code) or self.parameters.get(code)
            if symbol is None:
                self._diagnostic("FORMULA_SYMBOL_UNKNOWN", "error", "symbol", f"引用对象不存在：{code}", node=node.value, symbol_code=code)
            else:
                raw_indices = _subscript_items(node.slice)
                for position, raw_index in enumerate(raw_indices[: len(symbol.dimensions)]):
                    base = raw_index.left if isinstance(raw_index, ast.BinOp) else raw_index
                    if isinstance(base, ast.Name) and base.id not in aliases and base.id not in self.sets:
                        expected_set = symbol.dimensions[position]
                        aliases[base.id] = expected_set
                        self.aliases.setdefault(base.id, expected_set)
                        if not any(item["alias"] == base.id for item in self.scope):
                            self.scope.append({"alias": base.id, "set": expected_set})
                            self._diagnostic(
                                "FORMULA_SCOPE_INFERRED_REQUIRES_CONFIRMATION",
                                "warning",
                                "dimension",
                                f"已推断索引 {base.id} 映射到集合 {expected_set}，保存前请确认。",
                                node=base,
                                symbol_code=code,
                                expected={"alias": base.id, "set": expected_set},
                            )
                actual_sets = [
                    self._index_set(item, aliases, symbol.dimensions[position] if position < len(symbol.dimensions) else None)
                    for position, item in enumerate(raw_indices)
                ]
                self.references.append({"symbolCode": code, "kind": symbol.kind, "declaredDimensions": symbol.dimensions, "indices": [_safe_unparse(item) for item in raw_indices], "actualSets": actual_sets})
                if len(raw_indices) != len(symbol.dimensions):
                    self._diagnostic(
                        "FORMULA_INDEX_ARITY_MISMATCH",
                        "error",
                        "dimension",
                        f"{code} 声明 {len(symbol.dimensions)} 个维度，但实际使用 {len(raw_indices)} 个索引。",
                        node=node,
                        symbol_code=code,
                        expected=symbol.dimensions,
                        actual=[_safe_unparse(item) for item in raw_indices],
                        fix_hint=f"按声明顺序使用索引：{code}[{','.join(symbol.dimensions)}]。",
                    )
                for position, expected in enumerate(symbol.dimensions[: len(raw_indices)]):
                    actual = actual_sets[position]
                    if actual is None:
                        self._diagnostic("FORMULA_INDEX_SCOPE_UNKNOWN", "error", "dimension", f"索引 `{_safe_unparse(raw_indices[position])}` 未绑定集合。", node=raw_indices[position], symbol_code=code, expected=expected, fix_hint="在 scope 中声明 alias 与集合的映射。")
                    elif not self._dimension_compatible(expected, actual, raw_indices[position]):
                        self._diagnostic(
                            "FORMULA_INDEX_SET_MISMATCH",
                            "error",
                            "dimension",
                            f"{code} 第 {position + 1} 维期望集合 {expected}，实际为 {actual}。",
                            node=raw_indices[position],
                            symbol_code=code,
                            expected=expected,
                            actual=actual,
                            fix_hint="修正索引顺序或 scope 的集合映射。",
                        )
            for position, item in enumerate(_subscript_items(node.slice)):
                expected_set = symbol.dimensions[position] if symbol and position < len(symbol.dimensions) else None
                self._validate_index_expression(item, aliases, expected_set)
            return
        if isinstance(node, ast.Name):
            if node.id in aliases or node.id in self.sets or node.id in ALLOWED_FUNCTIONS:
                return
            symbol = self.variables.get(node.id) or self.parameters.get(node.id)
            if symbol:
                self.references.append({"symbolCode": node.id, "kind": symbol.kind, "declaredDimensions": symbol.dimensions, "indices": [], "actualSets": []})
                if symbol.dimensions:
                    self._diagnostic("FORMULA_INDEX_REQUIRED", "error", "dimension", f"{node.id} 是 {len(symbol.dimensions)} 维对象，必须提供索引。", node=node, symbol_code=node.id, expected=symbol.dimensions)
            else:
                self._diagnostic("FORMULA_SYMBOL_UNKNOWN", "error", "symbol", f"引用对象不存在：{node.id}", node=node, symbol_code=node.id)
            return
        for child in ast.iter_child_nodes(node):
            if isinstance(node, ast.Call) and child is node.func:
                continue
            self._validate_symbols(child, aliases)

    def _validate_index_expression(self, node: ast.AST, aliases: dict[str, str], target_set: str | None = None) -> None:
        if isinstance(node, ast.Name):
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, int)):
            return
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)) and isinstance(node.left, ast.Name) and isinstance(node.right, ast.Constant) and isinstance(node.right.value, int):
            set_code = aliases.get(node.left.id)
            if not set_code:
                self._diagnostic("FORMULA_OFFSET_SCOPE_UNKNOWN", "error", "dimension", "时间偏移索引的基础别名未绑定集合。", node=node)
            elif not self._is_time_set(set_code):
                self._diagnostic("FORMULA_OFFSET_NON_TIME_INDEX", "error", "dimension", f"仅时间维度支持偏移，当前集合为 {set_code}。", node=node)
            else:
                source_values = list(self.sets.get(set_code, {}).get("values") or [])
                resolved_target = target_set or set_code
                target_values = list(self.sets.get(resolved_target, {}).get("values") or [])
                offset = int(node.right.value) * (1 if isinstance(node.op, ast.Add) else -1)
                if not source_values or not target_values:
                    self._diagnostic(
                        "FORMULA_INDEX_OFFSET_DOMAIN_UNCONFIRMED",
                        "error",
                        "dimension",
                        "缺少时间集合成员，无法证明偏移索引在全部作用域内有效。",
                        node=node,
                        actual={"source_set": set_code, "target_set": resolved_target, "offset": offset},
                        fix_hint="在模型语义中提供 time_set 与 state_time_set 的完整成员后重新编译。",
                    )
                else:
                    first_invalid: Any | None = None
                    legal: list[Any] = []
                    for value in source_values:
                        try:
                            position = target_values.index(value) + offset
                        except ValueError:
                            first_invalid = value
                            break
                        if position < 0 or position >= len(target_values):
                            first_invalid = value
                            break
                        legal.append(value)
                    if first_invalid is not None:
                        self._diagnostic(
                            "FORMULA_INDEX_OFFSET_OUT_OF_RANGE",
                            "error",
                            "dimension",
                            f"偏移 {offset:+d} 在作用域 {set_code} 中越界，首个无效索引为 {first_invalid}。",
                            node=node,
                            actual={"offset": offset, "source_set": set_code, "target_set": resolved_target, "first_out_of_range": first_invalid},
                            expected={"legal_scope_values": legal},
                            fix_hint="显式定义只包含合法时点的子集，或修正偏移和状态时间集合。",
                        )
            return
        self._diagnostic("FORMULA_INDEX_EXPRESSION_UNSUPPORTED", "error", "dimension", "索引只允许别名、常量或时间偏移 t±n。", node=node)

    def _index_set(self, node: ast.AST, aliases: dict[str, str], expected_set: str | None = None) -> str | None:
        if isinstance(node, ast.Name):
            return aliases.get(node.id) or (node.id if node.id in self.sets else None)
        if isinstance(node, ast.BinOp) and isinstance(node.left, ast.Name):
            return aliases.get(node.left.id)
        if isinstance(node, ast.Constant) and expected_set:
            values = self.sets.get(expected_set, {}).get("values") or []
            return expected_set if not values or node.value in values else None
        return None

    def _dimension_compatible(self, expected: str, actual: str, index_node: ast.AST) -> bool:
        if expected == actual:
            return True
        time = self.request.model_context.get("time_dimension") or {}
        time_set = str(time.get("time_set") or "time")
        state_set = str(time.get("state_time_set") or "state_time")
        return bool(expected == state_set and actual == time_set)

    def _is_time_set(self, code: str) -> bool:
        time = self.request.model_context.get("time_dimension") or {}
        return code in {str(time.get("time_set") or "time"), str(time.get("state_time_set") or "state_time"), "time", "time_volume"}

    def _classify(self, node: ast.AST) -> str:
        flags: set[str] = set()

        def degree(current: ast.AST) -> int:
            if isinstance(current, (ast.Constant, ast.Name, ast.Subscript)):
                code = _reference_name(current)
                return 1 if code in self.variables else 0
            if isinstance(current, ast.UnaryOp):
                return degree(current.operand)
            if isinstance(current, ast.BinOp):
                left, right = degree(current.left), degree(current.right)
                if isinstance(current.op, (ast.Add, ast.Sub)):
                    return max(left, right)
                if isinstance(current.op, ast.Mult):
                    if left and right:
                        flags.add("bilinear" if left == right == 1 else "general_nonlinear")
                    return left + right
                if isinstance(current.op, ast.Div):
                    if right:
                        flags.add("general_nonlinear")
                        return 99
                    return left
                if isinstance(current.op, ast.Pow):
                    if isinstance(current.right, ast.Constant) and current.right.value == 2 and left == 1:
                        flags.add("quadratic")
                        return 2
                    flags.add("general_nonlinear")
                    return 99
            if isinstance(current, ast.Compare):
                return max([degree(current.left), *[degree(item) for item in current.comparators]])
            if isinstance(current, ast.BoolOp):
                flags.add("logical")
                return max((degree(item) for item in current.values), default=0)
            if isinstance(current, ast.Call) and isinstance(current.func, ast.Name):
                name = current.func.id
                if name in {"abs", "min", "max", "piecewise"}:
                    flags.add("piecewise_linear")
                elif name in {"log", "exp", "sqrt"}:
                    flags.add("general_nonlinear")
                if current.args and isinstance(current.args[0], ast.GeneratorExp):
                    return degree(current.args[0].elt)
                return max((degree(arg) for arg in current.args), default=0)
            if isinstance(current, ast.GeneratorExp):
                return degree(current.elt)
            flags.add("unsupported")
            return 99

        max_degree = degree(node)
        if "unsupported" in flags:
            return "unsupported"
        if "logical" in flags:
            return "logical"
        if "general_nonlinear" in flags:
            return "general_nonlinear"
        if "piecewise_linear" in flags:
            return "piecewise_linear"
        if "bilinear" in flags:
            return "bilinear"
        if "quadratic" in flags or max_degree == 2:
            return "quadratic"
        return "linear" if max_degree == 1 else "constant"

    def _compile(self, node: ast.AST) -> dict[str, Any]:
        if self.request.formula_type == "constraint":
            if not isinstance(node, ast.Compare):
                raise FormulaFailure("FORMULA_RELATION_REQUIRED", "约束缺少关系运算符。", node)
            rows = []
            operands = [node.left, *node.comparators]
            for offset, op in enumerate(node.ops, start=1):
                if type(op) not in RELATION_NAMES:
                    raise FormulaFailure("FORMULA_RELATION_UNSUPPORTED", "关系运算符不受支持。", node)
                left = self._linear(operands[offset - 1], dict(self.aliases))
                right = self._linear(operands[offset], dict(self.aliases))
                moved = LinearExpression([*left.terms, *right.negated().terms], [])
                rhs_scalars = [*right.scalars, *left.negated().scalars]
                rows.append(
                    {
                        "source_formula_id": self.request.formula_id,
                        "split_sequence": offset,
                        "sense": RELATION_NAMES[type(op)],
                        "scope": list(self.scope),
                        "foreach": [item["set"] for item in self.scope],
                        "terms": [self._term_payload(term) for term in moved.terms],
                        "rhs": 0.0,
                        "rhs_terms": [self._scalar_payload(term) for term in rhs_scalars if term.numeric or term.factors],
                        "compile_status": "compile_valid",
                    }
                )
            return {"ast_version": AST_VERSION, "type": "constraint", "constraints": rows}
        expression = self._linear(node, dict(self.aliases))
        if expression.scalars:
            raise FormulaFailure("FORMULA_OBJECTIVE_SCALAR_TERM_UNSUPPORTED", "目标函数包含纯参数或常数项；请显式确认其结果解释语义。", node)
        for term in expression.terms:
            existing = {(item["alias"], item["set"]) for item in term.aggregate_scope}
            term.aggregate_scope = [*term.aggregate_scope, *[item for item in self.scope if (item["alias"], item["set"]) not in existing]]
        return {
            "ast_version": AST_VERSION,
            "type": "objective",
            "direction": self.request.objective_direction,
            "scope": list(self.scope),
            "terms": [self._term_payload(term) for term in expression.terms],
            "compile_status": "compile_valid",
        }

    def _linear(self, node: ast.AST, aliases: dict[str, str]) -> LinearExpression:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return LinearExpression(scalars=[ScalarTerm(float(node.value))])
        if isinstance(node, ast.Name):
            if node.id in self.variables:
                return LinearExpression(terms=[VariableTerm(node.id, [])])
            if node.id in self.parameters:
                return LinearExpression(scalars=[ScalarTerm(1.0, [ScalarFactor(node.id, [])])])
            raise FormulaFailure("FORMULA_SYMBOL_UNKNOWN", f"无法编译未知符号 {node.id}。", node, stage="symbol")
        if isinstance(node, ast.Subscript):
            code = _base_name(node.value)
            symbol = self.variables.get(code) or self.parameters.get(code)
            dimensions = symbol.dimensions if symbol else []
            indices = [self._compile_index(item, aliases, dimensions[position] if position < len(dimensions) else None) for position, item in enumerate(_subscript_items(node.slice))]
            if code in self.variables:
                return LinearExpression(terms=[VariableTerm(code, indices)])
            if code in self.parameters:
                return LinearExpression(scalars=[ScalarTerm(1.0, [ScalarFactor(code, indices)])])
            raise FormulaFailure("FORMULA_SYMBOL_UNKNOWN", f"无法编译未知符号 {code}。", node, stage="symbol")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = self._linear(node.operand, aliases)
            return value.negated() if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
            left, right = self._linear(node.left, aliases), self._linear(node.right, aliases)
            if isinstance(node.op, ast.Sub):
                right = right.negated()
            return LinearExpression([*left.terms, *right.terms], [*left.scalars, *right.scalars])
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            left, right = self._linear(node.left, aliases), self._linear(node.right, aliases)
            if left.terms and right.terms:
                raise FormulaFailure("FORMULA_VARIABLE_PRODUCT", "变量乘变量不能直接进入线性 Builder。", node, fix_hint="使用 McCormick（需有限上下界）或选择 NLP。")
            return self._multiply(left, right, node)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            numerator, denominator = self._linear(node.left, aliases), self._linear(node.right, aliases)
            if denominator.terms or len(denominator.scalars) != 1:
                raise FormulaFailure("FORMULA_VARIABLE_DENOMINATOR", "分母必须是单个运行前已知的常数或参数乘积。", node.right)
            divisor = denominator.scalars[0]
            if divisor.numeric == 0:
                raise FormulaFailure("FORMULA_DIVISION_BY_ZERO", "分母不能为 0。", node.right)
            for factor in divisor.factors:
                metadata = self.parameters[factor.parameter].metadata
                nonzero_proven, positive_proven = _denominator_contract(metadata)
                if not nonzero_proven:
                    raise FormulaFailure(
                        "FORMULA_DENOMINATOR_NONZERO_UNCONFIRMED",
                        f"分母参数 {factor.parameter} 缺少可证明的非零契约。",
                        node.right,
                        fix_hint="声明 fixed_value!=0、min_value>0、max_value<0、nonzero/positive/negative=true，或提供全部非零的 allowed_values。默认值不能作为安全证明。",
                    )
                if metadata.get("denominator_positive_required") and not positive_proven:
                    raise FormulaFailure(
                        "FORMULA_DENOMINATOR_POSITIVITY_UNCONFIRMED",
                        f"分母参数 {factor.parameter} 的当前场景要求正值，但契约只能证明非零。",
                        node.right,
                        fix_hint="声明 positive=true 或 min_value>0。",
                    )
            inverse = ScalarTerm(1.0 / divisor.numeric, [ScalarFactor(item.parameter, item.indices, -item.power) for item in divisor.factors])
            return self._scale(numerator, inverse)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "sum":
            if len(node.args) != 1 or not isinstance(node.args[0], ast.GeneratorExp):
                raise FormulaFailure("FORMULA_AGGREGATE_INVALID", "sum 必须使用生成式。", node)
            generator = node.args[0]
            local = dict(aliases)
            scopes: list[dict[str, str]] = []
            for comp in generator.generators:
                if comp.ifs:
                    raise FormulaFailure("FORMULA_CONDITIONAL_AGGREGATE_UNSUPPORTED", "条件聚合尚未支持。", comp)
                if not isinstance(comp.target, ast.Name) or not isinstance(comp.iter, ast.Name):
                    raise FormulaFailure("FORMULA_AGGREGATE_SCOPE_INVALID", "聚合必须写成 for alias in set。", comp)
                local[comp.target.id] = comp.iter.id
                scopes.append({"alias": comp.target.id, "set": comp.iter.id})
            result = self._linear(generator.elt, local)
            for term in result.terms:
                term.aggregate_scope = [*term.aggregate_scope, *scopes]
            if result.scalars:
                raise FormulaFailure("FORMULA_SCALAR_AGGREGATE_UNSUPPORTED", "当前线性产物不支持纯参数聚合项。", node)
            return result
        raise FormulaFailure("FORMULA_NODE_UNSUPPORTED", f"节点无法编译：{type(node).__name__}", node)

    def _multiply(self, left: LinearExpression, right: LinearExpression, node: ast.AST) -> LinearExpression:
        if left.terms:
            if not right.scalars:
                raise FormulaFailure("FORMULA_EMPTY_COEFFICIENT", "变量项缺少有效系数。", node)
            return LinearExpression([term.scaled(scalar) for term in left.terms for scalar in right.scalars], [a.multiplied(b) for a in left.scalars for b in right.scalars])
        if right.terms:
            if not left.scalars:
                raise FormulaFailure("FORMULA_EMPTY_COEFFICIENT", "变量项缺少有效系数。", node)
            return LinearExpression([term.scaled(scalar) for term in right.terms for scalar in left.scalars], [a.multiplied(b) for a in left.scalars for b in right.scalars])
        return LinearExpression(scalars=[a.multiplied(b) for a in left.scalars for b in right.scalars])

    def _scale(self, value: LinearExpression, scalar: ScalarTerm) -> LinearExpression:
        return LinearExpression([term.scaled(scalar) for term in value.terms], [term.multiplied(scalar) for term in value.scalars])

    def _compile_index(self, node: ast.AST, aliases: dict[str, str], target_set: str | None = None) -> Any:
        if isinstance(node, ast.Name):
            return aliases.get(node.id, node.id)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, str)):
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.left, ast.Name) and isinstance(node.right, ast.Constant) and isinstance(node.right.value, int) and isinstance(node.op, (ast.Add, ast.Sub)):
            source_set = aliases.get(node.left.id, node.left.id)
            return {"type": "index_offset", "set": source_set, "target_set": target_set or source_set, "offset": node.right.value if isinstance(node.op, ast.Add) else -node.right.value}
        raise FormulaFailure("FORMULA_INDEX_EXPRESSION_UNSUPPORTED", "索引表达式无法编译。", node, stage="dimension")

    def _term_payload(self, term: VariableTerm) -> dict[str, Any]:
        coefficient = self._scalar_payload(term.coefficient)
        payload: dict[str, Any] = {
            "var": term.variable,
            "key": term.indices,
            "coefficient": coefficient,
            "coef": coefficient["numeric"],
        }
        if term.aggregate_scope:
            payload["aggregate_scope"] = term.aggregate_scope
            payload["foreach"] = [item["set"] for item in term.aggregate_scope]
        factors = coefficient["factors"]
        if len(factors) == 1 and factors[0]["power"] == 1:
            payload["coef_param"] = factors[0]["parameter"]
            payload["param_key"] = factors[0]["indices"]
        elif factors:
            payload["coef_factors"] = factors
        return payload

    def _scalar_payload(self, term: ScalarTerm) -> dict[str, Any]:
        return {
            "numeric": term.numeric,
            "factors": [{"parameter": item.parameter, "indices": item.indices, "power": item.power} for item in term.factors],
        }

    def _validate_units(self, node: ast.AST, aliases: dict[str, str]) -> dict[str, float]:
        # Conservative unit check: unknown/blank units stay compatible; known additive
        # operands and both sides of relations must match exactly.
        if isinstance(node, (ast.Name, ast.Subscript)):
            symbol = self.variables.get(_reference_name(node)) or self.parameters.get(_reference_name(node))
            return _parse_unit(symbol.unit if symbol else "")
        if isinstance(node, ast.Constant):
            return {}
        if isinstance(node, ast.UnaryOp):
            return self._validate_units(node.operand, aliases)
        if isinstance(node, ast.BinOp):
            left, right = self._validate_units(node.left, aliases), self._validate_units(node.right, aliases)
            if isinstance(node.op, (ast.Add, ast.Sub)):
                self._require_same_unit(left, right, node)
                return left or right
            if isinstance(node.op, ast.Mult):
                return _combine_units(left, right, 1)
            if isinstance(node.op, ast.Div):
                return _combine_units(left, right, -1)
            if isinstance(node.op, ast.Pow):
                if isinstance(node.right, ast.Constant) and isinstance(node.right.value, (int, float)):
                    return {key: value * float(node.right.value) for key, value in left.items()}
                return left
        if isinstance(node, ast.Compare):
            units = [self._validate_units(node.left, aliases), *[self._validate_units(item, aliases) for item in node.comparators]]
            for left, right in zip(units, units[1:]):
                self._require_same_unit(left, right, node)
            return {}
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.args and isinstance(node.args[0], ast.GeneratorExp):
                return self._validate_units(node.args[0].elt, aliases)
            units = [self._validate_units(item, aliases) for item in node.args]
            if node.func.id in {"min", "max"}:
                for left, right in zip(units, units[1:]):
                    self._require_same_unit(left, right, node)
            if node.func.id in {"log", "exp"} and any(bool(item) for item in units):
                self._diagnostic("FORMULA_FUNCTION_REQUIRES_DIMENSIONLESS", "error", "unit", f"{node.func.id} 的输入必须无量纲。", node=node, actual=units)
            return units[0] if units and node.func.id in {"sum", "min", "max", "abs", "sqrt"} else {}
        return {}

    def _require_same_unit(self, left: dict[str, float], right: dict[str, float], node: ast.AST) -> None:
        if left and right and left != right:
            self._diagnostic("FORMULA_UNIT_MISMATCH", "error", "unit", f"单位不一致：{_format_unit(left)} 与 {_format_unit(right)}。", node=node, expected=_format_unit(left), actual=_format_unit(right), fix_hint="补充单位换算参数或修正公式对象。")

    def _estimate_expansion(self, fragment: dict[str, Any] | None) -> dict[str, Any]:
        constraint_count = 0
        term_count = 0
        if fragment and fragment.get("type") == "constraint":
            for row in fragment.get("constraints") or []:
                multiplier = _scope_size(row.get("scope") or [], self.sets)
                constraint_count += multiplier
                for term in row.get("terms") or []:
                    term_count += multiplier * _scope_size(term.get("aggregate_scope") or [], self.sets)
        elif fragment:
            for term in fragment.get("terms") or []:
                term_count += _scope_size(term.get("aggregate_scope") or [], self.sets)
        return {"constraint_count": constraint_count, "term_count": term_count, "exact": all(bool(meta.get("values")) for meta in self.sets.values())}

    def _expansion_preview(self, fragment: dict[str, Any]) -> list[dict[str, Any]]:
        preview = []
        for row in (fragment.get("constraints") or [])[:20]:
            preview.append({"source_formula_id": row.get("source_formula_id"), "split_sequence": row.get("split_sequence"), "scope": row.get("scope"), "sense": row.get("sense"), "term_count": len(row.get("terms") or [])})
        return preview

    def _result(
        self,
        tree: ast.Expression | None,
        compiled_fragment: dict[str, Any] | None,
        expression_class: str,
        compile_requested: bool,
        normalized: str = "",
        capability: dict[str, Any] | None = None,
        estimated: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        syntax_ok = not self._has_errors(stages={"syntax"})
        semantic_ok = not self._has_errors(stages={"symbol", "dimension", "unit"})
        compile_ok = bool(compiled_fragment) if compile_requested and self.request.participation == "solve_active" else None
        status = "preview_only" if self.request.participation == "preview_only" else "compile_valid" if compile_ok else "compile_failed" if compile_requested else "semantic_valid" if semantic_ok else "syntax_valid" if syntax_ok else "draft"
        return {
            "success": not self._has_errors(),
            "ast_version": AST_VERSION,
            "compiler_version": COMPILER_VERSION,
            "ast": _serialize_ast(tree.body, self.source) if tree else None,
            "normalized_expression": normalized,
            "expression_class": expression_class,
            "capability": capability or _capability(expression_class),
            "diagnostics": self.diagnostics,
            "references": _dedupe_dicts(self.references),
            "scope": self.scope,
            "participation": self.request.participation,
            "compiled_fragment": compiled_fragment,
            "estimated_expansion": estimated or {"constraint_count": 0, "term_count": 0, "exact": False},
            "status": status,
            "checks": {
                "syntax": "passed" if syntax_ok else "failed",
                "symbol_dimension_unit": "passed" if semantic_ok else "failed",
                "classification": expression_class,
                "compile": "not_applicable" if self.request.participation == "preview_only" else "passed" if compile_ok else "failed" if compile_requested else "not_run",
            },
        }

    def _has_errors(self, stages: set[str] | None = None) -> bool:
        return any(item["severity"] == "error" and (stages is None or item["stage"] in stages) for item in self.diagnostics)

    def _diagnostic(
        self,
        code: str,
        severity: str,
        stage: str,
        message: str,
        *,
        node: ast.AST | None = None,
        start: int | None = None,
        end: int | None = None,
        symbol_code: str | None = None,
        expected: Any = None,
        actual: Any = None,
        fix_hint: str = "",
    ) -> None:
        node_start, node_end = _span(node, self.source) if node is not None else (0, 0)
        item = {
            "code": code,
            "severity": severity,
            "stage": stage,
            "message": message,
            "start": node_start if start is None else start,
            "end": node_end if end is None else end,
        }
        if symbol_code:
            item["symbolCode"] = symbol_code
        if expected is not None:
            item["expected"] = expected
        if actual is not None:
            item["actual"] = actual
        if fix_hint:
            item["fixHint"] = fix_hint
        if item not in self.diagnostics:
            self.diagnostics.append(item)


def analyze_formula(request: FormulaAnalyzeRequest, *, compile_requested: bool = True, expand_requested: bool = False) -> dict[str, Any]:
    return FormulaAnalyzer(request).run(compile_requested=compile_requested, expand_requested=expand_requested)


def _normalize_sets(raw: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if isinstance(raw, dict):
        rows: Iterable[tuple[str, Any]] = raw.items()
    elif isinstance(raw, list):
        rows = ((str(item.get("code") or item.get("name") or item.get("key") or ""), item) for item in raw if isinstance(item, dict))
    else:
        rows = []
    for code, value in rows:
        if not code:
            continue
        if isinstance(value, dict):
            result[code] = {**value, "values": list(value.get("values") or value.get("members") or [])}
        elif isinstance(value, list):
            result[code] = {"values": value}
        else:
            result[code] = {"values": []}
    return result


def _normalize_symbols(raw: Any, kind: str) -> dict[str, Symbol]:
    result: dict[str, Symbol] = {}
    if isinstance(raw, dict):
        rows: Iterable[tuple[str, Any]] = raw.items()
    elif isinstance(raw, list):
        rows = ((str(item.get("code") or item.get("name") or item.get("key") or item.get("math_param") or ""), item) for item in raw if isinstance(item, dict))
    else:
        rows = []
    for code, value in rows:
        if not code:
            continue
        metadata = value if isinstance(value, dict) else {}
        dimensions = list(metadata.get("dimensions") or metadata.get("dimension") or metadata.get("indices") or metadata.get("index_sets") or [])
        result[code] = Symbol(code, kind, [str(item) for item in dimensions], str(metadata.get("unit") or ""), dict(metadata))
    return result


def _denominator_contract(metadata: dict[str, Any]) -> tuple[bool, bool]:
    validation = metadata.get("validation") if isinstance(metadata.get("validation"), dict) else {}
    fixed = metadata.get("fixed_value")
    minimum = metadata.get("min_value", validation.get("min", validation.get("minimum")))
    maximum = metadata.get("max_value", validation.get("max", validation.get("maximum")))
    allowed = metadata.get("allowed_values")
    positive = metadata.get("positive") is True or (isinstance(minimum, (int, float)) and minimum > 0)
    negative = metadata.get("negative") is True or (isinstance(maximum, (int, float)) and maximum < 0)
    fixed_nonzero = isinstance(fixed, (int, float)) and not isinstance(fixed, bool) and fixed != 0
    allowed_nonzero = isinstance(allowed, list) and bool(allowed) and all(
        isinstance(value, (int, float)) and not isinstance(value, bool) and value != 0 for value in allowed
    )
    nonzero = metadata.get("nonzero") is True or positive or negative or fixed_nonzero or allowed_nonzero
    return nonzero, positive or (isinstance(fixed, (int, float)) and fixed > 0) or (
        isinstance(allowed, list) and bool(allowed) and all(isinstance(value, (int, float)) and value > 0 for value in allowed)
    )


def _serialize_ast(node: ast.AST, source: str) -> dict[str, Any]:
    start, end = _span(node, source)
    base: dict[str, Any] = {"start": start, "end": end}
    if isinstance(node, ast.Constant):
        base.update({"type": "BooleanLiteral" if isinstance(node.value, bool) else "NumberLiteral" if isinstance(node.value, (int, float)) else "Literal", "value": node.value})
    elif isinstance(node, ast.Name):
        base.update({"type": "SymbolReference", "name": node.id})
    elif isinstance(node, ast.Subscript):
        base.update({"type": "IndexedReference", "name": _base_name(node.value), "indices": [_serialize_ast(item, source) for item in _subscript_items(node.slice)]})
    elif isinstance(node, ast.UnaryOp):
        base.update({"type": "UnaryExpression", "operator": "-" if isinstance(node.op, ast.USub) else "+", "operand": _serialize_ast(node.operand, source)})
    elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)) and isinstance(node.left, ast.Name) and isinstance(node.right, ast.Constant) and isinstance(node.right.value, int):
        base.update({"type": "IndexOffsetExpression", "base": node.left.id, "offset": node.right.value if isinstance(node.op, ast.Add) else -node.right.value})
    elif isinstance(node, ast.BinOp):
        base.update({"type": "BinaryExpression", "operator": ARITHMETIC_NAMES.get(type(node.op), type(node.op).__name__), "left": _serialize_ast(node.left, source), "right": _serialize_ast(node.right, source)})
    elif isinstance(node, ast.Compare):
        base.update({"type": "ComparisonExpression", "operands": [_serialize_ast(node.left, source), *[_serialize_ast(item, source) for item in node.comparators]], "operators": [RELATION_NAMES.get(type(item), type(item).__name__) for item in node.ops]})
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.args and isinstance(node.args[0], ast.GeneratorExp):
        gen = node.args[0]
        base.update({"type": "AggregateExpression", "function": node.func.id, "body": _serialize_ast(gen.elt, source), "generators": [{"alias": comp.target.id if isinstance(comp.target, ast.Name) else _safe_unparse(comp.target), "set": comp.iter.id if isinstance(comp.iter, ast.Name) else _safe_unparse(comp.iter), "conditional": bool(comp.ifs)} for comp in gen.generators]})
    elif isinstance(node, ast.Call):
        base.update({"type": "FunctionCall", "function": _safe_unparse(node.func), "arguments": [_serialize_ast(item, source) for item in node.args]})
    elif isinstance(node, ast.Tuple):
        base.update({"type": "Tuple", "items": [_serialize_ast(item, source) for item in node.elts]})
    else:
        base.update({"type": type(node).__name__, "source": _safe_unparse(node)})
    return base


def _span(node: ast.AST | None, source: str) -> tuple[int, int]:
    if node is None or not hasattr(node, "lineno"):
        return 0, 0
    start = _line_col_to_offset(source, int(getattr(node, "lineno", 1)), int(getattr(node, "col_offset", 0)))
    end = _line_col_to_offset(source, int(getattr(node, "end_lineno", getattr(node, "lineno", 1))), int(getattr(node, "end_col_offset", getattr(node, "col_offset", 0))))
    return start, end


def _line_col_to_offset(source: str, line: int, column: int) -> int:
    lines = source.splitlines(keepends=True)
    return min(sum(len(item) for item in lines[: max(line - 1, 0)]) + column, len(source))


def _subscript_items(node: ast.AST) -> list[ast.AST]:
    return list(node.elts) if isinstance(node, ast.Tuple) else [node]


def _base_name(node: ast.AST) -> str:
    return node.id if isinstance(node, ast.Name) else _safe_unparse(node)


def _reference_name(node: ast.AST) -> str:
    return node.id if isinstance(node, ast.Name) else _base_name(node.value) if isinstance(node, ast.Subscript) else ""


def _safe_unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return type(node).__name__


def _scope_size(scope: list[dict[str, str]], sets: dict[str, dict[str, Any]]) -> int:
    result = 1
    for item in scope:
        values = sets.get(str(item.get("set")), {}).get("values") or []
        result *= len(values) if values else 1
    return result


def _max_ast_depth(node: ast.AST) -> int:
    children = list(ast.iter_child_nodes(node))
    return 1 if not children else 1 + max(_max_ast_depth(child) for child in children)


def _max_aggregate_depth(node: ast.AST, current: int = 0) -> int:
    is_aggregate = (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"sum", "min", "max"}
        and bool(node.args)
        and isinstance(node.args[0], ast.GeneratorExp)
    )
    next_depth = current + 1 if is_aggregate else current
    children = list(ast.iter_child_nodes(node))
    return next_depth if not children else max(next_depth, *(_max_aggregate_depth(child, next_depth) for child in children))


def _parse_unit(unit: str) -> dict[str, float]:
    text = unit.strip().replace("·", "*").replace(" ", "")
    if not text or text.lower() in {"1", "pu", "%", "percent", "dimensionless"}:
        return {}
    aliases = {"MWh": {"MW": 1.0, "h": 1.0}, "kWh": {"kW": 1.0, "h": 1.0}}
    if text in aliases:
        return aliases[text]
    result: dict[str, float] = {}
    numerator, *denominators = text.split("/")
    for token in filter(None, numerator.split("*")):
        if token in aliases:
            result = _combine_units(result, aliases[token], 1)
        else:
            result[token] = result.get(token, 0.0) + 1.0
    for section in denominators:
        for token in filter(None, section.split("*")):
            if token in aliases:
                result = _combine_units(result, aliases[token], -1)
            else:
                result[token] = result.get(token, 0.0) - 1.0
    return {key: value for key, value in result.items() if value}


def _combine_units(left: dict[str, float], right: dict[str, float], sign: int) -> dict[str, float]:
    result = dict(left)
    for key, value in right.items():
        result[key] = result.get(key, 0.0) + sign * value
        if result[key] == 0:
            result.pop(key)
    return result


def _format_unit(unit: dict[str, float]) -> str:
    if not unit:
        return "1"
    return "*".join(key if power == 1 else f"{key}^{power:g}" for key, power in sorted(unit.items()))


def _capability(expression_class: str) -> dict[str, Any]:
    direct = expression_class in {"constant", "linear"}
    recommendation: dict[str, Any] | None = None
    if expression_class == "bilinear":
        recommendation = {"type": "mccormick", "required_bounds": "all involved variables"}
    elif expression_class == "piecewise_linear":
        recommendation = {"type": "pwl_component"}
    elif expression_class in {"quadratic", "general_nonlinear"}:
        recommendation = {"type": "qp_or_nlp_solver" if expression_class == "quadratic" else "nlp_solver"}
    return {"direct_builder": "LP Builder" if direct else None, "requires": recommendation, "supported": direct, "recommended_transformation": recommendation}


def _recommendation_text(recommendation: Any) -> str:
    if not recommendation:
        return "改写为受支持的线性表达式。"
    kind = recommendation.get("type") if isinstance(recommendation, dict) else recommendation
    return f"建议使用 {kind}，不要自动改写原公式语义。"


def _dedupe_dicts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result = []
    for row in rows:
        key = repr(sorted(row.items()))
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result
