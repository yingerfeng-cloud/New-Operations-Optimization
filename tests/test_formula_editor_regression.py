"""
公式编辑器回归测试 — 覆盖任务清单中全部 Bug 修复项与迭代功能。

测试分组：
  A. 后端 P0 — ALLOWED_FUNCTIONS / AST 求值（BUG-01/02）
  B. 后端 P0 — abs / min / max Pyomo 编译（BUG-01）
  C. 后端 P0 — ** 2 / ** n Pyomo 编译（BUG-02）
  D. 后端科学函数 — log / exp / sqrt 验证与编译（ITER-01/15）
  E. 后端 expression_class 分类（ITER-02/16）
  F. 后端 NLP/MINLP solver 路由警告（ITER-03/17）
  G. 前端 DSL 解析 — ** n square token（BUG-04）
  H. 前端 DSL 解析 — 多维聚合（BUG-05）
  I. 前端 DSL 解析 — 复合约束（BUG-06）
  J. 前端搜索框只重绘符号面板（BUG-07）
  K. 前端 Backspace 按 selectedTokenIndex 删除（BUG-08）
  L. 前端 knownAliases 扩展（BUG-09）
  M. 前端数字 token 0. 正则（BUG-11）
  N. 前端 Scientific 函数分组（ITER-01）
  O. 前端 formulaExpressionClass 分类器（ITER-02）
  P. 前端约束类型提示卡（ITER-04）
  Q. 仍未修复项（BUG-03/10/12）— 记录预期失败
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pyomo.environ as pyo
import pytest

# ---------------------------------------------------------------------------
# 源码加载
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
FORMULA_JS = (ROOT / "static" / "js" / "platform-formula-editor.js").read_text(encoding="utf-8")

from app.model_components.formula_components import (
    ALLOWED_FUNCTIONS,
    ARITHMETIC_OPS,
    SCIENTIFIC_FUNCTIONS,
    DynamicFormulaComponent,
    validate_component_definition,
    validate_formula_expression,
)
from app.problem_type_diagnosis import component_problem_type_fields


# ===========================================================================
# A. 后端白名单 —— BUG-01 / BUG-02
# ===========================================================================

class TestBackendAllowedFunctions:
    def test_abs_in_allowed_functions(self):
        assert "abs" in ALLOWED_FUNCTIONS, "abs 未在 ALLOWED_FUNCTIONS 白名单"

    def test_min_in_allowed_functions(self):
        assert "min" in ALLOWED_FUNCTIONS, "min 未在 ALLOWED_FUNCTIONS 白名单"

    def test_max_in_allowed_functions(self):
        assert "max" in ALLOWED_FUNCTIONS, "max 未在 ALLOWED_FUNCTIONS 白名单"

    def test_log_in_allowed_functions(self):
        assert "log" in ALLOWED_FUNCTIONS, "log 未在 ALLOWED_FUNCTIONS 白名单"

    def test_exp_in_allowed_functions(self):
        assert "exp" in ALLOWED_FUNCTIONS, "exp 未在 ALLOWED_FUNCTIONS 白名单"

    def test_sqrt_in_allowed_functions(self):
        assert "sqrt" in ALLOWED_FUNCTIONS, "sqrt 未在 ALLOWED_FUNCTIONS 白名单"

    def test_pow_in_arithmetic_ops(self):
        assert ast.Pow in ARITHMETIC_OPS, "ast.Pow 未在 ARITHMETIC_OPS，** 运算将被拒绝"

    def test_scientific_functions_constant(self):
        assert SCIENTIFIC_FUNCTIONS >= {"log", "exp", "sqrt"}, \
            "SCIENTIFIC_FUNCTIONS 常量缺少 log / exp / sqrt"


# ===========================================================================
# B. abs / min / max 端到端验证 + Pyomo 编译 —— BUG-01
# ===========================================================================

def _make_component(expression: str, constraint: bool = True) -> dict:
    """构造最小化组件定义，方便重用。"""
    sets = [{"code": "time", "name": "时段", "values": [0, 1, 2]}]
    variables = [{"code": "deviation", "name": "偏差", "indices": ["time"], "domain": "Reals"}]
    if constraint:
        return {
            "component_id": "test_comp",
            "sets": sets,
            "variables": variables,
            "parameters": [],
            "constraints": [{"constraint_id": "c1", "expression": expression, "indices": ["time"]}],
            "objective_terms": [],
        }
    return {
        "component_id": "test_comp",
        "sets": sets,
        "variables": variables,
        "parameters": [],
        "constraints": [],
        "objective_terms": [{"term_id": "obj1", "expression": expression}],
    }


class TestAbsMinMaxCompile:
    def test_abs_validate_passes(self):
        syms = {"sets": set(), "parameters": set(), "variables": {"deviation"}, "indices": {"t", "time"}}
        errors = validate_formula_expression("abs(deviation[t]) >= 0", syms)
        assert not errors, f"abs 验证失败：{errors}"

    def test_min_validate_passes(self):
        syms = {"sets": {"time"}, "parameters": set(), "variables": {"deviation"}, "indices": {"t", "time"}}
        errors = validate_formula_expression("min(deviation[t] for t in time) >= -100", syms)
        assert not errors, f"min 验证失败：{errors}"

    def test_max_validate_passes(self):
        syms = {"sets": {"time"}, "parameters": set(), "variables": {"deviation"}, "indices": {"t", "time"}}
        errors = validate_formula_expression("max(deviation[t] for t in time) <= 100", syms)
        assert not errors, f"max 验证失败：{errors}"

    def test_abs_component_compiles(self):
        comp = _make_component("abs(deviation[t]) >= 0")
        result = validate_component_definition(comp)
        assert result["valid"], f"abs 组件编译失败：{result['errors']}"

    def test_min_component_compiles(self):
        comp = _make_component("min(deviation[t] for t in time) >= -100")
        result = validate_component_definition(comp)
        assert result["valid"], f"min 组件编译失败：{result['errors']}"

    def test_max_component_compiles(self):
        comp = _make_component("max(deviation[t] for t in time) <= 100")
        result = validate_component_definition(comp)
        assert result["valid"], f"max 组件编译失败：{result['errors']}"


# ===========================================================================
# C. ** 2 / ** n Pyomo 编译 —— BUG-02
# ===========================================================================

class TestPowerCompile:
    def test_pow2_validate_passes(self):
        syms = {"sets": set(), "parameters": set(), "variables": {"deviation"}, "indices": {"t", "time"}}
        errors = validate_formula_expression("(deviation[t]) ** 2 <= 100", syms)
        assert not errors, f"** 2 验证失败：{errors}"

    def test_pow2_component_compiles(self):
        comp = _make_component("(deviation[t]) ** 2 <= 10000")
        result = validate_component_definition(comp)
        assert result["valid"], f"** 2 组件编译失败：{result['errors']}"

    def test_pow3_component_compiles(self):
        comp = _make_component("(deviation[t]) ** 3 <= 10000")
        result = validate_component_definition(comp)
        assert result["valid"], f"** 3 组件编译失败：{result['errors']}"

    def test_pyomo_pow_eval_correct(self):
        """_eval_formula_node 对 BinOp(Pow) 的数值计算正确。"""
        from app.model_components.formula_components import _eval_formula_node
        tree = ast.parse("2 ** 3", mode="eval")
        result = _eval_formula_node(tree.body, None, {"runtime_parameters": {}, "sets": {}, "variables": {}}, {})
        assert result == 8, f"2 ** 3 期望 8，实际 {result}"


# ===========================================================================
# D. 科学函数 log / exp / sqrt 验证 + 编译 —— ITER-01 / ITER-15
# ===========================================================================

class TestScientificFunctions:
    def _syms(self):
        return {"sets": set(), "parameters": set(), "variables": {"deviation"}, "indices": {"t", "time"}}

    def test_log_validate_passes(self):
        errors = validate_formula_expression("log(deviation[t] + 1) <= 10", self._syms())
        assert not errors, f"log 验证失败：{errors}"

    def test_exp_validate_passes(self):
        errors = validate_formula_expression("exp(deviation[t]) <= 100", self._syms())
        assert not errors, f"exp 验证失败：{errors}"

    def test_sqrt_validate_passes(self):
        errors = validate_formula_expression("sqrt(deviation[t] + 1) <= 10", self._syms())
        assert not errors, f"sqrt 验证失败：{errors}"

    def test_log_component_compiles(self):
        comp = _make_component("log(deviation[t] + 1) <= 10")
        result = validate_component_definition(comp)
        assert result["valid"], f"log 组件编译失败：{result['errors']}"

    def test_exp_component_compiles(self):
        comp = _make_component("exp(deviation[t]) <= 100")
        result = validate_component_definition(comp)
        assert result["valid"], f"exp 组件编译失败：{result['errors']}"

    def test_sqrt_component_compiles(self):
        comp = _make_component("sqrt(deviation[t] + 1) <= 10")
        result = validate_component_definition(comp)
        assert result["valid"], f"sqrt 组件编译失败：{result['errors']}"

    def test_pyomo_log_eval(self):
        from app.model_components.formula_components import _eval_formula_node
        import math
        tree = ast.parse("log(1)", mode="eval")
        result = _eval_formula_node(tree.body, None, {"runtime_parameters": {}, "sets": {}, "variables": {}}, {})
        assert abs(float(pyo.value(result)) - 0.0) < 1e-9

    def test_pyomo_sqrt_eval(self):
        from app.model_components.formula_components import _eval_formula_node
        tree = ast.parse("sqrt(4)", mode="eval")
        result = _eval_formula_node(tree.body, None, {"runtime_parameters": {}, "sets": {}, "variables": {}}, {})
        assert abs(float(pyo.value(result)) - 2.0) < 1e-9


# ===========================================================================
# E. expression_class 分类 —— ITER-02 / ITER-16
# ===========================================================================

class TestExpressionClassDiagnosis:
    def _fields(self, expression: str, has_integer: bool = False) -> dict:
        variables = [{"code": "deviation", "indices": ["time"], "domain": "Binary" if has_integer else "Reals"}]
        return component_problem_type_fields({
            "variables": variables,
            "constraints": [{"expression": expression, "indices": ["time"], "participates_in_solve": True}],
            "objective_terms": [],
        })

    def test_linear_is_lp(self):
        fields = self._fields("deviation[t] <= 100")
        assert fields["expression_class"] == "linear", f"线性约束应为 linear，实际：{fields['expression_class']}"

    def test_pow2_is_quadratic(self):
        fields = self._fields("(deviation[t]) ** 2 <= 100")
        assert fields["expression_class"] == "quadratic", f"二次约束应为 quadratic，实际：{fields['expression_class']}"

    def test_log_is_nonlinear(self):
        fields = self._fields("log(deviation[t] + 1) <= 10")
        assert fields["expression_class"] == "nonlinear", f"log 约束应为 nonlinear，实际：{fields['expression_class']}"

    def test_exp_is_nonlinear(self):
        fields = self._fields("exp(deviation[t]) <= 100")
        assert fields["expression_class"] == "nonlinear", f"exp 约束应为 nonlinear，实际：{fields['expression_class']}"

    def test_sqrt_is_nonlinear(self):
        fields = self._fields("sqrt(deviation[t] + 1) <= 10")
        assert fields["expression_class"] == "nonlinear", f"sqrt 约束应为 nonlinear，实际：{fields['expression_class']}"

    def test_integer_nlp_infers_minlp(self):
        fields = self._fields("log(deviation[t] + 1) <= 10", has_integer=True)
        inferred = fields.get("problem_type") or fields.get("problem_types", [""])[0]
        assert "MINLP" in str(inferred).upper() or "NLP" in str(inferred).upper(), \
            f"含整数+非线性应推断 MINLP/NLP，实际：{inferred}"


# ===========================================================================
# F. NLP/MINLP solver 路由 —— ITER-03 / ITER-17
# ===========================================================================

class TestNlpSolverRoute:
    # _build_sets 要求 time 集合通过 runtime_parameters["time"] 或 ["horizon"] 传入
    _RUNTIME_BASE = {"solver": "highs", "time": [0, 1]}

    def test_nlp_solver_route_warning_recorded(self):
        from app.builders.component_model_builder import ComponentModelBuilder
        model_spec = {
            "model_code": "nlp_test",
            "sets": [{"code": "time"}],
            "variables": [{"code": "deviation", "name": "偏差", "indices": ["time"], "domain": "Reals"}],
            "components": [],
            "objective": {},
            "required_solver_capabilities": ["NLP"],
        }
        runtime = {**self._RUNTIME_BASE}
        _, info = ComponentModelBuilder().build(model_spec, runtime)
        warnings = info.get("metadata", {}).get("solver_route_warnings", [])
        assert warnings, "NLP 模型使用 HiGHS 时应记录 solver_route_warning"

    def test_lp_solver_no_warning(self):
        from app.builders.component_model_builder import ComponentModelBuilder
        model_spec = {
            "model_code": "lp_test",
            "sets": [{"code": "time"}],
            "variables": [{"code": "deviation", "name": "偏差", "indices": ["time"], "domain": "Reals"}],
            "components": [],
            "objective": {},
            "required_solver_capabilities": ["LP"],
        }
        runtime = {**self._RUNTIME_BASE}
        _, info = ComponentModelBuilder().build(model_spec, runtime)
        warnings = info.get("metadata", {}).get("solver_route_warnings", [])
        assert not warnings, f"LP 模型不应有 solver_route_warning，实际：{warnings}"


# ===========================================================================
# G. 前端 ** n → square/power token —— BUG-04
# ===========================================================================

def _js_has(pattern: str) -> bool:
    return bool(re.search(pattern, FORMULA_JS))


class TestFrontendPowerParsing:
    def test_power_match_logic_exists(self):
        assert "powerMatch" in FORMULA_JS, "parseDslLinearTokens 中缺少 powerMatch 逻辑"

    def test_power_match_regex_covers_double_star(self):
        body = FORMULA_JS[FORMULA_JS.find("powerMatch"):][:300]
        assert r"\*\*" in body, "powerMatch 正则应匹配 **"

    def test_formula_power_token_function_exists(self):
        assert "function formulaPowerToken" in FORMULA_JS, "缺少 formulaPowerToken 函数"

    def test_square_vs_power_branching(self):
        pm_start = FORMULA_JS.find("powerMatch")
        pm_end = FORMULA_JS.find("continue;", pm_start) + 10  # 整段 powerMatch 逻辑直到 continue
        body = FORMULA_JS[pm_start:pm_end]
        assert "formulaSquareToken" in body, \
            "** 2 应分支到 formulaSquareToken（powerMatch 逻辑段内）"


# ===========================================================================
# H. 前端多维聚合解析 —— BUG-05
# ===========================================================================

class TestFrontendMultiDimAggregate:
    def test_parse_aggregate_loops_function_exists(self):
        assert "function parseAggregateLoops" in FORMULA_JS, "缺少 parseAggregateLoops 函数"

    def test_aggregate_token_from_parsed_function_exists(self):
        assert "function aggregateTokenFromParsed" in FORMULA_JS, "缺少 aggregateTokenFromParsed 函数"

    def test_aggregate_loops_regex_is_global(self):
        body = FORMULA_JS[FORMULA_JS.find("function parseAggregateLoops"):][:300]
        assert "/g" in body, "parseAggregateLoops 中 for...in 匹配正则应为全局 /g"

    def test_aggregate_token_from_parsed_builds_nested(self):
        body = FORMULA_JS[FORMULA_JS.find("function aggregateTokenFromParsed"):][:500]
        assert "loops.length - 1" in body or "index >= 0" in body, \
            "aggregateTokenFromParsed 应从内到外嵌套构建多维 aggregate token"


# ===========================================================================
# I. 前端复合约束解析 —— BUG-06
# ===========================================================================

class TestFrontendCompoundConstraintParsing:
    def test_relation_split_in_parse_dsl_expression(self):
        body = FORMULA_JS[FORMULA_JS.find("function parseDslExpressionToTokens"):][:600]
        assert "relationMatch" in body, "parseDslExpressionToTokens 应先按关系符分割（relationMatch）"

    def test_left_right_parsed_separately(self):
        body = FORMULA_JS[FORMULA_JS.find("function parseDslExpressionToTokens"):][:600]
        assert "parseDslLinearTokens(relationMatch[1]" in body, "关系符左侧应独立调用 parseDslLinearTokens"
        assert "parseDslLinearTokens(relationMatch[3]" in body, "关系符右侧应独立调用 parseDslLinearTokens"

    def test_relation_match_covers_all_operators(self):
        body = FORMULA_JS[FORMULA_JS.find("function parseDslExpressionToTokens"):][:600]
        assert "<=|>=|==" in body, "relationMatch 应覆盖 <=、>= 和 =="


# ===========================================================================
# J. 前端搜索框只重绘符号面板 —— BUG-07
# ===========================================================================

class TestFrontendSearchFocus:
    def test_update_formula_symbol_search_targets_panel_not_modal(self):
        body = FORMULA_JS[FORMULA_JS.find("function updateFormulaSymbolSearch"):][:300]
        assert "formulaSymbolPanel" in body, \
            "updateFormulaSymbolSearch 应只更新 #formulaSymbolPanel"
        # 不应在该函数内调用整个模态框重绘
        assert "formulaEditorHtml()" not in body, \
            "updateFormulaSymbolSearch 不应调用 formulaEditorHtml() 重建整个模态框"

    def test_formula_symbol_panel_id_in_html(self):
        body = FORMULA_JS[FORMULA_JS.find("function formulaEditorHtml"):][:1000]
        assert 'id="formulaSymbolPanel"' in body, \
            "formulaEditorHtml 应渲染 id=formulaSymbolPanel 容器"


# ===========================================================================
# K. 前端 Backspace 按 selectedTokenIndex —— BUG-08
# ===========================================================================

class TestFrontendBackspaceBySelectedIndex:
    def test_backspace_reads_selected_token_index(self):
        body = FORMULA_JS[FORMULA_JS.find("function handleFormulaTokenEditorKeydown"):][:400]
        assert "selectedTokenIndex" in body, \
            "handleFormulaTokenEditorKeydown 应读取 selectedTokenIndex"

    def test_backspace_deletes_by_index_not_always_last(self):
        body = FORMULA_JS[FORMULA_JS.find("function handleFormulaTokenEditorKeydown"):][:400]
        assert "deleteIndex" in body or "filter" in body, \
            "Backspace 删除应根据 deleteIndex 过滤，而不是始终 slice(0,-1)"
        assert ".slice(0, -1)" not in body, \
            "Backspace 不应仍然使用 slice(0,-1) 删末尾"

    def test_backspace_clears_selected_index_after_delete(self):
        start = FORMULA_JS.find("function handleFormulaTokenEditorKeydown")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "selectedTokenIndex = null" in body, \
            "删除后应清除 selectedTokenIndex"


# ===========================================================================
# L. 前端 knownAliases 扩展 —— BUG-09
# ===========================================================================

class TestFrontendKnownAliases:
    def test_r_in_known_aliases(self):
        body = FORMULA_JS[FORMULA_JS.find("knownAliases"):][:200]
        assert "'r'" in body, "knownAliases 应包含 'r'（reservoir 别名）"

    def test_sc_in_known_aliases(self):
        body = FORMULA_JS[FORMULA_JS.find("knownAliases"):][:200]
        assert "'sc'" in body, "knownAliases 应包含 'sc'（scenario 别名）"

    def test_tv_in_known_aliases(self):
        body = FORMULA_JS[FORMULA_JS.find("knownAliases"):][:200]
        assert "'tv'" in body, "knownAliases 应包含 'tv'（time_volume 别名）"


# ===========================================================================
# M. 前端数字 token 0. 正则 —— BUG-11
# ===========================================================================

class TestFrontendNumberTokenRegex:
    def test_number_regex_supports_trailing_dot(self):
        # 在 parseDslLinearTokens 中找到主匹配正则行
        start = FORMULA_JS.find("function parseDslLinearTokens")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert r"\d+(?:\.\d*)?" in body or r"\d+\.?\d*" in body, \
            "parseDslLinearTokens 的数字正则应支持 0. 形式（\\d+(?:\\.\\d*)?）"

    def test_number_regex_does_not_require_decimal_digits(self):
        # 主匹配行：const match = rest.match(/.../); 中的数字部分
        # powerMatch 可以合法保留 \d+(?:\.\d+)?（指数匹配），
        # 此测试只检查主 token 匹配行
        import re as _re
        start = FORMULA_JS.find("function parseDslLinearTokens")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        # 找到含 "const match = rest.match" 的那一行
        main_match_line = next(
            (line for line in body.splitlines() if "const match = rest.match" in line), ""
        )
        assert main_match_line, "未找到 'const match = rest.match' 行"
        # 该行中数字部分应已升级为 \d+(?:\.\d*)?
        assert r"\d+(?:\.\d+)?" not in main_match_line, \
            "主 token 匹配行中旧数字正则 \\d+(?:\\.\\d+)? 仍存在，不支持 0. 形式"


# ===========================================================================
# N. 前端 Scientific 函数分组 —— ITER-01
# ===========================================================================

class TestFrontendScientificGroup:
    def test_scientific_group_exists(self):
        assert "'Scientific'" in FORMULA_JS or '"Scientific"' in FORMULA_JS, \
            "FORMULA_FUNCTION_GROUPS 中缺少 Scientific 分组"

    def test_log_in_scientific_group(self):
        body = FORMULA_JS[FORMULA_JS.find("Scientific"):][:400]
        assert "'log'" in body or '"log"' in body, "Scientific 分组缺少 log"

    def test_exp_in_scientific_group(self):
        body = FORMULA_JS[FORMULA_JS.find("Scientific"):][:400]
        assert "'exp'" in body or '"exp"' in body, "Scientific 分组缺少 exp"

    def test_sqrt_in_scientific_group(self):
        body = FORMULA_JS[FORMULA_JS.find("Scientific"):][:400]
        assert "'sqrt'" in body or '"sqrt"' in body, "Scientific 分组缺少 sqrt"

    def test_pow_in_scientific_group(self):
        sci_start = FORMULA_JS.find("'Scientific'") if "'Scientific'" in FORMULA_JS else FORMULA_JS.find('"Scientific"')
        # Scientific 分组直到下一个 title 分组开始
        sci_end = FORMULA_JS.find("title:", sci_start + 20)
        body = FORMULA_JS[sci_start:sci_end]
        assert "'pow'" in body or '"pow"' in body, "Scientific 分组缺少 pow（任意幂次）"

    def test_scientific_function_labels_updated(self):
        assert "'log': 'ln'" in FORMULA_JS or '"log": "ln"' in FORMULA_JS or "log: 'ln'" in FORMULA_JS, \
            "FORMULA_FUNCTION_LABELS 缺少 log → ln 的标签映射"


# ===========================================================================
# O. 前端 formulaExpressionClass 分类器 —— ITER-02
# ===========================================================================

class TestFrontendExpressionClass:
    def test_formula_expression_class_function_exists(self):
        assert "function formulaExpressionClass" in FORMULA_JS

    def test_formula_expression_class_hint_function_exists(self):
        assert "function formulaExpressionClassHint" in FORMULA_JS

    def test_nlp_label_in_hint(self):
        body = FORMULA_JS[FORMULA_JS.find("function formulaExpressionClassHint"):][:400]
        assert "NLP" in body, "formulaExpressionClassHint 缺少 NLP 提示文案"

    def test_minlp_label_in_hint(self):
        start = FORMULA_JS.find("function formulaExpressionClassHint")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "MINLP" in body, "formulaExpressionClassHint 缺少 MINLP 提示文案"

    def test_qp_label_in_hint(self):
        start = FORMULA_JS.find("function formulaExpressionClassHint")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "QP" in body, "formulaExpressionClassHint 缺少 QP 提示文案"

    def test_classifier_detects_log_as_nlp(self):
        # find() 返回 -1 时为 truthy，不能用 or；直接搜索精确函数签名
        start = FORMULA_JS.find("function formulaExpressionClass(")
        assert start >= 0, "formulaExpressionClass 函数未找到"
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "NLP" in body and "log" in body, \
            "formulaExpressionClass 应将 log 标记为 NLP"

    def test_classifier_detects_pow2_as_qp(self):
        start = FORMULA_JS.find("function formulaExpressionClass(")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "QP" in body, "formulaExpressionClass 应将 ** 2 标记为 QP"
        assert "**" in body or r"\*\*" in body, "formulaExpressionClass 应检测 ** 运算符"


# ===========================================================================
# P. 前端约束类型提示卡展示 —— ITER-04
# ===========================================================================

class TestFrontendConstraintTypeCard:
    def test_math_class_shown_in_validation_html(self):
        body = FORMULA_JS[FORMULA_JS.find("function formulaValidationHtml"):][:600]
        assert "mathClass" in body, "formulaValidationHtml 应调用 mathClass"
        assert "mathHint" in body, "formulaValidationHtml 应调用 mathHint"

    def test_math_type_label_in_validation_html(self):
        start = FORMULA_JS.find("function formulaValidationHtml")
        end = FORMULA_JS.find("\n    function ", start + 10)
        body = FORMULA_JS[start:end]
        assert "数学类型" in body, "校验面板应显示'数学类型'标签"

    def test_expression_class_hint_color_classes(self):
        body = FORMULA_JS[FORMULA_JS.find("function formulaExpressionClassHint"):][:500]
        assert "green" in body and "orange" in body, \
            "formulaExpressionClassHint 应包含 green（LP）和 orange（NLP）颜色"


# ===========================================================================
# Q. 仍未修复的项（xfail 标记，保持可见）—— BUG-03 / BUG-10 / BUG-12
# ===========================================================================

class TestKnownRemainingIssues:
    def test_bug03_error_message_reflects_full_allowlist(self):
        """后端错误文案应枚举实际白名单，而非仅写 sum(...)。"""
        from app.model_components.formula_components import validate_formula_expression
        syms = {"sets": set(), "parameters": set(), "variables": set(), "indices": set()}
        errors = validate_formula_expression("unknown_fn(x) >= 0", syms)
        assert errors
        # 不应仍然包含"当前仅允许 sum(...)"这段文案
        assert all("当前仅允许 sum" not in e.get("suggestion", "") for e in errors), \
            "BUG-03: 错误建议文案仍为 '当前仅允许 sum(...)'"

    def test_bug10_scope_banner_is_chinese(self):
        """formulaScopeAliasBannerHtml 无作用范围时应返回中文提示。"""
        body = FORMULA_JS[FORMULA_JS.find("function formulaScopeAliasBannerHtml"):][:300]
        assert "Scope: auto inferred from free indices" not in body, \
            "BUG-10: Banner 仍包含英文文案 'Scope: auto inferred from free indices.'"

    def test_bug12_dead_code_replaced_with_named_flag(self):
        """piecewise 分段线性约束校验死代码应替换为 PIECEWISE_STRICT_VALIDATION 常量。"""
        from app.model_components import formula_components
        source = Path(formula_components.__file__).read_text(encoding="utf-8")
        assert "if False and" not in source, \
            "BUG-12: formula_components.py 仍含 'if False and' 死代码"
        assert "PIECEWISE_STRICT_VALIDATION" in source, \
            "BUG-12: 缺少具名特性开关 PIECEWISE_STRICT_VALIDATION"
