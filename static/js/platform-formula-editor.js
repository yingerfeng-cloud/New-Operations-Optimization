// Shared formula editor and validation helpers.
    const COMMON_FORMULA_SYMBOLS = {
      time: { code: 'time', name: '时段', type: 'set', typeLabel: '集合', description: '模型的时间索引集合' },
      unit: { code: 'unit', name: '机组', type: 'set', typeLabel: '集合', description: '发电机组集合' },
      reservoir: { code: 'reservoir', name: '水库', type: 'set', typeLabel: '集合', description: '水库集合' },
      station: { code: 'station', name: '电站', type: 'set', typeLabel: '集合', description: '电站集合' },
      storage: { code: 'storage', name: '储能', type: 'set', typeLabel: '集合', description: '储能设备集合' },
      scenario: { code: 'scenario', name: '情景', type: 'set', typeLabel: '集合', description: '运行或不确定性情景集合' },
      load_forecast: { code: 'load_forecast', name: '负荷预测', type: 'parameter', typeLabel: '参数', indices: ['time'], unit: 'MW', description: '各时段系统负荷预测' },
      fuel_cost: { code: 'fuel_cost', name: '燃料成本', type: 'parameter', typeLabel: '参数', indices: ['unit'], unit: '元/MWh', description: '机组单位发电燃料成本' },
      unit_max_output: { code: 'unit_max_output', name: '机组最大出力', type: 'parameter', typeLabel: '参数', indices: ['unit'], unit: 'MW', description: '机组出力上限' },
      unit_min_output: { code: 'unit_min_output', name: '机组最小出力', type: 'parameter', typeLabel: '参数', indices: ['unit'], unit: 'MW', description: '机组出力下限' },
      ramp_up: { code: 'ramp_up', name: '上爬坡能力', type: 'parameter', typeLabel: '参数', indices: ['unit'], unit: 'MW', description: '相邻时段最大上调能力' },
      ramp_down: { code: 'ramp_down', name: '下爬坡能力', type: 'parameter', typeLabel: '参数', indices: ['unit'], unit: 'MW', description: '相邻时段最大下调能力' },
      initial_volume: { code: 'initial_volume', name: '初始库容', type: 'parameter', typeLabel: '参数', indices: ['reservoir'], unit: '万m³', description: '水库期初库容' },
      inflow: { code: 'inflow', name: '入库流量', type: 'parameter', typeLabel: '参数', indices: ['reservoir', 'time'], unit: 'm³/s', description: '水库各时段入库流量' },
      soc_min: { code: 'soc_min', name: 'SOC下限', type: 'parameter', typeLabel: '参数', indices: ['storage'], unit: '%', description: '储能荷电状态下限' },
      soc_max: { code: 'soc_max', name: 'SOC上限', type: 'parameter', typeLabel: '参数', indices: ['storage'], unit: '%', description: '储能荷电状态上限' },
      reserve_req: { code: 'reserve_req', name: '备用需求', type: 'parameter', typeLabel: '参数', indices: ['time'], unit: 'MW', description: '系统备用容量需求' },
      penalty_cost: { code: 'penalty_cost', name: '惩罚成本', type: 'parameter', typeLabel: '参数', unit: '元', description: '违约、偏差或松弛惩罚成本' },
      unit_output: { code: 'unit_output', name: '机组出力', type: 'variable', typeLabel: '决策变量', indices: ['unit', 'time'], unit: 'MW', description: '机组在各时段的发电出力' },
      unit_on: { code: 'unit_on', name: '机组启停状态', type: 'variable', typeLabel: '决策变量', indices: ['unit', 'time'], unit: '0/1', description: '机组是否处于开机状态' },
      charge: { code: 'charge', name: '充电功率', type: 'variable', typeLabel: '决策变量', indices: ['storage', 'time'], unit: 'MW', description: '储能设备充电功率' },
      discharge: { code: 'discharge', name: '放电功率', type: 'variable', typeLabel: '决策变量', indices: ['storage', 'time'], unit: 'MW', description: '储能设备放电功率' },
      soc: { code: 'soc', name: '储能SOC', type: 'variable', typeLabel: '决策变量', indices: ['storage', 'time'], unit: '%', description: '储能荷电状态' },
      volume: { code: 'volume', name: '库容', type: 'variable', typeLabel: '决策变量', indices: ['reservoir', 'time'], unit: '万m³', description: '水库在各时段的库容' },
      spill: { code: 'spill', name: '弃水量', type: 'variable', typeLabel: '决策变量', indices: ['reservoir', 'time'], unit: 'm³/s', description: '未用于发电的弃水流量' },
      outflow: { code: 'outflow', name: '出库流量', type: 'variable', typeLabel: '决策变量', indices: ['reservoir', 'time'], unit: 'm³/s', description: '水库出库流量' },
      deviation: { code: 'deviation', name: '偏差量', type: 'variable', typeLabel: '决策变量', indices: ['time'], unit: 'MW', description: '计划或负荷跟踪偏差' }
    };

    const FORMULA_FUNCTION_GROUPS = [
      { title: 'Aggregate', items: [
        { label: 'Σ', symbol: 'sum', description: '求和：对集合成员表达式求和', example: 'sum(unit_output[u,t] for u in unit)', insert: 'sum(expr for i in set)' },
        { label: 'min', symbol: 'min', description: '最小值：取集合成员表达式最小值', example: 'min(unit_output[u,t] for u in unit)', insert: 'min(expr for i in set)' },
        { label: 'max', symbol: 'max', description: '最大值：取集合成员表达式最大值', example: 'max(unit_output[u,t] for u in unit)', insert: 'max(expr for i in set)' }
      ]},
      { title: 'Functions', items: [
        { label: 'abs', symbol: 'abs', description: '绝对值：计算表达式绝对值', example: 'abs(deviation[t])', insert: 'abs(expr)' },
        { label: 'x²', symbol: 'x²', description: '平方：用于二次惩罚或偏差平方', example: '(deviation[t]) ** 2', insert: '(expr) ** 2' }
      ]},
      { title: 'Scientific', items: [
        { label: 'ln', symbol: 'log', description: '自然对数：log(expr)', example: 'log(deviation[t] + 1)', insert: 'log(expr)' },
        { label: 'exp', symbol: 'exp', description: '自然指数：exp(expr)', example: 'exp(deviation[t])', insert: 'exp(expr)' },
        { label: '√x', symbol: 'sqrt', description: '平方根：sqrt(expr)', example: 'sqrt(deviation[t] + 1)', insert: 'sqrt(expr)' },
        { label: 'xⁿ', symbol: 'pow', description: '任意幂次：生成 (expr) ** n', example: '(deviation[t]) ** 3', insert: '(expr) ** n' }
      ]},
      { title: 'Relations', items: [
        { label: '≤', symbol: '<=', description: '小于等于：约束左端不超过右端', example: 'unit_output[u,t] <= unit_max_output[u]', insert: ' <= ' },
        { label: '≥', symbol: '>=', description: '大于等于：约束左端不低于右端', example: 'sum(unit_output[u,t] for u in unit) >= load_forecast[t]', insert: ' >= ' },
        { label: '=', symbol: '==', description: '等于：约束两端必须相等', example: 'charge[s,t] == discharge[s,t]', insert: ' == ' }
      ]},
      { title: 'Operators', items: [
        { label: '+', symbol: '+', description: '加：表达式相加', example: 'a + b', insert: ' + ' },
        { label: '-', symbol: '-', description: '减：表达式相减', example: 'a - b', insert: ' - ' },
        { label: '×', symbol: '*', description: '乘：表达式相乘', example: 'fuel_cost[u] * unit_output[u,t]', insert: ' * ' },
        { label: '÷', symbol: '/', description: '除：表达式相除', example: 'outflow[r,t] / 1000', insert: ' / ' }
      ]}
    ];

    function formulaContextFromComponent(component = {}) {
      return {
        component,
        sets: component.sets || [],
        parameters: component.parameters || component.inputs || [],
        variables: component.variables || []
      };
    }

    function getFormulaSymbolDictionary(context = {}) {
      const dict = { sets: [], parameters: [], variables: [], objectives: [], indices: [], all: [], byCode: {} };
      const add = (item, type) => {
        const normalized = normalizeFormulaSymbol(item, type);
        if (!normalized.code) return;
        const fallback = COMMON_FORMULA_SYMBOLS[normalized.code] || {};
        const finalItem = {
          ...fallback,
          ...normalized,
          name: normalized.hasCustomName ? normalized.name : fallback.name || normalized.code,
          type: normalized.type || fallback.type || type,
          typeLabel: normalized.typeLabel || fallback.typeLabel || formulaTypeLabel(type),
          indices: normalized.indices.length ? normalized.indices : (fallback.indices || []),
          unit: normalized.unit || fallback.unit || '',
          description: normalized.description || fallback.description || '',
          missingName: !normalized.hasCustomName && !fallback.name
        };
        if (dict.byCode[finalItem.code]) {
          Object.assign(dict.byCode[finalItem.code], finalItem);
          return;
        }
        dict.byCode[finalItem.code] = finalItem;
        dict.all.push(finalItem);
        if (finalItem.type === 'set') dict.sets.push(finalItem);
        else if (finalItem.type === 'parameter') dict.parameters.push(finalItem);
        else if (finalItem.type === 'variable') dict.variables.push(finalItem);
        else dict.objectives.push(finalItem);
      };
      collectFormulaItems(context.sets || context.model?.sets || context.component?.sets, 'set').forEach(item => add(item, 'set'));
      collectFormulaItems(context.parameters || context.inputs || context.model?.parameters || context.component?.parameters || context.component?.inputs, 'parameter').forEach(item => add(item, 'parameter'));
      collectFormulaItems(context.variables || context.model?.variables || context.component?.variables, 'variable').forEach(item => add(item, 'variable'));
      collectFormulaItems(context.objectives || context.objective_terms || context.model?.objective_terms || context.component?.objective_terms, 'objective').forEach(item => add(item, 'objective'));
      if (context.includeCommonSymbols) {
        ['time', 'unit', 'reservoir', 'station', 'storage', 'scenario'].forEach(code => {
          if (!dict.byCode[code]) add(COMMON_FORMULA_SYMBOLS[code], 'set');
        });
      }
      dict.indices = dict.sets.slice();
      return dict;
    }

    function collectFormulaItems(source, type) {
      if (!source) return [];
      if (Array.isArray(source)) return source.map(item => typeof item === 'string' ? { code: item, type } : item);
      if (typeof source === 'object') return Object.entries(source).map(([code, value]) => typeof value === 'object' ? { code, ...value, type } : { code, type });
      return [];
    }

    function normalizeFormulaSymbol(item, type) {
      const code = String(item?.code || item?.key || item?.math_param || item?.math_var || item?.name || item?.term_id || item?.constraint_id || '').trim();
      const rawName = String(item?.display_name || item?.label || item?.cn_name || item?.title || item?.name || '').trim();
      const hasCustomName = Boolean(rawName && rawName !== code && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawName));
      const indices = item?.indices || item?.dimension || item?.dims || item?.key || item?.foreach || [];
      return {
        code,
        name: hasCustomName ? rawName : code,
        hasCustomName,
        type: item?.type === 'set' || item?.kind === 'set' ? 'set' : type,
        typeLabel: formulaTypeLabel(type),
        indices: Array.isArray(indices) ? indices.map(x => typeof x === 'string' ? x : x?.set || x?.key || x?.name).filter(Boolean) : String(indices || '').split(',').map(x => x.trim()).filter(Boolean),
        unit: item?.unit || '',
        description: item?.description || item?.meaning || item?.business_meaning || item?.desc || ''
      };
    }

    function formulaTypeLabel(type) {
      return { set: '集合', parameter: '参数', variable: '决策变量', objective: '目标项' }[type] || '对象';
    }

    function renderFormulaReadable(expression, context = {}) {
      const raw = String(expression || '').trim();
      if (!raw) return '-';
      const dict = getFormulaSymbolDictionary(context);
      const renderBasic = text => String(text || '')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/==/g, '=')
        .replace(/\*\*\s*(-?\d+(?:\.\d+)?)/g, '^$1')
        .replace(/\s+\^/g, '^')
        .replace(/\blog\s*\(/g, 'ln(')
        .replace(/\bsqrt\s*\(/g, '√(')
        .replace(/\*/g, '×')
        .replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, token => {
          if (['sum', 'for', 'in', 'min', 'max', 'abs', 'ln', 'exp', 'if', 'else', 'piecewise'].includes(token)) return token;
          return dict.byCode[token]?.name || COMMON_FORMULA_SYMBOLS[token]?.name || token;
        });
      const sumMatch = raw.match(/^sum\(([\s\S]+)\)$/);
      if (sumMatch) {
        return renderSumReadable(sumMatch[1], dict, renderBasic);
      }
      const withSums = raw.replace(/sum\(([^()]+(?:\([^)]*\)[^()]*)?)\)/g, (_, body) => renderSumReadable(body, dict, renderBasic));
      return renderBasic(withSums);
    }

    function renderSumReadable(body, dict, renderBasic) {
      const parts = String(body || '').split(/\s+for\s+/);
      const inner = parts.shift() || '';
      const ranges = parts.map(part => {
        const m = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!m) return '';
        const setCode = m[2];
        const name = dict.byCode[setCode]?.name || COMMON_FORMULA_SYMBOLS[setCode]?.name || dict.byCode[m[1]]?.name || COMMON_FORMULA_SYMBOLS[m[1]]?.name || setCode;
        return `${name} ${setCode}`;
      }).filter(Boolean);
      return `∑(${ranges.join(', ') || '索引'}) ${renderBasic(inner)}`;
    }

    function formulaScopeFromApply(options = {}) {
      const apply = options.apply || {};
      try {
        if (Array.isArray(options.scopeIndices)) return options.scopeIndices.filter(Boolean);
        if (Array.isArray(options.scope)) return options.scope.filter(Boolean);
        if (apply.type === 'componentConstraint') {
          const row = (state.componentEditor?.component?.constraints || [])[apply.index] || {};
          return normalizeFormulaScopeList(row.indices || row.foreach || row.scope);
        }
        if (apply.type === 'componentObjective') {
          return [];
        }
        if (apply.type === 'genericConstraint') {
          const row = (getIndexedGenericParts().constraints || [])[apply.index] || {};
          return normalizeFormulaScopeList(row.foreach || row.indices || row.scope);
        }
        if (apply.type === 'genericObjective') {
          return [];
        }
      } catch (e) {}
      return [];
    }

    function normalizeFormulaScopeList(value) {
      if (!value) return [];
      const list = Array.isArray(value) ? value : String(value || '').split(',');
      return [...new Set(list.map(item => {
        if (typeof item === 'string') return item.split(':')[0].trim();
        return item?.set || item?.code || item?.key || item?.name || '';
      }).filter(Boolean))];
    }

    function formulaScopeItems(context = {}, scopeIndices = []) {
      const dict = getFormulaSymbolDictionary(context);
      return (scopeIndices || []).map(code => dict.byCode[code] || COMMON_FORMULA_SYMBOLS[code] || { code, name: code }).filter(item => item.code);
    }

    function renderFormulaReadableWithScope(expression, context = {}, scopeIndices = [], advanced = false) {
      const formula = renderFormulaReadable(expression, context);
      const scope = formulaScopeItems(context, scopeIndices);
      if (!scope.length) return formula;
      const prefix = advanced
        ? `∀ ${scope.map(item => `${item.name} ${item.code}`).join(', ')}：`
        : `对所有${scope.map(item => `${item.name} ${item.code}`).join('、')}：`;
      return `${prefix}\n${formula}`;
    }

    function formulaDisplayHtml(expression, context = {}) {
      const raw = String(expression || '').trim();
      if (!raw) return '<span class="muted">-</span>';
      return `<div class="formula-readable">${escapeHtml(renderFormulaReadable(raw, context))}</div><details class="formula-raw-toggle"><summary>原始 DSL</summary><pre class="code-scroll">${escapeHtml(raw)}</pre></details>`;
    }

    const FORMULA_OPERATOR_LABELS = { '+': '+', '-': '-', '*': '×', '/': '÷', '<=': '≤', '>=': '≥', '==': '=', '(': '(', ')': ')' };
    const FORMULA_OPERATOR_DSL = { '+': '+', '-': '-', '*': '*', '/': '/', '<=': '<=', '>=': '>=', '==': '==', '×': '*', '÷': '/', '≤': '<=', '≥': '>=', '=': '==', '(': '(', ')': ')' };
    const FORMULA_FUNCTION_LABELS = { sum: 'Σ', min: 'min', max: 'max', abs: 'abs', pow2: 'x²', log: 'ln', exp: 'exp', sqrt: '√x', pow: 'xⁿ' };
    const FORMULA_FUNCTION_CN_LABELS = { sum: '求和', min: '最小值', max: '最大值', abs: '绝对值', pow2: '平方', log: '自然对数', exp: '自然指数', sqrt: '平方根', pow: '任意幂' };
    const FORMULA_BUSINESS_DISPLAY_NAMES = {
      power_balance: '功率平衡',
      reserve_margin: '备用裕度',
      output_bound: '出力边界',
      ramp_limit: '爬坡约束',
      startup_cost: '启动成本',
      fuel_cost: '燃料成本',
      objective: '目标函数'
    };

    function openFormulaEditor(options = {}) {
      const context = options.context || formulaContextFromComponent(state.componentEditor?.component || {});
      const sourceRow = formulaEditorSourceRow(options) || {};
      const originalValue = options.value || sourceRow.dsl_formula || sourceRow.expression || sourceRow.formula || '';
      const tokens = normalizeFormulaTokens(sourceRow.tokens, context, originalValue);
      const dsl = tokens.length ? formulaTokensToDsl(tokens, context) : String(originalValue || '');
      const display = tokens.length ? formulaTokensToDisplay(tokens, context) : renderFormulaReadable(dsl, context);
      const mode = options.mode || 'constraint';
      const inferredScope = mode === 'objective' ? [] : inferFormulaScopeFromExpression(dsl, context, inferFormulaScopeFromTokens(tokens, context, formulaScopeFromApply(options)));
      const title = formulaEditorTitle(options, sourceRow);
      state.formulaEditor = {
        title,
        path: options.path || formulaEditorPath(options),
        mode,
        originalValue,
        value: dsl,
        displayFormula: display,
        dslFormula: dsl,
        tokens,
        advancedDslOpen: false,
        advancedExpressionOnly: false,
        context,
        apply: options.apply || null,
        insertedTemplate: '',
        symbolSearch: '',
        scopeIndices: inferredScope,
        validation: { valid: true, errors: [], explanations: [] }
      };
      state.formulaEditor.validation = validateFormulaText(dsl, mode, context, tokens);
      openInfoModal('统一公式编辑器', formulaEditorHtml(), { wide: true });
      const modalEl = document.getElementById('modal');
      if (modalEl) {
        modalEl.style.zIndex = '9999';
        modalEl.classList.add('formula-editor-modal');
      }
    }

    function formulaEditorTitle(options = {}, sourceRow = {}) {
      const raw = String(options.title || '').trim();
      const prefix = raw.match(/^(正在编辑：|正在编辑:\s*)(.*)$/);
      const rawCode = String(sourceRow.constraint_id || sourceRow.term_id || sourceRow.code || sourceRow.name || prefix?.[2] || raw || '').trim();
      const code = formulaEditorCodeFromTitle(rawCode);
      const directName = sourceRow.display_name || sourceRow.cn_name || sourceRow.chinese_name || sourceRow.label || '';
      const rowName = sourceRow.name && sourceRow.name !== code ? sourceRow.name : '';
      const mapped = (typeof BUSINESS_DISPLAY_NAMES !== 'undefined' && code) ? BUSINESS_DISPLAY_NAMES[code] : '';
      const formulaMapped = code ? FORMULA_BUSINESS_DISPLAY_NAMES[code] : '';
      const label = directName || rowName || mapped || formulaMapped || prefix?.[2] || raw || '公式';
      return label.startsWith('正在编辑') ? label : `正在编辑：${label}`;
    }

    function formulaEditorCodeFromTitle(value = '') {
      const raw = String(value || '').trim();
      const exact = raw.replace(/^(正在编辑：|正在编辑:\s*)/, '').trim();
      if (FORMULA_BUSINESS_DISPLAY_NAMES[exact]) return exact;
      const tail = exact.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
      return tail?.[1] || exact;
    }

    function formulaEditorPath(options = {}) {
      if (options.apply?.type === 'componentConstraint') return `组件库 / ${state.componentEditor?.component?.name || '组件'} / 数学定义 / ${options.title || '约束公式'}`;
      if (options.apply?.type === 'componentObjective') return `组件库 / ${state.componentEditor?.component?.name || '组件'} / 数学定义 / ${options.title || '目标项公式'}`;
      if (options.apply?.type === 'genericConstraint') return `模型创建 / 数学展开 / ${options.title || '约束公式'}`;
      if (options.apply?.type === 'genericObjective') return `模型创建 / 数学展开 / ${options.title || '目标项公式'}`;
      return options.title || '公式编辑';
    }

    function formulaEditorSourceRow(options = {}) {
      const apply = options.apply || {};
      try {
        if (apply.type === 'componentConstraint') return (state.componentEditor?.component?.constraints || [])[apply.index] || {};
        if (apply.type === 'componentObjective') return (state.componentEditor?.component?.objective_terms || [])[apply.index] || {};
        if (apply.type === 'genericConstraint') return (getIndexedGenericParts().constraints || [])[apply.index] || {};
        if (apply.type === 'genericObjective') return (getIndexedGenericParts().objective?.terms || [])[apply.index] || {};
      } catch (e) {}
      return {};
    }

    function formulaEditorHtml() {
      const editor = state.formulaEditor || {};
      const ctx = editor.context || {};
      const validation = editor.validation || validateFormulaText(editor.dslFormula || editor.value || '', editor.mode, ctx, editor.tokens || []);
      const scope = editor.scopeIndices || [];
      return `<div class="formula-modal-grid" onclick="if(!event.target.closest('#formulaTokenEditor')&&!event.target.closest('.formula-template-panel')) clearFormulaInsertionPoint()">
        <div class="formula-template-panel">
          <input class="search" placeholder="搜索对象：中文、编码或说明" value="${escapeHtml(editor.symbolSearch || '')}" oninput="updateFormulaSymbolSearch(this.value)" />
          <div id="formulaSymbolPanel">${formulaSymbolPanelHtml(ctx, editor.symbolSearch || '')}</div>
          ${formulaFunctionPanelHtml()}
        </div>
        <div class="formula-subblock formula-workspace">
          <div class="formula-subtitle"><span>${escapeHtml(editor.title)}</span>${pill(editor.mode === 'objective' ? '目标函数' : '约束公式')}</div>
          <p class="muted">${escapeHtml(editor.path || '-')}</p>
          ${formulaScopeAliasBannerHtml(ctx, scope)}
          <details class="formula-advanced-scope"><summary>高级设置：作用范围 / 展开索引</summary>${formulaScopeEditorHtml(ctx, scope)}</details>
          <div class="formula-readable" id="formulaDisplayPreview">${escapeHtml(editor.displayFormula || formulaTokensToDisplay(editor.tokens || [], ctx) || '-')}</div>
          <div id="formulaTokenEditor" class="formula-token-editor" aria-label="标签化公式编辑器" tabindex="0" onkeydown="handleFormulaTokenEditorKeydown(event)" onclick="clearFormulaInsertionPoint()">
            ${formulaTokenSequenceHtml(editor.tokens || [], ctx)}
          </div>
          <details class="formula-advanced-dsl" ${editor.advancedDslOpen ? 'open' : ''} ontoggle="toggleFormulaAdvancedDsl(this.open)">
            <summary>高级模式：DSL 表达式</summary>
            <!-- legacy id="advancedFormulaDslText" -->
            <textarea id="unifiedFormulaText" class="formula-textarea formula-dsl-textarea" oninput="updateAdvancedDslFormula(this.value)">${escapeHtml(editor.dslFormula || editor.value || '')}</textarea>
            <p class="muted">高级模式修改后会尝试重新解析为 token。无法解析时可作为高级表达式保存，但会保留更严格校验提示。</p>
          </details>
          <div class="actions mt"><button class="btn" onclick="event.stopPropagation();validateCurrentFormula()">校验公式</button><button class="btn primary" onclick="event.stopPropagation();applyFormulaEditor()">应用到当前字段</button><button class="btn" onclick="event.stopPropagation();cancelFormulaEditor()">取消</button><button class="btn" onclick="event.stopPropagation();showFormulaExamples()">查看示例</button></div>
        </div>
        <div class="formula-subblock formula-validation-panel">
          <div class="formula-subtitle">实时预览与校验</div>
          <div id="formulaFunctionHelpPanel">${formulaFunctionHelpHtml(editor.activeFunction || 'sum')}</div>
          <div id="formulaValidationPanel">${formulaValidationHtml(validation, ctx, editor.value || '')}</div>
        </div>
      </div>`;
    }

    function formulaTokenSequenceHtml(tokens = [], context = {}) {
      if (!(tokens || []).length) {
        return `${formulaCaretHtml('root', 0)}<span class="muted">从左侧集合、参数、变量、函数或运算符插入公式标签。</span>`;
      }
      return `${formulaCaretHtml('root', 0)}${tokens.map((token, index) => `${formulaTokenHtml(token, index, context)}${formulaCaretHtml('root', index + 1)}`).join('')}`;
    }

    function formulaCaretHtml(kind = 'root', index = 0, parentIndex = null, childIndex = null) {
      const active = formulaInsertionMatches(kind, index, parentIndex, childIndex) ? ' active' : '';
      const parentArg = parentIndex === null ? 'null' : String(parentIndex);
      const childArg = childIndex === null ? 'null' : String(childIndex);
      return `<span role="button" tabindex="0" class="formula-insert-caret${active}" aria-label="当前插入位置" title="在此处插入" onclick="event.stopPropagation();setFormulaInsertionPoint('${escapeHtml(kind)}', ${index}, ${parentArg}, ${childArg})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setFormulaInsertionPoint('${escapeHtml(kind)}', ${index}, ${parentArg}, ${childArg});}"></span>`;
    }

    function formulaInsertionMatches(kind = 'root', index = 0, parentIndex = null, childIndex = null) {
      const point = state.formulaEditor?.insertionPoint;
      if (!point) return false;
      return point.kind === kind && point.index === index && (point.parentIndex ?? null) === parentIndex && (point.childIndex ?? null) === childIndex;
    }

    function formulaTokenHtml(token = {}, index = 0, context = {}) {
      const title = formulaTokenTooltip(token, context);
      const label = formulaTokenLabel(token, context);
      const selected = state.formulaEditor?.selectedTokenIndex === index && !state.formulaEditor?.selectedChildToken && !state.formulaEditor?.selectedNestedChild && !state.formulaEditor?.selectedWrapperChild ? ' selected' : '';
      const cls = `formula-token formula-token-${escapeHtml(token.type || 'text')}${selected}`;
      if (token.type === 'aggregate') {
        const aggregateSetName = aggregateTokenSetName(token, context);
        const children = token.body_tokens || [];
        const body = children.length
          ? `${formulaCaretHtml('aggregate', 0, index)}${children.map((child, childIndex) => `${formulaAggregateChildHtml(child, index, childIndex, context)}${formulaCaretHtml('aggregate', childIndex + 1, index)}`).join('')}`
          : `${formulaCaretHtml('aggregate', 0, index)}<span class="formula-aggregate-empty">${token.set ? '表达式区域' : '请选择集合和表达式'}</span>`;
        return `<span class="${cls}" contenteditable="false" draggable="true" data-index="${index}" aria-label="聚合索引：${escapeHtml(aggregateSetName)} ${escapeHtml(token.set || '')}" title="${escapeHtml(title)}" onclick="event.stopPropagation();openFormulaTokenProperties(${index})" ondragstart="formulaTokenDragStart(event, ${index})" ondragover="event.preventDefault()" ondrop="formulaTokenDrop(event, ${index})"><span class="formula-aggregate-head">${escapeHtml(label)}</span><span class="formula-aggregate-body">${body}</span><button type="button" title="左移" onclick="event.stopPropagation();moveFormulaToken(${index}, -1)">‹</button><button type="button" title="右移" onclick="event.stopPropagation();moveFormulaToken(${index}, 1)">›</button><button type="button" title="删除" onclick="event.stopPropagation();removeFormulaToken(${index})">×</button></span>`;
      }
      if (isFormulaWrapperToken(token)) {
        const bodyTokens = token.body_tokens || [];
        const body = bodyTokens.length
          ? `${formulaCaretHtml('wrapper', 0, index)}${bodyTokens.map((child, childIndex) => `${formulaWrapperChildHtml(child, index, childIndex, context)}${formulaCaretHtml('wrapper', childIndex + 1, index)}`).join('')}`
          : `${formulaCaretHtml('wrapper', 0, index)}<span class="formula-aggregate-empty">选择要作用的标签</span>`;
        return `<span class="formula-token formula-token-function formula-token-wrapper formula-token-${escapeHtml(token.type)}${selected}" contenteditable="false" draggable="true" data-index="${index}" title="${escapeHtml(title)}" onclick="event.stopPropagation();openFormulaTokenProperties(${index})" ondragstart="formulaTokenDragStart(event, ${index})" ondragover="event.preventDefault()" ondrop="formulaTokenDrop(event, ${index})"><span class="formula-wrapper-head">${escapeHtml(wrapperTokenHead(token))}</span><span class="formula-aggregate-body">${body}</span><button type="button" title="左移" onclick="event.stopPropagation();moveFormulaToken(${index}, -1)">‹</button><button type="button" title="右移" onclick="event.stopPropagation();moveFormulaToken(${index}, 1)">›</button><button type="button" title="删除" onclick="event.stopPropagation();removeFormulaToken(${index})">×</button></span>`;
      }
      return `<span class="${cls}" contenteditable="false" draggable="true" data-index="${index}" title="${escapeHtml(title)}" onclick="event.stopPropagation();openFormulaTokenProperties(${index})" ondragstart="formulaTokenDragStart(event, ${index})" ondragover="event.preventDefault()" ondrop="formulaTokenDrop(event, ${index})"><span>${escapeHtml(label)}</span><button type="button" title="左移" onclick="event.stopPropagation();moveFormulaToken(${index}, -1)">‹</button><button type="button" title="右移" onclick="event.stopPropagation();moveFormulaToken(${index}, 1)">›</button><button type="button" title="删除" onclick="event.stopPropagation();removeFormulaToken(${index})">×</button></span>`;
    }

    function formulaAggregateChildHtml(child = {}, parentIndex = 0, childIndex = 0, context = {}) {
      const selected = state.formulaEditor?.selectedChildToken?.parentIndex === parentIndex && state.formulaEditor?.selectedChildToken?.childIndex === childIndex ? ' selected' : '';
      if (child.type === 'aggregate') {
        const nestedBody = (child.body_tokens || []).length
          ? `${formulaCaretHtml('nestedAggregate', 0, parentIndex, childIndex)}${(child.body_tokens || []).map((item, nestedIndex) => `<span class="formula-aggregate-nested-child${state.formulaEditor?.selectedNestedChild?.parentIndex === parentIndex && state.formulaEditor?.selectedNestedChild?.childIndex === childIndex && state.formulaEditor?.selectedNestedChild?.nestedIndex === nestedIndex ? ' selected' : ''}" onclick="event.stopPropagation();openNestedAggregateBodyTokenProperties(${parentIndex}, ${childIndex}, ${nestedIndex})">${escapeHtml(formulaTokenLabel(item, context))}</span>${formulaCaretHtml('nestedAggregate', nestedIndex + 1, parentIndex, childIndex)}`).join('')}`
          : `${formulaCaretHtml('nestedAggregate', 0, parentIndex, childIndex)}<span class="formula-aggregate-empty">表达式区域</span>`;
        return `<span class="formula-aggregate-child formula-aggregate-child-nested${selected}" title="${escapeHtml(formulaTokenTooltip(child, context))}" onclick="event.stopPropagation();openAggregateChildTokenProperties(${parentIndex}, ${childIndex})"><span class="formula-aggregate-head">${escapeHtml(aggregateTokenLabel(child, context))}</span><span class="formula-aggregate-body">${nestedBody}</span><button type="button" title="删除" onclick="event.stopPropagation();removeAggregateBodyToken(${parentIndex}, ${childIndex})">×</button></span>`;
      }
      return `<span class="formula-aggregate-child${selected}" title="${escapeHtml(formulaTokenTooltip(child, context))}" onclick="event.stopPropagation();openAggregateChildTokenProperties(${parentIndex}, ${childIndex})">${escapeHtml(formulaTokenLabel(child, context))}<button type="button" title="删除" onclick="event.stopPropagation();removeAggregateBodyToken(${parentIndex}, ${childIndex})">×</button></span>`;
    }

    function formulaWrapperChildHtml(child = {}, parentIndex = 0, childIndex = 0, context = {}) {
      const selected = state.formulaEditor?.selectedWrapperChild?.parentIndex === parentIndex && state.formulaEditor?.selectedWrapperChild?.childIndex === childIndex ? ' selected' : '';
      return `<span class="formula-aggregate-child${selected}" title="${escapeHtml(formulaTokenTooltip(child, context))}" onclick="event.stopPropagation();openWrapperChildTokenProperties(${parentIndex}, ${childIndex})">${escapeHtml(formulaTokenLabel(child, context))}<button type="button" title="删除" onclick="event.stopPropagation();removeWrapperBodyToken(${parentIndex}, ${childIndex})">×</button></span>`;
    }

    function isFormulaWrapperToken(token = {}) {
      return ['square', 'power', 'unary'].includes(token.type);
    }

    function wrapperTokenHead(token = {}) {
      if (token.type === 'square') return '(...)²';
      if (token.type === 'power') return `(...)^${token.exponent || 'n'}`;
      return FORMULA_FUNCTION_LABELS[token.fn || token.code] || token.fn || token.code || 'fn';
    }

    function formulaScopeAliasBannerHtml(context = {}, scopeIndices = []) {
      const rows = formulaScopeItems(context, scopeIndices || []);
      if (!rows.length) return '<div class="formula-scope-alias-banner muted">作用范围：系统将根据自由索引自动推断。</div>';
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], scopeIndices || []);
      return `<div class="formula-scope-alias-banner" title="${escapeHtml(rows.map(item => `${item.name || item.code}：${item.description || item.code}`).join('\n'))}">作用范围：${rows.map(item => `<code>∀ ${escapeHtml(indexContext.aliases[item.code] || defaultIndexAlias(item.code))} ∈ ${escapeHtml(item.code)}</code>`).join(' ')}</div>`;
    }

    function formulaTokenScopePrefixHtml(context = {}, scopeIndices = [], mode = 'constraint') {
      const scope = mode === 'objective' ? [] : formulaScopeItems(context, scopeIndices || []);
      if (!scope.length) return '';
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], scopeIndices || []);
      return `<span class="formula-token-scope-prefix" contenteditable="false" title="${escapeHtml(scope.map(item => `${item.name || item.code} ${item.code}`).join('\n'))}">${escapeHtml(`∀ ${scope.map(item => `${indexContext.aliases[item.code] || defaultIndexAlias(item.code)} ∈ ${item.code}`).join(', ')} :`)}</span>`;
    }

    function formulaScopeEditorHtml(context = {}, scopeIndices = []) {
      const dict = getFormulaSymbolDictionary(context);
      const selected = new Set(scopeIndices || []);
      const options = dict.sets.filter(item => !selected.has(item.code));
      const selectedRows = formulaScopeItems(context, scopeIndices);
      return `<div class="formula-scope-editor">
        <div class="formula-scope-head"><strong>作用范围 / 展开索引</strong><span class="muted">${selectedRows.length ? '约束按所选集合逐项展开' : '该公式尚未配置展开范围'}</span></div>
        <div class="formula-scope-controls">
          <select id="formulaScopeSelect">${options.map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} - ${escapeHtml(item.name || item.code)}</option>`).join('') || '<option value="">未绑定</option>'}</select>
          <button type="button" class="btn" onclick="addFormulaScopeIndex()">新增范围</button>
        </div>
        <div class="formula-scope-list">${selectedRows.map((item, index) => `<div class="formula-scope-row"><span><b>${escapeHtml(item.name)}</b> <code>${escapeHtml(item.code)}</code></span><span class="formula-scope-actions"><button type="button" class="btn" onclick="moveFormulaScopeIndex(${index}, -1)" ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" class="btn" onclick="moveFormulaScopeIndex(${index}, 1)" ${index === selectedRows.length - 1 ? 'disabled' : ''}>下移</button><button type="button" class="btn" onclick="removeFormulaScopeIndex(${index})">删除</button></span></div>`).join('') || '<p class="muted">未选择时，中文预览不显示 ∀；可从上方选择 time、unit、reservoir 等集合。</p>'}</div>
      </div>`;
    }

    function formulaSymbolPanelHtml(context, query = '') {
      const dict = getFormulaSymbolDictionary(context);
      const q = String(query || '').trim().toLowerCase();
      const groups = [['集合', dict.sets], ['参数', dict.parameters], ['变量', dict.variables]];
      return groups.map(([title, items]) => {
        const filtered = items.filter(item => !q || [item.name, item.code, item.description].some(v => String(v || '').toLowerCase().includes(q)));
        const openAttr = q || title !== '集合' ? 'open' : '';
        return `<details class="formula-subblock formula-symbol-section" ${openAttr}><summary class="formula-symbol-summary"><span>${title}</span><span class="pill blue">${filtered.length}</span></summary><div class="symbol-list">${filtered.map(symbolItemHtml).join('') || '<span class="muted">暂无</span>'}</div></details>`;
      }).join('');
    }

    function symbolItemHtml(item) {
      const meta = [`<span class="chip">${escapeHtml(item.typeLabel)}</span>`];
      if ((item.indices || []).length) meta.push(`<span class="chip">[${escapeHtml(item.indices.join(','))}]</span>`);
      if (item.unit) meta.push(`<span class="chip">${escapeHtml(item.unit)}</span>`);
      if (item.missingName) meta.push('<span class="chip">未维护中文名</span>');
      return `<button type="button" class="symbol-item" title="${escapeHtml(formulaTokenTooltip(item))}" onclick="insertFormulaTokenFromObject('${escapeHtml(item.type)}','${escapeHtml(item.code)}')"><span class="symbol-main"><span class="symbol-name">${escapeHtml(formulaObjectLabel(item, item.type))}</span><span class="symbol-code">${escapeHtml(item.typeLabel || formulaTypeLabel(item.type))}</span></span><span class="symbol-meta">${meta.join('')}</span></button>`;
    }

    function formulaFunctionPanelHtml() {
      const helperSymbols = new Set(['sum', 'min', 'max', 'abs', 'x²', 'log', 'exp', 'sqrt', 'pow']);
      const helperGroups = FORMULA_FUNCTION_GROUPS
        .map(group => ({ ...group, items: group.items.filter(item => helperSymbols.has(item.symbol)) }))
        .filter(group => group.items.length);
      const helpers = helperGroups.map(group => `<div class="formula-subblock formula-calculator-panel"><div class="formula-subtitle">${escapeHtml(group.title)}</div><div class="formula-calculator-grid">${group.items.map(item => `<button type="button" class="formula-calculator-btn" title="${escapeHtml(`${item.description}\nExample: ${item.example}`)}" ${item.disabled ? 'disabled' : `onclick="insertFormulaFunctionToken('${escapeHtml(item.symbol)}')"`}><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.symbol)}</span></button>`).join('')}</div></div>`).join('');
      const quickRows = [
        ['C', '(', ')', '/'],
        ['7', '8', '9', '*'],
        ['4', '5', '6', '-'],
        ['1', '2', '3', '+'],
        ['0', '.', '<=', '>='],
        ['==']
      ];
      const calculatorHints = {
        C: '清空当前公式',
        '(': '左括号：开始一个表达式分组',
        ')': '右括号：结束一个表达式分组'
      };
      const quick = `<div class="formula-subblock formula-quick-panel"><div class="formula-subtitle">Calculator</div><div class="formula-quick-grid">${quickRows.flat().map(symbol => {
        const isNumber = /^\d|\.$/.test(symbol);
        const label = symbol === '/' ? '÷' : symbol === '*' ? '×' : FORMULA_OPERATOR_LABELS[symbol] || symbol;
        const action = symbol === 'C' ? 'clearFormulaEditorTokens()' : isNumber ? `insertFormulaNumberToken('${escapeHtml(symbol)}')` : `insertFormulaOperatorToken('${escapeHtml(symbol)}')`;
        return `<button type="button" class="formula-quick-btn formula-quick-btn-${symbol === 'C' ? 'clear' : isNumber ? 'number' : 'operator'}${symbol === '0' ? ' formula-quick-btn-wide' : ''}" title="${escapeHtml(calculatorHints[symbol] || `插入 ${label}`)}" onclick="${action}"><b>${escapeHtml(label)}</b></button>`;
      }).join('')}</div></div>`;
      return `${helpers}${quick}`;
    }

    function formulaFunctionHelpHtml(fn = 'sum') {
      const help = {
        sum: { title: '求和 Σ', purpose: '对集合成员求和。', syntax: 'Σ(集合)：表达式', example: 'Σ(机组集合 unit)：机组出力', note: '聚合索引由系统生成，不作为外层 foreach。' },
        min: { title: '最小值 min', purpose: '取集合成员表达式中的最小值。', syntax: 'min(集合)：表达式', example: 'min(机组集合 unit)：机组出力', note: '聚合索引只在函数内部生效。' },
        max: { title: '最大值 max', purpose: '取集合成员表达式中的最大值。', syntax: 'max(集合)：表达式', example: 'max(调度时段 time)：偏差量', note: '线性求解场景中请确认后端支持该表达式。' },
        abs: { title: '绝对值 abs', purpose: '计算表达式的绝对值。', syntax: 'abs：表达式', example: 'abs：偏差量', note: '线性模型中通常需要拆分正负变量。' },
        pow2: { title: '平方 x²', purpose: '表达二次惩罚或偏差平方。', syntax: '(expr) ** 2', example: '(deviation[t]) ** 2', note: '会把问题升级为二次规划或更高复杂度。' },
        log: { title: '自然对数 ln', purpose: '表达自然对数项。', syntax: 'log(expr)', example: 'log(deviation[t] + 1)', note: '会把问题升级为非线性规划，求解需要 NLP 求解器。' },
        exp: { title: '自然指数 exp', purpose: '表达自然指数项。', syntax: 'exp(expr)', example: 'exp(deviation[t])', note: '会把问题升级为非线性规划，求解需要 NLP 求解器。' },
        sqrt: { title: '平方根 sqrt', purpose: '表达平方根项。', syntax: 'sqrt(expr)', example: 'sqrt(deviation[t] + 1)', note: '会把问题升级为非线性规划，求解需要 NLP 求解器。' },
        pow: { title: '任意幂 xⁿ', purpose: '表达任意幂次项。', syntax: '(expr) ** n', example: '(deviation[t]) ** 3', note: 'n=2 通常为 QP，其他幂次通常为 NLP。' }
      }[fn] || { title: '函数说明', purpose: '-', syntax: '选择函数 token', example: '-', note: '-' };
      return `<div class="validation-block formula-function-help"><strong>${escapeHtml(help.title)} 使用说明</strong><p><b>用途：</b>${escapeHtml(help.purpose)}</p><p><b>语法：</b><code>${escapeHtml(help.syntax)}</code></p><p><b>示例：</b><code>${escapeHtml(help.example)}</code></p><p><b>注意事项：</b>${escapeHtml(help.note)}</p></div>`;
    }

    function updateFormulaSymbolSearch(value) {
      if (!state.formulaEditor) return;
      state.formulaEditor.symbolSearch = value || '';
      const panel = document.getElementById('formulaSymbolPanel');
      if (panel) panel.innerHTML = formulaSymbolPanelHtml(state.formulaEditor.context || {}, state.formulaEditor.symbolSearch || '');
    }

    function refreshFormulaEditorBody() {
      if (typeof document === 'undefined') return;
      const modalBody = document.getElementById('modalBody');
      if (modalBody && state.formulaEditor) {
        const leftScroll = modalBody.querySelector('.formula-template-panel')?.scrollTop || 0;
        const workspaceScroll = modalBody.querySelector('.formula-workspace')?.scrollTop || 0;
        const validationScroll = modalBody.querySelector('.formula-validation-panel')?.scrollTop || 0;
        modalBody.innerHTML = formulaEditorHtml();
        const nextLeft = modalBody.querySelector('.formula-template-panel');
        const nextWorkspace = modalBody.querySelector('.formula-workspace');
        const nextValidation = modalBody.querySelector('.formula-validation-panel');
        if (nextLeft) nextLeft.scrollTop = leftScroll;
        if (nextWorkspace) nextWorkspace.scrollTop = workspaceScroll;
        if (nextValidation) nextValidation.scrollTop = validationScroll;
      }
    }

    function addFormulaScopeIndex() {
      if (!state.formulaEditor) return;
      const code = document.getElementById('formulaScopeSelect')?.value || '';
      if (!code) return;
      const aggregated = aggregatedFormulaScopeSet(state.formulaEditor);
      if (aggregated.has(code)) {
        toast(`聚合索引 ${code} 已在 sum/min/max 内部使用，不能加入外层 foreach。`);
        return;
      }
      const list = state.formulaEditor.scopeIndices || [];
      if (!list.includes(code)) state.formulaEditor.scopeIndices = [...list, code];
      refreshFormulaEditorBody();
    }

    function aggregatedFormulaScopeSet(editor = state.formulaEditor) {
      const result = new Set();
      collectAggregateTokens(editor?.tokens || []).forEach(token => { if (token.set) result.add(token.set); });
      String(editor?.dslFormula || editor?.value || '').replace(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/g, (_, alias, setCode) => {
        result.add(setCode);
        return '';
      });
      return result;
    }

    function removeFormulaScopeIndex(index) {
      if (!state.formulaEditor) return;
      state.formulaEditor.scopeIndices = (state.formulaEditor.scopeIndices || []).filter((_, i) => i !== index);
      refreshFormulaEditorBody();
    }

    function moveFormulaScopeIndex(index, delta) {
      if (!state.formulaEditor) return;
      const list = [...(state.formulaEditor.scopeIndices || [])];
      const next = index + delta;
      if (next < 0 || next >= list.length) return;
      [list[index], list[next]] = [list[next], list[index]];
      state.formulaEditor.scopeIndices = list;
      refreshFormulaEditorBody();
    }

    function formulaValidationHtml(validation = {}, context = {}, expression = '') {
      const refs = formulaReferencedObjects(validation, context);
      const scope = state.formulaEditor?.scopeIndices || [];
      const currentExpression = expression || state.formulaEditor?.value || '';
      const mathClass = formulaExpressionClass(currentExpression, context);
      const mathHint = formulaExpressionClassHint(mathClass);
      return `<div class="formula-validation-grid">
        <div class="validation-block"><strong>中文公式预览</strong><div class="formula-readable mt">${escapeHtml(renderFormulaReadableWithScope(currentExpression, context, scope, false))}</div></div>
        <div class="validation-block"><strong>高级数学预览</strong><div class="formula-readable mt">${escapeHtml(scope.length ? renderFormulaReadableWithScope(currentExpression, context, scope, true) : '该公式尚未配置展开范围')}</div></div>
        <div class="validation-block"><strong>作用范围</strong><p>${escapeHtml(formulaScopeText(validation, context, scope))}</p></div>
        <div class="validation-block"><strong>引用对象</strong>${formulaReferencesHtml(refs)}</div>
        <div class="validation-block ${escapeHtml(mathHint.className)}"><strong>数学类型</strong><p><span class="pill">${escapeHtml(mathClass)}</span> ${escapeHtml(mathHint.text)}</p></div>
        <div class="validation-block ${validation.valid ? 'green' : 'red'}"><strong>校验结果</strong><p>${validation.valid ? '通过：公式可应用。' : `发现 ${(validation.explanations || validation.errors || []).length} 个问题。`}</p></div>
        ${(validation.explanations || []).length ? `<div class="validation-explain"><strong>修改建议</strong>${validation.explanations.map((item, index) => `<p><b>${index + 1}. ${escapeHtml(item.title)}</b><br>${item.meaning ? `可能含义：${escapeHtml(item.meaning)}<br>` : ''}建议：${escapeHtml(item.suggestion)}</p>`).join('')}</div>` : `<div class="validation-block green"><strong>修改建议</strong><p>当前公式引用和模式检查通过。</p></div>`}
        <details class="formula-raw-toggle"><summary>原始 DSL</summary><pre class="code-scroll">${escapeHtml(currentExpression)}</pre></details>
      </div>`;
    }

    function formulaExpressionClass(expression = '', context = {}) {
      const value = String(expression || '');
      const dict = getFormulaSymbolDictionary(context);
      const variableCodes = dict.variables.map(item => item.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const variableRef = variableCodes.length ? `(?:${variableCodes.join('|')})(?:\\[[^\\]]+\\])?` : null;
      const hasInteger = dict.variables.some(item => /binary|bool|integer|int/i.test(String(item.domain || item.type || item.variable_type || '')));
      let base = 'LP';
      if (/\b(?:log|exp|sqrt)\s*\(/.test(value)) base = 'NLP';
      else if (/\*\*\s*(?!2(?:\.0+)?\b)-?\d+(?:\.\d+)?/.test(value)) base = 'NLP';
      else if (/\*\*\s*2(?:\.0+)?\b|\^\s*2(?:\.0+)?\b/.test(value)) base = 'QP';
      if (variableRef && new RegExp(`${variableRef}\\s*[*]\\s*${variableRef}`).test(value)) base = 'QP';
      if (variableRef && new RegExp(`${variableRef}\\s*/\\s*${variableRef}`).test(value)) base = 'NLP';
      if (!hasInteger) return base;
      return base === 'LP' ? 'MILP' : base === 'QP' ? 'MIQP' : 'MINLP';
    }

    function formulaExpressionClassHint(type = 'LP') {
      return {
        LP: { className: 'green', text: '线性约束，兼容 HiGHS。' },
        MILP: { className: 'green', text: '含整数变量，兼容 HiGHS MILP。' },
        QP: { className: 'yellow', text: '含二次项；目标函数可走 HiGHS 二次模式，约束中的二次项建议线性化。' },
        MIQP: { className: 'yellow', text: '含二次项和整数变量；需要支持 MIQP 的求解路径。' },
        NLP: { className: 'orange', text: '含非线性函数或高阶幂；求解需要 IPOPT 等 NLP 求解器。' },
        MINLP: { className: 'orange', text: '含非线性表达和整数变量；求解需要 MINLP 求解器。' }
      }[type] || { className: 'yellow', text: '请结合后端编译结果确认求解器兼容性。' };
    }
    function formulaReferencedObjects(validation = {}, context = {}) {
      const dict = getFormulaSymbolDictionary(context);
      const group = codes => codes.map(code => dict.byCode[code] || { code, name: code, typeLabel: '对象' });
      return { sets: group(validation.usedSets || []), parameters: group(validation.usedParameters || []), variables: group(validation.usedVariables || []) };
    }

    function formulaReferencesHtml(refs) {
      const block = (title, list) => `<p><b>${title}</b>：${list.length ? list.map(item => `${escapeHtml(item.name)} <code>${escapeHtml(item.code)}</code>`).join('，') : '-'}</p>`;
      return `${block('集合', refs.sets)}${block('参数', refs.parameters)}${block('变量', refs.variables)}`;
    }

    function formulaScopeText(validation = {}, context = {}, configuredScope = []) {
      const dict = getFormulaSymbolDictionary(context);
      const sets = configuredScope?.length ? configuredScope : [];
      if (!sets.length) return '该公式尚未配置展开范围。';
      return `对${sets.map(code => `所有${dict.byCode[code]?.name || COMMON_FORMULA_SYMBOLS[code]?.name || code}`).join('、')}生效`;
    }
    function refreshFormulaValidationPanel() {
      if (typeof document === 'undefined') return;
      const panel = document.getElementById('formulaValidationPanel');
      if (panel && state.formulaEditor) panel.innerHTML = formulaValidationHtml(state.formulaEditor.validation, state.formulaEditor.context, state.formulaEditor.dslFormula || state.formulaEditor.value);
    }

    function refreshFormulaFunctionHelpPanel() {
      if (typeof document === 'undefined') return;
      const panel = document.getElementById('formulaFunctionHelpPanel');
      if (!panel || !state.formulaEditor) return;
      panel.innerHTML = formulaFunctionHelpHtml(state.formulaEditor.activeFunction || 'sum');
    }

    function updateFormulaDraft(value) {
      if (!state.formulaEditor) return;
      state.formulaEditor.value = value;
      state.formulaEditor.dslFormula = value;
      state.formulaEditor.displayFormula = formulaTokensToDisplay(state.formulaEditor.tokens || [], state.formulaEditor.context) || renderFormulaReadable(value, state.formulaEditor.context);
      state.formulaEditor.validation = validateFormulaText(value, state.formulaEditor.mode, state.formulaEditor.context, state.formulaEditor.tokens || []);
      const readable = document.querySelector('.formula-workspace > .formula-readable');
      if (readable) readable.textContent = state.formulaEditor.displayFormula || '-';
      const hidden = document.getElementById('unifiedFormulaText');
      if (hidden) hidden.value = value;
      refreshFormulaValidationPanel();
    }

    function insertFormulaToken(token) {
      const structured = typeof token === 'object' ? token : formulaTextToToken(String(token || ''), state.formulaEditor?.context || {});
      if (!structured) return;
      appendFormulaToken(structured);
    }

    function insertFormulaTokenFromObject(type, code) {
      if (!state.formulaEditor) return;
      const dict = getFormulaSymbolDictionary(state.formulaEditor.context || {});
      const item = dict.byCode[code] || COMMON_FORMULA_SYMBOLS[code] || { code, type };
      appendFormulaToken(formulaObjectToToken(item, type));
    }

    function insertFormulaOperatorToken(symbol) {
      if (state.formulaEditor?.tokens?.[state.formulaEditor.selectedTokenIndex]?.type === 'aggregate' && ['<=', '>=', '=='].includes(FORMULA_OPERATOR_DSL[symbol] || symbol)) {
        state.formulaEditor.selectedTokenIndex = null;
      }
      appendFormulaToken({ type: 'operator', code: FORMULA_OPERATOR_DSL[symbol] || symbol, label: FORMULA_OPERATOR_LABELS[symbol] || symbol, dsl: FORMULA_OPERATOR_DSL[symbol] || symbol, readonly: true });
    }

    function insertFormulaNumberToken(symbol) {
      if (!state.formulaEditor) return;
      const value = String(symbol || '').trim();
      if (!/^\d+|\.$/.test(value)) return;
      const point = state.formulaEditor.insertionPoint;
      const selected = state.formulaEditor.selectedTokenIndex;
      const target = point?.kind === 'aggregate'
        ? state.formulaEditor.tokens?.[point.parentIndex]
        : point?.kind === 'wrapper'
          ? state.formulaEditor.tokens?.[point.parentIndex]
        : point?.kind === 'nestedAggregate'
          ? state.formulaEditor.tokens?.[point.parentIndex]?.body_tokens?.[point.childIndex]
        : state.formulaEditor.tokens?.[selected];
      const nestedTarget = target?.type === 'aggregate' || isFormulaWrapperToken(target);
      const list = nestedTarget ? (target.body_tokens || []) : (state.formulaEditor.tokens || []);
      const insertionIndex = ['aggregate', 'wrapper', 'nestedAggregate'].includes(point?.kind) && nestedTarget
        ? Math.max(0, Math.min(Number(point.index) || 0, list.length))
        : point?.kind === 'root'
          ? Math.max(0, Math.min(Number(point.index) || 0, list.length))
          : list.length;
      const last = list[insertionIndex - 1];
      if (last?.type === 'number' && /^\d|\.$/.test(value)) {
        const next = value === '.' && String(last.value).includes('.') ? String(last.value) : `${last.value}${value}`;
        const updated = { ...last, value: next, label: next, dsl: next };
        if (nestedTarget) target.body_tokens = [...list.slice(0, insertionIndex - 1), updated, ...list.slice(insertionIndex)];
        else state.formulaEditor.tokens = [...list.slice(0, insertionIndex - 1), updated, ...list.slice(insertionIndex)];
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
        return;
      }
      appendFormulaToken(formulaNumberToken(value));
    }

    function insertFormulaFunctionToken(symbol) {
      const fn = symbol === 'x²' ? 'pow2' : symbol;
      const tokens = state.formulaEditor?.tokens || [];
      const previous = tokens[tokens.length - 1];
      if (fn === 'pow2') {
        squarePreviousFormulaToken();
        return;
      }
      if (fn === 'pow') {
        powerPreviousFormulaToken();
        return;
      }
      if (['abs', 'log', 'exp', 'sqrt'].includes(fn)) {
        wrapFormulaSelectionWithFunction(fn);
        return;
      }
      if (previous?.type === 'function') {
        toast('函数 token 不能连续插入，请先补充集合、变量或参数。');
        return;
      }
      state.formulaEditor.activeFunction = fn;
      if (['sum', 'min', 'max'].includes(fn)) {
        appendFormulaToken(formulaAggregateToken(fn));
        return;
      }
      appendFormulaToken({ type: 'function', code: fn, label: FORMULA_FUNCTION_LABELS[fn] || FORMULA_FUNCTION_LABELS[symbol] || `${symbol}`, dsl: fn, readonly: true });
    }

    function squarePreviousFormulaToken() {
      if (!state.formulaEditor) return;
      state.formulaEditor.activeFunction = 'pow2';
      if (wrapSelectedFormulaToken(inner => formulaSquareToken(inner, state.formulaEditor.context || {}))) {
        return;
      }
      const selected = state.formulaEditor.selectedTokenIndex;
      const aggregate = state.formulaEditor.tokens?.[selected];
      if (aggregate?.type === 'aggregate') {
        const body = aggregate.body_tokens || [];
        if (!body.length) {
          toast('请先在求和表达式区域插入要平方的对象。');
          return;
        }
        const last = body[body.length - 1];
        aggregate.body_tokens = [...body.slice(0, -1), formulaSquareToken(last, state.formulaEditor.context || {})];
      } else {
        const tokens = state.formulaEditor.tokens || [];
        if (!tokens.length) {
          appendFormulaToken(formulaSquareToken({}, state.formulaEditor.context || {}));
          const index = Math.max(0, (state.formulaEditor.tokens || []).length - 1);
          state.formulaEditor.selectedTokenIndex = index;
          state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: index, index: 0 };
          state.formulaEditor.activeFunction = 'pow2';
          refreshFormulaEditorBody();
          return;
        }
        const last = tokens[tokens.length - 1];
        if (['operator', 'function'].includes(last.type)) {
          toast('平方必须作用在对象、聚合或完整表达式之后。');
          return;
        }
        state.formulaEditor.tokens = [...tokens.slice(0, -1), formulaSquareToken(last, state.formulaEditor.context || {})];
      }
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function formulaSquareToken(inner = {}, context = {}) {
      const body = inner && Object.keys(inner).length ? [inner] : [];
      return {
        type: 'square',
        code: 'pow2',
        label: `(${body.length ? formulaTokenLabel(inner, context) : '表达式'})²`,
        body_tokens: body,
        readonly: true
      };
    }

    function powerPreviousFormulaToken() {
      if (!state.formulaEditor) return;
      const raw = typeof window !== 'undefined' && window.prompt ? window.prompt('请输入幂次 n，例如 3', '') : '';
      if (raw === null || String(raw).trim() === '') {
        toast('已取消幂运算：请输入幂次后再应用 xⁿ。');
        return;
      }
      const exponent = String(raw || '').trim();
      if (!/^-?\d+(?:\.\d+)?$/.test(exponent)) {
        toast('幂次必须是数字。');
        return;
      }
      state.formulaEditor.activeFunction = 'pow';
      if (wrapSelectedFormulaToken(inner => formulaPowerToken(inner, exponent, state.formulaEditor.context || {}))) {
        return;
      }
      const selected = state.formulaEditor.selectedTokenIndex;
      const aggregate = state.formulaEditor.tokens?.[selected];
      if (aggregate?.type === 'aggregate') {
        const body = aggregate.body_tokens || [];
        if (!body.length) {
          toast('请先在聚合表达式区域插入要取幂的对象。');
          return;
        }
        const last = body[body.length - 1];
        aggregate.body_tokens = [...body.slice(0, -1), formulaPowerToken(last, exponent, state.formulaEditor.context || {})];
      } else {
        const tokens = state.formulaEditor.tokens || [];
        if (!tokens.length) {
          appendFormulaToken(formulaPowerToken({}, exponent, state.formulaEditor.context || {}));
          const index = Math.max(0, (state.formulaEditor.tokens || []).length - 1);
          state.formulaEditor.selectedTokenIndex = index;
          state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: index, index: 0 };
          state.formulaEditor.activeFunction = 'pow';
          refreshFormulaEditorBody();
          return;
        }
        const last = tokens[tokens.length - 1];
        if (['operator', 'function'].includes(last.type)) {
          toast('幂运算必须作用在对象、聚合或完整表达式之后。');
          return;
        }
        state.formulaEditor.tokens = [...tokens.slice(0, -1), formulaPowerToken(last, exponent, state.formulaEditor.context || {})];
      }
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function formulaPowerToken(inner = {}, exponent = '2', context = {}) {
      const body = inner && Object.keys(inner).length ? [inner] : [];
      return {
        type: 'power',
        code: 'pow',
        exponent: String(exponent || '2'),
        label: `(${body.length ? formulaTokenLabel(inner, context) : '表达式'})^${exponent}`,
        body_tokens: body,
        readonly: true
      };
    }

    function formulaUnaryToken(fn = 'abs', inner = {}, context = {}) {
      const body = inner && Object.keys(inner).length ? [inner] : [];
      return {
        type: 'unary',
        code: fn,
        fn,
        label: `${FORMULA_FUNCTION_LABELS[fn] || fn}(${body.length ? formulaTokenLabel(inner, context) : '表达式'})`,
        body_tokens: body,
        readonly: true
      };
    }

    function wrapFormulaSelectionWithFunction(fn = 'abs') {
      if (!state.formulaEditor) return;
      state.formulaEditor.activeFunction = fn;
      if (wrapSelectedFormulaToken(inner => formulaUnaryToken(fn, inner, state.formulaEditor.context || {}))) {
        return;
      }
      appendFormulaToken(formulaUnaryToken(fn, {}, state.formulaEditor.context || {}));
      const index = Math.max(0, (state.formulaEditor.tokens || []).length - 1);
      state.formulaEditor.selectedTokenIndex = index;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: index, index: 0 };
      refreshFormulaEditorBody();
    }

    function wrapSelectedFormulaToken(factory) {
      if (!state.formulaEditor || typeof factory !== 'function') return false;
      const ctx = state.formulaEditor.context || {};
      const child = state.formulaEditor.selectedChildToken;
      if (child) {
        const aggregate = state.formulaEditor.tokens?.[child.parentIndex];
        const body = aggregate?.body_tokens || [];
        const target = body[child.childIndex];
        if (target) {
          aggregate.body_tokens = body.map((item, index) => index === child.childIndex ? factory(item, ctx) : item);
          state.formulaEditor.selectedChildToken = { parentIndex: child.parentIndex, childIndex: child.childIndex };
          state.formulaEditor.selectedTokenIndex = child.parentIndex;
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          return true;
        }
      }
      const nestedChild = state.formulaEditor.selectedNestedChild;
      if (nestedChild) {
        const aggregate = state.formulaEditor.tokens?.[nestedChild.parentIndex]?.body_tokens?.[nestedChild.childIndex];
        const body = aggregate?.body_tokens || [];
        const target = body[nestedChild.nestedIndex];
        if (target) {
          aggregate.body_tokens = body.map((item, index) => index === nestedChild.nestedIndex ? factory(item, ctx) : item);
          state.formulaEditor.selectedNestedChild = { ...nestedChild };
          state.formulaEditor.selectedChildToken = null;
          state.formulaEditor.selectedWrapperChild = null;
          state.formulaEditor.selectedTokenIndex = nestedChild.parentIndex;
          state.formulaEditor.insertionPoint = { kind: 'nestedAggregate', parentIndex: nestedChild.parentIndex, childIndex: nestedChild.childIndex, index: nestedChild.nestedIndex + 1 };
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          return true;
        }
      }
      const wrapperChild = state.formulaEditor.selectedWrapperChild;
      if (wrapperChild) {
        const wrapper = state.formulaEditor.tokens?.[wrapperChild.parentIndex];
        const body = wrapper?.body_tokens || [];
        const target = body[wrapperChild.childIndex];
        if (isFormulaWrapperToken(wrapper) && target) {
          wrapper.body_tokens = body.map((item, index) => index === wrapperChild.childIndex ? factory(item, ctx) : item);
          state.formulaEditor.selectedWrapperChild = { ...wrapperChild };
          state.formulaEditor.selectedChildToken = null;
          state.formulaEditor.selectedNestedChild = null;
          state.formulaEditor.selectedTokenIndex = wrapperChild.parentIndex;
          state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: wrapperChild.parentIndex, index: wrapperChild.childIndex + 1 };
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          return true;
        }
      }
      const selected = state.formulaEditor.selectedTokenIndex;
      const tokens = state.formulaEditor.tokens || [];
      if (Number.isInteger(selected) && tokens[selected]) {
        state.formulaEditor.tokens = tokens.map((item, index) => index === selected ? factory(item, ctx) : item);
        state.formulaEditor.selectedTokenIndex = selected;
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
        return true;
      }
      const grouped = takeFormulaGroupBeforeInsertionPoint();
      if (grouped) {
        insertWrappedFormulaGroup(factory, grouped);
        return true;
      }
      const followingGroup = takeFormulaGroupAfterInsertionPoint();
      if (followingGroup) {
        insertWrappedFormulaGroup(factory, followingGroup);
        return true;
      }
      const point = state.formulaEditor.insertionPoint;
      const index = wrappableRootTokenIndex(point, tokens);
      if (tokens[index]) {
        state.formulaEditor.tokens = tokens.map((item, i) => i === index ? factory(item, ctx) : item);
        state.formulaEditor.selectedTokenIndex = index;
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
        return true;
      }
      return false;
    }

    function isWrappableFormulaToken(token = {}) {
      return ['aggregate', 'square', 'power', 'unary', 'group', 'number', 'parameter', 'variable'].includes(token?.type);
    }

    function wrappableRootTokenIndex(point = null, tokens = []) {
      if (point?.kind !== 'root') return tokens.length - 1;
      const cursor = Math.max(0, Math.min(Number(point.index) || 0, tokens.length));
      const previous = tokens[cursor - 1];
      const next = tokens[cursor];
      if (isWrappableFormulaToken(next) && (!previous || previous.type === 'operator' || previous.type === 'function')) return cursor;
      if (isWrappableFormulaToken(previous)) return cursor - 1;
      if (isWrappableFormulaToken(next)) return cursor;
      return cursor - 1;
    }

    function takeFormulaGroupBeforeInsertionPoint() {
      const point = state.formulaEditor?.insertionPoint;
      if (!point || point.kind !== 'root') return null;
      const tokens = state.formulaEditor.tokens || [];
      const end = Math.max(0, Math.min(Number(point.index) || 0, tokens.length));
      if (end < 2 || tokens[end - 1]?.type !== 'operator' || tokens[end - 1].code !== ')') return null;
      let depth = 0;
      for (let i = end - 1; i >= 0; i -= 1) {
        const item = tokens[i];
        if (item.type === 'operator' && item.code === ')') depth += 1;
        if (item.type === 'operator' && item.code === '(') {
          depth -= 1;
          if (depth === 0) return { start: i, end, body_tokens: tokens.slice(i + 1, end - 1) };
        }
      }
      return null;
    }

    function takeFormulaGroupAfterInsertionPoint() {
      const point = state.formulaEditor?.insertionPoint;
      if (!point || point.kind !== 'root') return null;
      const tokens = state.formulaEditor.tokens || [];
      const start = Math.max(0, Math.min(Number(point.index) || 0, tokens.length));
      if (tokens[start - 1]?.type !== 'operator' || tokens[start - 1].code !== '(') return null;
      let depth = 1;
      for (let i = start; i < tokens.length; i += 1) {
        const item = tokens[i];
        if (item.type === 'operator' && item.code === '(') depth += 1;
        if (item.type === 'operator' && item.code === ')') {
          depth -= 1;
          if (depth === 0) return { start: start - 1, end: i + 1, body_tokens: tokens.slice(start, i) };
        }
      }
      return null;
    }

    function insertWrappedFormulaGroup(factory, group = null) {
      if (!state.formulaEditor || !group || !(group.body_tokens || []).length) return;
      const tokens = state.formulaEditor.tokens || [];
      const wrapped = factory({ type: 'group', body_tokens: group.body_tokens, readonly: true }, state.formulaEditor.context || {});
      state.formulaEditor.tokens = [...tokens.slice(0, group.start), wrapped, ...tokens.slice(group.end)];
      state.formulaEditor.selectedTokenIndex = group.start;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'root', index: group.start + 1 };
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function formulaNumberToken(value = '0') {
      const raw = String(value || '0').trim();
      const normalized = raw === '.' ? '0.' : raw;
      return { type: 'number', code: normalized, value: normalized, label: normalized, dsl: normalized, readonly: true };
    }

    function formulaAggregateToken(fn = 'sum', set = {}) {
      const code = set?.code || set?.key || set?.name || '';
      return {
        type: 'aggregate',
        fn,
        set: code,
        alias: code ? defaultIndexAlias(code) : '',
        label: FORMULA_FUNCTION_LABELS[fn] || fn,
        body_tokens: [],
        readonly: true,
        aggregateBlock: true
      };
    }

    function appendFormulaToken(token) {
      appendFormulaTokens([token]);
    }

    function appendFormulaTokens(tokensToAppend = []) {
      if (!state.formulaEditor) return;
      const point = state.formulaEditor.insertionPoint;
      const selected = state.formulaEditor.selectedTokenIndex;
      const target = state.formulaEditor.tokens?.[selected];
      const selectedChild = state.formulaEditor.selectedChildToken;
      const childTarget = selectedChild ? state.formulaEditor.tokens?.[selectedChild.parentIndex]?.body_tokens?.[selectedChild.childIndex] : null;
      if (childTarget?.type === 'aggregate' && tokensToAppend.length === 1 && tokensToAppend[0]?.type === 'set' && !(childTarget.body_tokens || []).length) {
        childTarget.set = tokensToAppend[0].code;
        childTarget.alias = defaultIndexAlias(childTarget.set);
        state.formulaEditor.insertionPoint = { kind: 'nestedAggregate', parentIndex: selectedChild.parentIndex, childIndex: selectedChild.childIndex, index: 0 };
        state.formulaEditor.selectedTokenIndex = selectedChild.parentIndex;
        state.formulaEditor.selectedChildToken = { ...selectedChild };
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
        if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
        return;
      }
      if (target?.type === 'aggregate' && tokensToAppend.length === 1 && tokensToAppend[0]?.type === 'set' && !(target.body_tokens || []).length) {
        target.set = tokensToAppend[0].code;
        target.alias = defaultIndexAlias(target.set);
        state.formulaEditor.insertionPoint = { kind: 'aggregate', parentIndex: selected, index: 0 };
        state.formulaEditor.selectedTokenIndex = selected;
        state.formulaEditor.selectedChildToken = null;
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
        if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
        return;
      }
      if (point?.kind === 'aggregate') {
        const target = state.formulaEditor.tokens?.[point.parentIndex];
        if (target?.type === 'aggregate') {
          const body = target.body_tokens || [];
          const index = Math.max(0, Math.min(Number(point.index) || 0, body.length));
          target.body_tokens = [...body.slice(0, index), ...tokensToAppend, ...body.slice(index)];
          state.formulaEditor.insertionPoint = { kind: 'aggregate', parentIndex: point.parentIndex, index: index + tokensToAppend.length };
          state.formulaEditor.selectedTokenIndex = point.parentIndex;
          state.formulaEditor.selectedChildToken = null;
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
          return;
        }
      }
      if (point?.kind === 'nestedAggregate') {
        const target = state.formulaEditor.tokens?.[point.parentIndex]?.body_tokens?.[point.childIndex];
        if (target?.type === 'aggregate') {
          const body = target.body_tokens || [];
          const index = Math.max(0, Math.min(Number(point.index) || 0, body.length));
          target.body_tokens = [...body.slice(0, index), ...tokensToAppend, ...body.slice(index)];
          state.formulaEditor.insertionPoint = { kind: 'nestedAggregate', parentIndex: point.parentIndex, childIndex: point.childIndex, index: index + tokensToAppend.length };
          state.formulaEditor.selectedTokenIndex = point.parentIndex;
          state.formulaEditor.selectedChildToken = null;
          state.formulaEditor.selectedNestedChild = null;
          state.formulaEditor.selectedWrapperChild = null;
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
          return;
        }
      }
      if (point?.kind === 'wrapper') {
        const target = state.formulaEditor.tokens?.[point.parentIndex];
        if (isFormulaWrapperToken(target)) {
          const body = target.body_tokens || [];
          const index = Math.max(0, Math.min(Number(point.index) || 0, body.length));
          target.body_tokens = [...body.slice(0, index), ...tokensToAppend, ...body.slice(index)];
          state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: point.parentIndex, index: index + tokensToAppend.length };
          state.formulaEditor.selectedTokenIndex = point.parentIndex;
          state.formulaEditor.selectedChildToken = null;
          state.formulaEditor.selectedNestedChild = null;
          state.formulaEditor.selectedWrapperChild = null;
          syncFormulaStateFromTokens();
          refreshFormulaEditorBody();
          if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
          return;
        }
      }
      if (!point && target?.type === 'aggregate' && !tokensToAppend.some(token => token.type === 'aggregate')) {
        if (tokensToAppend.length === 1 && tokensToAppend[0]?.type === 'set' && !(target.body_tokens || []).length) {
          target.set = tokensToAppend[0].code;
          target.alias = defaultIndexAlias(target.set);
        } else {
          target.body_tokens = [...(target.body_tokens || []), ...tokensToAppend];
        }
      } else if (!point && isFormulaWrapperToken(target)) {
        target.body_tokens = [...(target.body_tokens || []), ...tokensToAppend];
        state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex: selected, index: target.body_tokens.length };
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
      } else {
        const list = state.formulaEditor.tokens || [];
        const index = point?.kind === 'root' ? Math.max(0, Math.min(Number(point.index) || 0, list.length)) : list.length;
        state.formulaEditor.tokens = [...list.slice(0, index), ...tokensToAppend, ...list.slice(index)];
        state.formulaEditor.insertionPoint = { kind: 'root', index: index + tokensToAppend.length };
        state.formulaEditor.selectedChildToken = null;
        if (tokensToAppend.length === 1 && tokensToAppend[0]?.type === 'aggregate') state.formulaEditor.selectedTokenIndex = index;
      }
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
      if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
    }

    function setFormulaInsertionPoint(kind = 'root', index = 0, parentIndex = null, childIndex = null) {
      if (!state.formulaEditor) return;
      state.formulaEditor.insertionPoint = { kind, index, parentIndex, childIndex };
      if (kind === 'root') {
        state.formulaEditor.selectedTokenIndex = null;
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
      } else if (kind === 'aggregate') {
        state.formulaEditor.selectedTokenIndex = parentIndex;
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
      } else if (kind === 'nestedAggregate') {
        state.formulaEditor.selectedTokenIndex = parentIndex;
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
      } else if (kind === 'wrapper') {
        state.formulaEditor.selectedTokenIndex = parentIndex;
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
      }
      refreshFormulaEditorBody();
      if (typeof document !== 'undefined') document.getElementById('formulaTokenEditor')?.focus();
    }

    function clearFormulaInsertionPoint() {
      if (!state.formulaEditor) return;
      state.formulaEditor.insertionPoint = null;
      refreshFormulaEditorBody();
    }

    function clearFormulaEditorTokens() {
      if (!state.formulaEditor) return;
      state.formulaEditor.tokens = [];
      state.formulaEditor.selectedTokenIndex = null;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = null;
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function removeAggregateBodyToken(parentIndex, childIndex) {
      if (!state.formulaEditor) return;
      const token = state.formulaEditor.tokens?.[parentIndex];
      if (token?.type !== 'aggregate') return;
      token.body_tokens = (token.body_tokens || []).filter((_, i) => i !== childIndex);
      state.formulaEditor.selectedTokenIndex = parentIndex;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'aggregate', parentIndex, index: Math.max(0, childIndex) };
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function removeWrapperBodyToken(parentIndex, childIndex) {
      if (!state.formulaEditor) return;
      const token = state.formulaEditor.tokens?.[parentIndex];
      if (!isFormulaWrapperToken(token)) return;
      token.body_tokens = (token.body_tokens || []).filter((_, i) => i !== childIndex);
      state.formulaEditor.selectedTokenIndex = parentIndex;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex, index: Math.max(0, childIndex) };
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function removeFormulaToken(index) {
      if (!state.formulaEditor) return;
      state.formulaEditor.tokens = (state.formulaEditor.tokens || []).filter((_, i) => i !== index);
      state.formulaEditor.selectedTokenIndex = null;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function moveFormulaToken(index, delta) {
      if (!state.formulaEditor) return;
      const tokens = [...(state.formulaEditor.tokens || [])];
      const next = index + delta;
      if (next < 0 || next >= tokens.length) return;
      [tokens[index], tokens[next]] = [tokens[next], tokens[index]];
      state.formulaEditor.tokens = tokens;
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function formulaTokenDragStart(event, index) {
      event.dataTransfer?.setData('text/formula-token-index', String(index));
    }

    function formulaTokenDrop(event, index) {
      event.preventDefault();
      const from = Number(event.dataTransfer?.getData('text/formula-token-index'));
      if (!Number.isInteger(from) || !state.formulaEditor) return;
      const tokens = [...(state.formulaEditor.tokens || [])];
      const [item] = tokens.splice(from, 1);
      tokens.splice(index, 0, item);
      state.formulaEditor.tokens = tokens;
      syncFormulaStateFromTokens();
      refreshFormulaEditorBody();
    }

    function handleFormulaTokenEditorKeydown(event) {
      if (event.key === 'Backspace' && state.formulaEditor?.tokens?.length) {
        event.preventDefault();
        const selected = state.formulaEditor.selectedTokenIndex;
        const deleteIndex = Number.isInteger(selected) && selected >= 0 && selected < state.formulaEditor.tokens.length
          ? selected
          : state.formulaEditor.tokens.length - 1;
        state.formulaEditor.tokens = state.formulaEditor.tokens.filter((_, index) => index !== deleteIndex);
        state.formulaEditor.selectedTokenIndex = null;
        state.formulaEditor.selectedChildToken = null;
        state.formulaEditor.selectedNestedChild = null;
        state.formulaEditor.selectedWrapperChild = null;
        syncFormulaStateFromTokens();
        refreshFormulaEditorBody();
      }
    }

    function openFormulaTokenProperties(index) {
      if (!state.formulaEditor) return;
      const token = state.formulaEditor.tokens?.[index];
      if (!token) return;
      state.formulaEditor.selectedTokenIndex = index;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'root', index: index + 1 };
      if (token.type === 'function') state.formulaEditor.activeFunction = token.code;
      if (token.type === 'aggregate') state.formulaEditor.activeFunction = token.fn;
      if (token.type === 'unary') state.formulaEditor.activeFunction = token.fn || token.code;
      if (token.type === 'square') state.formulaEditor.activeFunction = 'pow2';
      if (token.type === 'power') state.formulaEditor.activeFunction = 'pow';
      refreshFormulaEditorBody();
      refreshFormulaFunctionHelpPanel();
      const panel = typeof document === 'undefined' ? null : document.getElementById('formulaValidationPanel');
      if (panel) panel.innerHTML = `<div class="validation-block"><strong>标签属性</strong><p>${escapeHtml(formulaTokenTooltip(token, state.formulaEditor.context))}</p><details><summary>JSON 调试</summary><pre class="code-scroll">${escapeHtml(JSON.stringify(token, null, 2))}</pre></details></div>${formulaValidationHtml(state.formulaEditor.validation, state.formulaEditor.context, state.formulaEditor.dslFormula || state.formulaEditor.value)}`;
    }

    function openAggregateChildTokenProperties(parentIndex, childIndex) {
      if (!state.formulaEditor) return;
      const parent = state.formulaEditor.tokens?.[parentIndex];
      const token = parent?.body_tokens?.[childIndex];
      if (!token) return;
      state.formulaEditor.selectedTokenIndex = parentIndex;
      state.formulaEditor.selectedChildToken = { parentIndex, childIndex };
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'aggregate', parentIndex, index: childIndex + 1 };
      if (token.type === 'function') state.formulaEditor.activeFunction = token.code;
      if (token.type === 'aggregate') state.formulaEditor.activeFunction = token.fn;
      if (token.type === 'unary') state.formulaEditor.activeFunction = token.fn || token.code;
      if (token.type === 'square') state.formulaEditor.activeFunction = 'pow2';
      if (token.type === 'power') state.formulaEditor.activeFunction = 'pow';
      refreshFormulaEditorBody();
      refreshFormulaFunctionHelpPanel();
      const panel = typeof document === 'undefined' ? null : document.getElementById('formulaValidationPanel');
      if (panel) panel.innerHTML = `<div class="validation-block"><strong>标签属性</strong><p>${escapeHtml(formulaTokenTooltip(token, state.formulaEditor.context))}</p><details><summary>JSON 调试</summary><pre class="code-scroll">${escapeHtml(JSON.stringify(token, null, 2))}</pre></details></div>${formulaValidationHtml(state.formulaEditor.validation, state.formulaEditor.context, state.formulaEditor.dslFormula || state.formulaEditor.value)}`;
    }

    function openNestedAggregateBodyTokenProperties(parentIndex, childIndex, nestedIndex) {
      if (!state.formulaEditor) return;
      const parent = state.formulaEditor.tokens?.[parentIndex];
      const aggregate = parent?.body_tokens?.[childIndex];
      const token = aggregate?.body_tokens?.[nestedIndex];
      if (parent?.type !== 'aggregate' || aggregate?.type !== 'aggregate' || !token) return;
      state.formulaEditor.selectedTokenIndex = parentIndex;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = { parentIndex, childIndex, nestedIndex };
      state.formulaEditor.selectedWrapperChild = null;
      state.formulaEditor.insertionPoint = { kind: 'nestedAggregate', parentIndex, childIndex, index: nestedIndex + 1 };
      if (token.type === 'function') state.formulaEditor.activeFunction = token.code;
      if (token.type === 'aggregate') state.formulaEditor.activeFunction = token.fn;
      if (token.type === 'unary') state.formulaEditor.activeFunction = token.fn || token.code;
      if (token.type === 'square') state.formulaEditor.activeFunction = 'pow2';
      if (token.type === 'power') state.formulaEditor.activeFunction = 'pow';
      refreshFormulaEditorBody();
      refreshFormulaFunctionHelpPanel();
      const panel = typeof document === 'undefined' ? null : document.getElementById('formulaValidationPanel');
      if (panel) panel.innerHTML = `<div class="validation-block"><strong>标签属性</strong><p>${escapeHtml(formulaTokenTooltip(token, state.formulaEditor.context))}</p><details><summary>JSON 调试</summary><pre class="code-scroll">${escapeHtml(JSON.stringify(token, null, 2))}</pre></details></div>${formulaValidationHtml(state.formulaEditor.validation, state.formulaEditor.context, state.formulaEditor.dslFormula || state.formulaEditor.value)}`;
    }

    function openWrapperChildTokenProperties(parentIndex, childIndex) {
      if (!state.formulaEditor) return;
      const parent = state.formulaEditor.tokens?.[parentIndex];
      const token = parent?.body_tokens?.[childIndex];
      if (!isFormulaWrapperToken(parent) || !token) return;
      state.formulaEditor.selectedTokenIndex = parentIndex;
      state.formulaEditor.selectedChildToken = null;
      state.formulaEditor.selectedNestedChild = null;
      state.formulaEditor.selectedWrapperChild = { parentIndex, childIndex };
      state.formulaEditor.insertionPoint = { kind: 'wrapper', parentIndex, index: childIndex + 1 };
      if (token.type === 'function') state.formulaEditor.activeFunction = token.code;
      if (token.type === 'aggregate') state.formulaEditor.activeFunction = token.fn;
      if (token.type === 'unary') state.formulaEditor.activeFunction = token.fn || token.code;
      if (token.type === 'square') state.formulaEditor.activeFunction = 'pow2';
      if (token.type === 'power') state.formulaEditor.activeFunction = 'pow';
      refreshFormulaEditorBody();
      refreshFormulaFunctionHelpPanel();
      const panel = typeof document === 'undefined' ? null : document.getElementById('formulaValidationPanel');
      if (panel) panel.innerHTML = `<div class="validation-block"><strong>标签属性</strong><p>${escapeHtml(formulaTokenTooltip(token, state.formulaEditor.context))}</p><details><summary>JSON 调试</summary><pre class="code-scroll">${escapeHtml(JSON.stringify(token, null, 2))}</pre></details></div>${formulaValidationHtml(state.formulaEditor.validation, state.formulaEditor.context, state.formulaEditor.dslFormula || state.formulaEditor.value)}`;
    }

    function selectedFormulaFunctionHelpKey(token = {}) {
      return token.type === 'aggregate' ? token.fn : token.type === 'function' ? token.code : (state.formulaEditor?.activeFunction || 'sum');
    }

    function syncFormulaStateFromTokens() {
      if (!state.formulaEditor) return;
      const editor = state.formulaEditor;
      editor.dslFormula = formulaTokensToDsl(editor.tokens || [], editor.context || {});
      editor.value = editor.dslFormula;
      editor.displayFormula = formulaTokensToDisplay(editor.tokens || [], editor.context || {});
      editor.scopeIndices = editor.mode === 'objective' ? [] : inferFormulaScopeFromExpression(editor.dslFormula, editor.context || {}, inferFormulaScopeFromTokens(editor.tokens || [], editor.context || {}, editor.scopeIndices || []));
      editor.validation = validateFormulaText(editor.dslFormula, editor.mode, editor.context, editor.tokens || []);
    }

    function validateCurrentFormula() {
      if (state.formulaEditor?.advancedDslOpen) updateAdvancedDslFormula(document.getElementById('unifiedFormulaText')?.value || state.formulaEditor.dslFormula || '');
      else syncFormulaStateFromTokens();
      refreshFormulaValidationPanel();
    }

    function toggleFormulaAdvancedDsl(open) {
      if (!state.formulaEditor) return;
      state.formulaEditor.advancedDslOpen = Boolean(open);
    }

    function updateAdvancedDslFormula(value) {
      if (!state.formulaEditor) return;
      const parsed = parseDslExpressionToTokens(value, state.formulaEditor.context || {});
      state.formulaEditor.tokens = normalizeFormulaTokens(stripFormulaScopePrefixTokens(parsed.tokens || [], state.formulaEditor.context || {}), state.formulaEditor.context || {}, '');
      state.formulaEditor.advancedExpressionOnly = !parsed.ok;
      state.formulaEditor.dslFormula = parsed.ok ? formulaTokensToDsl(state.formulaEditor.tokens, state.formulaEditor.context || {}) : String(value || '').trim();
      state.formulaEditor.value = state.formulaEditor.dslFormula;
      state.formulaEditor.displayFormula = parsed.ok ? formulaTokensToDisplay(state.formulaEditor.tokens, state.formulaEditor.context || {}) : renderFormulaReadable(value, state.formulaEditor.context || {});
      state.formulaEditor.scopeIndices = state.formulaEditor.mode === 'objective' ? [] : inferFormulaScopeFromExpression(state.formulaEditor.dslFormula, state.formulaEditor.context || {}, inferFormulaScopeFromTokens(state.formulaEditor.tokens || [], state.formulaEditor.context || {}, state.formulaEditor.scopeIndices || []));
      state.formulaEditor.validation = validateFormulaText(state.formulaEditor.dslFormula, state.formulaEditor.mode, state.formulaEditor.context, state.formulaEditor.tokens || []);
      if (!parsed.ok) state.formulaEditor.validation.explanations.push({ title: '高级 DSL 无法完全解析为标签', suggestion: '可作为高级表达式保存，但请完成编译校验后再求解。', meaning: '该表达式不会在普通模式中拆成可编辑 token。' });
      state.formulaEditor.validation.valid = state.formulaEditor.validation.errors.length === 0;
      const preview = typeof document === 'undefined' ? null : document.getElementById('formulaDisplayPreview');
      if (preview) preview.textContent = state.formulaEditor.displayFormula || '-';
      const tokenEditor = typeof document === 'undefined' ? null : document.getElementById('formulaTokenEditor');
      if (tokenEditor && parsed.ok) tokenEditor.innerHTML = formulaTokenSequenceHtml(state.formulaEditor.tokens || [], state.formulaEditor.context || {});
      const textarea = typeof document === 'undefined' ? null : document.getElementById('unifiedFormulaText');
      if (textarea && parsed.ok && textarea.value.trim() !== state.formulaEditor.dslFormula) textarea.value = state.formulaEditor.dslFormula;
      refreshFormulaValidationPanel();
    }

    function showFormulaExamples() {
      if (!state.formulaEditor) return;
      const examples = FORMULA_FUNCTION_GROUPS.flatMap(group => group.items.filter(item => !item.disabled).map(item => ({ title: `${item.label} ${item.symbol}`, expression: item.example })));
      const html = `<div class="formula-examples-modal">
        <p class="muted">选择示例会载入到高级 DSL，并同步生成可编辑标签。原公式不会应用到字段，除非继续点击“应用到当前字段”。</p>
        <div class="formula-validation-grid">${examples.map((item, index) => `<div class="validation-block formula-example-card"><strong>${escapeHtml(item.title)}</strong>${formulaDisplayHtml(item.expression, state.formulaEditor.context || {})}<button type="button" class="btn mt" onclick="loadFormulaExample(${index})">载入此示例</button></div>`).join('')}</div>
      </div>`;
      openInfoModal('公式示例', html, { wide: true });
      state.formulaEditor.examples = examples;
    }

    function loadFormulaExample(index) {
      if (!state.formulaEditor) return;
      const item = (state.formulaEditor.examples || [])[index];
      if (!item?.expression) return;
      state.formulaEditor.advancedDslOpen = true;
      updateAdvancedDslFormula(item.expression);
      openInfoModal('统一公式编辑器', formulaEditorHtml(), { wide: true });
      toast('已载入公式示例，可继续编辑后应用。');
    }

    function formulaContextFromGenericParts() {
      const parts = getIndexedGenericParts();
      let semantic = {};
      try { semantic = typeof getSemanticSpec === 'function' ? getSemanticSpec() : {}; } catch (e) {}
      return {
        sets: semantic.sets?.length ? semantic.sets : Object.keys(parts.sets || {}),
        parameters: semantic.parameters?.length ? semantic.parameters : Object.keys(parts.parameters || {}),
        variables: semantic.variables?.length ? semantic.variables : (parts.variables || []).map(v => ({ code: v.name, indices: v.indices || [] }))
      };
    }

    function openGenericConstraintFormulaEditor(index) {
      const parts = getIndexedGenericParts();
      const row = parts.constraints[index] || {};
      openFormulaEditor({
        title: `正在编辑：${row.name || `约束 ${index + 1}`}`,
        mode: 'constraint',
        value: row.dsl_formula || row.expression || indexedConstraintText(row),
        context: formulaContextFromGenericParts(),
        apply: { type: 'genericConstraint', index }
      });
    }

    function openGenericObjectiveFormulaEditor(index) {
      const parts = getIndexedGenericParts();
      const term = parts.objective?.terms?.[index] || {};
      openFormulaEditor({
        title: `正在编辑：${term.name || `目标项 ${index + 1}`}`,
        mode: 'objective',
        value: term.dsl_formula || term.expression || objectiveTermText(term),
        context: formulaContextFromGenericParts(),
        apply: { type: 'genericObjective', index }
      });
    }

    function applyFormulaEditor() {
      const editor = state.formulaEditor;
      if (!editor) return;
      const value = editor.advancedDslOpen ? (document.getElementById('unifiedFormulaText')?.value || editor.dslFormula || editor.value || '') : (editor.dslFormula || formulaTokensToDsl(editor.tokens || [], editor.context));
      if (editor.advancedDslOpen) updateAdvancedDslFormula(value);
      else syncFormulaStateFromTokens();
      const tokens = editor.tokens || [];
      const display = editor.displayFormula || formulaTokensToDisplay(tokens, editor.context) || renderFormulaReadable(value, editor.context);
      const validation = validateFormulaText(value, editor.mode, editor.context, tokens);
      const refs = formulaPersistedReferences(validation);
      state.formulaEditor.validation = validation;
      const aggregatedScope = aggregatedFormulaScopeSet(editor);
      const invalidOuterScope = (editor.scopeIndices || []).filter(code => aggregatedScope.has(code));
      if (invalidOuterScope.length) {
        validation.valid = false;
        validation.errors.push(`聚合索引不能作为外层 foreach：${invalidOuterScope.join(', ')}`);
        validation.explanations.push({ title: `聚合索引不能作为外层 foreach：${invalidOuterScope.join(', ')}`, suggestion: '请从高级设置的作用范围中移除这些集合。sum/min/max 内部聚合的索引只在函数内部生效。', meaning: '否则会重复展开约束。' });
        refreshFormulaValidationPanel();
        return;
      }
      if (!validation.valid) {
        refreshFormulaValidationPanel();
        return;
      }
      const appliedTarget = formulaApplyTargetLabel(editor);
      if (editor.apply?.type === 'componentConstraint') {
        updateComponentEditorArray('constraints', editor.apply.index, 'expression', value);
        writeComponentFormulaFields('constraints', editor.apply.index, value, display, tokens);
        syncFormulaScopeToApplyTarget(editor);
      } else if (editor.apply?.type === 'componentObjective') {
        updateComponentEditorArray('objective_terms', editor.apply.index, 'expression', value);
        writeComponentFormulaFields('objective_terms', editor.apply.index, value, display, tokens);
        syncFormulaScopeToApplyTarget(editor);
      } else if (editor.apply?.type === 'genericConstraint') {
        const parts = getIndexedGenericParts();
        parts.constraints[editor.apply.index].expression = value;
        parts.constraints[editor.apply.index].dsl_formula = value;
        parts.constraints[editor.apply.index].display_formula = display;
        parts.constraints[editor.apply.index].tokens = tokens;
        parts.constraints[editor.apply.index].compiled_status = validation.valid ? 'compiled' : 'draft';
        parts.constraints[editor.apply.index].compile_status = validation.valid ? 'compiled' : 'draft';
        parts.constraints[editor.apply.index].referenced_sets = refs.sets;
        parts.constraints[editor.apply.index].referenced_parameters = refs.parameters;
        parts.constraints[editor.apply.index].referenced_variables = refs.variables;
        parts.constraints[editor.apply.index].foreach = (editor.scopeIndices || []).slice();
        parts.constraints[editor.apply.index].scope_indices = (editor.scopeIndices || []).slice();
        parts.constraints[editor.apply.index].expansion_scope = (editor.scopeIndices || []).slice();
        setIndexedGenericParts(parts);
      } else if (editor.apply?.type === 'genericObjective') {
        const parts = getIndexedGenericParts();
        parts.objective.terms[editor.apply.index].expression = value;
        parts.objective.terms[editor.apply.index].dsl_formula = value;
        parts.objective.terms[editor.apply.index].display_formula = display;
        parts.objective.terms[editor.apply.index].tokens = tokens;
        parts.objective.terms[editor.apply.index].compiled_status = validation.valid ? 'compiled' : 'draft';
        parts.objective.terms[editor.apply.index].compile_status = validation.valid ? 'compiled' : 'draft';
        parts.objective.terms[editor.apply.index].referenced_sets = refs.sets;
        parts.objective.terms[editor.apply.index].referenced_parameters = refs.parameters;
        parts.objective.terms[editor.apply.index].referenced_variables = refs.variables;
        delete parts.objective.terms[editor.apply.index].foreach;
        delete parts.objective.terms[editor.apply.index].scope_indices;
        delete parts.objective.terms[editor.apply.index].expansion_scope;
        setIndexedGenericParts(parts);
      }
      state.formulaEditor = null;
      closeModal();
      toast(`已应用到：${appliedTarget}`);
      render();
    }

    function writeComponentFormulaFields(field, index, dslFormula, displayFormula, tokens) {
      const rows = state.componentEditor?.component?.[field] || [];
      rows[index] = rows[index] || {};
      rows[index].expression = dslFormula;
      rows[index].dsl_formula = dslFormula;
      rows[index].display_formula = displayFormula;
      rows[index].tokens = tokens;
      const scope = state.formulaEditor?.scopeIndices || [];
      const refs = formulaPersistedReferences(state.formulaEditor?.validation || {});
      rows[index].compiled_status = state.formulaEditor?.validation?.valid ? 'compiled' : 'draft';
      rows[index].compile_status = state.formulaEditor?.validation?.valid ? 'compiled' : 'draft';
      rows[index].referenced_sets = refs.sets;
      rows[index].referenced_parameters = refs.parameters;
      rows[index].referenced_variables = refs.variables;
      if (field === 'constraints') {
        rows[index].foreach = scope.slice();
        rows[index].scope_indices = scope.slice();
        rows[index].expansion_scope = scope.slice();
      } else {
        delete rows[index].foreach;
        delete rows[index].scope_indices;
        delete rows[index].expansion_scope;
      }
      if (field === 'constraints') rows[index].formula = dslFormula;
      state.componentEditor.component[field] = rows;
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
    }

    function formulaPersistedReferences(validation = {}) {
      return {
        sets: [...new Set(validation.usedSets || [])],
        parameters: [...new Set(validation.usedParameters || [])],
        variables: [...new Set(validation.usedVariables || [])]
      };
    }

    function syncFormulaScopeToApplyTarget(editor = {}) {
      const scope = editor.scopeIndices || [];
      if (editor.apply?.type === 'componentConstraint') {
        updateComponentEditorArray('constraints', editor.apply.index, 'indices', scope.join(','));
        writeComponentFormulaScope('constraints', editor.apply.index, scope);
      } else if (editor.apply?.type === 'componentObjective') {
        writeComponentFormulaScope('objective_terms', editor.apply.index, []);
      }
    }

    function writeComponentFormulaScope(field, index, scope = []) {
      const rows = state.componentEditor?.component?.[field] || [];
      rows[index] = rows[index] || {};
      if (field === 'constraints') {
        rows[index].foreach = scope.slice();
        rows[index].scope_indices = scope.slice();
        rows[index].expansion_scope = scope.slice();
      } else {
        delete rows[index].foreach;
        delete rows[index].scope_indices;
        delete rows[index].expansion_scope;
      }
      state.componentEditor.component[field] = rows;
      state.componentEditor.dirty = true;
    }

    function formulaApplyTargetLabel(editor = {}) {
      const component = state.componentEditor?.component || {};
      if (editor.apply?.type === 'componentConstraint') {
        const row = (component.constraints || [])[editor.apply.index] || {};
        return `${row.name || row.constraint_id || '当前'}约束`;
      }
      if (editor.apply?.type === 'componentObjective') {
        const row = (component.objective_terms || [])[editor.apply.index] || {};
        return `${row.name || row.term_id || '当前'}目标项`;
      }
      if (editor.apply?.type === 'genericConstraint') return '模型创建当前约束';
      if (editor.apply?.type === 'genericObjective') return '模型创建当前目标项';
      return '当前字段';
    }

    function cancelFormulaEditor() {
      const editor = state.formulaEditor;
      const current = editor?.dslFormula ?? document.getElementById('unifiedFormulaText')?.value ?? editor?.value ?? '';
      if (editor && current !== editor.originalValue && !confirm('公式内容已修改但未应用，确认放弃？')) return;
      state.formulaEditor = null;
      closeModal();
    }

    function normalizeFormulaTokens(tokens, context = {}, fallbackExpression = '') {
      if (Array.isArray(tokens) && tokens.length) {
        return stripFormulaScopePrefixTokens(tokens.map(token => normalizeFormulaToken(token, context)).filter(Boolean), context);
      }
      return stripFormulaScopePrefixTokens(parseDslExpressionToTokens(fallbackExpression, context).tokens || [], context);
    }

    function formulaScopePrefixTokenValue(token = {}) {
      return String(token.code ?? token.dsl ?? token.label ?? token.text ?? '').trim();
    }

    function stripFormulaScopePrefixTokens(tokens = [], context = {}) {
      const list = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
      if (!list.length) return list;
      const first = formulaScopePrefixTokenValue(list[0]).toLowerCase();
      const colonIndex = list.findIndex((token, index) => index > 0 && [':', '：'].includes(formulaScopePrefixTokenValue(token)));
      const nextIsScopeSet = list.slice(1, Math.max(2, colonIndex)).some(token => token.type === 'set');
      const firstLooksLikeScope = ['∀', '?', 'forall', 'for all'].includes(first) || first.startsWith('∀') || (nextIsScopeSet && colonIndex > 0 && colonIndex <= 8);
      if (!firstLooksLikeScope) return list;
      if (colonIndex > 0 && colonIndex <= 8) return list.slice(colonIndex + 1);
      if (first.startsWith('∀') && first.includes(':')) return list.slice(1);
      return list;
    }

    function normalizeFormulaToken(token = {}, context = {}) {
      if (!token || typeof token !== 'object') return null;
      if (token.type === 'operator') return { ...token, label: token.label || FORMULA_OPERATOR_LABELS[token.dsl || token.code] || token.code, dsl: FORMULA_OPERATOR_DSL[token.dsl || token.code] || token.dsl || token.code, readonly: true };
      if (token.type === 'function') return { ...token, label: token.label || FORMULA_FUNCTION_LABELS[token.code] || token.code, dsl: token.dsl || token.code, readonly: true };
      if (token.type === 'group') return { ...token, body_tokens: (token.body_tokens || []).map(child => normalizeFormulaToken(child, context)).filter(Boolean), readonly: true };
      if (token.type === 'square') return { ...token, body_tokens: (token.body_tokens || []).map(child => normalizeFormulaToken(child, context)).filter(Boolean), readonly: true };
      if (token.type === 'power') return { ...token, exponent: String(token.exponent || '2'), body_tokens: (token.body_tokens || []).map(child => normalizeFormulaToken(child, context)).filter(Boolean), readonly: true };
      if (token.type === 'unary') return { ...token, fn: token.fn || token.code || 'abs', body_tokens: (token.body_tokens || []).map(child => normalizeFormulaToken(child, context)).filter(Boolean), readonly: true };
      if (token.type === 'aggregate') {
        return {
          ...token,
          type: 'aggregate',
          fn: token.fn || token.code || 'sum',
          set: token.set || '',
          alias: token.alias || (token.set ? defaultIndexAlias(token.set) : ''),
          label: FORMULA_FUNCTION_LABELS[token.fn || token.code] || token.label || token.fn || token.code || 'Σ',
          body_tokens: stripFormulaScopePrefixTokens((token.body_tokens || []).map(child => normalizeFormulaToken(child, context)).filter(Boolean), context),
          readonly: true,
          aggregateBlock: true
        };
      }
      if (['set', 'parameter', 'variable'].includes(token.type)) {
        const dict = getFormulaSymbolDictionary(context);
        const item = dict.byCode[token.code] || COMMON_FORMULA_SYMBOLS[token.code] || token;
        return formulaObjectToToken({ ...item, ...token }, token.type);
      }
      return { type: 'text', text: token.text || token.label || token.dsl || '', label: token.label || token.text || token.dsl || '', dsl: token.dsl || token.text || token.label || '', readonly: true };
    }

    function formulaObjectToToken(item = {}, type = '') {
      const actualType = type || item.type || 'object';
      return {
        type: actualType,
        code: item.code,
        name: item.name || item.code,
        label: formulaObjectLabel(item, actualType),
        dsl: item.code,
        indices: item.indices || item.dimension || [],
        unit: item.unit || '',
        description: item.description || '',
        missingName: Boolean(item.missingName),
        readonly: true
      };
    }

    function formulaObjectLabel(item = {}, type = '') {
      const code = item.code || item.key || item.name || '';
      if (type === 'set') return code;
      if (['parameter', 'variable'].includes(type)) {
        const dims = item.indices || item.dimension || [];
        const indexContext = formulaIndexContext(state.formulaEditor?.context || {}, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
        const indices = dims.map(dim => indexContext.aliases[dim] || defaultIndexAlias(dim));
        return dims.length ? `${code}[${indices.join(',')}]` : code;
      }
      return code;
    }

    function formulaTextToToken(text = '', context = {}) {
      const raw = String(text || '').trim();
      if (!raw) return null;
      if (FORMULA_OPERATOR_DSL[raw]) return { type: 'operator', code: FORMULA_OPERATOR_DSL[raw], label: FORMULA_OPERATOR_LABELS[FORMULA_OPERATOR_DSL[raw]] || raw, dsl: FORMULA_OPERATOR_DSL[raw], readonly: true };
      if (FORMULA_FUNCTION_LABELS[raw]) return { type: 'function', code: raw, label: FORMULA_FUNCTION_LABELS[raw], dsl: raw, readonly: true };
      const dict = getFormulaSymbolDictionary(context);
      const code = raw.replace(/\[[^\]]*\]/g, '');
      const item = dict.byCode[code] || COMMON_FORMULA_SYMBOLS[code];
      if (item) return formulaObjectToToken(item, item.type);
      return { type: 'text', text: raw, label: raw, dsl: raw, readonly: true };
    }

    function formulaTokenLabel(token = {}, context = {}) {
      if (token.type === 'aggregate') return aggregateTokenLabel(token, context);
      if (token.type === 'square') return `(${wrappedBodyToLabel(token, context)})²`;
      if (token.type === 'power') return `(${wrappedBodyToLabel(token, context)})^${token.exponent || '2'}`;
      if (token.type === 'unary') return unaryTokenText(token, unaryBodyToLabel(token, context));
      if (token.type === 'group') return `(${(token.body_tokens || []).map(child => formulaTokenLabel(child, context)).join(' ') || '表达式'})`;
      if (token.type === 'number') return String(token.value ?? token.dsl ?? token.code ?? '0');
      if (token.type === 'operator') return FORMULA_OPERATOR_LABELS[token.dsl || token.code] || token.code || '';
      if (token.type === 'function') return FORMULA_FUNCTION_LABELS[token.code] || token.code || '';
      if (['set', 'parameter', 'variable'].includes(token.type)) {
        const dict = getFormulaSymbolDictionary(context);
        return formulaObjectLabel({ ...(dict.byCode[token.code] || {}), ...token }, token.type);
      }
      if (token.label) return token.label;
      return token.text || token.dsl || '';
    }

    function formulaTokenTooltip(token = {}, context = {}) {
      const dict = getFormulaSymbolDictionary(context);
      const item = token.code ? { ...(dict.byCode[token.code] || COMMON_FORMULA_SYMBOLS[token.code] || {}), ...token } : token;
      const parts = [
        `编码：${item.code || item.dsl || '-'}`,
        `中文：${item.name || FORMULA_FUNCTION_CN_LABELS[item.code] || FORMULA_FUNCTION_CN_LABELS[token.fn] || item.label || '-'}`,
        `类型：${item.typeLabel || formulaTypeLabel(item.type) || item.type || '表达式片段'}`
      ];
      const dims = item.indices || item.dimension || [];
      if (dims?.length) parts.push(`维度：${dims.join(',')}`);
      if (item.unit) parts.push(`单位：${item.unit}`);
      if (item.description) parts.push(`业务含义：${item.description}`);
      if (item.missingName) parts.push('未维护中文名');
      if (token.type === 'aggregate') {
        const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
        parts.push(`中文含义：${FORMULA_FUNCTION_CN_LABELS[token.fn] || token.fn}；集合 ${aggregateTokenSetName(token, context)} ${token.set || '-'}；索引别名 ${indexContext.aliases[token.set] || token.alias || defaultIndexAlias(token.set)}`);
      }
      return parts.join('\n');
    }

    function formulaTokensToDisplay(tokens = [], context = {}) {
      if (!tokens.length) return '';
      return tokens.map(token => formulaTokenDisplayPart(token, context)).filter(Boolean).join(' ').trim();
    }

    function formulaTokenDisplayPart(token = {}, context = {}) {
        if (token.type === 'operator') return FORMULA_OPERATOR_LABELS[token.dsl || token.code] || token.label || token.code;
        if (token.type === 'aggregate') {
          const body = (token.body_tokens || []).map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '[表达式区域]';
          return `${aggregateTokenLabel(token, context)} ( ${body} )`;
        }
        if (token.type === 'square') return `(${wrappedBodyToDisplay(token, context)})²`;
        if (token.type === 'power') return `(${wrappedBodyToDisplay(token, context)})^${token.exponent || '2'}`;
        if (token.type === 'unary') return unaryTokenText(token, unaryBodyToDisplay(token, context));
        if (token.type === 'group') return `(${(token.body_tokens || []).map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '表达式'})`;
        if (token.type === 'function') return FORMULA_FUNCTION_LABELS[token.code] || token.code;
        return formulaTokenLabel(token, context);
    }

    function unaryTokenText(token = {}, body = '表达式') {
      const fn = token.fn || token.code || 'abs';
      const content = body || '表达式';
      if (fn === 'sqrt') return `√(${content})`;
      if (fn === 'log') return `ln(${content})`;
      return `${FORMULA_FUNCTION_LABELS[fn] || fn}(${content})`;
    }

    function formulaTokensToDsl(tokens = [], context = {}) {
      if (!tokens.length) return '';
      return tokensToDslLinear(tokens, context, {});
    }

    function tokensToDslLinear(tokens = [], context = {}, aliasBySet = {}) {
      return tokens.map(token => {
        if (token.type === 'placeholder') return '';
        if (token.type === 'number') return String(token.value ?? token.dsl ?? token.code ?? '0');
        if (token.type === 'operator') return token.dsl || FORMULA_OPERATOR_DSL[token.code] || token.code;
        if (token.type === 'function') return token.code === 'abs' ? 'abs' : token.dsl || token.code;
        if (token.type === 'square') return `(${wrappedBodyToDsl(token, context, aliasBySet)}) ** 2`;
        if (token.type === 'power') return `(${wrappedBodyToDsl(token, context, aliasBySet)}) ** ${token.exponent || '2'}`;
        if (token.type === 'unary') return `${token.fn || token.code || 'abs'}(${unaryBodyToDsl(token, context, aliasBySet)})`;
        if (token.type === 'group') return `(${tokensToDslLinear(token.body_tokens || [], context, aliasBySet)})`;
        if (token.type === 'aggregate') return aggregateTokenToDsl(token, context, aliasBySet);
        if (token.type === 'parameter' || token.type === 'variable') return objectTokenToDsl(token, context, aliasBySet);
        if (token.type === 'set') return token.code;
        return token.dsl || token.text || token.label || '';
      }).filter(Boolean).join(' ').replace(/\s+([,\]\)])/g, '$1').replace(/([\[\(])\s+/g, '$1');
    }

    function unaryBodyToDsl(token = {}, context = {}, aliasBySet = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return tokensToDslLinear(body[0].body_tokens || [], context, aliasBySet);
      return tokensToDslLinear(body, context, aliasBySet);
    }

    function wrappedBodyToDsl(token = {}, context = {}, aliasBySet = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return tokensToDslLinear(body[0].body_tokens || [], context, aliasBySet);
      return tokensToDslLinear(body, context, aliasBySet);
    }

    function unaryBodyToLabel(token = {}, context = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return (body[0].body_tokens || []).map(child => formulaTokenDisplayPart(child, context) || formulaTokenLabel(child, context)).join(' ') || '表达式';
      return body.map(child => formulaTokenDisplayPart(child, context) || formulaTokenLabel(child, context)).join(' ') || '表达式';
    }

    function wrappedBodyToLabel(token = {}, context = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return (body[0].body_tokens || []).map(child => formulaTokenDisplayPart(child, context) || formulaTokenLabel(child, context)).join(' ') || '表达式';
      return body.map(child => formulaTokenDisplayPart(child, context) || formulaTokenLabel(child, context)).join(' ') || '表达式';
    }

    function unaryBodyToDisplay(token = {}, context = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return (body[0].body_tokens || []).map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '表达式';
      return body.map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '表达式';
    }

    function wrappedBodyToDisplay(token = {}, context = {}) {
      const body = token.body_tokens || [];
      if (body.length === 1 && body[0]?.type === 'group') return (body[0].body_tokens || []).map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '表达式';
      return body.map(child => formulaTokenDisplayPart(child, context)).filter(Boolean).join(' ') || '表达式';
    }

    function objectTokenToDsl(token = {}, context = {}, aliasBySet = {}) {
      const dict = getFormulaSymbolDictionary(context);
      const item = { ...(dict.byCode[token.code] || {}), ...token };
      const dims = item.indices || [];
      if (!dims.length) return item.code || '';
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
      const tokenAliases = Array.isArray(token.index_aliases) ? token.index_aliases : [];
      const indices = dims.map((dim, index) => tokenAliases[index] || aliasBySet[dim] || indexContext.aliases[dim] || defaultIndexAlias(dim));
      return `${item.code}[${indices.join(',')}]`;
    }

    function aggregateTokenSetName(token = {}, context = {}) {
      const dict = getFormulaSymbolDictionary(context);
      return token.set ? (dict.byCode[token.set]?.name || COMMON_FORMULA_SYMBOLS[token.set]?.name || token.set) : '请选择集合';
    }

    function aggregateTokenLabel(token = {}, context = {}) {
      const fnLabel = { sum: 'Σ', min: 'min', max: 'max' }[token.fn] || token.fn || '聚合';
      if (!token.set) return `${fnLabel}（请选择集合）`;
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
      const alias = indexContext.aliases[token.set] || token.alias || defaultIndexAlias(token.set);
      return `${fnLabel} for ${alias} ∈ ${token.set || 'set'}`;
    }

    function aggregateTokenToDsl(token = {}, context = {}, parentAliasBySet = {}) {
      const setCode = token.set || '';
      if (!setCode) {
        const inner = tokensToDslLinear(token.body_tokens || [], context, parentAliasBySet);
        return `${token.fn || 'sum'}(${inner || 'expr'} for i in set)`;
      }
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
      const fallbackAlias = indexContext.aliases[setCode] || token.alias || defaultIndexAlias(setCode);
      const alias = token.alias || fallbackAlias;
      const aliasBySet = { ...(parentAliasBySet || {}), [setCode]: alias };
      const inner = tokensToDslLinear(token.body_tokens || [], context, aliasBySet);
      return `${token.fn || 'sum'}(${inner} for ${alias} in ${setCode})`;
    }

    function collectAggregateTokens(tokens = []) {
      return (tokens || []).flatMap(token => {
        if (token.type !== 'aggregate') return [];
        return [token, ...collectAggregateTokens(token.body_tokens || [])];
      });
    }

    function aggregatePrefixFromTokens(tokens = [], context = {}) {
      const first = tokens[0] || {};
      if (first.type !== 'function' || !['sum', 'min', 'max'].includes(first.code)) return null;
      const sets = [];
      let index = 1;
      const dict = getFormulaSymbolDictionary(context);
      while (tokens[index]?.type === 'set') {
        const item = dict.byCode[tokens[index].code] || tokens[index];
        sets.push(item);
        index += 1;
      }
      if (!sets.length) return null;
      const aliasBySet = {};
      sets.forEach(item => { aliasBySet[item.code] = defaultIndexAlias(item.code, aliasBySet); });
      return { fn: first.code, label: `${FORMULA_FUNCTION_LABELS[first.code] || first.code}(${sets.map(item => formulaTokenLabel({ ...item, type: 'set' }, context)).join('、')})`, sets, aliasBySet, endIndex: index };
    }

    function formulaIndexContext(context = {}, tokens = [], scopeIndices = []) {
      const dict = getFormulaSymbolDictionary(context);
      const aliases = {};
      const aliasToSet = {};
      const used = {};
      const assign = (setCode, preferred = '') => {
        if (!setCode) return '';
        if (aliases[setCode]) return aliases[setCode];
        let alias = preferred || defaultIndexAlias(setCode, used);
        if (Object.values(aliases).includes(alias) || used[alias]) alias = defaultIndexAlias(setCode, used);
        aliases[setCode] = alias;
        aliasToSet[alias] = setCode;
        used[alias] = true;
        return alias;
      };
      (scopeIndices || []).forEach(code => assign(code));
      collectAggregateTokens(tokens || []).forEach(token => assign(token.set, token.alias));
      (dict.sets || []).forEach(item => assign(item.code));
      return { aliases, aliasToSet };
    }

    function formulaAliasToSetMap(context = {}, overrides = {}) {
      const indexContext = formulaIndexContext(context, state.formulaEditor?.tokens || [], state.formulaEditor?.scopeIndices || []);
      return { ...(indexContext.aliasToSet || {}), ...(overrides || {}) };
    }

    function defaultIndexAlias(code = '', used = {}) {
      const preferred = { time: 't', unit: 'u', storage: 's', reservoir: 'r', station: 's', scenario: 'sc' }[code] || String(code || 'i').charAt(0).toLowerCase();
      let alias = preferred || 'i';
      let suffix = 2;
      while (Object.values(used || {}).includes(alias) || used?.[alias]) {
        alias = `${preferred}${suffix}`;
        suffix += 1;
      }
      return alias;
    }

    function inferFormulaScopeFromTokens(tokens = [], context = {}, fallback = []) {
      const aggregated = new Set();
      const referenced = new Set();
      collectAggregateTokens(tokens || []).forEach(token => aggregated.add(token.set));
      const knownSets = new Set(getFormulaSymbolDictionary(context).sets.map(item => item.code));
      const visit = list => (list || []).forEach(token => {
        if (token.type === 'aggregate') visit(token.body_tokens || []);
        if (token.type === 'parameter' || token.type === 'variable') (token.indices || []).forEach(dim => {
          if (knownSets.has(dim)) referenced.add(dim);
        });
      });
      visit(tokens || []);
      const scope = new Set((fallback || []).filter(code => knownSets.has(code) && !aggregated.has(code)));
      referenced.forEach(code => { if (!aggregated.has(code)) scope.add(code); });
      return [...scope].filter(Boolean);
    }

    function inferFormulaScopeFromExpression(expression = '', context = {}, fallback = []) {
      const value = String(expression || '');
      const dict = getFormulaSymbolDictionary(context);
      const knownSets = new Set(dict.sets.map(item => item.code));
      const aliasToSet = formulaAliasToSetMap(context);
      const aggregated = new Set();
      value.replace(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/g, (_, alias, setCode) => {
        aliasToSet[alias] = setCode;
        if (knownSets.has(setCode)) aggregated.add(setCode);
        return '';
      });
      const referenced = new Set();
      value.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*\[([^\]]+)\]/g, (_, rawIndices) => {
        String(rawIndices || '').split(',').map(item => item.trim()).filter(Boolean).forEach(indexCode => {
          const setCode = aliasToSet[indexCode] || indexCode;
          if (knownSets.has(setCode)) referenced.add(setCode);
        });
        return '';
      });
      const scope = new Set((fallback || []).filter(code => knownSets.has(code) && !aggregated.has(code)));
      referenced.forEach(code => { if (!aggregated.has(code)) scope.add(code); });
      return [...scope];
    }

    function parseDslExpressionToTokens(expression = '', context = {}) {
      const raw = String(expression || '').trim();
      if (!raw) return { ok: true, tokens: [] };
      const dict = getFormulaSymbolDictionary(context);
      const relationMatch = raw.match(/^(.*?)(<=|>=|==)(.*)$/);
      if (relationMatch) {
        const left = parseDslLinearTokens(relationMatch[1], context, {});
        const right = parseDslLinearTokens(relationMatch[3], context, {});
        return {
          ok: left.length > 0 && right.length > 0,
          tokens: [
            ...left,
            { type: 'operator', code: relationMatch[2], label: FORMULA_OPERATOR_LABELS[relationMatch[2]] || relationMatch[2], dsl: relationMatch[2], readonly: true },
            ...right
          ]
        };
      }
      const sumMatch = raw.match(/^(sum|min|max)\(([\s\S]+?)\s+((?:for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[A-Za-z_][A-Za-z0-9_]*\s*)+)\)$/);
      if (sumMatch) {
        const fn = sumMatch[1];
        const loops = parseAggregateLoops(sumMatch[3]);
        const aggregate = aggregateTokenFromParsed(fn, sumMatch[2], loops, context, dict, {});
        if (aggregate) return { ok: true, tokens: [aggregate] };
      }
      const tokens = parseDslLinearTokens(raw, context, {});
      return { ok: tokens.length > 0, tokens };
    }

    function parseDslLinearTokens(text = '', context = {}, aliasToSet = {}) {
      const dict = getFormulaSymbolDictionary(context);
      const effectiveAliasToSet = formulaAliasToSetMap(context, aliasToSet);
      const tokens = [];
      const source = String(text || '');
      let index = 0;
      while (index < source.length) {
        const rest = source.slice(index);
        const whitespace = rest.match(/^\s+/);
        if (whitespace) {
          index += whitespace[0].length;
          continue;
        }
        const aggregateStart = rest.match(/^(sum|min|max)\s*\(/);
        if (aggregateStart) {
          const openIndex = index + aggregateStart[0].lastIndexOf('(');
          const closeIndex = formulaFindMatchingParen(source, openIndex);
          if (closeIndex > openIndex) {
            const fn = aggregateStart[1];
            const body = source.slice(openIndex + 1, closeIndex);
            const aggregateMatch = body.match(/^([\s\S]+?)\s+((?:for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[A-Za-z_][A-Za-z0-9_]*\s*)+)$/);
            const loops = aggregateMatch ? parseAggregateLoops(aggregateMatch[2]) : [];
            const aggregateToken = aggregateMatch ? aggregateTokenFromParsed(fn, aggregateMatch[1], loops, context, dict, effectiveAliasToSet) : null;
            if (aggregateToken) {
              tokens.push(aggregateToken);
              index = closeIndex + 1;
              continue;
            }
          }
        }
        const unaryStart = rest.match(/^(abs|log|exp|sqrt)\s*\(/);
        if (unaryStart) {
          const openIndex = index + unaryStart[0].lastIndexOf('(');
          const closeIndex = formulaFindMatchingParen(source, openIndex);
          if (closeIndex > openIndex) {
            const fn = unaryStart[1];
            const body = source.slice(openIndex + 1, closeIndex);
            tokens.push(formulaUnaryToken(fn, { type: 'group', body_tokens: parseDslLinearTokens(body, context, effectiveAliasToSet), readonly: true }, context));
            index = closeIndex + 1;
            continue;
          }
        }
        const powerMatch = rest.match(/^\*\*\s*(-?\d+(?:\.\d+)?)?/);
        if (powerMatch) {
          const exponent = powerMatch[1] || '2';
          let bodyTokens = [];
          const previous = tokens[tokens.length - 1];
          if (previous?.type === 'operator' && previous.code === ')') {
            let depth = 0;
            let openAt = -1;
            for (let i = tokens.length - 1; i >= 0; i -= 1) {
              const item = tokens[i];
              if (item.type === 'operator' && item.code === ')') depth += 1;
              if (item.type === 'operator' && item.code === '(') {
                depth -= 1;
                if (depth === 0) {
                  openAt = i;
                  break;
                }
              }
            }
            if (openAt >= 0) {
              bodyTokens = tokens.slice(openAt + 1, -1);
              tokens.splice(openAt);
            }
          }
          if (!bodyTokens.length) {
            const popped = tokens.pop();
            if (popped) bodyTokens = [popped];
          }
          if (bodyTokens.length) {
            const inner = bodyTokens.length === 1 ? bodyTokens[0] : { type: 'group', body_tokens: bodyTokens, readonly: true };
            tokens.push(exponent === '2' ? formulaSquareToken(inner, context) : formulaPowerToken(inner, exponent, context));
          }
          else tokens.push({ type: 'text', text: powerMatch[0], label: powerMatch[0], dsl: powerMatch[0], readonly: true });
          index += powerMatch[0].length;
          continue;
        }
        const match = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)\])?|^<=|^>=|^==|^[+\-*/()]|^\d+(?:\.\d*)?/);
        if (!match) {
          tokens.push({ type: 'text', text: rest[0], label: rest[0], dsl: rest[0], readonly: true });
          index += 1;
          continue;
        }
        const raw = match[0];
        if (FORMULA_OPERATOR_DSL[raw]) {
          tokens.push({ type: 'operator', code: FORMULA_OPERATOR_DSL[raw], label: FORMULA_OPERATOR_LABELS[raw] || FORMULA_OPERATOR_LABELS[FORMULA_OPERATOR_DSL[raw]] || raw, dsl: FORMULA_OPERATOR_DSL[raw], readonly: true });
        } else if (['sum', 'min', 'max', 'abs'].includes(raw)) {
          tokens.push({ type: 'function', code: raw, label: FORMULA_FUNCTION_LABELS[raw] || raw, dsl: raw, readonly: true });
        } else if (/^[A-Za-z_]/.test(raw)) {
          const code = match[1];
          const item = dict.byCode[code] || COMMON_FORMULA_SYMBOLS[code];
          const rawIndexAliases = match[2] ? match[2].split(',').map(x => x.trim()).filter(Boolean) : [];
          const parsedDims = rawIndexAliases.map(x => effectiveAliasToSet[x] || x).filter(Boolean);
          if (item) tokens.push({ ...formulaObjectToToken({ ...item, indices: parsedDims.length ? parsedDims : item.indices }, item.type), index_aliases: rawIndexAliases });
          else tokens.push({ type: 'text', text: raw, label: raw, dsl: raw, readonly: true });
        } else if (/^\d/.test(raw)) {
          tokens.push(formulaNumberToken(raw));
        } else {
          tokens.push({ type: 'text', text: raw, label: raw, dsl: raw, readonly: true });
        }
        index += raw.length;
      }
      return tokens;
    }

    function parseAggregateLoops(text = '') {
      const loops = [];
      String(text || '').replace(/for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/g, (_, alias, setCode) => {
        loops.push({ alias, setCode });
        return '';
      });
      return loops;
    }

    function aggregateTokenFromParsed(fn = 'sum', body = '', loops = [], context = {}, dict = getFormulaSymbolDictionary(context), inheritedAliasToSet = {}) {
      if (!loops.length) return null;
      const aliasMap = { ...(inheritedAliasToSet || {}) };
      loops.forEach(loop => { aliasMap[loop.alias] = loop.setCode; });
      let bodyTokens = parseDslLinearTokens(body, context, aliasMap);
      for (let index = loops.length - 1; index >= 0; index -= 1) {
        const loop = loops[index];
        const setItem = dict.byCode[loop.setCode] || COMMON_FORMULA_SYMBOLS[loop.setCode] || { code: loop.setCode, name: loop.setCode, type: 'set' };
        bodyTokens = [{ ...formulaAggregateToken(fn, setItem), alias: loop.alias || defaultIndexAlias(loop.setCode), body_tokens: bodyTokens }];
      }
      return bodyTokens[0] || null;
    }

    function formulaFindMatchingParen(text = '', openIndex = 0) {
      let depth = 0;
      for (let index = openIndex; index < String(text || '').length; index += 1) {
        const ch = text[index];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) return index;
        }
      }
      return -1;
    }

    function validateFormulaText(text, mode = 'constraint', context = {}, tokens = []) {
      const value = String(text || '').trim();
      const errors = [];
      const explanations = [];
      const dict = getFormulaSymbolDictionary(context);
      const sets = new Set(dict.sets.map(x => x.code));
      const params = new Set(dict.parameters.map(x => x.code));
      const vars = new Set(dict.variables.map(x => x.code));
      const tokenRefs = formulaTokenKnownReferences(tokens || []);
      tokenRefs.sets.forEach(code => sets.add(code));
      tokenRefs.parameters.forEach(code => params.add(code));
      tokenRefs.variables.forEach(code => vars.add(code));
      if (!value) addFormulaIssue(errors, explanations, '表达式不能为空', '请先从左侧对象面板插入公式标签，或在高级模式输入 DSL。');
      const hasSingleEquals = /(^|[^<>=!])=([^=]|$)/.test(value);
      if (hasSingleEquals) addFormulaIssue(errors, explanations, '不支持单等号', '请使用 == 表示等式约束。');
      const relation = (value.match(/<=|>=|==/) || [])[0] || '';
      if (mode === 'constraint' && !relation) addFormulaIssue(errors, explanations, '约束表达式缺少关系符', '约束表达式必须包含 <=、>= 或 ==。');
      if (mode === 'objective' && relation) addFormulaIssue(errors, explanations, '目标函数表达式包含约束关系符', '目标函数表达式不应包含约束关系符，请切换到约束模式或删除关系符。');
      const stack = [];
      for (const ch of value) {
        if (ch === '(' || ch === '[') stack.push(ch);
        if (ch === ')' && stack.pop() !== '(') addFormulaIssue(errors, explanations, '圆括号不匹配', '请检查函数调用和表达式分组中的圆括号。');
        if (ch === ']' && stack.pop() !== '[') addFormulaIssue(errors, explanations, '方括号不匹配', '请检查对象索引是否完整，例如 unit_output[unit,time]。');
      }
      if (stack.length) addFormulaIssue(errors, explanations, '括号未闭合', '请补全缺失的 ) 或 ]。');
      const keywords = new Set(['sum', 'for', 'in', 'min', 'max', 'abs', 'log', 'exp', 'sqrt', 'pow', 'if', 'else', 'piecewise']);
      const names = [...new Set((value.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter(x => !keywords.has(x)))];
      const loopAliases = new Set();
      const loopSets = [];
      value.replace(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/g, (_, alias, setCode) => {
        loopAliases.add(alias);
        loopSets.push(setCode);
        return '';
      });
      const knownAliases = new Set(['t', 'g', 'i', 'j', 'k', 'u', 'r', 's', 'sc', 'tv']);
      const known = new Set([...sets, ...params, ...vars, ...loopAliases, ...knownAliases]);
      names.filter(n => !known.has(n)).slice(0, 8).forEach(n => {
        const fallback = COMMON_FORMULA_SYMBOLS[n];
        const inferredType = fallback?.type === 'variable' ? '变量' : fallback?.type === 'parameter' ? '参数' : fallback?.type === 'set' ? '集合' : '对象';
        const suggestion = fallback
          ? `请先在“${inferredType === '变量' ? '变量定义' : inferredType === '参数' ? '参数定义' : '集合定义'}”中新增“${fallback.name} ${n}”，或从左侧对象面板插入已有对象。`
          : n === 's'
            ? '请确认 s 是否代表水库集合。如果是，请使用 reservoir，或在集合定义中新增 s。'
            : '请检查对象编码是否拼写正确，或先在当前模型/组件中维护该对象。';
        addFormulaIssue(errors, explanations, `${inferredType} ${n} 未定义`, suggestion, fallback?.name || '');
      });
      validateFormulaTokenStructure(tokens || [], context, mode, value, errors, explanations);
      const configuredScope = state.formulaEditor?.scopeIndices || [];
      loopSets.filter(setCode => configuredScope.includes(setCode)).forEach(setCode => {
        explanations.push({ title: `聚合索引 ${setCode} 被手工选为作用范围`, suggestion: 'sum/min/max 中已经聚合的索引不应再作为外层 ∀ 作用范围，否则会重复展开。', meaning: '系统保存时会优先按自由索引推断外层作用范围。' });
      });
      return {
        valid: errors.length === 0,
        errors,
        explanations,
        relation,
        loopSets,
        usedSets: names.filter(n => sets.has(n)),
        usedParameters: names.filter(n => params.has(n)),
        usedVariables: names.filter(n => vars.has(n)),
        indexNames: names.filter(n => sets.has(n) || loopAliases.has(n))
      };
    }

    function formulaTokenKnownReferences(tokens = []) {
      const refs = { sets: new Set(), parameters: new Set(), variables: new Set() };
      const visit = list => (list || []).forEach(token => {
        if (!token) return;
        if (token.type === 'set' && token.code) refs.sets.add(token.code);
        if (token.type === 'parameter' && token.code) refs.parameters.add(token.code);
        if (token.type === 'variable' && token.code) refs.variables.add(token.code);
        if (token.type === 'aggregate') {
          if (token.set) refs.sets.add(token.set);
          visit(token.body_tokens || []);
        }
        if (['square', 'power', 'unary', 'group'].includes(token.type)) visit(token.body_tokens || []);
      });
      visit(tokens || []);
      return refs;
    }

    function addFormulaIssue(errors, explanations, title, suggestion, meaning = '') {
      if (errors.includes(title)) return;
      errors.push(title);
      explanations.push({ title, suggestion, meaning });
    }

    function validateFormulaTokenStructure(tokens = [], context = {}, mode = 'constraint', dsl = '', errors = [], explanations = []) {
      const dict = getFormulaSymbolDictionary(context);
      const knownSets = new Set(dict.sets.map(item => item.code));
      const knownParams = new Set(dict.parameters.map(item => item.code));
      const knownVars = new Set(dict.variables.map(item => item.code));
      const tokenRefs = formulaTokenKnownReferences(tokens || []);
      tokenRefs.sets.forEach(code => knownSets.add(code));
      tokenRefs.parameters.forEach(code => knownParams.add(code));
      tokenRefs.variables.forEach(code => knownVars.add(code));
      const aggregate = aggregatePrefixFromTokens(tokens, context);
      const aggregateTokens = collectAggregateTokens(tokens || []);
      const covered = new Set([...(aggregate?.sets || []).map(item => item.code), ...aggregateTokens.map(item => item.set), ...(state.formulaEditor?.scopeIndices || [])]);
      const isValueToken = token => ['aggregate', 'square', 'power', 'unary', 'group', 'number', 'parameter', 'variable', 'set'].includes(token?.type);
      const isOperatorToken = token => token?.type === 'operator';
      const isOpenParen = token => isOperatorToken(token) && token.code === '(';
      const isCloseParen = token => isOperatorToken(token) && token.code === ')';
      const validateTokenOrder = list => (list || []).forEach((token, index) => {
        const next = list[index + 1];
        if (!next) return;
        if (isValueToken(token) && isValueToken(next)) {
          addFormulaIssue(errors, explanations, '相邻表达式缺少运算符', '两个对象、聚合块或科学函数结果之间需要插入 +、-、×、÷、≤、≥ 或 =，不能直接相邻。');
        }
        if ((isValueToken(token) || isCloseParen(token)) && isOpenParen(next)) {
          addFormulaIssue(errors, explanations, '括号前缺少运算符', '括号分组前需要插入明确运算符，例如 × 或 +。');
        }
        if (isOperatorToken(token) && isOperatorToken(next) && !isCloseParen(token) && !isOpenParen(next)) {
          addFormulaIssue(errors, explanations, '运算符连续', '请删除多余运算符，或在两个运算符之间插入对象/数字/函数。');
        }
      });
      const visitTokens = (list, insideAggregate = false) => {
        validateTokenOrder(list || []);
        (list || []).forEach((token, index) => {
        if (token.type === 'aggregate') {
          if (!token.set) addFormulaIssue(errors, explanations, '聚合集合未选择', '请先选中聚合标签，再从左侧集合面板选择该聚合函数作用的集合。');
          else if (!knownSets.has(token.set)) addFormulaIssue(errors, explanations, `集合 ${token.set} 不存在`, '请从左侧集合面板重新插入聚合集合，或先维护该集合。');
          if (!(token.body_tokens || []).length) addFormulaIssue(errors, explanations, `${FORMULA_FUNCTION_LABELS[token.fn] || token.fn} 表达式为空`, `${FORMULA_FUNCTION_LABELS[token.fn] || token.fn}表达式为空，请在 ${aggregateTokenLabel(token, context)} 内配置被聚合表达式。`);
          visitTokens(token.body_tokens || [], true);
          return;
        }
        if (token.type === 'square') {
          if (!(token.body_tokens || []).length) addFormulaIssue(errors, explanations, '平方表达式为空', '请先插入要平方的对象或表达式，再点击平方。');
          visitTokens(token.body_tokens || [], insideAggregate);
          return;
        }
        if (token.type === 'power') {
          if (!(token.body_tokens || []).length) addFormulaIssue(errors, explanations, '幂表达式为空', '请先插入要取幂的对象或表达式。');
          if (!/^-?\d+(?:\.\d+)?$/.test(String(token.exponent || ''))) addFormulaIssue(errors, explanations, '幂次不是数字', '请重新插入 xⁿ 并输入数字幂次。');
          visitTokens(token.body_tokens || [], insideAggregate);
          return;
        }
        if (token.type === 'unary') {
          if (!(token.body_tokens || []).length) addFormulaIssue(errors, explanations, `${FORMULA_FUNCTION_LABELS[token.fn || token.code] || token.fn || token.code} 表达式为空`, '请先选中要应用函数的标签或括号分组。');
          visitTokens(token.body_tokens || [], insideAggregate);
          return;
        }
        if (token.type === 'group') {
          visitTokens(token.body_tokens || [], insideAggregate);
          return;
        }
        if (token.type === 'set' && !knownSets.has(token.code)) addFormulaIssue(errors, explanations, `集合 ${token.code} 不存在`, '请从左侧集合面板重新插入，或先维护该集合。');
        if (token.type === 'parameter' && !knownParams.has(token.code)) addFormulaIssue(errors, explanations, `参数 ${token.code} 不存在`, '请从左侧参数面板重新插入，或先维护该参数。');
        if (token.type === 'variable' && !knownVars.has(token.code)) addFormulaIssue(errors, explanations, `变量 ${token.code} 不存在`, '请从左侧变量面板重新插入，或先维护该变量。');
        if (token.type === 'parameter' || token.type === 'variable') {
          const item = dict.byCode[token.code] || {};
          const expected = item.indices || [];
          const actual = token.indices || [];
          if (expected.length && actual.length && expected.join(',') !== actual.join(',')) {
            addFormulaIssue(errors, explanations, `${token.code} 维度不匹配`, `期望维度 [${expected.join(',')}]，当前 token 维度 [${actual.join(',')}]。`);
          }
          actual.forEach(dim => {
            if (!covered.has(dim) && knownSets.has(dim)) addFormulaIssue(errors, explanations, `自由索引 ${dim} 未被聚合或作用范围覆盖`, '普通模式会自动识别范围；如需手工调整，请在高级设置中维护作用范围。');
          });
        }
      });
      };
      visitTokens(tokens || [], false);
      if (aggregate && !(aggregate.sets || []).every(item => knownSets.has(item.code))) {
        addFormulaIssue(errors, explanations, 'sum 中索引集合绑定不完整', '请在求和函数后插入明确的集合 token。');
      }
      (tokens || []).forEach((token, index) => {
        if (token.type !== 'function') return;
        if (['sum', 'min', 'max'].includes(token.code)) {
          addFormulaIssue(errors, explanations, `裸函数 ${FORMULA_FUNCTION_LABELS[token.code] || token.code} 不合法`, '请使用聚合块插入 sum/min/max，不要在普通 token 序列中手工拼函数、括号、for 或 in。');
          return;
        }
        const next = tokens[index + 1];
        if (!next || next.type === 'function') {
          addFormulaIssue(errors, explanations, `函数 ${FORMULA_FUNCTION_LABELS[token.code] || token.code} 缺少操作对象`, '请在函数后插入集合、变量或参数，避免连续拼接函数 token。');
        }
      });
      if (mode === 'objective' && (tokens || []).some(token => token.type === 'variable' && (token.indices || []).some(dim => !covered.has(dim)))) {
        addFormulaIssue(errors, explanations, '目标函数不是标量', '目标函数中的带维度变量需要被 sum/min/max 聚合，或在高级设置中明确展开范围。');
      }
      if (mode === 'constraint' && !(tokens || []).some(token => token.type === 'operator' && ['<=', '>=', '=='].includes(token.dsl || token.code))) {
        addFormulaIssue(errors, explanations, '约束 token 缺少关系符', '请从左侧运算符区插入 ≤、≥ 或 =。');
      }
      const variableCodes = [...knownVars].map(code => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (variableCodes.length) {
        const variableRef = `(?:${variableCodes.join('|')})(?:\\[[^\\]]+\\])?`;
        if (new RegExp(`${variableRef}\\s*\\*\\s*${variableRef}`).test(dsl)) addFormulaIssue(errors, explanations, '存在变量×变量非线性表达', '当前线性求解流程不支持变量相乘，请改为线性化或作为非线性模型处理。');
        if (new RegExp(`${variableRef}\\s*/\\s*${variableRef}`).test(dsl)) addFormulaIssue(errors, explanations, '存在变量÷变量非线性表达', '当前线性求解流程不支持变量相除，请改为线性化或作为非线性模型处理。');
      }
    }


