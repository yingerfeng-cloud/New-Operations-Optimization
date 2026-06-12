from __future__ import annotations

import json
import subprocess
import textwrap
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORMULA_JS = ROOT / "static" / "js" / "platform-formula-editor.js"


def _run_formula_editor_js(scenario_script: str) -> dict:
    script = f"""
    const assert = require('assert');
    var state = {{ formulaEditor: null }};
    function escapeHtml(value) {{ return String(value ?? ''); }}
    function pill(value) {{ return String(value ?? ''); }}
    function openInfoModal() {{}}
    function toast(message) {{ state.lastToast = message; }}
    function renderFormulaReadableTable() {{ return ''; }}
    {FORMULA_JS.read_text(encoding='utf-8')}

    const context = {{
      sets: [
        {{ code: 'time', name: 'time', type: 'set' }},
        {{ code: 'unit', name: 'unit', type: 'set' }},
        {{ code: 'storage', name: 'storage', type: 'set' }},
        {{ code: 'reservoir', name: 'reservoir', type: 'set' }},
        {{ code: 'scenario', name: 'scenario', type: 'set' }}
      ],
      parameters: [
        {{ code: 'load_forecast', name: 'load_forecast', type: 'parameter', dimension: ['time'] }},
        {{ code: 'startup_cost', name: 'startup_cost', type: 'parameter', dimension: ['unit'] }}
      ],
      variables: [
        {{ code: 'unit_output', name: 'unit_output', type: 'variable', dimension: ['unit', 'time'] }},
        {{ code: 'unit_startup', name: 'unit_startup', type: 'variable', dimension: ['unit', 'time'] }},
        {{ code: 'deviation', name: 'deviation', type: 'variable', dimension: ['time'] }},
        {{ code: 'soc', name: 'soc', type: 'variable', dimension: ['storage', 'time'] }},
        {{ code: 'volume', name: 'volume', type: 'variable', dimension: ['reservoir', 'time'] }},
        {{ code: 'dispatch', name: 'dispatch', type: 'variable', dimension: ['scenario', 'time'] }}
      ]
    }};
    state.formulaEditor = {{ context, tokens: [], scopeIndices: [] }};

    const results = {{}};
    {scenario_script}
    console.log(JSON.stringify(results));
    """
    script_path = ROOT / f"__formula_taskbook_{uuid.uuid4().hex}.js"
    script_path.write_text(script, encoding="utf-8")
    try:
        completed = subprocess.run(["node", str(script_path)], cwd=ROOT, text=True, encoding="utf-8", capture_output=True, check=False)
    finally:
        script_path.unlink(missing_ok=True)
    assert completed.returncode == 0, completed.stderr or completed.stdout
    return json.loads(completed.stdout)


def test_advanced_square_dsl_round_trips_to_square_token() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const parsed = parseDslExpressionToTokens('(deviation[t]) ** 2 <= 100', context);
            assert.equal(parsed.ok, true);
            assert.equal(parsed.tokens[0].type, 'square');
            assert.equal(parsed.tokens[0].body_tokens[0].type, 'variable');
            assert.equal(parsed.tokens[1].code, '<=');
            results.dsl = formulaTokensToDsl(parsed.tokens, context);
            results.firstType = parsed.tokens[0].type;
            """
        )
    )
    assert result == {"dsl": "(deviation[t]) ** 2 <= 100", "firstType": "square"}


def test_multidimensional_aggregate_dsl_preserves_nested_index_tokens() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const localContext = {
              sets: [{ code: 'A', type: 'set' }, { code: 'B', type: 'set' }],
              parameters: [],
              variables: [{ code: 'x', type: 'variable', dimension: ['A', 'B'] }]
            };
            state.formulaEditor.context = localContext;
            const parsed = parseDslExpressionToTokens('sum(x[i,j] for i in A for j in B)', localContext);
            const variable = parsed.tokens[0].body_tokens[0].body_tokens[0];
            assert.equal(parsed.ok, true);
            assert.equal(parsed.tokens[0].set, 'A');
            assert.equal(parsed.tokens[0].body_tokens[0].set, 'B');
            assert.deepEqual(variable.indices, ['A', 'B']);
            results.dsl = formulaTokensToDsl(parsed.tokens, localContext);
            results.indices = variable.indices;
            """
        )
    )
    assert result["dsl"] == "sum(sum(x[i,j] for j in B) for i in A)"
    assert result["indices"] == ["A", "B"]


def test_nested_aggregate_child_renders_body_tokens() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const parsed = parseDslExpressionToTokens('sum(sum(load_forecast[t] * unit_output[u,t] for t in time) for u in unit)', context);
            state.formulaEditor.tokens = parsed.tokens;
            const html = formulaTokenHtml(parsed.tokens[0], 0, context);
            assert(html.includes('formula-aggregate-child-nested'));
            assert(html.includes('load_forecast[t]'));
            assert(html.includes('unit_output[u,t]'));
            results.hasNested = html.includes('formula-aggregate-child-nested');
            results.hasBody = html.includes('load_forecast[t]') && html.includes('unit_output[u,t]');
            """
        )
    )
    assert result == {"hasNested": True, "hasBody": True}


def test_storage_reservoir_and_scenario_aliases_do_not_warn_as_unknown_names() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            for (const expression of ['soc[s,t] >= 0', 'volume[r,t] >= 0', 'dispatch[sc,t] >= 0']) {
              const parsed = parseDslExpressionToTokens(expression, context);
              const validation = validateFormulaText(expression, 'constraint', context, parsed.tokens);
              assert.equal(validation.errors.some(item => item.includes('未定义')), false);
            }
            results.ok = true;
            """
        )
    )
    assert result["ok"] is True


def test_frontend_expression_class_badges_qp_and_nlp() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            results.qp = formulaExpressionClass('(deviation[t]) ** 2 <= 100', context);
            results.nlp = formulaExpressionClass('log(deviation[t] + 1) <= 5', context);
            """
        )
    )
    assert result == {"qp": "QP", "nlp": "NLP"}


def test_token_editor_does_not_render_scope_prefix() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor = {
              title: 'scope check',
              path: 'test',
              mode: 'constraint',
              context,
              tokens: parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens,
              scopeIndices: ['time'],
              validation: { valid: true, errors: [], explanations: [] }
            };
            const html = formulaEditorHtml();
            assert.equal(html.includes('formula-token-scope-prefix'), false);
            results.hasPrefix = html.includes('formula-token-scope-prefix');
            """
        )
    )
    assert result == {"hasPrefix": False}


def test_insertion_point_inserts_between_root_tokens() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('deviation[t] <= 100', context).tokens;
            setFormulaInsertionPoint('root', 1, null);
            insertFormulaOperatorToken('+');
            insertFormulaNumberToken('1');
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["dsl"] == "deviation[t] + 1 <= 100"


def test_insertion_caret_only_active_after_click_and_clears() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('deviation[t] <= 100', context).tokens;
            let html = formulaEditorHtml();
            results.initialActive = html.includes('formula-insert-caret active');
            results.caretIsButton = html.includes('<button type="button" class="formula-insert-caret');
            results.caretTitle = html.includes('title="在此处插入"');
            setFormulaInsertionPoint('root', 1, null);
            html = formulaEditorHtml();
            results.clickedActive = html.includes('formula-insert-caret active');
            clearFormulaInsertionPoint();
            html = formulaEditorHtml();
            results.clearedActive = html.includes('formula-insert-caret active');
            """
        )
    )
    assert result == {
        "initialActive": False,
        "caretIsButton": False,
        "caretTitle": True,
        "clickedActive": True,
        "clearedActive": False,
    }


def test_aggregate_function_starts_without_default_set_then_accepts_selected_set() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = [];
            insertFormulaFunctionToken('sum');
            const aggregate = state.formulaEditor.tokens[0];
            results.initialSet = aggregate.set;
            results.initialLabel = aggregateTokenLabel(aggregate, context);
            results.initialHtml = formulaEditorHtml();
            insertFormulaTokenFromObject('set', 'unit');
            results.finalSet = state.formulaEditor.tokens[0].set;
            results.finalLength = state.formulaEditor.tokens.length;
            results.finalLabel = aggregateTokenLabel(state.formulaEditor.tokens[0], context);
            """
        )
    )
    assert result["initialSet"] == ""
    assert "请选择集合" in result["initialLabel"]
    assert "请选择集合和表达式" in result["initialHtml"]
    assert result["finalSet"] == "unit"
    assert result["finalLength"] == 1
    assert result["finalLabel"] == "Σ for u ∈ unit"


def test_insertion_point_inserts_between_aggregate_children() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] * deviation[t] for u in unit) >= load_forecast[t]', context).tokens;
            setFormulaInsertionPoint('aggregate', 1, 0);
            insertFormulaOperatorToken('+');
            insertFormulaNumberToken('1');
            const aggregate = state.formulaEditor.tokens[0];
            results.body = aggregate.body_tokens.map(t => t.type === 'number' ? t.value : (t.dsl || t.code || t.type));
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["body"][1:3] == ["+", "1"]
    assert "unit_output[u,t] + 1 * deviation[t]" in result["dsl"]


def test_scientific_function_wraps_selected_aggregate_child() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens;
            openAggregateChildTokenProperties(0, 0);
            insertFormulaFunctionToken('log');
            const child = state.formulaEditor.tokens[0].body_tokens[0];
            results.type = child.type;
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["type"] == "unary"
    assert result["dsl"] == "sum(log(unit_output[u,t]) for u in unit) >= load_forecast[t]"


def test_nested_aggregate_body_token_can_be_selected_and_wrapped_without_losing_body() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(sum(startup_cost[u] * unit_startup[u,t] for t in time) for u in unit)', context).tokens;
            openNestedAggregateBodyTokenProperties(0, 0, 0);
            insertFormulaFunctionToken('x²');
            const inner = state.formulaEditor.tokens[0].body_tokens[0].body_tokens[0];
            results.innerType = inner.type;
            results.selected = state.formulaEditor.selectedNestedChild;
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.display = formulaTokensToDisplay(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["innerType"] == "square"
    assert result["selected"] == {"parentIndex": 0, "childIndex": 0, "nestedIndex": 0}
    assert result["dsl"] == "sum(sum((startup_cost[u]) ** 2 * unit_startup[u,t] for t in time) for u in unit)"
    assert "unit_startup[u,t]" in result["display"]


def test_insert_aggregate_inside_aggregate_body_and_then_attach_set() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            insertFormulaFunctionToken('sum');
            insertFormulaTokenFromObject('set', 'unit');
            setFormulaInsertionPoint('aggregate', 0, 0);
            insertFormulaFunctionToken('sum');
            openAggregateChildTokenProperties(0, 0);
            insertFormulaTokenFromObject('set', 'time');
            insertFormulaTokenFromObject('parameter', 'startup_cost');
            insertFormulaOperatorToken('*');
            insertFormulaTokenFromObject('variable', 'unit_startup');
            const nested = state.formulaEditor.tokens[0].body_tokens[0];
            results.outerSet = state.formulaEditor.tokens[0].set;
            results.nestedSet = nested.set;
            results.nestedBodyTypes = nested.body_tokens.map(token => token.type);
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["outerSet"] == "unit"
    assert result["nestedSet"] == "time"
    assert result["nestedBodyTypes"] == ["parameter", "operator", "variable"]
    assert result["dsl"] == "sum(sum(startup_cost[u] * unit_startup[u,t] for t in time) for u in unit)"


def test_empty_editor_functions_create_fillable_wrappers() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            insertFormulaFunctionToken('log');
            results.logType = state.formulaEditor.tokens[0].type;
            results.logPoint = state.formulaEditor.insertionPoint;
            insertFormulaTokenFromObject('parameter', 'load_forecast');
            results.logDsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            clearFormulaEditorTokens();
            insertFormulaFunctionToken('x²');
            results.squareType = state.formulaEditor.tokens[0].type;
            results.squarePoint = state.formulaEditor.insertionPoint;
            insertFormulaTokenFromObject('variable', 'deviation');
            results.squareDsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["logType"] == "unary"
    assert result["logPoint"] == {"kind": "wrapper", "parentIndex": 0, "index": 0}
    assert result["logDsl"] == "log(load_forecast[t])"
    assert result["squareType"] == "square"
    assert result["squarePoint"] == {"kind": "wrapper", "parentIndex": 0, "index": 0}
    assert result["squareDsl"] == "(deviation[t]) ** 2"


def test_scope_prefix_tokens_are_stripped_from_editable_formula_tokens() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const savedTokens = [
              { type: 'text', text: '∀', label: '∀', dsl: '∀' },
              { type: 'set', code: 'time', label: 'time', dsl: 'time' },
              { type: 'text', text: ':', label: ':', dsl: ':' },
              ...parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens
            ];
            const normalized = normalizeFormulaTokens(savedTokens, context, '');
            results.first = normalized[0].type;
            results.hasForall = normalized.some(token => (token.dsl || token.label || token.text || token.code) === '∀');
            results.dsl = formulaTokensToDsl(normalized, context);
            const parsed = stripFormulaScopePrefixTokens(parseDslExpressionToTokens('∀ time : sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens, context);
            results.parsedFirst = parsed[0].type;
            results.parsedDsl = formulaTokensToDsl(parsed, context);
            """
        )
    )
    assert result["first"] == "aggregate"
    assert result["hasForall"] is False
    assert result["dsl"] == "sum(unit_output[u,t] for u in unit) >= load_forecast[t]"
    assert result["parsedFirst"] == "aggregate"
    assert result["parsedDsl"] == "sum(unit_output[u,t] for u in unit) >= load_forecast[t]"


def test_advanced_dsl_scientific_functions_round_trip_without_unknown_object_errors() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.mode = 'constraint';
            state.formulaEditor.scopeIndices = ['time'];
            updateAdvancedDslFormula('log(load_forecast[t]) <= deviation[t]');
            results.logDsl = state.formulaEditor.dslFormula;
            results.logDisplay = state.formulaEditor.displayFormula;
            results.logErrors = state.formulaEditor.validation.errors;
            updateAdvancedDslFormula('sqrt(deviation[t] + 1) <= 10');
            results.sqrtDsl = state.formulaEditor.dslFormula;
            results.sqrtErrors = state.formulaEditor.validation.errors;
            updateAdvancedDslFormula('(deviation[t] + load_forecast[t]) ** 2 <= 100');
            results.squareDsl = state.formulaEditor.dslFormula;
            results.squareDisplay = state.formulaEditor.displayFormula;
            """
        )
    )
    assert result["logDsl"] == "log(load_forecast[t]) <= deviation[t]"
    assert "ln(load_forecast[t])" in result["logDisplay"]
    assert all("log 未定义" not in error for error in result["logErrors"])
    assert result["sqrtDsl"] == "sqrt(deviation[t] + 1) <= 10"
    assert all("sqrt 未定义" not in error for error in result["sqrtErrors"])
    assert result["squareDsl"] == "(deviation[t] + load_forecast[t]) ** 2 <= 100"
    assert result["squareDisplay"] == "(deviation[t] + load_forecast[t])² ≤ 100"


def test_scientific_power_preview_does_not_render_double_asterisk_as_multiply() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const expression = 'sum(unit_output[u,t] for u in unit) * (load_forecast[t]) ** 3';
            results.readable = renderFormulaReadable(expression, context);
            results.scoped = renderFormulaReadableWithScope(expression, context, ['time'], true);
            results.mathClass = formulaExpressionClass(expression, context);
            """
        )
    )
    assert "× ×" not in result["readable"]
    assert "(负荷预测[t])^3" in result["readable"]
    assert "∀ 时段 time" in result["scoped"]
    assert result["mathClass"] == "NLP"


def test_power_function_can_wrap_selected_root_and_aggregate_child() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            global.window = { prompt() { return '3'; } };
            state.formulaEditor.tokens = parseDslExpressionToTokens('load_forecast[t]', context).tokens;
            openFormulaTokenProperties(0);
            powerPreviousFormulaToken();
            results.rootDsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.rootDisplay = formulaTokensToDisplay(state.formulaEditor.tokens, context);

            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit)', context).tokens;
            openAggregateChildTokenProperties(0, 0);
            powerPreviousFormulaToken();
            results.childDsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.childDisplay = formulaTokensToDisplay(state.formulaEditor.tokens, context);
            """
        )
    )
    assert result["rootDsl"] == "(load_forecast[t]) ** 3"
    assert result["rootDisplay"] == "(load_forecast[t])^3"
    assert result["childDsl"] == "sum((unit_output[u,t]) ** 3 for u in unit)"
    assert result["childDisplay"] == "Σ for u ∈ unit ( (unit_output[u,t])^3 )"


def test_power_function_refreshes_help_panel_when_wrapping_selected_token() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const modalBody = {
              html: '',
              querySelector() { return { scrollTop: 0 }; },
              set innerHTML(value) { this.html = value; },
              get innerHTML() { return this.html; }
            };
            global.document = {
              getElementById(id) {
                if (id === 'modalBody') return modalBody;
                if (id === 'formulaTokenEditor') return { focus() {} };
                return null;
              },
              querySelector() { return null; }
            };
            global.window = { prompt() { return '3'; } };
            state.formulaEditor = {
              title: 'help sync',
              path: 'test',
              mode: 'constraint',
              context,
              tokens: parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens,
              scopeIndices: ['time'],
              validation: { valid: true, errors: [], explanations: [] },
              activeFunction: 'sum'
            };
            openFormulaTokenProperties(2);
            powerPreviousFormulaToken();
            results.activeFunction = state.formulaEditor.activeFunction;
            results.htmlHasPowHelp = modalBody.html.includes('任意幂 xⁿ 使用说明');
            results.htmlHasSumHelp = modalBody.html.includes('求和 Σ 使用说明');
            results.dsl = state.formulaEditor.dslFormula;
            """
        )
    )
    assert result["activeFunction"] == "pow"
    assert result["htmlHasPowHelp"] is True
    assert result["htmlHasSumHelp"] is False
    assert result["dsl"] == "sum(unit_output[u,t] for u in unit) >= (load_forecast[t]) ** 3"


def test_scientific_wrapper_adjacent_to_expression_is_flagged_as_missing_operator() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            global.window = { prompt() { return '3'; } };
            state.formulaEditor.mode = 'objective';
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) load_forecast[t]', context).tokens;
            openFormulaTokenProperties(1);
            powerPreviousFormulaToken();
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.errors = state.formulaEditor.validation.errors;
            """
        )
    )
    assert result["dsl"] == "sum(unit_output[u,t] for u in unit) (load_forecast[t]) ** 3"
    assert "相邻表达式缺少运算符" in result["errors"]


def test_power_function_requires_explicit_exponent_and_cancel_keeps_formula() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            global.window = { prompt() { return ''; } };
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens;
            openFormulaTokenProperties(2);
            powerPreviousFormulaToken();
            results.dslAfterBlank = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.toastAfterBlank = state.lastToast;
            global.window = { prompt() { return null; } };
            powerPreviousFormulaToken();
            results.dslAfterCancel = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.toastAfterCancel = state.lastToast;
            """
        )
    )
    assert result["dslAfterBlank"] == "sum(unit_output[u,t] for u in unit) >= load_forecast[t]"
    assert result["dslAfterCancel"] == "sum(unit_output[u,t] for u in unit) >= load_forecast[t]"
    assert "已取消幂运算" in result["toastAfterBlank"]
    assert "已取消幂运算" in result["toastAfterCancel"]


def test_token_embedded_object_metadata_prevents_false_unknown_object_error() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const localContext = {
              sets: [{ code: 'time', name: 'time', type: 'set' }, { code: 'unit', name: 'unit', type: 'set' }],
              parameters: [{ code: 'unit_max_output', name: 'unit_max_output', type: 'parameter', dimension: ['unit'] }],
              variables: [{ code: 'unit_on', name: 'unit_on', type: 'variable', dimension: ['unit', 'time'] }]
            };
            const tokens = [
              ...parseDslExpressionToTokens('sum(unit_max_output[u] * unit_on[u,t] for u in unit) >=', localContext).tokens,
              formulaSquareToken({
                type: 'parameter',
                code: 'load_with_reserve',
                name: 'load_with_reserve',
                indices: ['time'],
                label: 'load_with_reserve[time]',
                readonly: true
              }, localContext)
            ];
            const dsl = formulaTokensToDsl(tokens, localContext);
            const validation = validateFormulaText(dsl, 'constraint', localContext, tokens);
            results.dsl = dsl;
            results.errors = validation.errors;
            results.usedParameters = validation.usedParameters;
            """
        )
    )
    assert result["dsl"] == "sum(unit_max_output[u] * unit_on[u,t] for u in unit) >= (load_with_reserve[t]) ** 2"
    assert all("load_with_reserve 未定义" not in error for error in result["errors"])
    assert "load_with_reserve" in result["usedParameters"]


def test_scientific_unary_wrappers_keep_selected_target_visible() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            for (const fn of ['log', 'exp', 'sqrt', 'abs']) {
              state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens;
              openFormulaTokenProperties(2);
              insertFormulaFunctionToken(fn);
              const wrapper = state.formulaEditor.tokens[2];
              results[fn] = {
                type: wrapper.type,
                bodyCode: wrapper.body_tokens[0].code,
                dsl: formulaTokensToDsl(state.formulaEditor.tokens, context),
                htmlHasBody: formulaTokenHtml(wrapper, 2, context).includes('load_forecast[t]')
              };
            }
            """
        )
    )
    assert result["log"]["dsl"] == "sum(unit_output[u,t] for u in unit) >= log(load_forecast[t])"
    assert result["exp"]["dsl"] == "sum(unit_output[u,t] for u in unit) >= exp(load_forecast[t])"
    assert result["sqrt"]["dsl"] == "sum(unit_output[u,t] for u in unit) >= sqrt(load_forecast[t])"
    assert result["abs"]["dsl"] == "sum(unit_output[u,t] for u in unit) >= abs(load_forecast[t])"
    for fn in ["log", "exp", "sqrt", "abs"]:
        assert result[fn]["type"] == "unary"
        assert result[fn]["bodyCode"] == "load_forecast"
        assert result[fn]["htmlHasBody"] is True


def test_scientific_function_wraps_parentheses_body_from_cursor_after_open_paren() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= (load_forecast[t])', context).tokens;
            const openParenIndex = state.formulaEditor.tokens.findIndex(token => token.type === 'operator' && token.code === '(');
            setFormulaInsertionPoint('root', openParenIndex + 1, null);
            insertFormulaFunctionToken('log');
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.display = formulaTokensToDisplay(state.formulaEditor.tokens, context);
            results.types = state.formulaEditor.tokens.map(token => token.type === 'operator' ? token.code : token.type);
            results.wrapperBody = state.formulaEditor.tokens[2].body_tokens.map(token => token.code || token.type);
            """
        )
    )
    assert result["dsl"] == "sum(unit_output[u,t] for u in unit) >= log(load_forecast[t])"
    assert result["display"] == "Σ for u ∈ unit ( unit_output[u,t] ) ≥ ln(load_forecast[t])"
    assert result["types"] == ["aggregate", ">=", "unary"]
    assert result["wrapperBody"] == ["group"]


def test_scientific_function_does_not_wrap_relation_operator_at_cursor() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            state.formulaEditor.tokens = parseDslExpressionToTokens('sum(unit_output[u,t] for u in unit) >= load_forecast[t]', context).tokens;
            setFormulaInsertionPoint('root', 2, null);
            insertFormulaFunctionToken('sqrt');
            results.dsl = formulaTokensToDsl(state.formulaEditor.tokens, context);
            results.display = formulaTokensToDisplay(state.formulaEditor.tokens, context);
            results.types = state.formulaEditor.tokens.map(token => token.type === 'operator' ? token.code : token.type);
            results.wrapperBodyCode = state.formulaEditor.tokens[2].body_tokens[0].code;
            """
        )
    )
    assert result["dsl"] == "sum(unit_output[u,t] for u in unit) >= sqrt(load_forecast[t])"
    assert result["display"] == "Σ for u ∈ unit ( unit_output[u,t] ) ≥ √(load_forecast[t])"
    assert result["types"] == ["aggregate", ">=", "unary"]
    assert result["wrapperBodyCode"] == "load_forecast"


def test_formula_examples_open_modal_and_can_load_example() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            openInfoModal = function(title, html) { results.modalTitle = title; results.modalHtml = html; };
            showFormulaExamples();
            results.exampleModalTitle = results.modalTitle;
            results.hasLoadAction = results.modalHtml.includes('loadFormulaExample(0)');
            loadFormulaExample(0);
            results.editorModalTitle = results.modalTitle;
            results.loadedOpen = state.formulaEditor.advancedDslOpen;
            results.loadedDsl = state.formulaEditor.dslFormula;
            results.toast = state.lastToast;
            """
        )
    )
    assert result["exampleModalTitle"] == "公式示例"
    assert result["editorModalTitle"] == "统一公式编辑器"
    assert result["hasLoadAction"] is True
    assert result["loadedOpen"] is True
    assert "sum(" in result["loadedDsl"]
    assert result["toast"] == "已载入公式示例，可继续编辑后应用。"


def test_formula_editor_title_prefers_chinese_business_name() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            var BUSINESS_DISPLAY_NAMES = { reserve_margin: '备用裕度', power_balance: '功率平衡' };
            results.mapped = formulaEditorTitle({ title: '正在编辑：reserve_margin' }, { constraint_id: 'reserve_margin', name: 'reserve_margin' });
            results.direct = formulaEditorTitle({ title: '正在编辑：目标项 1' }, { term_id: 'obj1', display_name: '总成本最小化' });
            """
        )
    )
    assert result["mapped"] == "正在编辑：备用裕度"
    assert result["direct"] == "正在编辑：总成本最小化"


def test_formula_editor_title_extracts_code_from_mojibake_prefix() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            results.title = formulaEditorTitle({ title: '?????reserve_margin' }, {});
            """
        )
    )
    assert result["title"] == "正在编辑：备用裕度"


def test_advanced_dsl_updates_textarea_and_token_editor_dom() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const tokenEditor = { innerHTML: '' };
            const textarea = { value: '∀ time : log(load_forecast[t]) <= deviation[t]' };
            const preview = { textContent: '' };
            const validation = { innerHTML: '' };
            global.document = {
              getElementById(id) {
                if (id === 'formulaTokenEditor') return tokenEditor;
                if (id === 'unifiedFormulaText') return textarea;
                if (id === 'formulaDisplayPreview') return preview;
                if (id === 'formulaValidationPanel') return validation;
                return null;
              }
            };
            state.formulaEditor.mode = 'constraint';
            state.formulaEditor.scopeIndices = ['time'];
            updateAdvancedDslFormula(textarea.value);
            results.textarea = textarea.value;
            results.preview = preview.textContent;
            results.tokenHtml = tokenEditor.innerHTML;
            """
        )
    )
    assert result["textarea"] == "log(load_forecast[t]) <= deviation[t]"
    assert result["preview"] == "ln(load_forecast[t]) ≤ deviation[t]"
    assert "formula-token-unary" in result["tokenHtml"]
    assert "∀" not in result["tokenHtml"]


def test_refresh_formula_editor_body_preserves_left_scroll() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const modalBody = {
              html: '',
              left: { scrollTop: 321 },
              workspace: { scrollTop: 22 },
              validation: { scrollTop: 45 },
              querySelector(selector) {
                if (selector === '.formula-template-panel') return this.left;
                if (selector === '.formula-workspace') return this.workspace;
                if (selector === '.formula-validation-panel') return this.validation;
                return null;
              },
              set innerHTML(value) {
                this.html = value;
                this.left = { scrollTop: 0 };
                this.workspace = { scrollTop: 0 };
                this.validation = { scrollTop: 0 };
              },
              get innerHTML() { return this.html; }
            };
            global.document = { getElementById(id) { return id === 'modalBody' ? modalBody : null; } };
            state.formulaEditor.tokens = parseDslExpressionToTokens('deviation[t] <= 100', context).tokens;
            refreshFormulaEditorBody();
            results.left = modalBody.left.scrollTop;
            results.workspace = modalBody.workspace.scrollTop;
            results.validation = modalBody.validation.scrollTop;
            """
        )
    )
    assert result == {"left": 321, "workspace": 22, "validation": 45}
