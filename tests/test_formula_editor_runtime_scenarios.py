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
        {{ code: 'time', name: '调度时段集合', type: 'set' }},
        {{ code: 'unit', name: '机组集合', type: 'set' }},
        {{ code: 'storage', name: '储能集合', type: 'set' }},
        {{ code: 'station', name: '电站集合', type: 'set' }}
      ],
      parameters: [
        {{ code: 'load_forecast', name: '负荷预测', type: 'parameter', dimension: ['time'], unit: 'MW', meaning: '各时段系统负荷' }},
        {{ code: 'fuel_cost', name: '燃料成本', type: 'parameter', dimension: ['unit'], unit: '元/MWh' }},
        {{ code: 'deviation_penalty_price', name: '偏差考核单价', type: 'parameter', unit: '元/MWh' }},
        {{ code: 'unit_max_output', name: '机组最大出力', type: 'parameter', dimension: ['unit'], unit: 'MW' }}
      ],
      variables: [
        {{ code: 'unit_output', name: '机组出力', type: 'variable', dimension: ['unit', 'time'], unit: 'MW' }},
        {{ code: 'unit_on', name: '机组启停状态', type: 'variable', dimension: ['unit', 'time'], unit: '0/1' }},
        {{ code: 'deviation', name: '偏差量', type: 'variable', dimension: ['time'], unit: 'MW' }}
      ]
    }};
    state.formulaEditor = {{ context, tokens: [], scopeIndices: [] }};

    const results = {{}};
    {scenario_script}
    console.log(JSON.stringify(results));
    """
    script_path = ROOT / f"__formula_runtime_{uuid.uuid4().hex}.js"
    script_path.write_text(script, encoding="utf-8")
    try:
        completed = subprocess.run(["node", str(script_path)], cwd=ROOT, text=True, encoding="utf-8", capture_output=True, check=False)
    finally:
        script_path.unlink(missing_ok=True)
    assert completed.returncode == 0, completed.stderr or completed.stdout
    return json.loads(completed.stdout)


def test_power_balance_dsl_parses_and_infers_time_scope() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const parsed = parseDslExpressionToTokens(
              'sum(unit_output[u,t] for u in unit) >= load_forecast[t]',
              context
            );
            assert.equal(parsed.ok, true);
            state.formulaEditor.tokens = parsed.tokens;
            const dsl = formulaTokensToDsl(parsed.tokens, context);
            const scope = inferFormulaScopeFromExpression(dsl, context, []);
            state.formulaEditor.scopeIndices = scope;
            const validation = validateFormulaText(dsl, 'constraint', context, parsed.tokens);
            assert.equal(dsl, 'sum(unit_output[u,t] for u in unit) >= load_forecast[t]');
            assert.deepEqual(scope, ['time']);
            assert.equal(validation.valid, true);
            results.dsl = dsl;
            results.scope = scope;
            results.valid = validation.valid;
            """
        )
    )
    assert result == {
        "dsl": "sum(unit_output[u,t] for u in unit) >= load_forecast[t]",
        "scope": ["time"],
        "valid": True,
    }


def test_objective_with_number_constant_and_square_compiles() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const dict = getFormulaSymbolDictionary(context);
            const tokens = [
              formulaNumberToken('0.5'),
              { type: 'operator', code: '*', dsl: '*', label: '×', readonly: true },
              formulaObjectToToken(dict.byCode.deviation_penalty_price, 'parameter'),
              { type: 'operator', code: '*', dsl: '*', label: '×', readonly: true },
              formulaSquareToken(formulaObjectToToken(dict.byCode.deviation, 'variable'), context)
            ];
            state.formulaEditor.tokens = tokens;
            state.formulaEditor.scopeIndices = ['time'];
            const dsl = formulaTokensToDsl(tokens, context);
            const validation = validateFormulaText(dsl, 'objective', context, tokens);
            assert.equal(dsl, '0.5 * deviation_penalty_price * (deviation[t]) ** 2');
            assert.equal(validation.valid, true);
            results.dsl = dsl;
            results.valid = validation.valid;
            """
        )
    )
    assert result["dsl"] == "0.5 * deviation_penalty_price * (deviation[t]) ** 2"
    assert result["valid"] is True


def test_index_context_avoids_storage_station_alias_collision() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const dict = getFormulaSymbolDictionary(context);
            const aggregateStorage = formulaAggregateToken('sum', dict.byCode.storage);
            const aggregateStation = formulaAggregateToken('sum', dict.byCode.station);
            state.formulaEditor.tokens = [aggregateStorage, aggregateStation];
            const indexContext = formulaIndexContext(context, state.formulaEditor.tokens, []);
            assert.equal(indexContext.aliases.storage, 's');
            assert.equal(indexContext.aliases.station, 's2');
            results.aliases = indexContext.aliases;
            """
        )
    )
    assert result["aliases"]["storage"] == "s"
    assert result["aliases"]["station"] == "s2"


def test_invalid_constraint_reports_missing_relation_and_free_index() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const dict = getFormulaSymbolDictionary(context);
            const tokens = [formulaObjectToToken(dict.byCode.unit_output, 'variable')];
            state.formulaEditor.tokens = tokens;
            state.formulaEditor.scopeIndices = [];
            const dsl = formulaTokensToDsl(tokens, context);
            const validation = validateFormulaText(dsl, 'constraint', context, tokens);
            assert.equal(validation.valid, false);
            assert(validation.errors.some(item => item.includes('缺少关系符')));
            assert(validation.errors.some(item => item.includes('自由索引 unit')));
            assert(validation.errors.some(item => item.includes('自由索引 time')));
            results.errors = validation.errors;
            """
        )
    )
    assert any("缺少关系符" in item for item in result["errors"])
    assert any("自由索引 unit" in item for item in result["errors"])
    assert any("自由索引 time" in item for item in result["errors"])


def test_single_equals_is_rejected_with_clear_message() -> None:
    result = _run_formula_editor_js(
        textwrap.dedent(
            """
            const validation = validateFormulaText('unit_output[u,t] = load_forecast[t]', 'constraint', context, []);
            assert.equal(validation.valid, false);
            assert(validation.errors.some(item => item.includes('不支持单等号')));
            results.errors = validation.errors;
            """
        )
    )
    assert any("不支持单等号" in item for item in result["errors"])
