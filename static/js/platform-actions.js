// Cross-page actions, modals, task actions, demo/debug helpers.
    function toggleMoreMenu(btn) {
      const existing = document.getElementById('__morePortal');
      if (existing) {
        const same = existing._btn === btn;
        existing.remove();
        if (same) return;
      }
      const tpl = btn.nextElementSibling;
      if (!tpl || !tpl.classList.contains('more-menu')) return;
      const r = btn.getBoundingClientRect();
      const d = document.createElement('div');
      d.id = '__morePortal';
      d._btn = btn;
      d.className = 'more-menu';
      d.style.cssText = `display:grid;gap:4px;position:fixed;z-index:9999;top:${r.bottom + 4}px;right:${document.documentElement.clientWidth - r.right}px`;
      d.innerHTML = tpl.innerHTML;
      document.body.appendChild(d);
      requestAnimationFrame(() => {
        document.addEventListener('click', function dismiss(e) {
          if (!d.contains(e.target) && e.target !== btn) { d.remove(); document.removeEventListener('click', dismiss); }
        });
      });
    }

    function taskActions(i) {
      const task = state.tasks[i] || {};
      const status = normalizedTaskStatus(task);
      if (status === 'SUCCESS') {
        return `<div class="task-actions"><button class="btn primary" onclick="openTaskSolveResult(${i})">查看结果</button><button class="btn" onclick="openTaskLog(${i})">查看日志</button><span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu"><button class="btn" onclick="copyTaskParametersRetry(${i})">重新提交</button><button class="btn" disabled title="后续开放">导出报告</button><button class="btn" onclick="openTaskRawParameters(${i})">查看原始参数</button></span></span></div>`;
      }
      if (['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(status)) {
        return `<div class="task-actions"><button class="btn" onclick="openTaskError(${i})">查看错误</button><button class="btn" onclick="copyTaskParametersRetry(${i})">重新提交</button><span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu"><button class="btn" onclick="openTaskLog(${i})">查看日志</button><button class="btn" onclick="openTaskRawParameters(${i})">查看原始参数</button></span></span></div>`;
      }
      return `<div class="task-actions"><button class="btn" onclick="${isDemoMode() ? `advanceTask(${i})` : 'refreshTasks()'}">刷新</button><button class="btn" onclick="openTaskLog(${i})">查看日志</button><span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu"><button class="btn" ${state.backendOnline || isDemoMode() ? '' : 'disabled title="后续开放"'} onclick="cancelTask(${i})">取消任务</button></span></span></div>`;
    }

    async function openInvocationDetail(invocationId) {
      try {
        const detail = await apiFetch(`/invocations/${invocationId}`);
        openInvocationDetailModal(detail);
      } catch (e) {
        toast(`调用详情加载失败：${state.apiError || e.message}`);
      }
    }

    function openInvocationDetailModal(detail) {
      openInfoModal('调用记录详情', `<div class="grid cols-2">
        ${panel('基本信息', `<table class="compact-table"><tr><th>调用编号</th><td>${escapeHtml(detail.invocation_id || '-')}</td></tr><tr><th>模型接口</th><td>${escapeHtml(detail.skill_name || '-')}</td></tr><tr><th>绑定模型</th><td>${escapeHtml(detail.model_name || detail.model_id || '-')}</td></tr><tr><th>状态</th><td>${pill(detail.status || '-')}</td></tr><tr><th>耗时</th><td>${escapeHtml(detail.duration_seconds ?? '-')}s</td></tr></table>`)}
        ${panel('错误详情', `<pre>${escapeHtml(safeJson(detail.error || detail.error_detail || {}))}</pre>`)}
      </div>
      <div class="grid cols-2 mt">
        ${panel('输入参数', `<pre>${escapeHtml(safeJson(detail.parameters || detail.input || detail.request || {}))}</pre>`)}
        ${panel('输出结果', `<pre>${escapeHtml(safeJson(detail.result || detail.output || detail.response || {}))}</pre>`)}
      </div>
      <div class="mt">${panel('原始 JSON', `<pre>${escapeHtml(safeJson(detail))}</pre>`)}</div>`);
    }

    function selectDomain(d) {
      state.activeDomain = d === '水风光储' ? '水风光储协同优化' : d;
      state.filterDomain = d;
      state.page = 'domains';
      toast(`已切换到${state.activeDomain}`);
      render();
    }

    function setFilter(d) { state.filterDomain = d; render(); }

    function setSearch(v) { state.search = v; if (v) toast(`正在搜索：${v}`); }

    function loadDemo() {
      state.filterDomain = '日前机组组合';
      applyModelPreset('日前机组组合优化', '日前机组组合优化 Unit Commitment');
    }

    function loadGenericDemo() {
      state.activeDomain = '通用线性/MILP建模';
      state.activeModel = '自定义通用MILP模型';
      state.useGenericBuilder = true;
      state.genericBuilderMode = 'basic';
      state.selectedBasicConstraint = 0;
      state.genericSense = 'maximize';
      state.genericVariablesText = defaultGenericVariablesText();
      state.genericConstraintsText = defaultGenericConstraintsText();
      state.genericObjectiveText = defaultGenericObjectiveText();
      state.page = 'builder';
      state.modelReady = false;
      toast('已加载通用线性/MILP示例');
      render();
    }

    function loadIndexedGenericDemo() {
      applyModelPreset('日前机组组合优化', '日前机组组合优化 Unit Commitment');
    }

    function loadModel(name) {
      state.activeDomain = name;
      state.activeModel = name;
      applyModelPreset(state.activeDomain, state.activeModel);
    }

    function toggleScene(name) {
      const opening = state.expandedScene !== name;
      state.expandedScene = opening ? name : '';
      if (opening) state.managedScene = '';
      toast(opening ? `已展开${name}下属模型` : '已收起模型列表');
      render();
    }

    function manageScene(name) {
      const opening = state.managedScene !== name;
      state.activeDomain = name;
      state.managedScene = opening ? name : '';
      state.sceneManageTab = '基础信息';
      if (opening) state.expandedScene = '';
      toast(opening ? `已展开${name}管理面板` : '已收起场景管理面板');
      render();
    }

    function setSceneManageTab(scene, tab) {
      state.activeDomain = scene;
      state.managedScene = scene;
      state.sceneManageTab = tab;
      toast(`已切换到场景管理：${tab}`);
      render();
    }

    function enterModeling(scene, model) {
      applyModelPreset(scene, model);
    }

    async function selectScene(scene) {
      const s = getScenes().find(item => item.name === scene);
      if (!s) return;
      state.activeDomain = scene;
      state.runtimeTemplateId = '';
      const asset = (state.savedModels || []).find(model => model.id && sceneMatchesName(model.scene, scene));
      if (asset?.id) {
        await selectModel(`asset:${asset.id}`);
        return;
      }
      state.activeModel = '';
      resetModelWorkingStateForSwitch();
      render();
    }

    async function selectModel(modelName) {
      if (modelName === '__blank_model__') {
        createBlankModel({ promptForName: false, modelName: '自定义空白优化模型' });
        return;
      }
      if (String(modelName || '').startsWith('asset:')) {
        const modelId = String(modelName).slice('asset:'.length);
        let model = state.savedModels.find(item => item.id === modelId);
        try {
          if (modelId) {
            const remote = await apiFetch(`/models/${modelId}`);
            const normalized = normalizeModel(remote);
            model = { ...(model || {}), ...normalized, modelPackage: normalized };
            state.savedModels = [model, ...state.savedModels.filter(item => item.id !== modelId)];
            state.backendOnline = true;
          }
        } catch (e) {
          state.backendOnline = false;
          if (!model) {
            toast(`加载模型资产失败：${state.apiError || e.message || e}`);
            render();
            return;
          }
        }
        if (model) {
          applyModelPackageToBuilder(model.modelPackage || model);
          state.runtimeTemplateId = model.id || modelId;
          state.activeModel = model.name || state.activeModel;
          state.activeDomain = normalizeSceneNameForMatch(model.scene || state.activeDomain);
          toast(`已加载模型资产：${model.name || modelId}${model.version ? ` ${model.version}` : ''}`);
          render();
        }
        return;
      }
      if (String(modelName || '').startsWith('catalog:')) {
        const catalogKey = String(modelName).slice('catalog:'.length);
        const s = getScenes().find(item => item.name === state.activeDomain);
        const model = (s?.children || []).find(item => item.code === catalogKey || item.id === catalogKey || item.name === catalogKey);
        if (model) modelName = model.name;
      }
      const s = getScenes().find(item => item.name === state.activeDomain);
      const model = (s?.children || []).find(item => item.name === modelName);
      if (model?.builderMode === 'component_based') {
        const previousScene = state.activeDomain;
        const previousModel = state.activeModel;
        state.runtimeTemplateId = '';
        state.activeModel = model.name;
        state.builderMode = 'component_based';
        state.useGenericBuilder = false;
        state.modelReady = false;
        loadComponentTemplateExample(model.templateCode || model.code, { preserveScene: true, modelName: model.name, sceneName: state.activeDomain, rollbackScene: previousScene, rollbackModel: previousModel }).catch(() => {
          state.activeDomain = previousScene;
          state.activeModel = previousModel;
          render();
        });
        return;
      }
      state.runtimeTemplateId = '';
      applyModelPreset(state.activeDomain, modelName, { preserveScene: true, preserveModel: true });
    }

    function toggleGenericBuilder(on) {
      state.useGenericBuilder = on;
      if (on && state.activeModel !== '自定义通用MILP模型') {
        state.activeDomain = '通用线性/MILP建模';
        state.activeModel = '自定义通用MILP模型';
      }
      state.modelReady = false;
      render();
    }

    function setGenericBuilderMode(mode) {
      if (mode !== 'indexed') {
        toast('当前自定义模型统一使用语义驱动集合索引模式，基础变量模式已隐藏');
      }
      state.genericBuilderMode = 'indexed';
      state.selectedBasicConstraint = 0;
      state.modelReady = false;
      render();
    }

    function toggleAdvancedMode() {
      state.advancedMode = !state.advancedMode;
      render();
    }

    function selectAssetCategory(name) {
      state.assetCategory = name;
      const section = assetCatalog()[name];
      state.selectedAssetName = section && section.rows.length ? section.rows[0][0] : '';
      toast(`已展开资产分类：${name}`);
      render();
    }

    function viewAsset(name) {
      const catalog = assetCatalog();
      Object.keys(catalog).forEach(category => {
        if (catalog[category].rows.some(row => row[0] === name)) state.assetCategory = category;
      });
      state.selectedAssetName = name;
      toast(`已查看资产：${name}`);
      render();
    }

    function toggleRule(i) {
      state.constraints[i].on = !state.constraints[i].on;
      toast(`${state.constraints[i].name}${state.constraints[i].on ? '已启用' : '已关闭'}`);
      render();
    }

    function toggleGenericRule(i) {
      state.genericConstraints[i].on = !state.genericConstraints[i].on;
      state.modelReady = false;
      toast(`${state.genericConstraints[i].name}${state.genericConstraints[i].on ? '已启用' : '已关闭'}`);
      render();
    }

    function selectGenericRule(i) {
      state.selectedGenericRule = i;
      render();
    }

    function updateRuleConfig(i, key, value) {
      state.ruleConfigs[i][key] = value;
      state.modelReady = false;
    }

    function setBuilderStep(i) {
      state.builderStep = i;
      const steps = ['基本信息', '模型语义', '数学展开', '运行参数', '校验发布'];
      toast(`已切换到模型步骤：${steps[i]}`);
      render();
    }

    function mapField(i) {
      state.mappingBindings[i].status = '已绑定';
      state.mappedFields = state.mappingBindings.filter(row => row.status === '已绑定').length;
      state.modelReady = false;
      toast(`字段映射已更新：${state.mappedFields}/8`);
      render();
    }

    function updateMappingField(i, field, value) {
      state.mappingBindings[i][field] = value;
      state.mappingBindings[i].status = '已绑定';
      state.mappedFields = state.mappingBindings.filter(row => row.status === '已绑定').length;
      state.modelReady = false;
    }

    function setBuilderObjective(value) {
      state.objective = value;
      state.modelReady = false;
      toast(`主目标已更新为：${value}`);
      render();
    }

    function updateBuilderSetting(key, value, label) {
      state[key] = value;
      state.modelReady = false;
      toast(`${label}已更新`);
      render();
    }

    function enableCoreRules() {
      state.genericConstraints.forEach((r, i) => { if (i < 5) r.on = true; });
      state.modelReady = false;
      toast('核心约束已启用');
      render();
    }

    function disableOptionalRules() {
      state.genericConstraints.forEach((r, i) => { if (i >= 6) r.on = false; });
      state.modelReady = false;
      toast('可选约束已关闭');
      render();
    }

    function setTaskPage(page) {
      state.taskPage = Math.max(1, page);
      render();
    }

    function setTaskPageSize(value) {
      const parsed = parseInt(value, 10);
      state.taskPageSize = Number.isNaN(parsed) ? 8 : parsed;
      state.taskPage = 1;
      render();
    }

    function submitBatch() {
      if (!state.backendOnline) {
        toast('后端未连接，批量求解已禁用。');
        return;
      }
      selectedCompareCases().forEach((item, i) => state.tasks.unshift({ id: `BATCH-20260429-${i + 1}`, scene: item.name, model: item.model || '当前业务模型', solver: 'HiGHS', status: 'PENDING', progress: 5, gap: '-', cost: 0, risk: item.metrics?.risk || '低' }));
      state.page = 'tasks';
      toast('已按所选对比方案生成批量任务');
      render();
    }

    async function advanceTask(i) {
      const t = state.tasks[i];
      if (!t) return;
      if (!isDemoMode()) {
        try {
          const task = await apiFetch(`/optimize/jobs/${encodeURIComponent(t.id)}`);
          state.tasks[i] = normalizeTask(task);
          state.backendOnline = true;
          toast(`${t.id} 已从后端刷新`);
          render();
          return;
        } catch (e) {
          toast(`任务刷新失败：${state.apiError || e.message}`);
          return;
        }
      }
      t.progress = Math.min(100, t.progress + 24);
      const solver = t.solver || state.solverBackend;
      t.status = t.progress < 25 ? '排队' : t.progress < 55 ? '建模' : t.progress < 92 ? `${solver}求解` : '结果解析';
      if (t.progress === 100) { t.status = '完成'; t.gap = `${state.solverGap}%`; t.cost = 118.6; }
      toast(`${t.id} 已更新到 ${t.status}`);
      render();
    }

    async function openResult(i) {
      const task = state.tasks[i];
      if (!task) return toast('任务不存在');
      if (!isTaskTerminal(task)) {
        if (!isDemoMode()) {
          toast('任务尚未完成，请刷新任务列表后再查看结果');
          return;
        }
        await advanceTask(i);
        if (!isTaskTerminal(state.tasks[i])) {
          toast('任务尚未完成，请稍后刷新');
          return;
        }
      }
      if (task.id && task.id.startsWith('OPT-')) {
        try {
          state.lastResult = await apiFetch(`/optimize/result/${task.id}`);
          state.backendOnline = true;
        } catch (e) {
          toast(`结果获取失败：${state.apiError || e.message}`);
          if (e.payload?.diagnosis) {
            state.lastResult = { status: 'INFEASIBLE', diagnosis: e.payload.diagnosis, business_output: {}, metrics: {} };
          }
        }
      }
      openTaskSolveResult(i);
    }

    async function openTaskSolveResult(i) {
      const task = state.tasks[i];
      if (!task) return toast('任务不存在');
      if (!isTaskTerminal(task)) {
        if (!isDemoMode()) {
          toast('任务尚未完成，请刷新任务列表后再查看结果');
          return;
        }
        await advanceTask(i);
        if (!isTaskTerminal(state.tasks[i])) {
          toast('任务尚未完成，请稍后刷新');
          return;
        }
      }
      const result = await fetchTaskResult(task);
      state.lastResult = result;
      openInfoModal('查看求解结果', taskSolveResultHtml(task, result), { wide: true });
    }

    async function openTaskExplanation(i) {
      const task = state.tasks[i];
      const result = await fetchTaskResult(task);
      state.lastResult = result;
      const metrics = result.metrics || result.solve_result?.metrics || {};
      const business = result.business_output || result.solve_result?.business_output || {};
      const explanation = result.explanation || result.business_explanation?.summary || result.business_summary || '-';
      const riskNotes = result.risk_notes || result.warnings || result.diagnosis || [];
      const actions = result.next_actions || result.suggested_actions || [];
      openInfoModal('任务结果解释', `<div class="grid cols-2">
        ${panel('任务基本信息', `<table class="compact-table"><tr><th>任务ID</th><td>${escapeHtml(task.id)}</td></tr><tr><th>模型</th><td>${escapeHtml(task.model || '-')}</td></tr><tr><th>状态</th><td>${pill(task.status || '-')}</td></tr><tr><th>目标值</th><td>${escapeHtml(metrics.objective_value ?? metrics.total_cost ?? '-')}</td></tr></table>`)}
        ${panel('explanation', `<p>${escapeHtml(explanation)}</p>`)}
      </div>
      <div class="grid cols-2 mt">
        ${panel('关键业务变量', businessResultHtml({ business_output: business, variable_values: result.variable_values || business.variable_values || {} }))}
        ${panel('risk_notes / next_actions', `${warningsHtml(riskNotes)}<pre>${escapeHtml(safeJson(actions))}</pre>`)}
      </div>
      <div class="actions mt"><button class="btn primary" onclick="exportTaskReport(${i})">导出报告</button></div>
      <details class="mt"><summary>原始 JSON</summary><pre>${escapeHtml(safeJson(result))}</pre></details>`);
    }

    function openTaskError(i) {
      const task = state.tasks[i] || {};
      const detail = task.error || task.detail || task.raw?.error || task.raw?.detail || '暂无错误详情';
      openInfoModal('任务失败原因', `<div class="validation-block red"><strong>后端错误</strong><pre>${escapeHtml(safeJson(detail))}</pre></div><div class="validation-block amber mt"><strong>建议处理方式</strong><p>检查运行参数 JSON、模型版本状态、输入数据维度和后端日志；修正后可重新提交。</p></div>`);
    }

    function openTaskLog(i) {
      const task = state.tasks[i] || {};
      openInfoModal('任务日志', `<pre>${escapeHtml(safeJson(task.trace || task.logs || task))}</pre>`);
    }

    function openTaskRawParameters(i) {
      const task = state.tasks[i] || {};
      openInfoModal('任务原始参数', `<pre>${escapeHtml(safeJson(task.parameters || task.runtime_parameters || task.raw?.parameters || task.raw?.runtime_parameters || {}))}</pre>`);
    }

    function copyTaskAsNew(i) {
      toast('该功能已停用，请使用复制参数重试处理失败任务');
    }

    function copyTaskParametersRetry(i) {
      const task = state.tasks[i] || {};
      state.runtimeTemplateId = task.model_id || state.runtimeTemplateId;
      state.runtimeParametersText = safeJson(task.parameters || task.runtime_parameters || {});
      state.page = 'tasks';
      toast('已复制失败任务参数，请调整后重试');
      render();
    }

    async function retryTask(i) {
      const task = state.tasks[i];
      if (!task.id || !task.id.startsWith('OPT-')) {
        toast('本地模拟任务不支持后端重试');
        return;
      }
      try {
        const updated = await apiFetch(`/tasks/${task.id}/retry`, { method: 'POST' });
        state.tasks[i] = normalizeTask(updated);
        toast(`${task.id} 已重新入队`);
        render();
      } catch (e) {
        toast('该任务当前状态不能重试');
      }
    }

    async function cancelTask(i) {
      const task = state.tasks[i];
      if (!task) return;
      if (isDemoMode() && (!task.id || !task.id.startsWith('OPT-'))) {
          state.tasks.splice(i, 1);
          toast('演示任务已移除');
          render();
          return;
      }
      if (!state.backendOnline) return toast('后端未连接，取消任务已禁用');
      try {
        const updated = await apiFetch(`/tasks/${task.id}/cancel`, { method: 'POST' });
        state.tasks[i] = normalizeTask(updated);
        toast(`${task.id} 已取消`);
        render();
      } catch (e) {
        toast('该任务当前状态不能取消');
      }
    }

    function toggleCompare(id, checked) {
      if (checked && !state.compare.includes(id)) state.compare.push(id);
      if (!checked) state.compare = state.compare.filter(v => v !== id);
      const item = state.compareCases.find(c => c.id === id);
      toast(`${item?.name || id}${checked ? '已加入' : '已移出'}对比`);
      render();
    }

    function testApi(i) {
      state.apis[i].status = '在线';
      state.apis[i].latency = `${80 + i * 35}ms`;
      toast(`${state.apis[i].name} 测试通过`);
      render();
    }

    function openModal(type) {
      state.modalType = type;
      document.querySelector('#modal .modal-card')?.classList.remove('wide');
      document.getElementById('modalFooter').innerHTML = '<button class="btn" onclick="closeModal()">关闭</button><button class="btn primary" id="modalSaveBtn" onclick="saveModal()">保存</button>';
      document.getElementById('modalTitle').textContent = type === 'scenario' ? '新建业务场景' : type === 'asset' ? '新增资产条目' : '新增接口';
      if (type === 'asset') {
        document.getElementById('modalBody').innerHTML = `
          <p>新增资产用于沉淀集团可复用能力，不直接提交求解。场景模板、数据对象、约束组件、目标函数、求解策略和解释模板都在这里统一治理。</p>
          <div class="field"><label>资产类型</label><select id="modalAssetType"><option>场景模板</option><option>数据对象</option><option>约束组件</option><option>目标函数</option><option>求解策略</option><option>解释模板</option></select></div>
          <div class="field"><label>资产名称</label><input id="modalName" placeholder="例如：新能源消纳场景模板 / 容量边界约束组件" /></div>
          <div class="field"><label>适用范围</label><select id="modalDomain">${domainNames.map(d => `<option>${d}</option>`).join('')}</select></div>
          <div class="field"><label>说明</label><input id="modalDesc" placeholder="请输入输入、规则、目标或适用边界" /></div>
          <div class="field"><label>治理状态</label><select id="modalStatus"><option>开发中</option><option>试运行</option><option>已发布</option></select></div>
          <div class="field"><label>治理说明</label><textarea id="modalNote" placeholder="请输入适用业务、引用方式、版本要求或审批说明"></textarea></div>
        `;
      } else {
        document.getElementById('modalBody').innerHTML = `
          <div class="field"><label>场景名称 <span style="color:#c24132">*</span></label><input id="modalName" placeholder="请输入场景名称，不能与已有场景重复" /></div>
          <div class="field"><label>场景说明</label><textarea id="modalDesc" rows="3" placeholder="请输入场景简要说明（选填）" style="width:100%;resize:vertical"></textarea></div>
          <div class="field"><label>初始模型</label><select id="modalInitModel"><option value="none">不创建模型</option><option value="blank">创建空白模型</option></select></div>
          <div id="modalNameError" class="validation-block red" style="display:none;margin-top:8px"></div>
        `;
      }
      document.getElementById('modal').classList.add('show');
    }

    function closeModal() {
      if (state.formulaEditor) {
        const current = state.formulaEditor.dslFormula ?? document.getElementById('unifiedFormulaText')?.value ?? state.formulaEditor.value ?? '';
        if (current !== state.formulaEditor.originalValue && !confirm('公式内容已修改但未应用，确认放弃？')) return;
        state.formulaEditor = null;
      }
      const modalEl = document.getElementById('modal');
      if (modalEl) { modalEl.classList.remove('show', 'formula-editor-modal'); modalEl.style.zIndex = ''; }
      document.querySelector('#modal .modal-card')?.classList.remove('wide');
    }

    function openInfoModal(title, body, options = {}) {
      state.modalType = 'info';
      document.getElementById('modal')?.classList.remove('formula-editor-modal');
      document.querySelector('#modal .modal-card')?.classList.toggle('wide', Boolean(options.wide));
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = body;
      document.getElementById('modalFooter').innerHTML = '<button class="btn primary" onclick="closeModal()">关闭</button>';
      document.getElementById('modal').classList.add('show');
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeModal();
    });

    async function saveModal() {
      if (state.modalType === 'scenario') {
        const name = (document.getElementById('modalName')?.value || '').trim();
        const desc = (document.getElementById('modalDesc')?.value || '').trim();
        const initModel = document.getElementById('modalInitModel')?.value || 'none';
        const errorEl = document.getElementById('modalNameError');
        const showError = msg => {
          if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
          else toast(msg);
        };
        if (!name) { showError('场景名称不能为空。'); return; }
        const catalog = getScenarioCatalog();
        if (catalog.some(s => s.name === name)) {
          showError(`场景名称"${name}"已存在，请使用其他名称。`);
          return;
        }
        const initModels = [];
        if (initModel === 'blank') {
          initModels.push({
            id: 'model_' + Date.now(),
            name: name + '空白模型',
            type: 'LP/MILP',
            status: 'developing',
            objective: '用户自定义',
            builderMode: 'generic_linear'
          });
        }
        try {
          addScenario({ name, description: desc, status: 'draft', models: initModels });
        } catch (e) {
          showError(e.message || '保存失败，请重试。');
          return;
        }
        state.filterDomain = name;
        state.page = 'domains';
        document.getElementById('modal').classList.remove('show');
        toast(`场景"${name}"已创建并保存`);
        render();
        return;
      }
      const name = document.getElementById('modalName').value.trim() || '未命名对象';
      const domain = document.getElementById('modalDomain')?.value || '';
      if (state.modalType === 'asset') {
        const assetType = document.getElementById('modalAssetType').value;
        const desc = document.getElementById('modalDesc').value.trim() || `${domain}通用资产`;
        const status = document.getElementById('modalStatus').value;
        const note = document.getElementById('modalNote').value.trim();
        try {
          await apiFetch('/assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset_type: assetType,
              name,
              domain,
              description: desc,
              status,
              note
            })
          });
          state.backendOnline = true;
          await refreshAssets(false);
        } catch (e) {
          state.backendOnline = false;
          state.customAssets[assetType].unshift([name, desc, status]);
          toast('后端资产接口未启用，已保存到本地原型');
        }
        state.assetCategory = assetType;
        state.selectedAssetName = name;
        state.page = 'assets';
      }
      if (state.modalType === 'api') {
        state.apis.unshift({ name, type: 'API', status: '待配置', latency: '-' });
        state.page = 'integration';
      }
      closeModal();
      toast(`${name} 已保存`);
      render();
    }

    function installPowerTemplateDemoDock() {
      if (document.getElementById('powerTemplateDemoDock')) return;
      const dock = document.createElement('div');
      dock.id = 'powerTemplateDemoDock';
      dock.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:50;width:440px;max-width:calc(100vw - 36px);background:#ffffff;border:1px solid #d6dde8;border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.16);padding:12px;font-size:13px;color:#172033';
      dock.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <strong>电力优化闭环演示</strong>
          <button class="btn small" onclick="document.getElementById('powerTemplateDemoDock').style.display='none'">关闭</button>
        </div>
        <div class="field"><label>API地址</label><input id="powerApiBase" value="${escapeHtml(state.apiBase)}" onchange="setApiBase(this.value)" style="width:100%;height:32px;border:1px solid #ccd6e3;border-radius:6px;padding:0 8px" /></div>
        <select id="powerTemplateSelect" style="width:100%;height:34px;border:1px solid #ccd6e3;border-radius:6px;margin-bottom:8px">
          <option value="storage_dispatch">储能充放电优化</option>
          <option value="unit_commitment_day_ahead">日前机组组合优化</option>
        </select>
        <input id="powerDemoGoal" value="最大化峰谷套利收益" style="width:100%;height:32px;border:1px solid #ccd6e3;border-radius:6px;margin-bottom:8px;padding:0 8px" />
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button id="runPowerDemoBtn" class="btn primary" onclick="runPowerClosedLoopDemo()">一键演示</button>
          <button id="exportPowerReportBtn" class="btn" onclick="exportPowerDemoReport()">导出报告</button>
          <button class="btn" onclick="loadPowerTemplates()">加载模板</button>
        </div>
        <div id="powerTemplateDemoOutput" style="max-height:320px;overflow:auto;background:#f6f8fb;border-radius:6px;padding:8px;white-space:normal">${emptyState('请选择场景后点击一键演示。')}</div>
      `;
      document.body.appendChild(dock);
      window.lastPowerDemo = null;
      loadPowerTemplates();
    }

    function setDemoBusy(isBusy, message) {
      state.demoRunning = isBusy;
      const runBtn = document.getElementById('runPowerDemoBtn');
      const exportBtn = document.getElementById('exportPowerReportBtn');
      if (runBtn) {
        runBtn.disabled = isBusy;
        runBtn.textContent = isBusy ? (message || '运行中...') : '一键演示';
      }
      if (exportBtn) exportBtn.disabled = isBusy || state.reportExporting;
    }

    function renderDemoResult(demo) {
      const out = document.getElementById('powerTemplateDemoOutput');
      if (!out) return;
      const result = demo.solve_result || {};
      const output = result.business_output || {};
      const metrics = result.metrics || {};
      const chartData = result.chart || {};
      out.innerHTML = `
        <strong>预测输入</strong>
        <pre>${escapeHtml(safeJson(demo.forecast_inputs || {}))}</pre>
        <strong>核心指标</strong>
        <pre>${escapeHtml(safeJson(metrics))}</pre>
        <strong>结果图表数据</strong>
        ${safeChartData(chartData).labels.length ? chart(safeChartData(chartData).labels, safeChartData(chartData).values) : emptyState('暂无图表数据')}
        <strong>业务结果</strong>
        ${businessResultHtml(result)}
        <strong>中文解释</strong>
        <p>${escapeHtml(demo.business_summary || getPath(result, 'business_explanation.summary', '-'))}</p>
        <strong>建议动作</strong>
        <pre>${escapeHtml(safeJson(demo.suggested_actions || []))}</pre>
        <strong>风险提示</strong>
        ${warningsHtml(demo.warnings || result.diagnosis || [])}
      `;
    }

    function skillAssetEndpoint(skill) {
      return `${state.apiBase}/skills/${encodeURIComponent(skill.skill_name)}/run`;
    }

    function skillOpenApiExample(skill) {
      return JSON.stringify({
        openapi: '3.0.3',
        paths: {
          [`/api/skills/${skill.skill_name}/run`]: {
            post: {
              summary: `Run model interface ${skill.skill_name}`,
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        parameters: { type: 'object' },
                        options: { type: 'object', properties: { mode: { enum: ['sync', 'async'] }, explain: { type: 'boolean' } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }, null, 2);
    }

    function skillAssetRows(skills) {
      if (!Array.isArray(skills) || !skills.length) return `<tr><td colspan="8">${emptyState('暂无模型服务接口，请先发布模型。')}</td></tr>`;
      return skills.map((skill, index) => {
        const endpoint = skillAssetEndpoint(skill);
        const curl = `curl -X POST "${endpoint}" -H "Content-Type: application/json" -d '{"parameters":{},"options":{"mode":"sync","explain":true}}'`;
        const curlEncoded = encodeURIComponent(curl);
        const openApiEncoded = encodeURIComponent(skillOpenApiExample(skill));
        const displayName = skill.display_name || skill.name || skill.skill_name || '优化模型调用能力';
        const statusText = { enabled: '已启用', disabled: '已停用', deprecated: '已废弃', generated: '待审核', reviewed: '已审核', published: '已发布', tested: '已测试', trial: '试运行' }[skill.skill_status || skill.status] || (skill.skill_status || skill.status || '已启用');
        return `<tr>
          <td><strong>${escapeHtml(displayName)}</strong></td>
          <td><code>${escapeHtml(skill.skill_name || '-')}</code></td>
          <td>${escapeHtml(skill.model_name || skill.model_id || '-')}</td>
          <td>${escapeHtml(skill.model_version || skill.version || '-')}</td>
          <td>${pill(statusText)}</td>
          <td>${escapeHtml(skill.invocation_count ?? skill.call_count ?? 0)} 次</td>
          <td>${escapeHtml(skill.last_invoked_at || '-')}</td>
          <td><div class="actions"><button class="btn" onclick="openInfoModal('模型接口详情', skillInfoModalHtml(state.skills[${index}]), { wide: true })">查看</button><button class="btn primary" ${productionDisabledAttr()} onclick="runModelInterface('${escapeHtml(skill.skill_name || '')}')">调用</button><span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu"><button class="btn" onclick="openInfoModal('调用契约', contractHtmlForModelInterface(state.skills[${index}]), { wide: true })">查看调用契约</button><button class="btn" onclick="openModelInterfaceRecords('${escapeHtml(skill.skill_name || '')}')">查看调用记录</button><button class="btn" onclick="copyEncodedText('${openApiEncoded}','接口示例已复制')">复制接口示例</button><button class="btn" onclick="disableAssetSkill('${escapeHtml(skill.skill_name)}')">下线接口</button></span></span></div></td>
        </tr>`;
      }).join('');
    }

    function contractHtmlForModelInterface(item = {}) {
      return `<div class="grid cols-2">
        ${panel('输入契约', `<pre>${escapeHtml(safeJson(item.input_schema || {}))}</pre>`)}
        ${panel('输出契约', `<pre>${escapeHtml(safeJson(item.output_schema || {}))}</pre>`)}
      </div>`;
    }

    function openModelInterfaceRecords(code) {
      const records = (state.skillInvocations || []).filter(item => !code || item.skill_name === code);
      openInfoModal('调用记录', invocationLogHtml(records), { wide: true });
    }

    function runModelInterface(code) {
      state.compareSkillName = code || state.compareSkillName;
      go('compare');
    }

    function executionPolicyLabel(policy) {
      return {
        advisory_only: '仅提供决策建议',
        execute_with_approval: '审批后执行',
        auto_execute: '允许自动执行',
        async_only: '仅异步调用'
      }[policy || 'advisory_only'] || String(policy || '仅提供决策建议');
    }

    function callerLabel(caller) {
      return {
        api: '开放 API',
        service_console: '模型服务控制台',
        model_service: '平台服务',
        task_center: '任务调度中心',
        platform: '平台页面'
      }[caller] || caller;
    }

    async function enableAssetSkill(skillName) {
      try {
        await apiFetch(`/skills/${encodeURIComponent(skillName)}/enable`, { method: 'POST' });
        await refreshSkills(false);
        toast('模型服务接口已启用');
      } catch (e) {
        toast(`启用失败：${state.apiError || e.message}`);
      }
    }

    async function disableAssetSkill(skillName) {
      try {
        await apiFetch(`/skills/${encodeURIComponent(skillName)}/disable`, { method: 'POST' });
        await refreshSkills(false);
        toast('模型服务接口已停用');
      } catch (e) {
        toast(`停用失败：${state.apiError || e.message}`);
      }
    }

