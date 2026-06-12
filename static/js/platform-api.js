// API and backend connectivity helpers.
    function resolveApiBase() {
      const queryApiBase = new URLSearchParams(window.location.search).get('apiBase');
      const savedApiBase = localStorage.getItem('power-or-api-base');
      const candidate = queryApiBase || savedApiBase || (location.protocol.startsWith('http') ? `${location.origin}/api` : 'http://127.0.0.1:8000/api');
      return candidate.replace(/\/$/, '');
    }

    function apiHealthUrl(base) {
      const clean = String(base || '').replace(/\/$/, '');
      return clean.endsWith('/api') ? `${clean}/health` : `${clean}/api/health`;
    }

    function apiBaseFromHealthUrl(url) {
      return String(url || '').replace(/\/health$/, '').replace(/\/$/, '');
    }

    function apiBaseCandidates() {
      const queryApiBase = new URLSearchParams(window.location.search).get('apiBase');
      const savedApiBase = localStorage.getItem('power-or-api-base');
      const currentOrigin = location.protocol.startsWith('http') ? `${location.origin}/api` : '';
      return [queryApiBase, savedApiBase, state?.apiBase, currentOrigin, 'http://127.0.0.1:8000/api', 'http://127.0.0.1:8090/api']
        .filter(Boolean)
        .map(v => String(v).replace(/\/$/, ''))
        .filter((v, i, arr) => arr.indexOf(v) === i);
    }

    async function probeApiBase() {
      for (const base of apiBaseCandidates()) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1800);
          const res = await fetch(apiHealthUrl(base), { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) continue;
          state.apiBase = apiBaseFromHealthUrl(apiHealthUrl(base));
          localStorage.setItem('power-or-api-base', state.apiBase);
          return await res.json();
        } catch (e) {}
      }
      throw new Error('后端未连接，当前无法加载真实资产。');
    }

    function setApiBase(value) {
      const next = String(value || '').trim().replace(/\/$/, '');
      if (!next) return toast('API地址不能为空');
      state.apiBase = next;
      localStorage.setItem('power-or-api-base', next);
      toast(`API地址已切换：${next}`);
      checkBackend();
    }

    function apiUrl(path) {
      if (/^https?:\/\//.test(path)) return path;
      return `${state.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
    }

    async function apiFetch(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || 60000);
      try {
        const headers = { ...(options.headers || {}) };
        if (options.body !== undefined && options.body !== null && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json; charset=utf-8';
        }
        const res = await fetch(apiUrl(path), { ...options, headers, signal: controller.signal });
        const text = await res.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = text; }
        if (!res.ok) {
          const err = new Error(typeof payload === 'string' ? payload : (payload?.detail ? friendlyApiError(payload) : `HTTP ${res.status}`));
          err.status = res.status;
          err.payload = payload;
          throw err;
        }
        state.apiError = '';
        return payload;
      } catch (e) {
        state.apiError = e.name === 'AbortError' ? '接口请求超时，请检查后端服务' : friendlyApiError(e);
        throw e;
      } finally {
        clearTimeout(timeout);
      }
    }

    async function legacyApiFetchDisabled(path, options) {
      const res = await fetch(`${state.apiBase}${path}`, options);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    }

    async function checkBackend() {
      try {
        const health = await probeApiBase();
        await refreshInvocations(false);
        state.backendOnline = true;
        if (!isDemoMode()) {
          state.savedModels = [];
          state.tasks = [];
          state.skills = [];
          state.skillInvocations = [];
        }
        state.solverBackend = 'HiGHS';
        state.solverHealth = {
          solver: health.solver || 'HiGHS',
          pyomoInstalled: Object.prototype.hasOwnProperty.call(health, 'pyomo_installed') ? Boolean(health.pyomo_installed) : null,
          highspyInstalled: Object.prototype.hasOwnProperty.call(health, 'highspy_installed') ? Boolean(health.highspy_installed) : null,
          checked: true,
          capabilities: Array.isArray(health.capabilities) ? health.capabilities : []
        };
        await Promise.all([refreshTasks(false), refreshModels(false), refreshSkills(false), refreshInvocations(false), refreshComponentRegistry(false)]);
      } catch (e) {
        state.backendOnline = false;
        state.solverHealth = { solver: 'HiGHS', pyomoInstalled: null, highspyInstalled: null, checked: true };
        if (!isDemoMode()) {
          state.savedModels = [];
          state.tasks = [];
          state.skills = [];
          state.skillInvocations = [];
        }
      }
      render();
    }

    async function refreshTasks(showToast = true) {
      try {
        const tasks = await apiFetch('/tasks');
        state.tasks = tasks.map(normalizeTask);
        state.taskPage = 1;
        state.backendOnline = true;
        if (showToast) toast('任务列表已从后端刷新');
        render();
      } catch (e) {
        state.backendOnline = false;
        if (!isDemoMode()) state.tasks = [];
        if (showToast) toast('后端未连接，当前无法加载真实任务');
        render();
      }
    }

    function normalizeModel(m) {
      const templateNames = {
        unit_commitment_day_ahead: '日前机组组合优化 Unit Commitment',
        economic_dispatch: '经济负荷分配',
        storage_dispatch: '储能充放电优化',
        renewable_storage_dispatch: '风光储协同优化',
        chp_dispatch: '热电协同优化',
        cascade_hydro_dispatch: '梯级水电日前调度优化模型',
        pv_storage_capacity_planning: '光伏场站储能容量配置优化',
        pv_storage_day_ahead_dispatch: '光储协同日前调度',
        pv_storage_intraday_dispatch: '光储协同日内滚动调度',
        pv_storage_dispatch_v2: '光储一体化调度 V2',
        pv_storage_day_ahead_dispatch_v2: '光储协同日前调度 V2',
        pv_storage_intraday_dispatch_v2: '光储协同日内滚动调度 V2'
      };
      const templateId = m.template_id || m.model_code || m.semantic_spec?.model_code || '';
      const mappedName = templateNames[templateId];
      const displayName = mappedName || m.display_name || m.name || m.model_code || m.id || '';
      return {
        id: m.id || '',
        template_id: m.template_id || '',
        name: displayName,
        raw_name: m.name || displayName,
        display_name: displayName,
        scene: m.scene,
        version: m.version || 'v0.1',
        status: m.status || '开发中',
        caller: m.caller || '任务调度中心/API',
        solver: m.solver || state.solverBackend,
        objective: m.objective || m.model_draft?.objective_strategy?.summary || m.component_spec?.objective_strategy?.summary || m.ui_metadata?.legacy_objective_code || '',
        time_granularity: m.time_granularity || m.ui_metadata?.template_hint?.time_granularity || '',
        constraints: m.constraints || {},
        mapping_bindings: m.mapping_bindings || [],
        rule_configs: m.rule_configs || [],
        semantic_spec: m.semantic_spec || {},
        generic_spec: m.generic_spec || {},
        build_mode: m.build_mode || m.semantic_spec?.build_mode || 'generic_linear',
        component_spec: m.component_spec || m.semantic_spec?.component_spec || {},
        component_schema: m.component_schema || m.semantic_spec?.component_schema || {},
        model_problem_type: m.model_problem_type || m.problem_type || m.semantic_spec?.model_problem_type || '',
        required_solver_capabilities: m.required_solver_capabilities || m.semantic_spec?.required_solver_capabilities || [],
        ui_metadata: m.ui_metadata || m.semantic_spec?.ui_metadata || {},
        parameters: m.parameters || {},
        validation_warnings: m.validation_warnings || [],
        dry_run_result: m.dry_run_result || {}
      };
    }

    function markBackendFromError(e) {
      state.backendOnline = Boolean(e && e.status);
      return state.backendOnline;
    }

    async function refreshModels(showToast = true) {
      try {
        const models = await apiFetch('/models');
        const remote = models.map(normalizeModel);
        state.savedModels = remote;
        syncRuntimeTemplateSelection(state.savedModels);
        await refreshAssets(false);
        state.backendOnline = true;
        if (showToast) toast('模型资产已从后端刷新');
        render();
      } catch (e) {
        state.backendOnline = false;
        if (!isDemoMode()) state.savedModels = [];
        if (showToast) toast('后端未连接，当前无法加载真实模型资产');
        render();
      }
    }

    async function refreshAssets(showToast = true) {
      try {
        const assets = await apiFetch('/assets');
        state.customAssets = emptyCustomAssets();
        assets.forEach(asset => {
          if (state.customAssets[asset.asset_type]) {
            state.customAssets[asset.asset_type].push([asset.name, asset.description, asset.status]);
          }
        });
        if (showToast) toast('资产条目已从后端刷新');
      } catch (e) {
        if (!isDemoMode()) state.customAssets = emptyCustomAssets();
        if (showToast) toast('后端资产接口未启用');
      }
    }

    async function refreshComponentRegistry(showToast = true) {
      try {
        const catalog = await apiFetch('/components/catalog');
        state.componentRegistry = Array.isArray(catalog) ? catalog : [];
        if (!state.selectedComponentId && state.componentRegistry.length) {
          state.selectedComponentId = state.componentRegistry[0].component_id || state.componentRegistry[0].type || '';
        }
        state.backendOnline = true;
        if (showToast) toast('组件库已刷新');
        render();
      } catch (e) {
        if (showToast) toast(`组件库刷新失败：${state.apiError || e.message}`);
      }
    }

    async function refreshSkills(showToast = true) {
      try {
        const skills = await apiFetch('/skills');
        state.skills = Array.isArray(skills) ? skills : [];
        state.backendOnline = true;
        if (showToast) toast('模型服务接口列表已刷新');
        render();
      } catch (e) {
        markBackendFromError(e);
        if (!isDemoMode()) state.skills = [];
        if (showToast) toast(`模型服务接口列表加载失败：${state.apiError || e.message}`);
        render();
      }
    }

    async function refreshInvocations(showToast = true) {
      try {
        const records = await apiFetch('/invocations');
        state.skillInvocations = Array.isArray(records) ? records : [];
        state.invocationPage = 1;
        if (showToast) toast('调用记录已刷新');
      } catch (e) {
        if (!isDemoMode()) state.skillInvocations = [];
        if (showToast) toast(`调用记录加载失败：${e.message || e}`);
      }
    }

    async function fetchComponentDetail(id) {
      return apiFetch(`/components/${encodeURIComponent(id)}`);
    }

    async function exportLastResultReport() {
      if (!state.lastResult) return toast('暂无可导出的结果');
      try {
        const report = await apiFetch('/reports/export', {
          method: 'POST',
          body: JSON.stringify({
            scenario: state.lastResult.scene || state.lastResult.model || 'optimization',
            forecast_inputs: state.lastResult.forecast_inputs || {},
            solve_result: state.lastResult,
            business_summary: getPath(state.lastResult, 'business_explanation.summary', ''),
            warnings: state.lastResult.warnings || [],
            format: 'html'
          })
        });
        toast(`报告已导出：${report.file_path || report.download_url || '-'}`);
      } catch (e) {
        toast(`报告导出失败：${state.apiError || e.message}`);
      }
    }

    async function selectRuntimeTemplate(modelId) {
      state.runtimeTemplateId = modelId;
      if (!modelId) {
        render();
        return;
      }
      let model = state.savedModels.find(m => m.id === modelId);
      try {
        const remote = await apiFetch(`/models/${modelId}`);
        const normalized = normalizeModel(remote);
        normalized.modelPackage = normalized;
        model = normalized;
        const idx = state.savedModels.findIndex(m => m.id === modelId);
        if (idx >= 0) state.savedModels[idx] = normalized;
        state.backendOnline = true;
      } catch (e) {
        markBackendFromError(e);
      }
      if (model) {
        applyRuntimeConfigFromModel(model);
        toast(`已切换模型版本：${model.name}`);
      }
      render();
    }

    async function submitRuntimeTemplateTask() {
      if (!state.backendOnline) {
        toast('后端未连接，实例化求解已禁用。');
        return;
      }
      const fallback = state.savedModels.find(m => m.id && isCallableModel(m));
      const modelId = state.runtimeTemplateId || (fallback ? fallback.id : '');
      if (!modelId) {
        toast('请先保存并发布一个模型');
        return;
      }
      let parameters;
      let objectiveConfig;
      let constraintConfig;
      try {
        parameters = JSON.parse(state.runtimeParametersText || '{}');
        objectiveConfig = JSON.parse(state.runtimeObjectiveText || '{}');
        constraintConfig = JSON.parse(state.runtimeConstraintText || '{}');
      } catch (e) {
        toast(`运行时配置JSON解析失败：${e.message}`);
        return;
      }
      const selectedModel = state.savedModels.find(m => m.id === modelId) || {};
      parameters = normalizeHydroRuntimeParameters(parameters, selectedModel);
      state.runtimeParametersText = JSON.stringify(parameters, null, 2);
      const modelCode = selectedModel.semantic_spec?.model_code || selectedModel.modelPackage?.semantic_spec?.model_code || '';
      try {
        const task = await apiFetch('/optimize/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_code: modelCode || undefined,
            model_id: modelId,
            horizon: Number(parameters.horizon) || (Array.isArray(parameters.load_forecast) ? parameters.load_forecast.length : 24),
            interval_minutes: 60,
            runtime_parameters: parameters,
            objective_config: objectiveConfig,
            constraint_config: constraintConfig,
            solver_config: {
              solver: state.solverBackend,
              time_limit: state.timeLimit,
              mip_gap: state.solverGap / 100
            },
            max_retries: 1
          })
        });
        state.backendOnline = true;
        state.tasks.unshift(normalizeTask(task));
        toast(`已按模型实例化任务：${task.id}`);
        render();
        setTimeout(refreshTasks, 900);
      } catch (e) {
        markBackendFromError(e);
        const detail = Array.isArray(e.payload?.detail)
          ? e.payload.detail.map(item => `${item.field || item.loc || '参数'}: ${item.error || item.msg || JSON.stringify(item)}`).join('；')
          : (e.payload?.detail || state.apiError || e.message);
        toast(`模型实例化提交失败：${detail}`);
        render();
      }
    }

    async function fetchTaskResult(task) {
      if (!task?.id) return {};
      try {
        return await apiFetch(`/tasks/${encodeURIComponent(task.id)}/result`);
      } catch (e1) {
        try {
          return await apiFetch(`/optimize/result/${encodeURIComponent(task.id)}`);
        } catch (e2) {
          return { error: state.apiError || e2.message || e1.message, task };
        }
      }
    }

    async function exportTaskReport(i) {
      if (!state.backendOnline) return toast('导出报告后续开放');
      const task = state.tasks[i];
      const result = state.lastResult || await fetchTaskResult(task);
      try {
        const report = await apiFetch('/reports/export', {
          method: 'POST',
          body: JSON.stringify({
            scenario: task.scene || task.model || 'optimization',
            forecast_inputs: result.forecast_inputs || {},
            solve_result: result,
            business_summary: result.explanation || getPath(result, 'business_explanation.summary', ''),
            warnings: result.warnings || [],
            format: 'html'
          })
        });
        toast(`报告已导出：${report.file_path || report.download_url || '-'}`);
      } catch (e) {
        toast(`报告导出失败：${state.apiError || e.message}`);
      }
    }

    async function loadPowerTemplates() {
      const out = document.getElementById('powerTemplateDemoOutput');
      try {
        const templates = await apiFetch('/templates');
        state.templates = Array.isArray(templates) ? templates : [];
        const allowed = state.templates.filter(t => ['storage_dispatch', 'unit_commitment_day_ahead'].includes(t.code));
        const select = document.getElementById('powerTemplateSelect');
        if (select && allowed.length) {
          select.innerHTML = allowed.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name || t.code)}</option>`).join('');
        }
        if (out) out.innerHTML = `<p>已加载 ${state.templates.length} 个模板，演示场景 ${allowed.length} 个。</p>`;
      } catch (e) {
        if (out) out.innerHTML = `<p>模板加载失败：${escapeHtml(state.apiError || e.message)}</p>`;
        toast('模板加载失败，请检查后端服务');
      }
    }

    async function runPowerClosedLoopDemo() {
      if (state.demoRunning) return;
      const scenario = document.getElementById('powerTemplateSelect')?.value || 'storage_dispatch';
      const business_goal = document.getElementById('powerDemoGoal')?.value || '';
      const out = document.getElementById('powerTemplateDemoOutput');
      setDemoBusy(true, '求解中...');
      if (out) out.innerHTML = `<p>正在加载预测数据并提交求解任务，请稍候...</p>`;
      try {
        const demo = await apiFetch('/demo/run', {
          method: 'POST',
          body: JSON.stringify({ scenario, use_sample_data: true, business_goal })
        });
        window.lastPowerDemo = demo;
        state.lastResult = demo.solve_result || null;
        renderDemoResult(demo);
        toast('演示闭环已完成');
      } catch (e) {
        const message = state.apiError || e.message;
        if (out) out.innerHTML = `<p>演示运行失败：${escapeHtml(message)}</p>${e.payload ? `<pre>${escapeHtml(safeJson(e.payload))}</pre>` : ''}`;
        toast(`演示运行失败：${message}`);
      } finally {
        setDemoBusy(false);
      }
    }

    async function exportPowerDemoReport() {
      if (state.reportExporting) return;
      if (!window.lastPowerDemo) {
        await runPowerClosedLoopDemo();
        if (!window.lastPowerDemo) return;
      }
      state.reportExporting = true;
      const btn = document.getElementById('exportPowerReportBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '导出中...';
      }
      try {
        const demo = window.lastPowerDemo;
        const report = await apiFetch('/reports/export', {
          method: 'POST',
          body: JSON.stringify({
            scenario: demo.scenario,
            forecast_inputs: demo.forecast_inputs || {},
            solve_result: demo.solve_result || {},
            business_summary: demo.business_summary || '',
            warnings: demo.warnings || [],
            format: 'html'
          })
        });
        const out = document.getElementById('powerTemplateDemoOutput');
        const link = report.download_url ? `${state.apiBase.replace(/\/api$/, '')}${report.download_url}` : '';
        if (out) out.innerHTML += `<p><strong>报告已导出：</strong>${escapeHtml(report.file_path || '')}${link ? ` <a href="${escapeHtml(link)}" target="_blank">打开报告</a>` : ''}</p>`;
        toast('报告已导出');
      } catch (e) {
        toast(`报告导出失败：${state.apiError || e.message}`);
      } finally {
        state.reportExporting = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = '导出报告';
        }
      }
    }

    function modelInterfaceApiBase() {
      return (localStorage.modelInterfaceApiBaseForPlatform || 'http://127.0.0.1:8010/api').replace(/\/$/, '');
    }

    function modelInterfaceHealthUrl() {
      const base = modelInterfaceApiBase();
      return base.endsWith('/api') ? `${base}/health` : `${base}/api/health`;
    }

    async function checkModelInterfaceServiceStatus() {
      const started = Date.now();
      try {
        const response = await fetch(modelInterfaceHealthUrl());
        if (!response.ok) throw new Error(await response.text());
        state.modelInterfaceServiceHealth = await response.json();
        state.modelInterfaceServiceOnline = true;
        state.modelInterfaceServiceLatency = Date.now() - started;
      } catch (e) {
        state.modelInterfaceServiceHealth = { error: e.message };
        state.modelInterfaceServiceOnline = false;
        state.modelInterfaceServiceLatency = null;
      }
      state.modelInterfaceServiceCheckedAt = new Date().toLocaleString();
      render();
    }

    function setModelInterfaceApiBase(value) {
      localStorage.modelInterfaceApiBaseForPlatform = String(value || '').replace(/\/$/, '');
    }
