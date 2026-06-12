// Component library and component editor drawer.
    function pageComponents() {
      const allRows = filteredComponentRegistry();
      const total = (state.componentRegistry || []).length;
      const pageSize = Number(state.componentPageSize || 8);
      const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
      state.componentPage = Math.min(Math.max(1, Number(state.componentPage || 1)), totalPages);
      const published = (state.componentRegistry || []).filter(c => c.enabled !== false && c.implemented !== false).length;
      const trial = (state.componentRegistry || []).filter(c => String(c.status || '').includes('trial') || String(c.status || '').includes('试运行')).length;
      const pending = (state.componentRegistry || []).filter(c => c.implemented === false || c.enabled === false).length;
      return shell('组件库管理', '沉淀可复用的集合、参数、变量、约束和目标项组件，支撑模型快速装配。', `<button class="btn primary" ${productionDisabledAttr()} onclick="beginCreateComponent()">新增组件</button>`) +
      demoModeBanner() +
      `<div class="grid cols-5">
        <div class="card metric blue"><span>组件总数</span><b>${total}</b><span>库内登记组件</span></div>
        <div class="card metric green"><span>已发布</span><b>${published}</b><span>可用于模型装配</span></div>
        <div class="card metric amber"><span>试运行</span><b>${trial}</b><span>待业务验证</span></div>
        <div class="card metric red"><span>待校验</span><b>${pending}</b><span>需完善或停用</span></div>
        <div class="card metric blue"><span>筛选结果</span><b>${allRows.length}</b><span>当前可见组件</span></div>
      </div>
      <div class="list-shell component-list-shell mt">
        ${componentRegistryToolbar(allRows.length, total)}
        ${componentRegistryTable(allRows)}
      </div>
      ${state.componentDetailOpen ? componentDetailDrawer() : ''}
      ${state.componentEditor?.active ? componentEditorDrawer() : ''}`;
    }

    function componentRegistryToolbar(filteredCount, total) {
      const pageSize = Number(state.componentPageSize || 8);
      const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
      const page = Math.min(Math.max(1, Number(state.componentPage || 1)), totalPages);
      const start = filteredCount ? (page - 1) * pageSize + 1 : 0;
      const end = Math.min(filteredCount, page * pageSize);
      return `<div class="component-registry-toolbar">
        <div class="component-registry-filters">
          <input class="search" style="height:32px;flex:0 1 160px;min-width:80px" value="${escapeHtml(state.componentSearch || '')}" placeholder="搜索组件名称、编码、描述" oninput="setComponentSearch(this.value)" />
          <label class="filter-label-group"><span>领域</span><select style="width:110px" onchange="state.componentFilters.domain=this.value;state.componentPage=1;render()">${componentFilterOptions('domain')}</select></label>
          <label class="filter-label-group"><span>类别</span><select style="width:105px" onchange="state.componentFilters.category=this.value;state.componentPage=1;render()">${componentFilterOptions('category')}</select></label>
          <label class="filter-label-group"><span>状态</span><select style="width:78px" onchange="state.componentFilters.status=this.value;state.componentPage=1;render()">${componentStatusOptions()}</select></label>
          <label class="filter-label-group"><span>类型</span><select style="width:72px" onchange="state.componentFilters.problemType=this.value;state.componentPage=1;render()">${componentProblemTypeOptions()}</select></label>
        </div>
        <div class="component-registry-actions">
          <span class="chip muted" style="font-size:12px;white-space:nowrap">${start}–${end} / ${filteredCount}</span>
          <button class="btn" onclick="setComponentPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="chip" style="font-size:12px;white-space:nowrap">${page} / ${totalPages}</span>
          <button class="btn" onclick="setComponentPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
          <select style="height:32px;width:85px" onchange="setComponentPageSize(this.value)">
            <option value="8" ${pageSize === 8 ? 'selected' : ''}>8 条/页</option>
            <option value="12" ${pageSize === 12 ? 'selected' : ''}>12 条/页</option>
            <option value="24" ${pageSize === 24 ? 'selected' : ''}>24 条/页</option>
          </select>
          <button class="btn" onclick="refreshComponentRegistry()">刷新</button>
          <button class="btn primary" ${productionDisabledAttr()} onclick="beginCreateComponent()">新增组件</button>
        </div>
      </div>`;
    }

    function componentFilterOptions(field) {
      const current = state.componentFilters[field] || '全部';
      const values = ['全部', ...new Set((state.componentRegistry || []).map(item => item[field]).filter(Boolean))];
      return values.map(value => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
    }

    function componentStatusOptions() {
      const current = state.componentFilters.status || '全部';
      return ['全部', '已发布', '试运行', '待校验', '停用'].map(value => `<option value="${value}" ${current === value ? 'selected' : ''}>${value}</option>`).join('');
    }

    function componentProblemTypeOptions() {
      const current = state.componentFilters.problemType || '全部';
      const values = new Set(['全部']);
      (state.componentRegistry || []).forEach(item => componentProblemTypes(item).forEach(v => values.add(v)));
      return [...values].map(value => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
    }

    function componentProblemTypes(item) {
      const values = item.problem_types || item.solver_capabilities || item.required_solver_capabilities || [];
      if (Array.isArray(values) && values.length) return values;
      return [item.problem_type || item.problem_type_effect || 'LP'].filter(Boolean);
    }

    function expressionClassLabel(value) {
      const labels = { linear: '线性', quadratic: '二次', nonlinear: '非线性' };
      return labels[String(value || 'linear').toLowerCase()] || value || '线性';
    }

    function componentStatusText(item) {
      if (item.implemented === false) return '待校验';
      if (item.enabled === false) return '停用';
      if (String(item.status || '').includes('trial') || String(item.status || '').includes('试运行')) return '试运行';
      return '已发布';
    }

    function filteredComponentRegistry() {
      const filters = state.componentFilters || {};
      const keyword = String(state.componentSearch || '').trim().toLowerCase();
      return (state.componentRegistry || []).filter(item => {
        if (filters.domain && filters.domain !== '全部' && item.domain !== filters.domain) return false;
        if (filters.category && filters.category !== '全部' && item.category !== filters.category) return false;
        if (filters.status && filters.status !== '全部' && componentStatusText(item) !== filters.status) return false;
        if (filters.problemType && filters.problemType !== '全部') {
          const types = componentProblemTypes(item);
          if (!types.includes(filters.problemType)) return false;
        }
        if (keyword) {
          const haystack = [item.name, item.display_name, item.component_id, item.type, item.description, item.domain, item.category].join(' ').toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      }).sort((a, b) => String(a.component_id || a.type).localeCompare(String(b.component_id || b.type)));
    }

    function componentRegistryTable(rows) {
      if (!rows.length) return `<div class="list-body">${emptyState('暂无符合条件的组件，请调整筛选条件或新增组件。')}</div>`;
      const pageSize = Number(state.componentPageSize || 8);
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      state.componentPage = Math.min(Math.max(1, Number(state.componentPage || 1)), totalPages);
      const start = (state.componentPage - 1) * pageSize;
      const pageRows = rows.slice(start, start + pageSize);
      const body = pageRows.map(item => {
        const id = item.component_id || item.type || '';
        const types = componentProblemTypes(item);
        return `<tr class="component-list-row ${state.selectedComponentId === id ? 'selected' : ''}">
          <td>
            <div class="component-main-info">
              <strong title="${escapeHtml(item.name || item.display_name || id)}">${escapeHtml(item.name || item.display_name || id)}</strong>
              <code class="component-code code-token" title="${escapeHtml(id)}">${escapeHtml(id)}</code>
              <p class="component-desc line-clamp-2" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || '暂无组件说明')}</p>
            </div>
          </td>
          <td><div class="component-tags"><span class="chip">${escapeHtml(item.domain || '-')}</span><span class="chip">${escapeHtml(item.category || '-')}</span></div></td>
          <td><div class="component-tags">${types.length ? types.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('') : '<span class="muted">-</span>'}</div></td>
          <td><span class="chip">${escapeHtml(expressionClassLabel(item.expression_class))}</span></td>
          <td><div class="component-tags"><span class="chip">${escapeHtml(item.version || '1.0.0')}</span>${pill(componentStatusText(item))}</div></td>
          <td class="ops-col"><div class="asset-actions"><button class="btn" onclick="openComponentDetail('${escapeHtml(id)}')">查看</button><button class="btn" ${productionDisabledAttr()} onclick="beginEditComponent('${escapeHtml(id)}')">编辑</button>${componentMoreMenu(id)}</div></td>
        </tr>`;
      }).join('');
      return `<div class="list-body"><div class="table-scroll"><table class="sticky-table table-density-comfortable component-table"><thead><tr><th>组件信息</th><th>领域 / 类别</th><th>问题类型</th><th>表达式类型</th><th>版本 / 状态</th><th class="ops-col">操作</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
    }

    function componentMoreMenu(id) {
      return `<span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu">
        <button class="btn" onclick="validateSingleComponentDependencies('${escapeHtml(id)}')">校验依赖</button>
        <button class="btn" onclick="validateManagedComponentFormula('${escapeHtml(id)}')">公式校验</button>
        <button class="btn" ${productionDisabledAttr()} onclick="copyComponentVersion('${escapeHtml(id)}')">复制版本</button>
        <button class="btn" ${productionDisabledAttr()} onclick="offlineManagedComponent('${escapeHtml(id)}')">停用/下线</button>
        <button class="btn" ${productionDisabledAttr()} onclick="deleteManagedComponent('${escapeHtml(id)}')">删除草稿</button>
      </span></span>`;
    }

    function setComponentSearch(value) {
      state.componentSearch = value || '';
      state.componentPage = 1;
      render();
    }

    function setComponentPage(page) {
      state.componentPage = Math.max(1, Number(page) || 1);
      render();
    }

    function setComponentPageSize(value) {
      state.componentPageSize = Number(value) || 8;
      state.componentPage = 1;
      render();
    }

    function openComponentDetail(id) {
      state.selectedComponentId = id;
      state.componentDetailOpen = true;
      state.componentDetailTab = state.componentDetailTab || '基础信息';
      render();
    }

    function closeComponentDetail() {
      state.componentDetailOpen = false;
      render();
    }

    function setComponentDetailTab(tab) {
      state.componentDetailTab = tab;
      render();
    }

    function currentSelectedComponent() {
      return (state.componentRegistry || []).find(c => (c.component_id || c.type) === state.selectedComponentId) || null;
    }

    function componentDetailDrawer() {
      const component = currentSelectedComponent();
      if (!component) return '';
      const id = component.component_id || component.type;
      const tabs = ['基础信息', '数学定义', '依赖与版本', '校验预览'];
      const tab = state.componentDetailTab || '基础信息';
      const body = {
        '基础信息': componentDetailBasic(component),
        '数学定义': componentDetailMath(component),
        '依赖与版本': componentDetailRefs(component),
        '校验预览': componentDetailValidation(component)
      }[tab] || componentDetailBasic(component);
      return `<div class="drawer-mask component-detail-drawer" onclick="if(event.target===this && !state.formulaEditor) closeComponentDetail()"><div class="editor-drawer" onclick="event.stopPropagation()">
        <div class="drawer-head">
          <div>
            <h1>${escapeHtml(component.name || component.display_name || id)}</h1>
            <p class="muted">组件库 / ${escapeHtml(component.category || '组件')} / ${escapeHtml(id)}</p>
            <div class="drawer-tags">${pill(componentStatusText(component))}<span class="chip">版本 ${escapeHtml(component.version || '1.0.0')}</span><span class="chip">${escapeHtml(component.domain || '-')}</span><span class="chip">${escapeHtml(component.category || '-')}</span></div>
          </div>
          <div class="actions"><button class="btn" ${productionDisabledAttr()} onclick="beginEditComponent('${escapeHtml(id)}')">编辑</button><button class="btn" onclick="closeComponentDetail()">关闭</button></div>
        </div>
        <div class="drawer-body">
          <div class="tabs detail-tabs">${tabs.map(name => `<button class="tab ${tab === name ? 'active' : ''}" onclick="setComponentDetailTab('${name}')">${name}</button>`).join('')}</div>
          <div class="mt">${body}</div>
        </div>
      </div></div>`;
    }

    function componentDetailBasic(component) {
      const id = component.component_id || component.type || '-';
      return `<div class="detail-summary-grid">
        <div class="card"><strong>组件名称</strong><p>${escapeHtml(component.name || component.display_name || id)}</p></div>
        <div class="card"><strong>组件编码</strong><p><code class="code-token">${escapeHtml(id)}</code></p></div>
        <div class="card"><strong>领域 / 类别</strong><p>${escapeHtml(component.domain || '-')} / ${escapeHtml(component.category || '-')}</p></div>
        <div class="card"><strong>版本 / 状态</strong><p>${escapeHtml(component.version || '1.0.0')} / ${statusLabel(component.status || componentStatusText(component))}</p></div>
        <div class="card"><strong>问题类型</strong><p>${escapeHtml(componentProblemTypes(component).join(', ') || '-')}</p></div>
        <div class="card"><strong>表达式类型</strong><p>${escapeHtml(expressionClassLabel(component.expression_class))}</p></div>
      </div><div class="card mt"><strong>组件说明</strong><p>${escapeHtml(component.description || '-')}</p></div>
      <details class="mt json-collapse"><summary>原始 JSON</summary><pre>${escapeHtml(safeJson(component))}</pre></details>`;
    }

    function componentDetailMath(component) {
      const sets = component.sets || [];
      const parameters = component.parameters || component.inputs || [];
      const variables = component.variables || [];
      return `<div class="grid cols-2">
        ${panel('集合定义', compactSchemaTable(sets, [{ label: '编码', value: item => item.code || item.name || item.key || '-' }, { label: '名称', value: item => item.name || '-' }]))}
        ${panel('参数定义', compactSchemaTable(parameters, [{ label: '编码', value: item => typeof item === 'string' ? item : item.code || item.name || item.key || '-' }, { label: '维度', value: item => (item.dimension || []).join(', ') || '-' }, { label: '默认值', value: item => item.default ?? item.default_value ?? '-' }]))}
        ${panel('变量定义', compactSchemaTable(variables, [{ label: '编码', value: item => item.code || item.name || item.key || '-' }, { label: '维度', value: item => (item.dimension || item.indices || []).join(', ') || '-' }, { label: '类型', value: item => item.type || item.domain || 'continuous' }]))}
        ${panel('输出变量', compactSchemaTable(component.outputs || [], [{ label: '输出', value: item => typeof item === 'string' ? item : item.name || item.code || '-' }]))}
      </div><div class="grid cols-2 mt">${panel('生成约束', longFormulaTable(component.generated_constraints || component.constraints || [], 'constraint'))}${panel('目标项', longFormulaTable(component.generated_objective_terms || component.objective_terms || [], 'objective'))}</div>`;
    }

    function componentDetailRefs(component) {
      return `<div class="grid cols-2">
        ${panel('依赖组件', (component.depends_on || []).length ? `<div class="chips">${component.depends_on.map(item => `<span class="chip">${escapeHtml(item)}</span>`).join('')}</div>` : emptyState('暂无依赖组件'))}
        ${panel('版本记录', compactSchemaTable(component.versions || [], [{ label: '版本', value: item => item.version || '-' }, { label: '变更时间', value: item => item.changed_at || '-' }, { label: '说明', value: item => item.change_note || '-' }]))}
      </div><div class="mt">${panel('引用追踪', compactSchemaTable(component.referenced_by || [], [{ label: '模型', value: item => item.model_name || item.model_id || '-' }, { label: '版本', value: item => item.model_version || '-' }, { label: '状态', value: item => item.status || '-' }]))}</div>`;
    }

    function componentDetailValidation(component) {
      const constraints = component.generated_constraints || component.constraints || [];
      const okMeta = Boolean(component.name || component.display_name) && Boolean(component.component_id || component.type);
      const okMath = (component.sets || []).length || (component.parameters || component.inputs || []).length || (component.variables || []).length || constraints.length;
      const okFormula = constraints.every(row => row.formula || row.expression);
      return `<div class="validation-report">
        ${validationLine('元数据完整性', okMeta, okMeta ? '名称、编码等基础信息完整' : '缺少组件名称或组件编码')}
        ${validationLine('数学定义完整性', okMath, okMath ? '已维护集合、参数、变量或约束' : '缺少数学定义内容')}
        ${validationLine('依赖完整性', true, (component.depends_on || []).length ? `依赖 ${(component.depends_on || []).length} 个组件` : '暂无外部依赖')}
        ${validationLine('公式校验', okFormula, okFormula ? '公式字段完整' : '存在未填写公式的约束')}
        ${validationLine('后端编译校验', state.backendOnline, state.backendOnline ? '可连接后端执行编译校验' : '编译校验需连接后端')}
      </div>`;
    }

    function componentManagementDetail(component) {
      if (!component) return emptyState('暂无组件。');
      const id = component.component_id || component.type;
      const constraints = component.generated_constraints || [];
      const terms = component.generated_objective_terms || [];
      const versions = component.versions || [];
      const refs = component.referenced_by || [];
      const sets = component.sets || [];
      const parameters = component.parameters || component.inputs || [];
      const variables = component.variables || [];
      return `<div>
        <table class="compact-table"><tbody>
          <tr><th>组件名称</th><td>${escapeHtml(component.name || component.display_name || id)}</td></tr>
          <tr><th>组件编码</th><td><code>${escapeHtml(id)}</code></td></tr>
          <tr><th>领域/类别</th><td>${escapeHtml(component.domain || '-')} / ${escapeHtml(component.category || '-')}</td></tr>
          <tr><th>版本/状态</th><td>${escapeHtml(component.version || '1.0.0')} / ${pill(component.status || (component.implemented === false ? 'draft' : 'published'))}</td></tr>
          <tr><th>问题类型</th><td>${escapeHtml(componentProblemTypes(component).join(', ') || '-')}</td></tr>
          <tr><th>类型影响</th><td>变量：${escapeHtml((component.variable_types || ['continuous']).join(', '))}；表达式：${escapeHtml(expressionClassLabel(component.expression_class))}；影响：${escapeHtml(component.problem_type_effect || 'LP')}</td></tr>
          <tr><th>依赖</th><td>${escapeHtml((component.depends_on || []).join(', ') || '-')}</td></tr>
          <tr><th>说明</th><td>${escapeHtml(component.description || '-')}</td></tr>
        </tbody></table>
        <div class="actions mt"><button class="btn primary" ${productionDisabledAttr()} onclick="beginEditComponent('${escapeHtml(id)}')">编辑组件</button>${componentMoreMenu(id)}</div>
        <div class="mt">${panel('集合定义', compactSchemaTable(sets, [{ label: '编码', value: item => item.code || item.name || item.key || '-' }, { label: '名称', value: item => item.name || '-' }]))}</div>
        <div class="mt">${panel('参数定义', compactSchemaTable(parameters, [{ label: '编码', value: item => typeof item === 'string' ? item : item.code || item.name || item.key || '-' }, { label: '维度', value: item => (item.dimension || []).join(', ') || '-' }, { label: '默认值', value: item => item.default ?? item.default_value ?? '-' }]))}</div>
        <div class="mt">${panel('变量定义', compactSchemaTable(variables, [{ label: '编码', value: item => item.code || item.name || item.key || '-' }, { label: '维度', value: item => (item.dimension || item.indices || []).join(', ') || '-' }, { label: '类型', value: item => item.type || item.domain || 'continuous' }]))}</div>
        <div class="mt">${panel('生成变量 / 输出', compactSchemaTable(component.outputs || [], [{ label: '输出', value: item => typeof item === 'string' ? item : item.name || item.code || '-' }]))}</div>
        <div class="mt">${panel('生成约束', longFormulaTable(constraints, 'constraint'))}</div>
        <div class="mt">${panel('目标项', longFormulaTable(terms, 'objective'))}</div>
        <div class="mt">${panel('版本记录', compactSchemaTable(versions, [{ label: '版本', value: item => item.version || '-' }, { label: '变更时间', value: item => item.changed_at || '-' }, { label: '说明', value: item => item.change_note || '-' }]))}</div>
        <div class="mt">${panel('引用追踪', compactSchemaTable(refs, [{ label: '模型', value: item => item.model_name || item.model_id || '-' }, { label: '版本', value: item => item.model_version || '-' }, { label: '状态', value: item => item.status || '-' }]))}</div>
      </div>`;
    }

    function longFormulaTable(rows = [], type = 'constraint') {
      if (!Array.isArray(rows) || !rows.length) {
        return `<div class="empty-state" style="min-height:60px"><strong>${type === 'constraint' ? '暂无生成约束' : '暂无目标项'}</strong></div>`;
      }
      return `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr><th>名称</th><th>表达式（公式）</th><th>业务含义</th></tr></thead><tbody>${rows.map(item => `<tr><td class="cell-truncate" title="${escapeHtml(item.name || item.constraint_id || item.term_id || '-')}">${escapeHtml(item.name || item.constraint_id || item.term_id || '-')}</td><td><div class="formula-cell">${escapeHtml(item.formula || item.expression || '-')}</div></td><td class="cell-truncate" title="${escapeHtml(item.business_meaning || item.description || item.weight_key || '-')}">${escapeHtml(item.business_meaning || item.description || item.weight_key || '-')}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function componentFormulaDisplay(expression, context = formulaContextFromComponent(state.componentEditor?.component || {})) {
      const value = String(expression || '').trim();
      if (!value) return '<span class="muted">-</span>';
      if (typeof formulaDisplayHtml === 'function') return formulaDisplayHtml(value, context);
      return `<pre class="formula-cell">${escapeHtml(value)}</pre>`;
    }

    function longFormulaTable(rows = [], type = 'constraint') {
      if (!Array.isArray(rows) || !rows.length) {
        return `<div class="empty-state" style="min-height:60px"><strong>${type === 'constraint' ? '暂无生成约束' : '暂无目标项'}</strong></div>`;
      }
      const ctx = formulaContextFromComponent(state.componentEditor?.component || componentRegistryMeta(state.selectedComponentId) || {});
      return `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr><th>名称</th><th>表达式（公式）</th><th>业务含义</th></tr></thead><tbody>${rows.map(item => `<tr><td class="cell-truncate" title="${escapeHtml(item.name || item.constraint_id || item.term_id || '-')}">${escapeHtml(item.name || item.constraint_id || item.term_id || '-')}</td><td>${componentFormulaDisplay(item.formula || item.expression || '-', ctx)}</td><td class="cell-truncate" title="${escapeHtml(item.business_meaning || item.description || item.weight_key || '-')}">${escapeHtml(item.business_meaning || item.description || item.weight_key || '-')}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function selectManagedComponent(id) {
      state.selectedComponentId = id;
      render();
    }

    function defaultEditableComponent() {
      return {
        component_id: `custom_component_${Date.now()}`,
        name: '自定义组件',
        domain: '通用',
        category: '基础组件',
        version: '1.0.0',
        status: 'draft',
        implemented: false,
        enabled: true,
        problem_types: ['LP'],
        solver_capabilities: ['LP'],
        variable_types: ['continuous'],
        expression_class: 'linear',
        problem_type_effect: 'LP',
        sets: [],
        parameters: [],
        variables: [],
        constraints: [],
        objective_terms: [],
        depends_on: [],
        math_template: { formula: '', description: '' },
        test_cases: []
      };
    }

    function beginCreateComponent() {
      state.componentEditor = { active: true, mode: 'create', component: defaultEditableComponent(), validationResult: null, dirty: false };
      state.componentEditorTab = '基础信息';
      render();
    }

    async function beginEditComponent(id) {
      try {
        const component = await fetchComponentDetail(id);
        state.selectedComponentId = id;
        state.componentEditor = { active: true, mode: 'edit', component: normalizeEditableComponent(component), validationResult: null, dirty: false };
        state.componentEditorTab = '基础信息';
        render();
      } catch (e) {
        toast(`加载组件失败：${formatBackendFailure(e)}`);
      }
    }

    function normalizeEditableComponent(component) {
      const copy = JSON.parse(JSON.stringify(component || defaultEditableComponent()));
      copy.sets = copy.sets || [];
      copy.parameters = copy.parameters || copy.inputs || [];
      copy.variables = copy.variables || [];
      copy.constraints = copy.constraints || copy.generated_constraints || [];
      copy.objective_terms = copy.objective_terms || copy.generated_objective_terms || [];
      copy.parameter_bindings = copy.parameter_bindings || [];
      copy.depends_on = copy.depends_on || copy.dependencies || [];
      copy.variable_types = copy.variable_types || ['continuous'];
      copy.expression_class = copy.expression_class || 'linear';
      copy.problem_type_effect = copy.problem_type_effect || 'LP';
      copy.test_cases = copy.test_cases || [];
      copy.math_template = copy.math_template || {};
      return copy;
    }

    function componentEditorDrawer() {
      const component = state.componentEditor.component || defaultEditableComponent();
      const validation = state.componentEditor.validationResult;
      const tabs = ['基础信息', '业务口径', '数学定义', '参数绑定', '校验预览'];
      const tab = state.componentEditorTab || '基础信息';
      const body = {
        '基础信息': componentBasicEditor(component),
        '业务口径': componentBusinessEditor(component),
        '数学定义': componentMathDefinitionEditor(component),
        '参数绑定': componentBindingEditor(component),
        '校验预览': componentValidationPreview(component, validation)
      }[tab] || componentBasicEditor(component);
      return `<div class="drawer-mask" onclick="if(event.target===this && !state.formulaEditor) cancelComponentEditor()"><div class="editor-drawer" onclick="event.stopPropagation()">
        <div class="drawer-head">
          <div class="component-editor-head-main">
            <h1>${state.componentEditor.mode === 'edit' ? '编辑组件' : '新增组件'}</h1>
            <p class="muted">组件库 / ${escapeHtml(component.category || '组件')} / ${escapeHtml(component.name || component.component_id || '自定义组件')}</p>
            <div class="drawer-tags">${pill(component.status || 'draft')}<span class="chip">版本 ${escapeHtml(component.version || '1.0.0')}</span><span class="chip">${escapeHtml(component.domain || '通用领域')}</span><span class="chip">${escapeHtml(component.category || '基础组件')}</span></div>
          </div>
          <button class="btn" onclick="cancelComponentEditor()">关闭</button>
        </div>
        <div class="drawer-body">
          <div class="tabs">${tabs.map(name => `<button class="tab ${tab === name ? 'active' : ''}" onclick="setComponentEditorTab('${name}')">${name}</button>`).join('')}</div>
          <div class="mt">${body}</div>
          <details class="mt"><summary>高级模式：JSON 调试</summary><div class="actions mt"><button class="btn" onclick="openComponentEditorJsonDebug()">打开 JSON 调试</button></div></details>
        </div>
        <div class="drawer-foot component-editor-foot">
          <div><button class="btn" onclick="cancelComponentEditor()">取消</button></div>
          <div class="primary-actions">
            <button class="btn" onclick="validateComponentEditor()">校验组件</button>
            <button class="btn primary" ${productionDisabledAttr()} onclick="saveComponentEditor(false)">保存草稿</button>
            <button class="btn green" ${productionDisabledAttr()} onclick="saveComponentEditor(true)">保存并发布</button>
          </div>
        </div>
      </div></div>`;
    }

    function setComponentEditorTab(tab) {
      state.componentEditorTab = tab;
      render();
    }

    function componentBasicEditor(component) {
      return `<div class="component-basic-layout">
        <div class="component-main-form">
          <section class="component-form-section">
            <div class="component-section-title">基础元数据</div>
            <div class="component-field-grid">
              ${componentInput('component_id', '组件编码', component.component_id, state.componentEditor.mode === 'edit')}
              ${componentInput('name', '组件名称', component.name)}
              ${componentInput('domain', '适用领域', component.domain)}
              ${componentInput('category', '组件类别', component.category)}
              ${componentInput('version', '版本', component.version)}
            </div>
          </section>
          <section class="component-form-section">
            <div class="component-section-title">表达式属性</div>
            <div class="component-field-grid">
              <div class="field"><label>表达式类别</label><select onchange="updateComponentEditorField('expression_class', this.value)">${['linear','quadratic','nonlinear'].map(v => `<option value="${v}" ${String(component.expression_class || 'linear') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
              <div class="field"><label>问题类型影响</label><select onchange="updateComponentEditorField('problem_type_effect', this.value)">${['LP','MILP','QP','MIQP','NLP','MINLP'].map(v => `<option value="${v}" ${String(component.problem_type_effect || 'LP') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            </div>
          </section>
          <section class="component-form-section component-desc-field">
            <div class="component-section-title">组件描述</div>
            <div class="field"><label>描述</label><textarea onchange="updateComponentEditorField('description', this.value)">${escapeHtml(component.description || '')}</textarea><p class="muted mt">用于说明该组件解决的业务问题、适用对象和边界条件。</p></div>
          </section>
        </div>
        <aside class="component-side">
          <section class="component-side-card">
            <div class="component-section-title">当前状态</div>
            <div class="component-status-line"><span class="muted">状态</span>${pill(component.status || 'draft')}</div>
            <div class="component-status-line"><span class="muted">启用开关</span><button class="switch ${component.enabled === false ? '' : 'on'}" onclick="toggleComponentEditorEnabled()"><span></span></button></div>
            <div class="component-status-line"><span class="muted">启用状态</span><strong>${component.enabled === false ? '已停用' : '已启用'}</strong></div>
            <div class="component-status-line"><span class="muted">版本</span><span class="chip">${escapeHtml(component.version || '1.0.0')}</span></div>
          </section>
          <section class="component-side-card">
            <div class="component-section-title">能力影响</div>
            ${componentCapabilityGroup('problem_types', '问题类型', ['LP','MILP','QP','MIQP','NLP','MINLP'], component.problem_types || ['LP'])}
            ${componentCapabilityGroup('solver_capabilities', '求解能力', ['LP','MILP','QP','MIQP','NLP','MINLP'], component.solver_capabilities || ['LP'])}
            ${componentCapabilityGroup('variable_types', '变量类型影响', ['continuous','binary','integer','semi_continuous'], component.variable_types || ['continuous'])}
          </section>
        </aside>
      </div>`;
    }

    function componentCapabilityGroup(field, label, options, selected = []) {
      const set = new Set(Array.isArray(selected) ? selected : String(selected || '').split(',').map(x => x.trim()).filter(Boolean));
      return `<div class="component-capability-group">
        <div class="component-capability-title">${label}</div>
        <div class="component-capability-tags">${options.map(value => `<label class="tag-option"><input type="checkbox" data-field="${field}" value="${escapeHtml(value)}" ${set.has(value) ? 'checked' : ''} onchange="updateComponentEditorMulti('${field}')" />${escapeHtml(value)}</label>`).join('')}</div>
      </div>`;
    }

    function componentMultiSelect(field, label, options, selected = []) {
      const set = new Set(Array.isArray(selected) ? selected : String(selected || '').split(',').map(x => x.trim()).filter(Boolean));
      return `<div class="field"><label>${label}</label><div class="tag-select">${options.map(value => `<label class="tag-option"><input type="checkbox" data-field="${field}" value="${escapeHtml(value)}" ${set.has(value) ? 'checked' : ''} onchange="updateComponentEditorMulti('${field}')" />${escapeHtml(value)}</label>`).join('')}</div></div>`;
    }

    function updateComponentEditorMulti(field) {
      const values = Array.from(document.querySelectorAll(`input[type="checkbox"][data-field="${field}"]:checked`)).map(input => input.value);
      updateComponentEditorField(field, values);
      render();
    }

    function toggleComponentEditorEnabled() {
      const component = state.componentEditor.component;
      component.enabled = component.enabled === false;
      component.status = component.enabled === false ? 'offline' : (component.status === 'offline' ? 'draft' : component.status || 'draft');
      state.componentEditor.dirty = true;
      render();
    }

    function componentBusinessEditor(component) {
      return `<div class="validation-block green"><strong>业务口径用于说明该组件解决什么业务问题、适用于哪些对象、有哪些边界条件。</strong><p>建议用调度员、计划员能理解的语言描述输入、输出、适用对象和例外情况。示例：储能 SOC 递推组件用于描述每个时段电量状态随充放电变化的连续关系，不处理设备检修可用性。</p></div>
      <div class="grid form-grid-compact mt">
        ${componentTextarea('business_meaning', '业务含义', component.business_meaning)}
        ${componentTextarea('applicable_object', '适用对象', component.applicable_object)}
        ${componentTextarea('input_parameter_desc', '输入参数说明', component.input_parameter_desc)}
        ${componentTextarea('output_variable_desc', '输出变量说明', component.output_variable_desc)}
        ${componentTextarea('preconditions', '前置条件', component.preconditions)}
        ${componentTextarea('applicable_boundary', '适用边界', component.applicable_boundary)}
        <div class="field" style="grid-column:1 / -1"><label>业务示例</label><textarea onchange="updateComponentEditorField('business_example', this.value)">${escapeHtml(component.business_example || '')}</textarea></div>
      </div>`;
    }

    function componentTextarea(field, label, value) {
      return `<div class="field"><label>${label}</label><textarea onchange="updateComponentEditorField('${field}', this.value)">${escapeHtml(value || '')}</textarea></div>`;
    }

    function componentMathDefinitionEditor(component) {
      return `<div class="validation-block green"><strong>数学定义用于维护集合、参数、变量、约束和目标项，是组件生成模型结构的依据。</strong></div><div class="grid cols-2 mt">
        ${panel('集合定义', `<p class="muted">集合定义组件展开时遍历的对象范围，例如时段、机组、电站或储能设备。</p>${componentArrayEditor('sets', component.sets || [], [{ key: 'code', label: '编码' }, { key: 'name', label: '名称' }])}`)}
        ${panel('参数定义', `<p class="muted">参数对应运行时输入或主数据字段，供约束和目标函数引用。</p>${componentArrayEditor('parameters', component.parameters || [], [{ key: 'code', label: '编码' }, { key: 'name', label: '名称' }, { key: 'dimension', label: '维度' }, { key: 'unit', label: '单位' }, { key: 'default', label: '默认值' }])}`)}
        ${panel('变量定义', `<p class="muted">变量定义组件生成或依赖的决策变量，包括维度、类型和边界。</p>${componentArrayEditor('variables', component.variables || [], [{ key: 'code', label: '编码' }, { key: 'name', label: '名称' }, { key: 'dimension', label: '维度' }, { key: 'type', label: '类型' }, { key: 'lower_bound', label: '下界' }])}`)}
        ${panel('约束定义', `<p class="muted">约束表达式通过统一公式编辑器维护，避免在表格中编辑长公式。</p>${componentConstraintEditor(component)}`)}
        ${panel('目标项定义', `<p class="muted">目标项描述组件对总目标函数的贡献，可配置权重键和是否参与求解。</p>${componentObjectiveEditor(component)}`)}
        ${panel('数学展开模板', `<p class="muted">用于展示或生成文档中的数学展开说明，不替代实际约束表达式。</p>${mathTemplateEditor(component)}`)}
      </div>`;
    }

    function componentBindingEditor(component) {
      component.parameter_bindings = component.parameter_bindings || (component.parameters || []).map(p => ({ name: p.code || p.name || '', source: '运行时参数', required: true, default: p.default ?? '', unit: p.unit || '', range: '', example: p.default ?? '' }));
      return componentArrayEditor('parameter_bindings', component.parameter_bindings, [
        { key: 'name', label: '参数名称' },
        { key: 'source', label: '数据来源' },
        { key: 'required', label: '是否必填' },
        { key: 'default', label: '默认值' },
        { key: 'unit', label: '单位' },
        { key: 'range', label: '取值范围' },
        { key: 'example', label: '示例值' }
      ]);
    }

    function componentValidationPreview(component, validation) {
      const ctx = formulaContextFromComponent(component);
      const rowChecks = (component.constraints || []).map((row, index) => ({ index, name: row.name || row.constraint_id || `约束${index + 1}`, result: validateFormulaText(row.expression || row.formula || '', 'constraint', ctx) }));
      const localErrors = rowChecks.flatMap(item => item.result.errors.map(error => `constraints[${item.index}] ${item.name}: ${error}`));
      const local = { valid: !localErrors.length, errors: localErrors, relation: rowChecks.find(item => item.result.relation)?.result.relation || '' };
      const checklist = [
        ['基础信息完整', Boolean(component.component_id && component.name && component.domain && component.category)],
        ['业务口径完整', Boolean(component.business_meaning || component.description)],
        ['数学定义完整', Boolean((component.sets || []).length && (component.parameters || []).length && (component.variables || []).length)],
        ['参数绑定完整', Boolean((component.parameter_bindings || []).length || (component.parameters || []).length)],
        ['公式校验通过', local.valid],
        ['后端编译校验通过', validation?.valid === true]
      ];
      return `<div class="validation-block"><strong>发布前检查清单</strong><div class="chips mt">${checklist.map(([label, ok]) => `<span class="chip">${ok ? '✓' : '待完善'} ${escapeHtml(label)}</span>`).join('')}</div></div><div class="validation-report mt">
        ${validationLine('表达式合法性校验', local.valid, local.errors.join('；') || '公式结构通过基础校验')}
        ${validationLine('参数完整性校验', (component.parameters || []).length > 0, (component.parameters || []).length ? `parameters 共 ${(component.parameters || []).length} 行` : 'parameters[0]: 至少需要一个参数定义')}
        ${validationLine('变量引用校验', (component.variables || []).length > 0, (component.variables || []).length ? `variables 共 ${(component.variables || []).length} 行` : 'variables[0]: 至少需要一个变量定义')}
        ${validationLine('集合引用校验', (component.sets || []).length > 0, (component.sets || []).length ? `sets 共 ${(component.sets || []).length} 行` : 'sets[0]: 至少需要一个集合定义')}
        ${validationLine('约束方向校验', local.relation || false, local.relation ? `识别到 ${local.relation}` : '约束公式需要 <=、>= 或 ==')}
        ${validationLine('后端编译校验结果', validation?.valid !== false, validation ? safeJson(validation) : '尚未执行后端校验')}
      </div>`;
    }

    function validationLine(title, ok, text) {
      return `<div class="validation-block ${ok ? 'green' : 'red'}"><strong>${title}</strong><p>${escapeHtml(text || '-')}</p></div>`;
    }

    function componentInput(field, label, value, disabled = false) {
      return `<div class="field"><label>${label}</label><input ${disabled ? 'disabled' : ''} value="${escapeHtml(value ?? '')}" onchange="updateComponentEditorField('${field}', this.value)" /></div>`;
    }

    function componentArrayEditor(field, rows, columns) {
      const body = (rows || []).map((row, index) => `<tr>${columns.map(col => `<td>${componentEditorControl(field, row, index, col.key)}</td>`).join('')}<td><button class="btn" onclick="removeComponentEditorArrayRow('${field}', ${index})">删除</button></td></tr>`).join('');
      const table = body ? `<div class="table-scroll"><table class="compact-table"><thead><tr>${columns.map(col => `<th>${col.label}</th>`).join('')}<th>操作</th></tr></thead><tbody>${body}</tbody></table></div>` : '<div class="inline-empty-state">暂无数据</div>';
      return `${table}<button class="btn mt" onclick="addComponentEditorArrayRow('${field}')">新增行</button>`;
    }

    function componentEditorControl(field, row, index, key) {
      const value = row[key];
      if (key === 'dimension') {
        return `<select multiple size="3" onchange="updateComponentEditorArray('${field}', ${index}, '${key}', Array.from(this.selectedOptions).map(o=>o.value).join(','))">${setOptions(value || [])}</select>`;
      }
      if (key === 'type') {
        if (field === 'parameters') {
          return `<select onchange="updateComponentEditorArray('${field}', ${index}, '${key}', this.value)">${['scalar','array','piecewise_curve'].map(v => `<option value="${v}" ${String(value || 'scalar').toLowerCase() === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
        }
        return `<select onchange="updateComponentEditorArray('${field}', ${index}, '${key}', this.value)">${['continuous','binary','integer'].map(v => `<option value="${v}" ${String(value || 'continuous').toLowerCase() === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      }
      if (key === 'solve_participation') {
        return `<select onchange="updateComponentEditorArray('${field}', ${index}, '${key}', this.value)">${['display_only','solve','remark_only','none'].map(v => `<option value="${v}" ${String(value || 'display_only') === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      }
      if (key === 'required') {
        return `<select onchange="updateComponentEditorArray('${field}', ${index}, '${key}', this.value)"><option value="true" ${String(value) !== 'false' ? 'selected' : ''}>是</option><option value="false" ${String(value) === 'false' ? 'selected' : ''}>否</option></select>`;
      }
      return `<input value="${escapeHtml(formatEditorCell(value))}" onchange="updateComponentEditorArray('${field}', ${index}, '${key}', this.value)" />`;
    }

    function setOptions(selected = []) {
      const selectedSet = new Set(Array.isArray(selected) ? selected : String(selected || '').split(',').map(x => x.trim()).filter(Boolean));
      const sets = (state.componentEditor.component?.sets || []).map(s => s.code || s.name || s.key).filter(Boolean);
      return sets.map(code => `<option value="${escapeHtml(code)}" ${selectedSet.has(code) ? 'selected' : ''}>${escapeHtml(code)}</option>`).join('');
    }

    function curvePointEditors(component) {
      const curves = (component.parameters || []).map((param, index) => ({ param, index })).filter(item => String(item.param.type || item.param.param_type || '').toLowerCase() === 'piecewise_curve');
      if (!curves.length) return '';
      return `<div class="validation-block green mt"><strong>Curve point editor</strong>${curves.map(item => curvePointEditor(item.param, item.index)).join('')}</div>`;
    }

    function piecewiseConstraintEditor(row, rowIndex, component) {
      const isPiecewise = String(row.type || '').toLowerCase() === 'piecewise' || String(row.expression || '').includes('piecewise(');
      if (!isPiecewise) return '';
      const variables = (component.variables || []).map(v => v.code || v.name || v.key).filter(Boolean);
      const curves = (component.parameters || []).filter(p => String(p.type || p.param_type || '').toLowerCase() === 'piecewise_curve').map(p => p.code || p.name || p.key).filter(Boolean);
      const opts = (items, value) => items.map(item => `<option value="${escapeHtml(item)}" ${String(value || '') === String(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('');
      return `<div class="grid form-grid-compact mt"><div class="field"><label>x</label><select onchange="updatePiecewiseConstraintField(${rowIndex}, 'x', this.value)"><option value="">-</option>${opts(variables.map(v => `${v}[t]`), row.x)}</select></div><div class="field"><label>y</label><select onchange="updatePiecewiseConstraintField(${rowIndex}, 'y', this.value)"><option value="">-</option>${opts(variables.map(v => `${v}[t]`), row.y)}</select></div><div class="field"><label>curve</label><select onchange="updatePiecewiseConstraintField(${rowIndex}, 'curve', this.value)"><option value="">-</option>${opts(curves, row.curve)}</select></div><div class="field"><label>solve</label><select onchange="updatePiecewiseConstraintField(${rowIndex}, 'solve_participation', this.value)">${['solve_active','display_only'].map(v => `<option value="${v}" ${String(row.solve_participation || 'solve_active') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`;
    }

    function updatePiecewiseConstraintField(rowIndex, field, value) {
      const row = state.componentEditor.component.constraints[rowIndex] || {};
      row.type = 'piecewise';
      row[field] = value;
      row.solve_participation = row.solve_participation || 'solve_active';
      row.participates_in_solve = row.solve_participation !== 'display_only';
      if (row.x && row.y && row.curve) row.expression = `${row.y} == piecewise(${row.x}, ${row.curve})`;
      state.componentEditor.component.constraints[rowIndex] = row;
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
      render();
    }

    function curvePointEditor(param, paramIndex) {
      const points = Array.isArray(param.points) ? param.points : [];
      const monotonic = validateCurvePointsMonotonic(points);
      const rows = points.map((point, pointIndex) => `<tr><td><input type="number" value="${escapeHtml(point[0] ?? '')}" onchange="updateCurvePoint(${paramIndex}, ${pointIndex}, 0, this.value)" /></td><td><input type="number" value="${escapeHtml(point[1] ?? '')}" onchange="updateCurvePoint(${paramIndex}, ${pointIndex}, 1, this.value)" /></td><td><button class="btn" onclick="removeCurvePoint(${paramIndex}, ${pointIndex})">删除</button></td></tr>`).join('');
      return `<div class="mt"><div class="flex-between"><b>${escapeHtml(param.name || param.code || 'piecewise_curve')}</b><span class="pill ${monotonic.ok ? 'green' : 'amber'}">${escapeHtml(monotonic.message)}</span></div><div class="table-scroll"><table class="compact-table"><thead><tr><th>x</th><th>y</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="3">暂无曲线点</td></tr>'}</tbody></table></div><div class="actions mt"><button class="btn" onclick="addCurvePoint(${paramIndex})">新增点</button><button class="btn" onclick="sortCurvePoints(${paramIndex})">自动排序</button><button class="btn" onclick="importCurvePoints(${paramIndex})">导入 JSON</button><button class="btn" onclick="clearCurvePoints(${paramIndex})">清空曲线</button><button class="btn" onclick="validateCurvePoints(${paramIndex})">校验</button></div></div>`;
    }

    function validateCurvePointsMonotonic(points) {
      if (!Array.isArray(points) || points.length < 2) return { ok: false, message: '至少 2 个点' };
      let previous = null;
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) return { ok: false, message: '点必须为数字 [x,y]' };
        if (previous !== null && Number(point[0]) <= previous) return { ok: false, message: 'x 必须单调递增' };
        previous = Number(point[0]);
      }
      return { ok: true, message: '曲线点校验通过' };
    }

    function updateCurvePoint(paramIndex, pointIndex, axis, value) {
      const param = state.componentEditor.component.parameters[paramIndex];
      param.points = Array.isArray(param.points) ? param.points : [];
      param.points[pointIndex] = Array.isArray(param.points[pointIndex]) ? param.points[pointIndex] : [0, 0];
      param.points[pointIndex][axis] = Number(value);
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
    }

    function addCurvePoint(paramIndex) {
      const param = state.componentEditor.component.parameters[paramIndex];
      param.points = Array.isArray(param.points) ? param.points : [];
      const last = param.points[param.points.length - 1] || [0, 0];
      param.points.push([Number(last[0] || 0) + 1, Number(last[1] || 0)]);
      state.componentEditor.dirty = true;
      render();
    }

    function removeCurvePoint(paramIndex, pointIndex) {
      state.componentEditor.component.parameters[paramIndex].points.splice(pointIndex, 1);
      state.componentEditor.dirty = true;
      render();
    }

    function sortCurvePoints(paramIndex) {
      const param = state.componentEditor.component.parameters[paramIndex];
      param.points = (param.points || []).slice().sort((a, b) => Number(a[0]) - Number(b[0]));
      state.componentEditor.dirty = true;
      render();
    }

    function importCurvePoints(paramIndex) {
      const text = prompt('输入曲线点 JSON，例如 [[0,0],[10,100]]', JSON.stringify(state.componentEditor.component.parameters[paramIndex].points || [[0,0],[1,1]]));
      if (!text) return;
      try {
        const points = JSON.parse(text);
        if (!Array.isArray(points)) throw new Error('points must be an array');
        state.componentEditor.component.parameters[paramIndex].points = points.map(point => [Number(point[0]), Number(point[1])]);
        state.componentEditor.dirty = true;
        render();
      } catch (e) {
        toast(`曲线点 JSON 不合法：${e.message}`);
      }
    }

    function clearCurvePoints(paramIndex) {
      state.componentEditor.component.parameters[paramIndex].points = [];
      state.componentEditor.dirty = true;
      render();
    }

    function validateCurvePoints(paramIndex) {
      const result = validateCurvePointsMonotonic(state.componentEditor.component.parameters[paramIndex].points || []);
      toast(result.message);
      render();
    }

    function componentConstraintEditor(component) {
      const rows = component.constraints || [];
      const curveTools = curvePointEditors(component);
      const body = rows.map((row, index) => `<tr>
        <td><input value="${escapeHtml(row.constraint_id || '')}" onchange="updateComponentEditorArray('constraints', ${index}, 'constraint_id', this.value)" /></td>
        <td><input value="${escapeHtml(row.name || '')}" onchange="updateComponentEditorArray('constraints', ${index}, 'name', this.value)" /></td>
        <td>${indexAliasEditor(row.indices, index)}</td>
        <td>${componentFormulaDisplay(row.expression || row.formula || '', formulaContextFromComponent(component))}${piecewiseConstraintEditor(row, index, component)}</td>
        <td><input value="${escapeHtml(row.business_meaning || '')}" onchange="updateComponentEditorArray('constraints', ${index}, 'business_meaning', this.value)" /></td>
        <td><select onchange="updateComponentEditorArray('constraints', ${index}, 'boundary_strategy', this.value)">${['none','skip_first','skip_last','skip_out_of_range','use_initial_value'].map(v => `<option value="${v}" ${(row.boundary_strategy || 'none') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><button class="btn" onclick="openStructuredFormulaBuilder(${index})">编辑公式</button><button class="btn" onclick="removeComponentEditorArrayRow('constraints', ${index})">删除</button></td>
      </tr>${constraintValidationRow(index)}`).join('');
      return `${curveTools}<div class="table-scroll"><table class="compact-table"><thead><tr><th>编码</th><th>名称</th><th>索引集合(alias)</th><th>表达式 DSL</th><th>业务含义</th><th>边界策略</th><th>操作</th></tr></thead><tbody>${body || '<tr><td colspan="7">暂无约束</td></tr>'}</tbody></table></div><button class="btn mt" onclick="addComponentEditorArrayRow('constraints')">新增约束</button><p class="muted mt">长公式统一通过“编辑公式”维护；索引示例：time:t 或 unit:u,time:t。</p>`;
    }

    function componentObjectiveEditor(component) {
      const rows = component.objective_terms || [];
      const body = rows.map((row, index) => `<tr>
        <td><input value="${escapeHtml(row.term_id || '')}" onchange="updateComponentEditorArray('objective_terms', ${index}, 'term_id', this.value)" /></td>
        <td><input value="${escapeHtml(row.name || '')}" onchange="updateComponentEditorArray('objective_terms', ${index}, 'name', this.value)" /></td>
        <td>${componentFormulaDisplay(row.expression || '', formulaContextFromComponent(component))}</td>
        <td><input value="${escapeHtml(row.weight_key || '')}" onchange="updateComponentEditorArray('objective_terms', ${index}, 'weight_key', this.value)" /></td>
        <td><button class="btn" onclick="openComponentObjectiveFormulaEditor(${index})">编辑公式</button><button class="btn" onclick="removeComponentEditorArrayRow('objective_terms', ${index})">删除</button></td>
      </tr>`).join('');
      return `<div class="table-scroll"><table class="compact-table"><thead><tr><th>编码</th><th>名称</th><th>表达式</th><th>权重键</th><th>操作</th></tr></thead><tbody>${body || '<tr><td colspan="5">暂无目标项</td></tr>'}</tbody></table></div><button class="btn mt" onclick="addComponentEditorArrayRow('objective_terms')">新增目标项</button>`;
    }

    function indexAliasEditor(indices, rowIndex) {
      const value = formatIndices(indices || []);
      const listId = `indexAliasOptions_${rowIndex}`;
      const options = indexAliasOptionValues().map(option => `<option value="${escapeHtml(option)}">`).join('');
      return `<input list="${listId}" value="${escapeHtml(value)}" onchange="updateComponentEditorArray('constraints', ${rowIndex}, 'indices', this.value)" /><datalist id="${listId}">${options}</datalist>`;
    }

    function indexAliasOptionValues() {
      const codes = (state.componentEditor?.component?.sets || []).map(s => s.code || s.key || s.name).filter(Boolean);
      const singles = codes.map(code => `${code}:${defaultIndexAlias(code)}`);
      const combined = codes.length > 1 ? [codes.map(code => `${code}:${defaultIndexAlias(code)}`).join(',')] : [];
      return [...new Set([...singles, ...combined])];
    }

    function defaultIndexAlias(code) {
      return ({ time: 't', unit: 'u', station: 's', edge: 'e' }[code] || code);
    }

    function constraintValidationRow(index) {
      const errors = (state.componentEditor.validationResult?.errors || []).filter(err => String(err.field || '').includes(`constraints[${index}]`));
      if (!errors.length) return '';
      return `<tr><td colspan="7"><div class="callout danger">${errors.map(err => `${escapeHtml(err.message || err.error || '')} ${err.suggestion ? `建议：${escapeHtml(err.suggestion)}` : ''}`).join('<br>')}</div></td></tr>`;
    }

    function dependencyEditor(component) {
      return `<textarea onchange="updateComponentEditorField('depends_on', this.value)" placeholder="每行一个依赖组件编码">${escapeHtml((component.depends_on || []).join('\n'))}</textarea>`;
    }

    function mathTemplateEditor(component) {
      const template = component.math_template || {};
      return `<div class="grid form-grid-compact"><div class="field"><label>数学公式</label><textarea onchange="updateMathTemplateField('formula', this.value)">${escapeHtml(template.formula || '')}</textarea></div><div class="field"><label>说明</label><textarea onchange="updateMathTemplateField('description', this.value)">${escapeHtml(template.description || template.business_meaning || '')}</textarea></div></div>`;
    }

    async function createComponentFromJson() {
      const text = prompt('高级 JSON 调试入口：请输入组件元数据 JSON。日常新增请使用可视化组件编辑器。', JSON.stringify(defaultEditableComponent(), null, 2));
      if (!text) return;
      try {
        const created = await apiFetch('/components/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
        state.selectedComponentId = created.component_id || created.type;
        await refreshComponentRegistry(false);
        toast('组件已新增');
      } catch (e) {
        toast(`新增组件失败：${formatBackendFailure(e)}`);
      }
    }

    async function editComponentJson(id) {
      try {
        const component = await fetchComponentDetail(id);
        const text = prompt('高级 JSON 调试入口：编辑组件元数据 JSON。日常编辑请使用可视化组件编辑器。', JSON.stringify(component, null, 2));
        if (!text) return;
        const updated = await apiFetch(`/components/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
        state.selectedComponentId = updated.component_id || updated.type || id;
        await refreshComponentRegistry(false);
        toast('组件已保存为新版本记录');
      } catch (e) {
        toast(`编辑组件失败：${formatBackendFailure(e)}`);
      }
    }

    function updateComponentEditorField(field, value) {
      const component = state.componentEditor.component;
      if (field === 'problem_types' || field === 'solver_capabilities' || field === 'variable_types') {
        component[field] = Array.isArray(value) ? value : String(value || '').split(',').map(x => x.trim()).filter(Boolean);
      } else if (field === 'depends_on') {
        component.depends_on = value.split(/\n|,/).map(x => x.trim()).filter(Boolean);
      } else {
        component[field] = value;
      }
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
    }

    function updateMathTemplateField(field, value) {
      const component = state.componentEditor.component;
      component.math_template = component.math_template || {};
      component.math_template[field] = value;
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
    }

    function updateComponentEditorArray(field, index, key, value) {
      const rows = state.componentEditor.component[field] || [];
      rows[index] = rows[index] || {};
      rows[index][key] = parseEditorCell(key, value);
      if (field === 'parameters' && key === 'type' && String(value).toLowerCase() === 'piecewise_curve' && !Array.isArray(rows[index].points)) {
        rows[index].points = [[0, 0], [1, 1]];
        rows[index].interpolation = 'linear';
      }
      state.componentEditor.component[field] = rows;
      state.componentEditor.validationResult = null;
      state.componentEditor.dirty = true;
    }

    function renderComponentEditorPreservingScroll() {
      const body = document.querySelector('.editor-drawer .drawer-body');
      const bodyScrollTop = body ? body.scrollTop : 0;
      const nestedScrolls = Array.from(document.querySelectorAll('.editor-drawer .drawer-body .table-scroll')).map(el => ({
        top: el.scrollTop,
        left: el.scrollLeft
      }));
      render();
      requestAnimationFrame(() => {
        const nextBody = document.querySelector('.editor-drawer .drawer-body');
        if (nextBody) nextBody.scrollTop = bodyScrollTop;
        Array.from(document.querySelectorAll('.editor-drawer .drawer-body .table-scroll')).forEach((el, index) => {
          const previous = nestedScrolls[index];
          if (!previous) return;
          el.scrollTop = previous.top;
          el.scrollLeft = previous.left;
        });
      });
    }

    function addComponentEditorArrayRow(field) {
      const component = state.componentEditor.component;
      const nextCode = (prefix, rows, key) => {
        const used = new Set((rows || []).map(row => String(row?.[key] || '').trim()).filter(Boolean));
        if (!used.has(prefix)) return prefix;
        let index = used.size + 1;
        while (used.has(`${prefix}_${index}`)) index += 1;
        return `${prefix}_${index}`;
      };
      const nextObjectiveCode = nextCode('objective_term', component.objective_terms || [], 'term_id');
      const defaults = {
        sets: { code: '', name: '' },
        parameters: { code: 'param', name: '参数', type: 'scalar', dimension: [], default: 1 },
        variables: { code: nextCode('x', component.variables || [], 'code'), name: '变量', dimension: [], type: 'continuous', lower_bound: 0 },
        constraints: { constraint_id: nextCode('constraint', component.constraints || [], 'constraint_id'), name: '约束', indices: [], expression: '', business_meaning: '', boundary_strategy: 'none', enabled: true, participates_in_solve: true },
        objective_terms: { term_id: nextObjectiveCode, name: `目标项${(component.objective_terms || []).length + 1}`, expression: '', weight_key: nextObjectiveCode, solve_participation: 'display_only' },
        parameter_bindings: { name: 'param', source: '运行时参数', required: true, default: 1, unit: '', range: '', example: 1 },
        test_cases: { name: '默认用例', parameters: {} }
      };
      component[field] = component[field] || [];
      component[field].push(JSON.parse(JSON.stringify(defaults[field] || {})));
      state.componentEditor.dirty = true;
      renderComponentEditorPreservingScroll();
    }

    function removeComponentEditorArrayRow(field, index) {
      if (!confirm('确认删除该行定义？')) return;
      const component = state.componentEditor.component;
      component[field] = component[field] || [];
      component[field].splice(index, 1);
      state.componentEditor.dirty = true;
      render();
    }

    function openStructuredFormulaBuilder(index) {
      const row = state.componentEditor.component.constraints[index] || {};
      openFormulaEditor({
        title: `正在编辑：${row.name || row.constraint_id || '组件约束'}`,
        mode: 'constraint',
        value: row.expression || row.formula || '',
        context: formulaContextFromComponent(state.componentEditor.component),
        apply: { type: 'componentConstraint', index }
      });
    }

    function openComponentObjectiveFormulaEditor(index) {
      const row = state.componentEditor.component.objective_terms[index] || {};
      openFormulaEditor({
        title: `正在编辑：${row.name || row.term_id || '目标项'}`,
        mode: 'objective',
        value: row.expression || '',
        context: formulaContextFromComponent(state.componentEditor.component),
        apply: { type: 'componentObjective', index }
      });
    }

    function applyStructuredFormula(index) {
      applyFormulaEditor();
    }

    function formatEditorCell(value) {
      if (Array.isArray(value)) return value.join(',');
      if (value && typeof value === 'object') return JSON.stringify(value);
      return value ?? '';
    }

    function parseEditorCell(key, value) {
      if (key === 'dimension') return value.split(',').map(x => x.trim()).filter(Boolean);
      if (key === 'indices') return parseIndexSpecs(value);
      if (key === 'required') return String(value) === 'true';
      if (key === 'default' || key === 'lower_bound') {
        const num = Number(value);
        return Number.isFinite(num) && value !== '' ? num : value;
      }
      if (key === 'parameters') {
        try { return JSON.parse(value); } catch (e) { return value; }
      }
      return value;
    }

    function parseIndexSpecs(value) {
      if (Array.isArray(value)) return value;
      return String(value || '').split(',').map(part => {
        const [set, alias] = part.split(':').map(x => x.trim());
        return set ? { set, alias: alias || defaultIndexAlias(set) } : null;
      }).filter(Boolean);
    }

    function formatIndices(indices) {
      return (indices || []).map(item => {
        const code = typeof item === 'string' ? item : item.set || item.code || item.name;
        if (!code) return '';
        const alias = typeof item === 'string' ? defaultIndexAlias(code) : item.alias || defaultIndexAlias(code);
        return `${code}:${alias}`;
      }).filter(Boolean).join(',');
    }

    async function validateComponentEditor() {
      try {
        const component = normalizeEditableComponent(state.componentEditor.component);
        const result = await apiFetch(`/components/${encodeURIComponent(component.component_id)}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(component) });
        state.componentEditor.validationResult = result;
        render();
      } catch (e) {
        state.componentEditor.validationResult = { valid: false, error: formatBackendFailure(e) };
        render();
      }
    }

    async function saveComponentEditor(publishAfterSave = false) {
      try {
        const component = normalizeEditableComponent(state.componentEditor.component);
        const isEdit = state.componentEditor.mode === 'edit';
        const url = isEdit ? `/components/${encodeURIComponent(component.component_id)}` : '/components/catalog';
        const method = isEdit ? 'PUT' : 'POST';
        const saved = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(component) });
        if (publishAfterSave) {
          await apiFetch(`/components/${encodeURIComponent(saved.component_id || component.component_id)}/publish`, { method: 'POST' });
        }
        state.selectedComponentId = saved.component_id || component.component_id;
        state.componentEditor = { active: false, mode: 'create', component: null, validationResult: null };
        await refreshComponentRegistry(false);
        toast(publishAfterSave ? '组件已保存并发布' : '组件草稿已保存');
      } catch (e) {
        state.componentEditor.validationResult = { valid: false, error: formatBackendFailure(e) };
        render();
      }
    }

    function cancelComponentEditor() {
      if (state.componentEditor?.dirty && !confirm('存在未保存修改，确认关闭组件编辑器？')) return;
      state.componentEditor = { active: false, mode: 'create', component: null, validationResult: null };
      render();
    }

    function openComponentEditorJsonDebug() {
      const text = prompt('高级 JSON 调试入口', JSON.stringify(state.componentEditor.component, null, 2));
      if (!text) return;
      try {
        state.componentEditor.component = normalizeEditableComponent(JSON.parse(text));
        render();
      } catch (e) {
        toast(`JSON 解析失败：${e.message}`);
      }
    }

    async function toggleManagedComponentEnabled(id) {
      try {
        const component = await fetchComponentDetail(id);
        const updated = { ...component, enabled: component.enabled === false };
        await apiFetch(`/components/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await refreshComponentRegistry(false);
        toast(updated.enabled ? '组件已启用' : '组件已停用');
      } catch (e) {
        toast(`状态更新失败：${formatBackendFailure(e)}`);
      }
    }

    async function copyComponentVersion(id) {
      const version = prompt('请输入新版本号', '1.0.0-copy');
      if (!version) return;
      try {
        await apiFetch(`/components/${encodeURIComponent(id)}/copy-version`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, change_note: 'copy from component library UI' }) });
        await refreshComponentRegistry(false);
        toast('组件版本已复制，默认停用');
      } catch (e) {
        toast(`复制组件版本失败：${formatBackendFailure(e)}`);
      }
    }

    async function validateSingleComponentDependencies(id) {
      try {
        const result = await apiFetch('/components/validate-dependencies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ components: [{ type: id, enabled: true }] }) });
        openInfoModal('组件依赖校验', `<pre>${escapeHtml(safeJson(result))}</pre>`);
      } catch (e) {
        toast(`依赖校验失败：${formatBackendFailure(e)}`);
      }
    }

    async function validateManagedComponentFormula(id) {
      try {
        const result = await apiFetch(`/components/${encodeURIComponent(id)}/validate`, { method: 'POST' });
        openInfoModal('组件公式校验', `<pre>${escapeHtml(safeJson(result))}</pre>`);
      } catch (e) {
        toast(`公式校验失败：${formatBackendFailure(e)}`);
      }
    }

    async function publishManagedComponent(id) {
      try {
        const result = await apiFetch(`/components/${encodeURIComponent(id)}/publish`, { method: 'POST' });
        state.selectedComponentId = result.component_id || result.type || id;
        await refreshComponentRegistry(false);
        toast('组件已通过校验并发布');
      } catch (e) {
        toast(`组件发布失败：${formatBackendFailure(e)}`);
      }
    }

    async function offlineManagedComponent(id) {
      try {
        const result = await apiFetch(`/components/${encodeURIComponent(id)}/offline`, { method: 'POST' });
        state.selectedComponentId = result.component_id || result.type || id;
        await refreshComponentRegistry(false);
        toast('组件已停用或下线');
      } catch (e) {
        toast(`组件下线失败：${formatBackendFailure(e)}`);
      }
    }

    async function deleteManagedComponent(id) {
      if (!confirm('确认删除该草稿组件？已发布或已被引用组件只能停用。')) return;
      try {
        await apiFetch(`/components/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.selectedComponentId = '';
        await refreshComponentRegistry(false);
        toast('组件草稿已删除');
      } catch (e) {
        toast(`删除组件失败：${formatBackendFailure(e)}`);
      }
    }
