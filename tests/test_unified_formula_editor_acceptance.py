from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROTOTYPE = (ROOT / "prototype.html").read_text(encoding="utf-8")


def _static_script_path(src: str) -> Path:
    """Resolve versioned script URLs for static tests."""
    return ROOT / src.split("?", 1)[0]


SCRIPT_PATHS = [
    _static_script_path(match)
    for match in re.findall(r'<script\s+src="([^"]+)"\s*></script>', PROTOTYPE)
]
FRONTEND_SOURCES = PROTOTYPE + "\n" + "\n".join(path.read_text(encoding="utf-8") for path in SCRIPT_PATHS)
FORMULA_JS = (ROOT / "static" / "js" / "platform-formula-editor.js").read_text(encoding="utf-8")
MODELING_JS = (ROOT / "static" / "js" / "platform-pages-modeling.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "css" / "platform.css").read_text(encoding="utf-8")


def _function_body(source: str, name: str) -> str:
    starts = [source.find(pattern) for pattern in [f"function {name}", f"async function {name}", f"const {name} ="]]
    starts = [index for index in starts if index >= 0]
    assert starts, f"{name} not found"
    start = min(starts)
    next_function = source.find("\n    function ", start + len(name))
    if next_function == -1:
        next_function = source.find("\nfunction ", start + len(name))
    return source[start:] if next_function == -1 else source[start:next_function]


def test_versioned_static_scripts_are_resolved_without_query_suffix() -> None:
    assert any("?" in match for match in re.findall(r'<script\s+src="([^"]+)"\s*></script>', PROTOTYPE))
    assert all(path.exists() for path in SCRIPT_PATHS)
    assert all("?" not in str(path) for path in SCRIPT_PATHS)


def test_formula_editor_default_surface_is_token_canvas_and_dsl_textarea_is_advanced_only() -> None:
    body = _function_body(FORMULA_JS, "formulaEditorHtml")
    assert 'id="formulaTokenEditor"' in body
    assert 'class="formula-token-editor"' in body
    assert '<input type="hidden" id="unifiedFormulaText"' not in body
    assert '<textarea id="unifiedFormulaText"' in body
    assert body.index("高级模式：DSL 表达式") < body.index('<textarea id="unifiedFormulaText"')


def test_inserted_symbols_are_readonly_tokens_with_display_and_dsl_boundaries() -> None:
    body = _function_body(FORMULA_JS, "formulaObjectToToken") + _function_body(FORMULA_JS, "formulaTokensToDsl") + _function_body(FORMULA_JS, "formulaTokensToDisplay") + _function_body(FORMULA_JS, "tokensToDslLinear")
    assert "readonly: true" in body
    assert "formulaObjectLabel" in body
    assert "objectTokenToDsl" in body
    assert "displayFormula" in _function_body(FORMULA_JS, "openFormulaEditor")
    assert "dslFormula" in _function_body(FORMULA_JS, "openFormulaEditor")


def test_power_balance_scope_inference_excludes_aggregated_unit_from_foreach() -> None:
    infer_body = _function_body(FORMULA_JS, "inferFormulaScopeFromExpression")
    apply_body = _function_body(FORMULA_JS, "addFormulaScopeIndex") + _function_body(FORMULA_JS, "applyFormulaEditor")
    assert "referenced" in infer_body
    assert "aggregated" in infer_body
    assert "!aggregated.has(code)" in infer_body
    assert "aggregatedFormulaScopeSet" in apply_body
    assert "不能加入外层 foreach" in apply_body


def test_constraint_table_shows_time_foreach_and_preview_expands_by_constraint_foreach() -> None:
    table_body = _function_body(MODELING_JS, "formulaConstraintBlock")
    preview_body = _function_body(MODELING_JS, "expandGenericConstraintLabels")
    assert "∀ ${formulaScopePrefix(scope)}" in table_body
    assert "formulaScopeListFromRow(constraint)" in preview_body
    assert "genericContexts(spec, foreach)" in preview_body


def test_function_tokens_show_contextual_help_and_prevent_meaningless_chains() -> None:
    body = _function_body(FORMULA_JS, "insertFormulaFunctionToken") + _function_body(FORMULA_JS, "openFormulaTokenProperties") + _function_body(FORMULA_JS, "validateFormulaTokenStructure")
    for token in ["sum", "min", "max", "abs"]:
        assert token in _function_body(FORMULA_JS, "formulaFunctionHelpHtml")
    assert "refreshFormulaFunctionHelpPanel()" in body
    assert "函数 token 不能连续插入" in body
    assert "缺少操作对象" in body


def test_raw_formula_layers_do_not_duplicate_original_expression_and_dsl_prefixes_are_removed() -> None:
    assert "原始表达式" not in FORMULA_JS
    assert "参数:${term.coef_param}" not in MODELING_JS
    assert "参数:${cons.rhs_param}" not in MODELING_JS
    assert "原始 DSL" in FORMULA_JS


def test_operation_columns_are_wide_sticky_and_scroll_safe() -> None:
    assert "overflow-x: auto" in CSS
    assert "position: sticky" in CSS
    assert re.search(r"min-width:\s*1(?:2|3)\dpx", CSS)
    assert re.search(r"max-width:\s*1(?:3|6)\dpx", CSS)
    assert "formula-ops-col" in _function_body(MODELING_JS, "formulaConstraintBlock")
    assert "formula-ops-col" in _function_body(MODELING_JS, "formulaObjectiveBlock")
