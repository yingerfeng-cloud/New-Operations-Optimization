// Main product pages: dashboard, assets, tasks, results, compare, config.
    function pageDashboard() {
      const taskTotal = (state.tasks || []).length;
      const modelAssetCount = dashboardModelAssetCount();
      const sceneCount = getScenes().filter(s => s.name !== '通用线性/MILP建模').length;
      const componentCount = (state.componentRegistry || []).length || (state.componentLibrary || []).length || 0;
      return shell('集团级运筹优化底座总览', '围绕业务场景、模型资产、组件库、求解任务和结果报告提供统一建模与运行入口，当前运行环境为 Pyomo + HiGHS。', `<button class="btn primary" onclick="go('tasks')">发起任务</button>`) +
      `<div class="grid cols-4 mt">
        <button class="card metric blue" onclick="go('domains')"><span>业务场景数</span><b>${sceneCount}</b><span>来自业务场景库</span></button>
        <button class="card metric green" onclick="go('assets')"><span>模型资产数</span><b>${modelAssetCount}</b><span>模型资产中心当前数据</span></button>
        <button class="card metric amber" onclick="go('components')"><span>组件数量</span><b>${componentCount}</b><span>组件库已加载条目</span></button>
        <button class="card metric red" onclick="go('tasks')"><span>求解任务数</span><b>${taskTotal}</b><span>任务调度中心当前数据</span></button>
      </div>
      <div class="mt">${panel('快捷入口', `<div class="grid cols-4">${domainsGrid()}</div>`)}</div>
      <div class="grid cols-3 mt">
        ${panel('求解运行状态', solverRuntimeStatus())}
        <div style="grid-column:span 2">${panel('近期求解任务', taskTable())}</div>
      </div>`;
    }

    function dashboardModelAssetCount() {
      const models = state.savedModels || [];
      if (isDemoMode()) return models.length;
      if (state.backendOnline || state.solverHealth?.checked) return models.length;
      return '加载中';
    }

    function layerDiagram() {
      return domainsGrid();
    }

    function domainsGrid() {
      const entries = [
        { page: 'domains',    name: '业务场景库',   icon: '▤', color: 'blue',   desc: '按场景组织模型，选择场景进入建模或求解' },
        { page: 'builder',    name: '模型创建',     icon: '▧', color: 'green',  desc: '定义变量、约束和目标，生成求解模型' },
        { page: 'assets',     name: '模型资产中心', icon: '▥', color: 'purple', desc: '模型版本管理、发布治理与资产沉淀' },
        { page: 'components', name: '组件库管理',   icon: '▩', color: 'amber',  desc: '可复用约束组件、参数策略和解释模板' },
        { page: 'tasks',      name: '任务调度中心', icon: '◷', color: 'red',    desc: '提交、监控、重试和管理所有求解任务' },
        { page: 'results',    name: '结果报告库',   icon: '▨', color: 'teal',   desc: '查看求解结果、业务解释和风险提示' },
        { page: 'skills',     name: '模型服务接口', icon: '⚡', color: 'blue',   desc: '模型服务化发布、API 调用与记录' },
        { page: 'compare',    name: '方案对比分析', icon: '≋', color: 'amber',  desc: '多方案横向对比，快速定位最优方案' },
      ];
      return entries.map(e =>
        `<button class="card dash-entry dash-entry-${e.color}" onclick="go('${e.page}')">
          <div class="dash-entry-icon">${e.icon}</div>
          <strong>${e.name}</strong>
          <p>${e.desc}</p>
        </button>`
      ).join('');
    }

    function solverRuntimeStatus() {
      const health = state.solverHealth || {};
      const backend = state.backendOnline ? '在线' : '离线';
      const pyomo = health.pyomoInstalled === true ? '可用' : (health.pyomoInstalled === false ? '未检测到' : '未检测');
      const highs = health.highspyInstalled === true ? '可用' : (health.highspyInstalled === false ? '未检测到' : '未检测');
      return `<div class="chips"><span class="chip">Pyomo：${pyomo}</span><span class="chip">HiGHS：${highs}</span><span class="chip">后端：${backend}</span></div>
        <div class="actions mt"><button class="btn" onclick="checkBackend()">刷新状态</button><button class="btn" onclick="go('solver')">求解运行环境</button></div>`;
    }

    function taskTable() {
      const total = state.tasks.length;
      const pageSize = state.taskPageSize;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      state.taskPage = Math.min(Math.max(1, state.taskPage), totalPages);
      const start = (state.taskPage - 1) * pageSize;
      const rows = state.tasks.slice(start, start + pageSize);
      const running = state.tasks.filter(t => ['RUNNING','VALIDATING','BUILDING_MODEL','SOLVING','FORMATTING_RESULT'].includes(String(t.status).toUpperCase())).length;
      const success = state.tasks.filter(t => normalizedTaskStatus(t) === 'SUCCESS').length;
      const failed = state.tasks.filter(t => ['FAILED','INFEASIBLE','TIMEOUT','CANCELLED'].includes(normalizedTaskStatus(t))).length;
      const body = rows.length ? rows.map((t, idx) => {
        const i = start + idx;
        return `<tr><td title="${escapeHtml(t.id)}">${escapeHtml(t.id)}</td><td title="${escapeHtml(t.scene)}">${escapeHtml(t.scene)}</td><td title="${escapeHtml(t.model)}">${escapeHtml(t.model)}</td><td><span class="pill green">${escapeHtml(t.solver || 'HiGHS')}</span></td><td>${pill(t.status)}</td><td><div class="progress"><div style="width:${Number(t.progress || 0)}%"></div></div></td><td>${taskActions(i)}</td></tr>`;
      }).join('') : `<tr><td colspan="7">${emptyState('暂无真实任务数据')}</td></tr>`;
      return `<div class="list-shell">
        <div class="list-toolbar">
          <div class="list-summary"><span class="chip">共 ${total} 条</span><span class="chip">运行中 ${running}</span><span class="chip">成功 ${success}</span><span class="chip">失败 ${failed}</span><span class="chip">${isDemoMode() ? '演示数据' : '真实 API'}</span></div>
          <div class="actions"><button class="btn" onclick="refreshTasks()">刷新</button></div>
        </div>
        <div class="table-scroll list-body"><table class="sticky-table table-density-comfortable"><thead><tr><th>任务ID</th><th>场景</th><th>模型</th><th>求解器</th><th>状态</th><th>进度</th><th style="width:190px">操作</th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="list-footer">
          <button class="btn" onclick="setTaskPage(${state.taskPage - 1})" ${state.taskPage <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="chip">${state.taskPage} / ${totalPages}</span>
          <button class="btn" onclick="setTaskPage(${state.taskPage + 1})" ${state.taskPage >= totalPages ? 'disabled' : ''}>下一页</button>
          <select onchange="setTaskPageSize(this.value)"><option ${pageSize === 8 ? 'selected' : ''}>8</option><option ${pageSize === 15 ? 'selected' : ''}>15</option><option ${pageSize === 30 ? 'selected' : ''}>30</option></select>
        </div>
      </div>`;
    }

    function normalizedTaskStatus(task) {
      const status = String(task?.status || '').toUpperCase();
      if (Number(task?.progress || 0) >= 100 && !['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(status)) return 'SUCCESS';
      return status;
    }

    function modelBuildModeText(model) {
      const mode = model?.build_mode || model?.semantic_spec?.build_mode || '-';
      const map = {
        generic_linear: '通用线性 Builder',
        template_based: '模板 Builder',
        component_based: '组件化自定义 Builder',
        domain_builder: '领域 Builder'
      };
      return map[mode] || mode;
    }

    function modelProblemTypeText(model) {
      return model?.model_problem_type || model?.problem_type || model?.semantic_spec?.model_problem_type || '-';
    }

    function modelComponents(model) {
      const semantic = model?.semantic_spec || {};
      const schema = model?.component_schema || semantic.component_schema || {};
      const ui = model?.ui_metadata || semantic.ui_metadata || {};
      const spec = model?.component_spec || semantic.component_spec || {};
      return schema.components || ui.component_catalog || spec.components || [];
    }

    function modelComponentSummary(model) {
      const components = modelComponents(model);
      return components.length ? `${components.length} 个组件` : '-';
    }

    function componentCatalogHtml(modelOrSchema) {
      const semantic = modelOrSchema?.semantic_schema || modelOrSchema?.semantic_spec || modelOrSchema?.semantic_spec?.semantic_spec || {};
      const schema = modelOrSchema?.component_schema || semantic.component_schema || {};
      const ui = modelOrSchema?.ui_metadata || semantic.ui_metadata || {};
      const spec = modelOrSchema?.component_spec || semantic.component_spec || {};
      const components = schema.components || ui.component_catalog || spec.components || [];
      if (!components.length) return '<p class="muted">暂无组件化 Builder 信息。</p>';
      const complex = ui.complex_components || {};
      const rows = components.map((item, i) => {
        const type = item.type || item.code || '-';
        const name = item.display_name || item.name || type;
        return `<tr><td>${i + 1}</td><td>${escapeHtml(name)}<br><span class="muted">${escapeHtml(type)}</span></td><td>${escapeHtml(item.category || '水电调度')}</td><td>${escapeHtml(item.description || item.formula || '-')}</td><td>${complex[type] ? '<button class="btn" onclick="toast(&quot;可在下方复杂组件说明查看示例&quot;)">查看示例</button>' : '-'}</td></tr>`;
      }).join('');
      const complexHtml = Object.keys(complex).length ? `<div class="mt">${Object.entries(complex).map(([type, info]) => `<details class="mt"><summary>${escapeHtml(type)} 示例与说明</summary><pre>${escapeHtml(safeJson(info))}</pre></details>`).join('')}</div>` : '';
      return `<table class="compact-table"><thead><tr><th>#</th><th>组件名称 / code</th><th>分类</th><th>作用说明</th><th>示例</th></tr></thead><tbody>${rows}</tbody></table>${complexHtml}`;
    }

    function isCallableModel(model) {
      return ['published', 'trial', 'tested', '已发布', '试运行', '已测试'].includes(model?.status);
    }

    function isCascadeHydroModel(model) {
      const code = model?.template_id
        || model?.semantic_spec?.model_code
        || model?.component_spec?.model_code
        || model?.modelPackage?.semantic_spec?.model_code
        || '';
      const text = `${model?.name || ''} ${model?.scene || ''} ${model?.description || ''}`;
      return code === 'cascade_hydro_dispatch' || text.includes('梯级水电') || text.includes('水电调度');
    }

    function runtimeCallableModels(models = state.savedModels) {
      return models.filter(m => m.id && isCallableModel(m));
    }

    function preferredRuntimeModel(models = runtimeCallableModels()) {
      return models.find(isCascadeHydroModel)
        || models.find(m => m.template_id === 'unit_commitment_day_ahead' || m.semantic_spec?.model_code === 'unit_commitment_day_ahead')
        || models[0]
        || null;
    }

    function syncRuntimeTemplateSelection(models = state.savedModels) {
      const callable = runtimeCallableModels(models);
      const selectedStillCallable = callable.some(m => m.id === state.runtimeTemplateId);
      if (selectedStillCallable) return state.savedModels.find(m => m.id === state.runtimeTemplateId) || null;
      const selected = preferredRuntimeModel(callable);
      state.runtimeTemplateId = selected ? selected.id : '';
      if (selected) applyRuntimeConfigFromModel(selected);
      return selected;
    }

    function modelStatusText(status) {
      const map = {
        published: '已发布',
        trial: '试运行',
        developing: '开发中',
        offline: '已下线'
      };
      return map[status] || status || '-';
    }

    function pageDomains() {
      const catalog = getScenarioCatalog();
      const allScenes = getScenes().filter(s => s.name !== '通用线性/MILP建模');
      const tabLabels = ['全部', ...catalog.map(s => s.name)];
      const activeLabel = state.filterDomain || '全部';
      const filteredScenes = activeLabel === '全部'
        ? allScenes
        : allScenes.filter(s => s.name === activeLabel);
      return shell('业务场景库', '按业务问题管理场景，并在每个场景下维护多个可选模型。用户先查看场景，再选择具体模型进入建模或提交求解。', `<button class="btn primary" onclick="openModal('scenario')">新建场景</button>`) +
      `<div class="tabs">${tabLabels.map(label => `<button class="tab ${activeLabel === label ? 'active' : ''}" onclick="setFilter('${escapeHtml(label)}')">${escapeHtml(label)}</button>`).join('')}</div>
      <div class="grid cols-2 mt">${filteredScenes.length ? filteredScenes.map(s => sceneCard(s)).join('') : emptyState('该标签下暂无业务场景')}</div>`;
    }

    function getScenes() {
      return scenarioModelCatalog().map(scene => {
        const models = scene.models || [];
        const publishedCount = models.filter(m => ['已发布', 'published'].includes(m.status)).length;
        return {
          name: scene.name,
          desc: scene.desc,
          modelCount: models.length,
          publishedModelCount: publishedCount,
          status: scene.status || '试运行',
          children: models.map(model => ({
            name: model.name,
            code: model.code,
            builderMode: model.builderMode,
            templateCode: model.templateCode,
            desc: model.desc,
            type: model.type || (model.builderMode === 'component_based' ? '组件化 LP/MILP' : 'LP/MILP'),
            target: model.target || '用户自定义',
            status: model.status || scene.status || '试运行',
            gap: model.gap || '0.00%'
          }))
        };
      });
    }
    function sceneCard(s) {
      const expanded = state.expandedScene === s.name;
      const managing = state.managedScene === s.name;
      const hasPublished = (s.publishedModelCount || 0) > 0;
      const sNameEsc = escapeHtml(s.name);
      const modelRowsHtml = s.children && s.children.length
        ? s.children.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.type)}</td><td>${escapeHtml(m.target)}</td><td>${pill(m.status)}</td><td><button class="btn" onclick="enterModeling('${sNameEsc}','${escapeHtml(m.name)}')">进入建模</button></td></tr>`).join('')
        : `<tr><td colspan="5" style="text-align:center;color:#8a9bb5">暂无模型</td></tr>`;
      return `<div class="card"><div class="panel-title"><span>${sNameEsc}</span>${pill(s.status)}</div>
        <p>${escapeHtml(s.desc)}</p>
        <p>归属模型：${s.modelCount} 个 ｜ 已发布：${s.publishedModelCount || 0} 个</p>
        <div class="actions mt">
          <button class="btn ${expanded ? 'primary' : ''}" onclick="toggleScene('${sNameEsc}')">${expanded ? '收起模型' : '查看模型'}</button>
          <button class="btn ${managing ? 'primary' : ''}" onclick="manageScene('${sNameEsc}')">${managing ? '收起管理' : '管理场景'}</button>
          <button class="btn primary" ${hasPublished ? `onclick="go('tasks')"` : 'disabled title="暂无已发布模型"'}>发起求解</button>
        </div>
        ${expanded ? `<div class="mt"><table><thead><tr><th>模型</th><th>类型</th><th>目标</th><th>状态</th><th>操作</th></tr></thead><tbody>${modelRowsHtml}</tbody></table></div>` : ''}
        ${managing ? sceneManagePanel(s) : ''}
      </div>`;
    }

    function sceneManagePanel(s) {
      const tab = state.sceneManageTab;
      return `<div class="mt card" style="background:#f8fafc">
        <div class="panel-title"><span>场景管理：${s.name}</span><span class="pill blue">配置视图</span></div>
        <div class="grid cols-3">
          <div><strong>场景定义</strong><p>维护业务问题说明、业务域分类、适用组织、使用权限和启停状态。</p></div>
          <div><strong>数据模板</strong><p>维护该场景需要的输入数据清单、来源系统、校验规则和默认粒度。</p></div>
          <div><strong>归属模型</strong><p>新增、复制、停用该场景下的模型，并管理默认模型、版本和发布状态。</p></div>
        </div>
        <div class="actions mt">
          ${['基础信息', '数据模板', '模型维护'].map(name => `<button class="btn ${tab === name ? 'primary' : ''}" onclick="setSceneManageTab('${s.name}','${name}')">${name}</button>`).join('')}
        </div>
        <div class="mt">${sceneManageDetail(s, tab)}</div>
      </div>`;
    }

    function sceneManageDetail(s, tab) {
      if (tab === '基础信息') {
        return `<div class="grid cols-2">
          <div class="field"><label>场景名称</label><input value="${escapeHtml(s.name)}" /></div>
          <div class="field"><label>适用组织</label><input value="集团本部 / 区域公司 / 场站单位" /></div>
          <div class="field"><label>默认求解器</label><select><option>HiGHS</option></select></div>
          <div class="field"><label>场景说明</label><input value="${escapeHtml(s.desc)}" /></div>
          <div class="field"><label>状态</label><select><option ${s.status === '已发布' ? 'selected' : ''}>已发布</option><option ${s.status === '试运行' ? 'selected' : ''}>试运行</option><option ${s.status === '草稿' || s.status === '开发中' ? 'selected' : ''}>草稿</option></select></div>
        </div>
        <div class="actions mt"><button class="btn primary" disabled title="后续开放">保存基础信息</button></div>`;
      }
      if (tab === '数据模板') {
        return `<table>
          <thead><tr><th>输入对象</th><th>来源系统</th><th>校验规则</th><th>默认粒度</th><th>状态</th></tr></thead>
          <tbody>
            <tr><td>资源对象</td><td>设备主数据 / 台账</td><td>主键唯一、编码完整</td><td>静态</td><td>${pill('已发布')}</td></tr>
            <tr><td>时序预测</td><td>生产实时库 / 预测服务</td><td>时间连续、缺失补齐</td><td>15分钟</td><td>${pill('已发布')}</td></tr>
            <tr><td>约束边界</td><td>规则参数库</td><td>上下限逻辑一致</td><td>日/周</td><td>${pill('试运行')}</td></tr>
            <tr><td>成本收益</td><td>经营指标库</td><td>单位统一、币种统一</td><td>日/月</td><td>${pill('试运行')}</td></tr>
          </tbody>
        </table>
        <div class="actions mt"><button class="btn primary" disabled title="后续开放">保存数据模板</button></div>`;
      }
      return `<table>
        <thead><tr><th>模型名称</th><th>类型</th><th>目标</th><th>版本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${s.children.map((m, i) => `<tr><td>${m.name}${i === 0 ? ' <span class="pill blue">默认</span>' : ''}</td><td>${m.type}</td><td>${m.target}</td><td>v${1 + i}.0</td><td>${pill(m.status)}</td><td><button class="btn" onclick="loadModel('${m.name}')">查看模型</button> <button class="btn" onclick="enterModeling('${s.name}','${m.name}')">模型编辑</button> <button class="btn primary" onclick="submitTask()">求解</button></td></tr>`).join('')}</tbody>
      </table>
      <div class="actions mt"><button class="btn primary" onclick="createBlankModel()">新增模型</button></div>`;
    }

    function pageAssets() {
      if (!state.backendOnline && !isDemoMode()) {
        return shell('模型资产中心', '统一管理模型版本、通用组件资产和发布治理流程。', `<button class="btn" onclick="refreshModels()">刷新资产</button>`) + offlineStateHtml('模型资产');
      }
      const models = state.savedModels || [];
      const publishedCount = models.filter(m => ['published', '已发布'].includes(m.status)).length;
      const trialCount = models.filter(m => ['trial', '试运行'].includes(m.status)).length;
      const devCount = models.filter(m => ['developing', '开发中'].includes(m.status)).length;
      return shell('模型资产中心', '沉淀可复用模型模板、通用组件、参数策略和版本治理记录，支撑模型资产全生命周期管理。', `<button class="btn primary" ${productionDisabledAttr()} onclick="openModal('asset')">登记模型</button><button class="btn" onclick="refreshModels()">刷新资产</button>`) +
      demoModeBanner() +
      `<div class="grid cols-4">
        <button class="card metric blue"><span>场景模板</span><b>18</b><span>覆盖主要安全生产场景</span></button>
        <button class="card metric green"><span>通用组件</span><b>96</b><span>可复用约束和目标项</span></button>
        <button class="card metric amber"><span>参数策略</span><b>24</b><span>Gap、时限和降级策略</span></button>
        <button class="card metric red" onclick="toast('版本待审核')"><span>版本待审核</span><b>3</b><span>等待发布治理确认</span></button>
      </div>
      <div class="mt">${modelVersionListShell(models, publishedCount, trialCount, devCount)}</div>`;
    }

    function modelVersionListShell(models, publishedCount, trialCount, devCount) {
      const rows = models.map((m, i) =>
        `<tr class="${state.recentSavedModel === m.name ? 'compare-best-row' : ''}">
          <td class="cell-truncate" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}${state.recentSavedModel === m.name ? ' <span class="pill blue">最近保存</span>' : ''}</td>
          <td>${escapeHtml(modelBuildModeText(m))}</td>
          <td>${escapeHtml(modelProblemTypeText(m))}</td>
          <td>${escapeHtml(modelComponentSummary(m))}</td>
          <td class="cell-truncate" title="${escapeHtml(m.scene)}">${escapeHtml(m.scene)}</td>
          <td>${escapeHtml(m.version)}</td>
          <td>${pill(modelStatusText(m.status))}</td>
          <td class="cell-truncate" title="${escapeHtml(m.caller)}">${escapeHtml(m.caller)}</td>
          <td class="ops-col">${modelAssetActions(i, m)}</td>
        </tr>`
      ).join('') || `<tr><td colspan="9">${emptyState('暂无模型版本')}</td></tr>`;
      return `<div class="list-shell">
        <div class="list-toolbar">
          <div class="list-summary"><span class="chip">共 ${models.length} 个版本</span><span class="chip">已发布 ${publishedCount}</span><span class="chip">试运行 ${trialCount}</span><span class="chip">开发中 ${devCount}</span><span class="chip">${isDemoMode() ? '演示数据' : '真实 API'}</span></div>
          <div class="actions"><input class="search" style="width:200px;height:34px" placeholder="搜索模型资产..." oninput="setSearch(this.value)" /><button class="btn" onclick="refreshModels()">刷新</button><button class="btn primary" ${productionDisabledAttr()} onclick="openModal('asset')">登记模型</button></div>
        </div>
        <div class="list-body"><div class="table-scroll"><table class="sticky-table table-density-comfortable asset-table"><thead><tr><th style="width:210px">模型名称</th><th>构建方式</th><th>问题类型</th><th>组件摘要</th><th>业务场景</th><th>版本</th><th>状态</th><th>负责人</th><th class="ops-col">操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>
        <div class="list-footer"><span class="muted" style="font-size:13px">模型版本管理用于查看、编辑、发布和调用配置，不影响后端接口路径。</span></div>
      </div>`;
    }

    function genericAssetListShell() {
      const assetData = [
        ['安全边界参数集','参数策略','上限/下限/告警/停机','v2.1','已发布'],
        ['机组组合约束模板','约束组件','启停/爬坡/备用','v1.8','已发布'],
        ['储能运行策略','求解策略','SOC/容量/效率','v1.2','试运行'],
        ['负荷预测映射规则','数据对象','时序/区域/口径','v1.0','已发布'],
        ['风险解释模板','解释模板','约束紧张度/风险提示','v0.9','待校验'],
        ['经济调度目标模板','目标函数','成本/收益/风险','v1.3','已发布'],
        ['日前计划场景骨架','场景模板','计划/执行/复盘','v0.8','试运行']
      ];
      const rows = assetData.map(a =>
        `<tr><td class="cell-truncate" title="${escapeHtml(a[0])}">${escapeHtml(a[0])}</td><td>${escapeHtml(a[1])}</td><td class="cell-truncate" title="${escapeHtml(a[2])}">${escapeHtml(a[2])}</td><td>${escapeHtml(a[3])}</td><td>${pill(a[4])}</td><td class="ops-col"><button class="btn" onclick="viewAsset('${escapeHtml(a[0])}')">查看</button></td></tr>`
      ).join('');
      return `<div class="list-shell"><div class="list-toolbar"><div class="list-summary"><span class="chip">通用资产清单</span><span class="chip">共 ${assetData.length} 条</span></div><div class="actions"><button class="btn primary" ${productionDisabledAttr()} onclick="openModal('asset')">登记资产</button></div></div><div class="list-body"><div class="table-scroll"><table class="sticky-table table-density-comfortable asset-table"><thead><tr><th style="width:220px">资产名称</th><th>资产类型</th><th>适用范围</th><th>版本</th><th>状态</th><th class="ops-col">操作</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
    }

    function modelAssetActions(i, model) {
      const publishText = isCallableModel(model) ? '下线' : '发布';
      const publishHandler = isCallableModel(model) ? `offlineModel(${i})` : `publishModel(${i})`;
      const publishClass = isCallableModel(model) ? '' : 'green';
      return `<div class="asset-actions">
        <button class="btn" onclick="viewModelAssetDetail(${i})">查看</button>
        <button class="btn" onclick="loadModelVersion(${i})">编辑</button>
        <span class="more"><button class="btn" onclick="toggleMoreMenu(this)">更多</button><span class="more-menu">
          <button class="btn primary" ${productionDisabledAttr()} onclick="callModelFromAsset(${i})">调用配置</button>
          <button class="btn ${publishClass}" ${productionDisabledAttr()} onclick="${publishHandler}">${publishText}</button>
          <button class="btn" ${productionDisabledAttr()} onclick="copyModelVersion(${i})">复制版本</button>
          <button class="btn" onclick="viewModelAssetDetail(${i})">查看数学表达式</button>
          <button class="btn warn" ${productionDisabledAttr()} onclick="deleteModelVersion(${i})">删除草稿</button>
        </span></span>
      </div>`;
    }

    function assetCategoryPanel() {
      const list = [
        ['场景模板', '按集团业务域沉淀标准问题骨架'],
        ['数据对象', '资源、时序、边界、成本、关系'],
        ['约束组件', '平衡、容量、互斥、窗口、安全'],
        ['目标函数', '成本、收益、风险、多目标'],
        ['求解策略', '快速、均衡、精确、降级'],
        ['解释模板', '业务指标、诊断话术、报告片段']
      ];
      return `<div class="grid cols-3">${list.map(a => `<button class="card" onclick="selectAssetCategory('${a[0]}')" style="${state.assetCategory === a[0] ? 'border-color:#2166c2;background:var(--soft-blue)' : ''}"><strong>${a[0]}</strong><p>${a[1]}</p></button>`).join('')}</div>`;
    }

    function assetCategoryDetail() {
      const catalog = assetCatalog();
      const section = catalog[state.assetCategory];
      const currentAsset = section.rows.find(row => row[0] === state.selectedAssetName) || section.rows[0];
      const rows = section.rows.map(row =>
        `<tr class="${state.selectedAssetName === row[0] ? 'compare-best-row' : ''}">
          <td class="cell-truncate" title="${escapeHtml(row[0])}">${escapeHtml(row[0])}</td>
          <td class="cell-truncate" title="${escapeHtml(row[1])}">${escapeHtml(row[1])}</td>
          <td>${pill(row[2])}</td>
          <td class="ops-col"><button class="btn" onclick="viewAsset('${escapeHtml(row[0])}')">查看</button></td>
        </tr>`
      ).join('');
      return `<p>${escapeHtml(section.explain)}</p>
      <div class="list-shell mt">
        <div class="list-toolbar">
          <div class="list-summary"><span class="chip">${escapeHtml(state.assetCategory)}</span><span class="chip">共 ${section.rows.length} 条</span></div>
        </div>
        <div class="list-body">
          <div class="table-scroll">
            <table class="sticky-table table-density-comfortable">
              <thead><tr><th>资产</th><th>展开内容</th><th>状态</th><th class="ops-col">操作</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <details class="mt">
        <summary style="padding:10px 12px;background:#f8fbff;border:1px solid var(--line);border-radius:var(--radius-md)">${escapeHtml(currentAsset[0])} 详情</summary>
        <div class="card mt">
          <div class="grid cols-2">
            <div><strong>定义</strong><p>${escapeHtml(currentAsset[1])}</p></div>
            <div><strong>状态</strong><p>${escapeHtml(currentAsset[2])}，可纳入集团统一资产治理。</p></div>
            <div><strong>适用业务域</strong><p>火电、水电、新能源、燃料、检修、应急、物流、排班等按需复用。</p></div>
            <div><strong>下游用途</strong><p>可被模型创建引用，也可发布后由任务中心选择模型并实例化求解。</p></div>
          </div>
        </div>
      </details>`;
    }

    function pageSolver() {
      const pyomoKnownMissing = state.solverHealth.pyomoInstalled === false;
      const highsKnownMissing = state.solverHealth.highspyInstalled === false;
      const highsReady = state.backendOnline && !pyomoKnownMissing && !highsKnownMissing;
      const dependencyStatus = !state.backendOnline ? '未连接' : (pyomoKnownMissing || highsKnownMissing) ? '依赖异常' : '在线';
      const pyomoStatus = !state.backendOnline ? '未连接' : state.solverHealth.pyomoInstalled === false ? '依赖异常' : state.solverHealth.pyomoInstalled === true ? '在线' : '未上报';
      const highspyStatus = !state.backendOnline ? '未连接' : state.solverHealth.highspyInstalled === false ? '依赖异常' : state.solverHealth.highspyInstalled === true ? '在线' : '未上报';
      const pyomoMetric = state.solverHealth.pyomoInstalled === null ? 'health.pyomo_installed 未上报，兼容旧后端' : `health.pyomo_installed = ${state.solverHealth.pyomoInstalled ? 'true' : 'false'}`;
      const highspyMetric = state.solverHealth.highspyInstalled === null ? 'health.highspy_installed 未上报，兼容旧后端' : `health.highspy_installed = ${state.solverHealth.highspyInstalled ? 'true' : 'false'}`;
      const backendNote = highsReady ? '后端可用，当前统一使用 HiGHS。若 health 未上报 pyomo_installed，请重启后端加载最新代码。' : state.backendOnline ? '后端在线，但 Pyomo 或 highspy 明确未就绪' : '后端未连接：请运行 .\\start.ps1 -Mode platform -Port 8000，或点击下方连接按钮。日志位置：logs/platform.log、logs/combined.log';
      return shell('求解运行环境', '当前阶段统一采用 Pyomo + HiGHS。', `<button class="btn primary" onclick="checkBackend()">健康检查</button>`) +
      `${panel('连接配置', `<div class="grid cols-2"><div class="field"><label>当前 API 地址</label><input value="${escapeHtml(state.apiBase)}" onchange="setApiBase(this.value)" /></div><div class="card"><strong>健康检查时间</strong><p>${state.solverHealth.checked ? new Date().toLocaleString() : '尚未检查'}</p></div></div><details class="mt"><summary>高级调试：快速连接</summary><div class="actions mt"><button class="btn" onclick="setApiBase('http://127.0.0.1:8000/api')">连接 8000</button><button class="btn" onclick="setApiBase('http://127.0.0.1:8090/api')">连接 8090</button><button class="btn primary" onclick="checkBackend()">自动探测</button></div></details><p class="muted mt">${escapeHtml(backendNote)}</p>`)}` +
      `<div class="grid cols-2">
        ${panel('求解后端', `<div class="seg"><button class="active" onclick="setSolverBackend('HiGHS')">HiGHS</button></div><div class="mt"><table><tr><th>框架/求解器</th><th>定位</th><th>适用模型</th><th>状态</th></tr><tr><td>Pyomo + HiGHS</td><td>当前统一求解链路</td><td>LP/MILP</td><td>${pill(dependencyStatus)}</td></tr></table><p class="muted">${escapeHtml(backendNote)}</p></div>`)}
        ${panel('求解模式配置', `<div class="seg">${['快速模式','均衡模式','精确模式'].map(m => `<button class="${state.solverMode === m ? 'active' : ''}" onclick="setMode('${m}')">${m}</button>`).join('')}</div><div class="grid cols-3 mt"><div class="field"><label>MIPGap</label><input value="${state.solverGap}%" onchange="updateSolver('gap', this.value)" /></div><div class="field"><label>时间限制</label><input value="${state.timeLimit} 秒" onchange="updateSolver('time', this.value)" /></div><div class="field"><label>并发任务数</label><input value="${state.concurrency}" onchange="updateSolver('concurrency', this.value)" /></div></div>`)}
      </div>
      <div class="grid cols-2 mt">
        ${panel('服务状态', `<table><tr><th>服务</th><th>状态</th><th>指标</th></tr><tr><td>FastAPI 后端</td><td>${pill(state.backendOnline ? '在线' : '未连接')}</td><td>${escapeHtml(state.apiBase)}</td></tr><tr><td>Pyomo 建模层</td><td>${pill(pyomoStatus)}</td><td>${escapeHtml(pyomoMetric)}</td></tr><tr><td>HiGHS highspy API</td><td>${pill(highspyStatus)}</td><td>${escapeHtml(highspyMetric)}</td></tr><tr><td>模型生成器</td><td>${pill(state.backendOnline ? '在线' : '未连接')}</td><td>PyomoModelBuilder</td></tr></table>`)}
        ${panel('运行策略', `<table><tr><th>场景</th><th>默认后端</th><th>说明</th></tr><tr><td>所有当前模板</td><td>HiGHS</td><td>后端 JobService 会强制 req.solver = HiGHS</td></tr></table>`)}
      </div>
      <div class="mt">${panel('参数暴露策略', `<div class="chips"><span class="chip">业务用户：模式选择</span><span class="chip">建模人员：Gap/时间/线程数</span><span class="chip">系统：统一 HiGHS 求解链路</span></div>`)}</div>`;
    }

    function pageTasks() {
      if (!state.backendOnline && !isDemoMode()) {
        return shell('任务调度中心', '默认仅展示后端真实任务。', `<span class="pill amber">后端未连接</span>`) + offlineStateHtml('真实任务');
      }
      return shell('任务调度中心', '对所有业务域的优化任务进行排队、建模、求解、解析、归档和异常重试管理。', `<span class="pill ${state.backendOnline ? 'green' : 'amber'}">${state.backendOnline ? '后端在线' : '本地展示'}</span>`) +
        demoModeBanner() +
        panel('模型实例化求解', runtimeTemplatePanel()) +
        `<div class="mt">${panel('任务列表', taskTable(), '<button class="btn" onclick="refreshTasks()">刷新任务</button>')}</div>`;
    }

    function runtimeTemplatePanel() {
      const callable = runtimeCallableModels();
      syncRuntimeTemplateSelection(state.savedModels);
      const selectedId = callable.some(m => m.id === state.runtimeTemplateId)
        ? state.runtimeTemplateId
        : (preferredRuntimeModel(callable)?.id || '');
      const options = callable.length
        ? callable.map(m => `<option value="${m.id}" ${selectedId === m.id ? 'selected' : ''}>${escapeHtml(m.display_name || m.name || m.id)} / ${escapeHtml(m.version || '-')} / ${modelStatusText(m.status)}</option>`).join('')
        : '<option value="">暂无可调用模型，请先刷新模型资产或启动后端</option>';
      return `<div class="grid cols-3">
        <div class="field"><label>选择模型版本</label><select onchange="selectRuntimeTemplate(this.value)">${options}</select><p class="muted">发布后的模型会在这里出现；若刚发布或看不到水电模型，请点击刷新模型。</p><button class="btn" onclick="refreshModels()">刷新模型</button></div>
        <div class="field"><label>运行时参数 parameters</label><textarea onchange="state.runtimeParametersText=this.value">${state.runtimeParametersText}</textarea></div>
        <div class="field"><label>目标配置 objective_config</label><textarea onchange="state.runtimeObjectiveText=this.value">${state.runtimeObjectiveText}</textarea></div>
        <div class="field" style="grid-column:span 2"><label>约束配置 constraint_config</label><textarea onchange="state.runtimeConstraintText=this.value">${state.runtimeConstraintText}</textarea></div>
        <div class="card"><strong>实例化规则</strong><p>平台读取模型中的变量、目标函数结构和约束逻辑，再把这里的运行时参数注入模型，生成一次新的求解任务。</p><button class="btn primary" ${productionDisabledAttr()} onclick="submitRuntimeTemplateTask()">实例化并提交任务</button></div>
      </div>`;
    }

    function pageResults() {
      const r = state.lastResult;
      if (!r) {
        return shell('结果报告中心', '展示优化求解结果、业务解释、关键指标和风险提示。') +
          `<div class="empty-state" style="min-height:220px">
            <div class="empty-icon">📄</div>
            <strong>当前暂无可解释结果</strong>
            <p>可从任务调度中心打开已完成任务，或先运行一个演示场景。</p>
            <div><button class="btn primary" onclick="go('tasks')">前往任务调度</button></div>
          </div>`;
      }
      const metrics = r.metrics || {};
      const explanation = typeof r.business_explanation === 'string'
        ? r.business_explanation
        : (r.business_explanation?.summary || r.business_summary || '-');
      const title = r.model || r.scene || '优化结果';
      const chartData = safeChartData(r);
      return shell('结果报告中心', '展示优化求解结果、关键指标、业务解释与风险提示。', `<button class="btn" disabled title="后续开放" onclick="exportLastResultReport()">导出报告（后续开放）</button>`) +
        (isHydroResult(r) ? hydroResultHtml(r, {}) :
        `<div class="report-section">
          <div class="report-section-title">结果摘要</div>
          ${resultMetricCards(metrics)}
        </div>
        <div class="grid cols-2 mt">
          <div class="report-section">
            <div class="report-section-title">${escapeHtml(title)} 图表</div>
            ${chartData.labels.length ? chart(chartData.labels, chartData.values) : `<div class="empty-state"><div class="empty-icon">📈</div><strong>暂无可渲染图表数据</strong></div>`}
          </div>
          <div class="report-section">
            <div class="report-section-title">核心指标详情</div>
            ${metricsTable(metrics)}
          </div>
        </div>
        <div class="grid cols-2 mt">
          <div class="report-section">
            <div class="report-section-title">业务结果</div>
            ${businessResultHtml(r)}
          </div>
          <div class="report-section">
            <div class="report-section-title">业务解释与风险提示</div>
            <p>${escapeHtml(explanation)}</p>
            ${warningsHtml(r.diagnosis || r.warnings || [])}
          </div>
        </div>
        <details class="json-collapse mt"><summary>原始结果 JSON（调试用）</summary><pre>${escapeHtml(safeJson(r))}</pre></details>`);
    }

    function isHydroResult(result) {
      const output = result?.business_output || result?.solve_result?.business_output || result?.result?.business_output || {};
      const chartObj = result?.chart || result?.solve_result?.chart || result?.result?.chart || {};
      const code = result?.resolved_model_code || result?.model_code || result?.solve_result?.resolved_model_code || '';
      return code === 'cascade_hydro_dispatch'
        || Array.isArray(output.station_summary)
        || Array.isArray(output.system_curve)
        || Array.isArray(output.dispatch_detail)
        || Boolean(chartObj.total_hydro_power_MW);
    }

    function normalizedResult(result = {}) {
      const nested = result.solve_result || result.result || {};
      return {
        ...nested,
        ...result,
        metrics: result.metrics || nested.metrics || {},
        business_output: result.business_output || nested.business_output || {},
        business_explanation: result.business_explanation || nested.business_explanation || {},
        chart: result.chart || nested.chart || {},
        series: result.series || nested.series || []
      };
    }

    function resultMetricCards(metrics = {}) {
      const items = [
        ['目标函数值', metrics.objective_value ?? metrics.total_cost, '综合惩罚/成本'],
        ['总发电量', metrics.total_generation_MWh, 'MWh'],
        ['总弃水量', metrics.total_spill_volume_million_m3 ?? metrics.total_spill_million_m3, '百万m³'],
        ['负荷偏差合计', metrics.total_abs_load_deviation_MW, 'MW'],
        ['期末库容偏差', metrics.terminal_volume_deviation_sum_million_m3, '百万m³'],
        ['求解 Gap', metrics.gap, '最优性差距']
      ].filter(([, value]) => value !== undefined && value !== null && value !== '');
      if (!items.length) {
        return `<div class="empty-state"><div class="empty-icon">📊</div><strong>暂无核心指标</strong><p>求解完成后指标将显示在此处。</p></div>`;
      }
      return `<div class="report-kpi-grid">${items.map(([label, value, desc]) =>
        `<div class="report-kpi"><span>${escapeHtml(label)}<br>${escapeHtml(desc)}</span><b>${escapeHtml(formatDisplayValue(value))}</b></div>`
      ).join('')}</div>`;
    }

    function hydroResultHtml(result, task = {}) {
      const r = normalizedResult(result);
      const output = r.business_output || {};
      const metrics = r.metrics || output.metrics || {};
      const explanationObj = r.business_explanation || {};
      const summary = typeof explanationObj === 'string'
        ? explanationObj
        : (explanationObj.summary || r.business_summary || '梯级水电调度求解已完成，请结合下方出力、库容、弃水和负荷偏差结果复核。');
      const systemCurve = output.system_curve || r.system_curve || [];
      const stationSummary = output.station_summary || r.station_summary || [];
      const detail = output.dispatch_detail || r.dispatch_detail || r.series || [];
      return `<div class="result-view">
        <div class="grid cols-2">
          <div class="report-section">
            <div class="report-section-title">任务与求解状态</div>
            <table class="compact-table"><tr><th>任务ID</th><td>${escapeHtml(task.id || r.id || '-')}</td></tr><tr><th>模型</th><td>${escapeHtml(task.model || r.model || task.model_id || '-')}</td></tr><tr><th>场景</th><td>${escapeHtml(task.scene || r.scene || '梯级水电日前调度')}</td></tr><tr><th>状态</th><td>${pill(r.status || r.solve_status || task.status || '-')}</td></tr></table>
          </div>
          <div class="report-section">
            <div class="report-section-title">业务解释摘要</div>
            <p>${escapeHtml(summary)}</p>${hydroExplanationNotes(explanationObj)}
          </div>
        </div>
        <div class="report-section mt">
          <div class="report-section-title">核心指标</div>
          ${resultMetricCards(metrics)}
        </div>
        <div class="grid cols-2 mt">
          <div class="report-section">
            <div class="report-section-title">系统负荷跟踪曲线</div>
            ${hydroSystemCurveTable(systemCurve)}
          </div>
          <div class="report-section">
            <div class="report-section-title">分电站汇总</div>
            ${hydroStationSummaryTable(stationSummary)}
          </div>
        </div>
        <div class="report-section mt">
          <div class="report-section-title">分时段调度明细</div>
          ${hydroDispatchDetailTable(detail)}
        </div>
        <details class="json-collapse mt"><summary>原始结果 JSON（调试用）</summary><pre>${escapeHtml(safeJson(result))}</pre></details>
      </div>`;
    }

    function hydroExplanationNotes(explanation = {}) {
      if (!explanation || typeof explanation !== 'object') return '';
      const rows = [
        ['检修容量', explanation.maintenance],
        ['梯级时滞', explanation.cascade_delay],
        ['弃水提示', explanation.spill],
        ['调度建议', explanation.advisory]
      ].filter(([, value]) => value);
      if (!rows.length) return '';
      return `<table class="compact-table mt"><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>`;
    }

    function hydroSystemCurveTable(rows = []) {
      const limited = rows.slice(0, 24);
      if (!limited.length) return emptyState('暂无系统曲线数据');
      const html = `<table class="compact-table"><thead><tr><th>时段</th><th>负荷预测(MW)</th><th>水电总出力(MW)</th><th>负荷偏差(MW)</th></tr></thead><tbody>${limited.map(row => `<tr><td>${escapeHtml(row.time_index)}</td><td>${escapeHtml(formatDisplayValue(row.load_forecast_MW))}</td><td>${escapeHtml(formatDisplayValue(row.total_hydro_power_MW))}</td><td>${escapeHtml(formatDisplayValue(row.load_deviation_MW))}</td></tr>`).join('')}</tbody></table>`;
      return `<div class="table-scroll">${html}</div>${rows.length > limited.length ? `<p class="muted mt">仅展示前 ${limited.length} 个时段，共 ${rows.length} 个时段。</p>` : ''}`;
    }

    function hydroStationSummaryTable(rows = []) {
      if (!Array.isArray(rows) || !rows.length) return emptyState('暂无电站汇总数据');
      const html = `<table class="compact-table"><thead><tr><th>电站</th><th>发电量(MWh)</th><th>弃水量(百万m³)</th><th>期末库容(百万m³)</th><th>目标库容(百万m³)</th><th>库容偏差(百万m³)</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.station)}</td><td>${escapeHtml(formatDisplayValue(row.generation_MWh))}</td><td>${escapeHtml(formatDisplayValue(row.spill_volume_million_m3))}</td><td>${escapeHtml(formatDisplayValue(row.terminal_volume_million_m3))}</td><td>${escapeHtml(formatDisplayValue(row.target_terminal_volume_million_m3))}</td><td>${escapeHtml(formatDisplayValue(row.terminal_volume_deviation_million_m3))}</td></tr>`).join('')}</tbody></table>`;
      return `<div class="table-scroll">${html}</div>`;
    }

    function hydroDispatchDetailTable(rows = []) {
      if (!Array.isArray(rows) || !rows.length) return emptyState('暂无分时段调度明细');
      const limited = rows.slice(0, 36);
      const html = `<table class="compact-table"><thead><tr><th>时段</th><th>电站</th><th>电站出力(MW)</th><th>发电流量(m³/s)</th><th>弃水(m³/s)</th><th>下泄(m³/s)</th><th>期初库容</th><th>期末库容</th><th>全网负荷</th><th>水电总出力</th><th>偏差</th></tr></thead><tbody>${limited.map(row => `<tr><td>${escapeHtml(row.time_index)}</td><td>${escapeHtml(row.station)}</td><td>${escapeHtml(formatDisplayValue(row.station_power_MW))}</td><td>${escapeHtml(formatDisplayValue(row.q_gen_m3s))}</td><td>${escapeHtml(formatDisplayValue(row.q_spill_m3s))}</td><td>${escapeHtml(formatDisplayValue(row.q_out_m3s))}</td><td>${escapeHtml(formatDisplayValue(row.volume_start_million_m3))}</td><td>${escapeHtml(formatDisplayValue(row.volume_end_million_m3))}</td><td>${escapeHtml(formatDisplayValue(row.load_forecast_MW))}</td><td>${escapeHtml(formatDisplayValue(row.total_hydro_power_MW))}</td><td>${escapeHtml(formatDisplayValue(row.load_deviation_MW))}</td></tr>`).join('')}</tbody></table>`;
      return `<div class="table-scroll">${html}</div>${rows.length > limited.length ? `<p class="muted mt">仅展示前 ${limited.length} 行，共 ${rows.length} 行；完整数据可在原始 JSON 或导出报告中查看。</p>` : ''}`;
    }

    function metricsTable(metrics) {
      const entries = Object.entries(metrics || {});
      if (!entries.length) return emptyState('暂无指标数据');
      return `<table><thead><tr><th>指标</th><th>值</th></tr></thead><tbody>${entries.map(([k, v]) => `<tr><td>${escapeHtml(displayLabel(k))}</td><td>${escapeHtml(formatDisplayValue(v))}</td></tr>`).join('')}</tbody></table>`;
    }

    function businessResultHtml(r) {
      const output = r.business_output || {};
      if (output.charge_discharge_plan) {
        return `<p class="muted" style="font-size:13px;margin-bottom:10px">充放电计划 / SOC 变化</p>
          <div class="table-scroll">${arrayTable(output.charge_discharge_plan)}</div>
          <p class="muted" style="font-size:13px;margin:10px 0 6px">SOC 变化曲线</p>
          <div class="table-scroll">${arrayTable(output.soc_curve || [])}</div>
          <details class="json-collapse mt"><summary>收益测算 JSON</summary><pre>${escapeHtml(safeJson(output.revenue_assessment || { arbitrage_profit: output.arbitrage_profit }))}</pre></details>
          <details class="json-collapse mt"><summary>约束校核 JSON</summary><pre>${escapeHtml(safeJson(output.constraint_check || {}))}</pre></details>`;
      }
      if (output.unit_start_stop_plan) {
        return `<p class="muted" style="font-size:13px;margin-bottom:10px">机组启停计划</p>
          <div class="table-scroll">${arrayTable(output.unit_start_stop_plan)}</div>
          <p class="muted" style="font-size:13px;margin:10px 0 6px">出力计划与备用裕度</p>
          <div class="table-scroll">${arrayTable(output.unit_output_plan || output.reserve_margin || [])}</div>
          <details class="json-collapse mt"><summary>成本拆分 JSON</summary><pre>${escapeHtml(safeJson(output.cost_breakdown || {}))}</pre></details>`;
      }
      return `<details class="json-collapse" open><summary>业务输出 JSON</summary><pre>${escapeHtml(safeJson(output))}</pre></details>`;
    }

    function arrayTable(rows) {
      if (!Array.isArray(rows) || !rows.length) return emptyState('暂无明细数据');
      const headers = Object.keys(rows[0] || {});
      return `<table><thead><tr>${headers.map(h => `<th>${escapeHtml(displayLabel(h))}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${escapeHtml(formatDisplayValue(row[h]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }

    function pageCompare() {
      if (!state.backendOnline && !isDemoMode()) {
        return shell('方案对比分析', '默认使用真实模型结果、参数组和已归档求解结果。') + offlineStateHtml('真实对比结果');
      }
      const selected = selectedCompareCases();
      const skills = state.skills || [];
      if (!state.compareSkillName && skills[0]) state.compareSkillName = skills[0].skill_name;
      const succeeded = selected.filter(item => String(item.status || item.metrics?.status || '').toUpperCase() === 'SUCCESS');
      const bestItem = succeeded.length ? succeeded.slice().sort((a, b) => Number(a.metrics?.objective_value ?? Infinity) - Number(b.metrics?.objective_value ?? Infinity))[0] : null;
      const riskCount = state.compareCases.filter(item => item.metrics?.risk === '高' || item.status === 'FAILED').length;
      return shell('方案对比分析', '支持多模型、多参数组和求解结果的横向比较，快速定位最优方案与风险点。', `<button class="btn" onclick="addCompareScenario()">新建方案</button><button class="btn primary" ${productionDisabledAttr()} onclick="runAllCompareScenarios()">运行全部方案</button>`) +
      demoModeBanner() +
      `<div class="analysis-summary">
        <div class="analysis-summary-card"><span>方案总数</span><b>${state.compareCases.length}</b></div>
        <div class="analysis-summary-card"><span>已选对比</span><b>${selected.length}</b></div>
        <div class="analysis-summary-card best"><span>当前最优方案</span><b>${bestItem ? escapeHtml(bestItem.name) : '—'}</b></div>
        <div class="analysis-summary-card risk"><span>高风险方案</span><b>${riskCount}</b></div>
      </div>
      <div class="grid cols-2">
        ${panel('1. 对比对象选择', compareObjectPanel(skills))}
        ${panel('2. 情景方案配置', compareScenarioPanel())}
      </div>
      <div class="grid cols-2 mt">
        ${panel('3. 参数扰动配置', comparePerturbationPanel())}
        ${panel('4. 批量运行状态', compareRunPanel())}
      </div>
      <div class="mt">${panel('5. 指标对比', compareTable(selected))}</div>
      <div class="mt">${compareRecommendationCard(selected)}</div>`;
    }

    function selectedCompareCases() {
      return state.compareCases.filter(item => state.compare.includes(item.id));
    }

    function compareCaseSelector() {
      if (!state.compareCases.length) return emptyState('暂无可对比方案');
      return state.compareCases.map(item => `
        <label class="card" style="display:block;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" ${state.compare.includes(item.id) ? 'checked' : ''} onchange="toggleCompare('${item.id}', this.checked)" />
            <strong>${escapeHtml(item.name)}</strong>
            ${pill(item.status || '备选')}
          </div>
          <p class="muted">${escapeHtml(item.model || '-')} · ${escapeHtml(item.source || '-')}</p>
          <p>${escapeHtml(item.changes || '-')}</p>
        </label>`).join('');
    }

    function compareTable(items) {
      if (!items.length) {
        return `<div class="empty-state"><div class="empty-icon">📊</div><strong>暂无可对比方案</strong><p>请在左侧添加方案或运行已有方案后查看指标对比表。</p></div>`;
      }
      const succeeded = items.filter(item => String(item.status || item.metrics?.status || '').toUpperCase() === 'SUCCESS');
      const bestObj = succeeded.length ? Math.min(...succeeded.map(item => Number(item.metrics?.objective_value ?? Infinity))) : Infinity;
      const rows = items.map(item => {
        const objVal = Number(item.metrics?.objective_value ?? item.metrics?.objective ?? NaN);
        const isBest = Number.isFinite(objVal) && objVal === bestObj;
        const isFailed = ['FAILED','INFEASIBLE','TIMEOUT'].includes(String(item.status || '').toUpperCase());
        const rowClass = isBest ? 'compare-best-row' : (isFailed ? 'compare-risk-row' : '');
        const outputMetrics = item.output_metrics && Object.keys(item.output_metrics).length
          ? `<details class="json-collapse"><summary>展开输出指标</summary><pre>${escapeHtml(safeJson(item.output_metrics))}</pre></details>`
          : '<span class="muted">—</span>';
        return `<tr class="${rowClass}">
          <td><strong>${escapeHtml(item.name)}</strong>${isBest ? ' <span class="compare-card-badge" style="background:var(--soft-green);color:var(--success)">最优</span>' : ''}${isFailed ? ' <span class="risk-high">失败</span>' : ''}</td>
          <td>${pill(item.status || item.metrics?.status || '-')}</td>
          <td><strong>${escapeHtml(Number.isFinite(objVal) ? objVal.toFixed(4) : (item.metrics?.objective_value ?? item.metrics?.objective ?? '-'))}</strong></td>
          <td>${escapeHtml(relativeChangeText(item, items[0]))}</td>
          <td>${escapeHtml(item.metrics?.solve_time_seconds ?? item.metrics?.duration_seconds ?? '-')}s</td>
          <td class="cell-truncate" title="${escapeHtml(item.invocation_id || item.task_id || '-')}">${escapeHtml(item.invocation_id || item.task_id || '-')}</td>
          <td>${outputMetrics}</td>
        </tr>`;
      }).join('');
      return `<div class="table-scroll"><table class="sticky-table table-density-comfortable">
        <thead><tr><th>方案名称</th><th>状态</th><th>目标值</th><th>相对基准变化</th><th>求解耗时</th><th>编号</th><th>输出指标</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    }

    function compareRecommendation(items) {
      if (!items.length) return '暂无对比对象。';
      const succeeded = items.filter(item => String(item.status || item.metrics?.status || '').toUpperCase() === 'SUCCESS');
      if (!succeeded.length) return '当前方案尚无成功结果，请先运行全部方案或添加结果。';
      const best = succeeded.slice().sort((a, b) => Number(a.metrics?.objective_value ?? Infinity) - Number(b.metrics?.objective_value ?? Infinity))[0];
      return `当前目标值较优的方案是"${best.name}"，请结合业务约束、输出变量指标和运行耗时复核。`;
    }

    function compareRecommendationCard(items) {
      if (!items.length) {
        return `<div class="empty-state"><div class="empty-icon">💡</div><strong>暂无分析结论</strong><p>添加并运行方案后，此处将自动生成推荐方案与风险提示。</p></div>`;
      }
      const succeeded = items.filter(item => String(item.status || item.metrics?.status || '').toUpperCase() === 'SUCCESS');
      const failed = items.filter(item => ['FAILED','INFEASIBLE'].includes(String(item.status || '').toUpperCase()));
      const best = succeeded.length ? succeeded.slice().sort((a, b) => Number(a.metrics?.objective_value ?? Infinity) - Number(b.metrics?.objective_value ?? Infinity))[0] : null;
      const baseObj = Number(items[0]?.metrics?.objective_value ?? NaN);
      const bestObj = Number(best?.metrics?.objective_value ?? NaN);
      const changeText = best && Number.isFinite(baseObj) && Number.isFinite(bestObj) && baseObj !== 0
        ? `${(((bestObj - baseObj) / Math.abs(baseObj)) * 100).toFixed(2)}%`
        : '—';
      return `<div class="report-section">
        <div class="report-section-title">6. 对比分析结论</div>
        <div class="grid cols-2">
          <div>
            <div class="grid cols-2" style="gap:10px;margin-bottom:14px">
              <div class="stat-card green"><span>推荐方案</span><b>${best ? escapeHtml(best.name) : '—'}</b></div>
              <div class="stat-card blue"><span>目标值变化</span><b>${changeText}</b></div>
              <div class="stat-card red"><span>失败方案数</span><b>${failed.length}</b></div>
              <div class="stat-card amber"><span>成功方案数</span><b>${succeeded.length}</b></div>
            </div>
          </div>
          <div>
            ${best ? `<div class="card" style="border-color:rgba(18,128,92,.4);background:linear-gradient(180deg,#f2fff9,#e8f7f1)">
              <strong>推荐方案</strong>
              <p>当前目标值最优方案为 <strong>${escapeHtml(best.name)}</strong>，目标函数值 ${escapeHtml(String(best.metrics?.objective_value ?? '-'))}。</p>
              <p class="muted">请结合业务约束、输出变量指标和运行耗时进行人工复核后决策。</p>
            </div>` : '<p class="muted">暂无成功方案可推荐。</p>'}
            ${failed.length ? `<div class="card mt" style="border-color:rgba(194,65,50,.35);background:linear-gradient(180deg,#fff8f7,#fff0ee)">
              <strong>风险提示</strong>
              <p>有 ${failed.length} 个方案求解失败，建议检查约束边界合理性或调整扰动参数。</p>
              <p class="muted">失败方案：${failed.map(f => escapeHtml(f.name)).join('、')}</p>
            </div>` : ''}
          </div>
        </div>
        <p class="muted" style="margin-top:12px;font-size:13px">以上结论由系统依据目标值自动生成，仅供参考，最终决策请结合业务背景与人工判断。</p>
      </div>`;
    }

    function addLastResultToCompare() {
      if (!state.lastResult) {
        toast('暂无当前结果，请先运行一个求解或一键演示');
        return;
      }
      const metrics = state.lastResult.metrics || {};
      const id = `result_${Date.now()}`;
      const item = {
        id,
        name: `${state.lastResult.model || state.lastResult.scene || '优化结果'}-${state.compareCases.length + 1}`,
        model: state.lastResult.model || state.lastResult.scene || '当前模型',
        source: '求解结果',
        changes: '来自最近一次求解结果，可与基准、参数扰动、约束扰动方案横向比较',
        metrics: {
          objective: metrics.objective_value ?? metrics.total_cost ?? metrics.profit ?? 0,
          cost: metrics.total_cost ?? metrics.objective_value ?? 0,
          revenue: metrics.profit ?? 0,
          risk: metrics.risk || '低',
          feasible: state.lastResult.status === 'SUCCESS' || !state.lastResult.status ? '可行' : state.lastResult.status
        },
        status: '结果'
      };
      state.compareCases.unshift(item);
      state.compare.unshift(id);
      toast('当前结果已加入方案对比');
      render();
    }

    function compareObjectPanel(skills) {
      const skillOptions = (skills || []).map(s => `<option value="${escapeHtml(s.skill_name)}" ${state.compareSkillName === s.skill_name ? 'selected' : ''}>${escapeHtml(s.display_name || s.skill_name)}</option>`).join('');
      return `<div class="field"><label>对比对象类型</label><select onchange="state.compareObjectType=this.value;render()"><option value="model" ${state.compareObjectType === 'model' ? 'selected' : ''}>多模型结果对比</option><option value="service" ${state.compareObjectType === 'service' ? 'selected' : ''}>同一接口多参数对比</option></select></div>
      <div class="field"><label>选择模型服务接口</label><select onchange="state.compareSkillName=this.value;render()">${skillOptions || '<option value="">暂无模型服务接口</option>'}</select></div>
      <div class="actions mt"><button class="btn" onclick="addLastResultToCompare()">添加当前结果</button><button class="btn" onclick="importCompareJson()">导入 JSON</button></div>`;
    }

    function compareScenarioPanel() {
      if (!state.compareCases.length) {
        return `<div class="empty-state"><div class="empty-icon">📋</div><strong>暂无对比方案</strong><p>可新建方案、添加当前结果或导入 JSON 数组。</p><div><button class="btn primary" onclick="addCompareScenario()">新建方案</button></div></div>`;
      }
      const succeeded = new Set(state.compareCases.filter(item => String(item.status || '').toUpperCase() === 'SUCCESS').map(item => item.id));
      const minObj = Math.min(...state.compareCases.filter(item => succeeded.has(item.id)).map(item => Number(item.metrics?.objective_value ?? Infinity)));
      return `<div class="scenario-list">${state.compareCases.map((item, i) => {
        const isBest = succeeded.has(item.id) && Number(item.metrics?.objective_value ?? Infinity) === minObj;
        const isFailed = ['FAILED','INFEASIBLE'].includes(String(item.status || '').toUpperCase());
        return `<div class="compare-card ${state.compare.includes(item.id) ? 'selected' : ''} ${isBest ? 'best-plan' : ''}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <input type="checkbox" ${state.compare.includes(item.id) ? 'checked' : ''} onchange="toggleCompare('${item.id}', this.checked)" />
            <strong>${escapeHtml(item.name)}</strong>
            ${pill(item.status || 'draft')}
            ${isBest ? '<span class="compare-card-badge">最优</span>' : ''}
            ${isFailed ? '<span class="risk-high">失败</span>' : ''}
          </div>
          <p class="muted" style="font-size:12px;margin-bottom:6px">${escapeHtml(item.model || '-')} · ${escapeHtml(item.source || '-')}</p>
          ${item.metrics?.objective_value != null ? `<p style="font-size:13px;margin-bottom:6px">目标值：<strong>${escapeHtml(String(item.metrics.objective_value))}</strong></p>` : ''}
          <details class="json-collapse" style="margin-bottom:8px">
            <summary>参数 JSON</summary>
            <div style="padding:8px"><textarea style="width:100%;min-height:80px;font-family:Consolas,monospace;font-size:12px" onchange="updateCompareScenario(${i}, this.value)">${escapeHtml(safeJson(item.parameters || {}))}</textarea></div>
          </details>
          <div class="actions"><button class="btn" onclick="duplicateCompareScenario(${i})">复制</button><button class="btn" onclick="deleteCompareScenario(${i})">删除</button></div>
        </div>`;
      }).join('')}</div>`;
    }

    function comparePerturbationPanel() {
      const skill = (state.skills || []).find(s => s.skill_name === state.compareSkillName) || {};
      const fields = schemaFieldKeys(skill.input_schema || []);
      return `<div class="grid form-grid-compact">
        <div class="field"><label>字段</label><select id="comparePerturbField">${fields.map(f => `<option>${escapeHtml(f)}</option>`).join('') || '<option value="">暂无 input_schema 字段</option>'}</select></div>
        <div class="field"><label>扰动方式</label><select id="comparePerturbMode"><option>multiply</option><option>add</option><option>set</option><option>percent_up</option><option>percent_down</option><option>index_set</option></select></div>
        <div class="field"><label>扰动值</label><input id="comparePerturbValue" value="1.1" /></div>
        <div class="field"><label>输出指标聚合</label><select onchange="state.compareMetricReducer=this.value"><option>sum</option><option>avg</option><option>max</option><option>min</option><option>last</option><option>by_index</option></select></div>
      </div><div class="actions mt"><button class="btn" onclick="applyComparePerturbation()">应用到方案 A/B/C</button></div>`;
    }

    function compareRunPanel() {
      return `<table class="compact-table"><thead><tr><th>方案</th><th>状态</th><th>任务/结果编号</th><th>错误</th></tr></thead><tbody>${state.compareCases.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${pill(item.status || 'draft')}</td><td>${escapeHtml(item.invocation_id || item.task_id || '-')}</td><td>${escapeHtml(item.error || '-')}</td></tr>`).join('') || '<tr><td colspan="4">暂无方案。</td></tr>'}</tbody></table>`;
    }

    function schemaFieldKeys(schema) {
      if (Array.isArray(schema)) return schema.map(item => item.key || item.name || item.field).filter(Boolean);
      if (schema && typeof schema === 'object') return Object.keys(schema.properties || schema);
      return [];
    }

    function addCompareScenario() {
      const id = `scenario_${Date.now()}`;
      const name = state.compareCases.length ? `方案 ${String.fromCharCode(64 + state.compareCases.length)}` : '基准方案';
      state.compareCases.push({ id, name, status: 'draft', parameters: {}, metrics: {}, output_metrics: {} });
      state.compare.push(id);
      render();
    }

    function duplicateCompareScenario(i) {
      const source = state.compareCases[i];
      if (!source) return;
      const id = `scenario_${Date.now()}`;
      state.compareCases.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(source)), id, name: `${source.name} 副本`, status: 'draft', invocation_id: '', error: '' });
      state.compare.push(id);
      render();
    }

    function deleteCompareScenario(i) {
      const [removed] = state.compareCases.splice(i, 1);
      state.compare = state.compare.filter(id => id !== removed?.id);
      render();
    }

    function updateCompareScenario(i, text) {
      try {
        state.compareCases[i].parameters = JSON.parse(text || '{}');
      } catch (e) {
        toast(`参数 JSON 解析失败：${e.message}`);
      }
    }

    function applyComparePerturbation() {
      const field = document.getElementById('comparePerturbField')?.value;
      const mode = document.getElementById('comparePerturbMode')?.value;
      const raw = document.getElementById('comparePerturbValue')?.value;
      if (!field) return toast('请选择字段');
      state.compareCases.slice(1).forEach(item => {
        item.parameters = item.parameters || {};
        item.parameters[field] = applyPerturbValue(item.parameters[field], mode, raw);
        item.changes = `${field} ${mode} ${raw}`;
      });
      toast('扰动已应用到非基准方案');
      render();
    }

    function applyPerturbValue(current, mode, raw) {
      const value = Number(raw);
      if (mode === 'set') return Number.isNaN(value) ? raw : value;
      if (mode === 'index_set') return raw;
      const base = Number(current ?? 0);
      if (mode === 'multiply') return base * (Number.isNaN(value) ? 1 : value);
      if (mode === 'add') return base + (Number.isNaN(value) ? 0 : value);
      if (mode === 'percent_up') return base * (1 + (Number.isNaN(value) ? 0 : value) / 100);
      if (mode === 'percent_down') return base * (1 - (Number.isNaN(value) ? 0 : value) / 100);
      return current;
    }

    async function runAllCompareScenarios() {
      if (!state.compareSkillName) return toast('请选择模型服务接口');
      for (const item of state.compareCases) {
        item.status = 'RUNNING';
        item.error = '';
        render();
        try {
          const result = await apiFetch(`/skills/${encodeURIComponent(state.compareSkillName)}/run`, {
            method: 'POST',
            body: JSON.stringify({ parameters: item.parameters || {}, options: { mode: 'sync', explain: true } })
          });
          item.invocation_id = result.invocation_id || result.invocation?.invocation_id || '';
          item.status = result.status || result.invocation?.status || 'SUCCESS';
          const output = result.result || result.output || result.solve_result || result;
          const metrics = output.metrics || result.metrics || {};
          item.metrics = {
            status: item.status,
            objective_value: metrics.objective_value ?? metrics.total_cost ?? metrics.profit ?? result.objective_value ?? '-',
            solve_time_seconds: result.duration_seconds ?? result.solve_time_seconds ?? '-'
          };
          item.output_metrics = deriveOutputMetrics(output, state.compareMetricReducer);
        } catch (e) {
          item.status = 'FAILED';
          item.error = state.apiError || e.message;
        }
      }
      toast('方案批量运行完成');
      render();
    }

    function deriveOutputMetrics(output, reducer) {
      const values = output?.variable_values || output?.business_output?.variable_values || {};
      const result = {};
      Object.entries(values).slice(0, 8).forEach(([key, value]) => {
        const nums = flattenNumbers(value);
        if (!nums.length) return;
        if (reducer === 'avg') result[key] = nums.reduce((a, b) => a + b, 0) / nums.length;
        else if (reducer === 'max') result[key] = Math.max(...nums);
        else if (reducer === 'min') result[key] = Math.min(...nums);
        else if (reducer === 'last') result[key] = nums[nums.length - 1];
        else if (reducer === 'by_index') result[key] = value;
        else result[key] = nums.reduce((a, b) => a + b, 0);
      });
      return result;
    }

    function flattenNumbers(value) {
      if (typeof value === 'number') return [value];
      if (Array.isArray(value)) return value.flatMap(flattenNumbers);
      if (value && typeof value === 'object') return Object.values(value).flatMap(flattenNumbers);
      return [];
    }

    function relativeChangeText(item, baseline) {
      const base = Number(baseline?.metrics?.objective_value ?? baseline?.metrics?.objective);
      const current = Number(item?.metrics?.objective_value ?? item?.metrics?.objective);
      if (!Number.isFinite(base) || base === 0 || !Number.isFinite(current)) return '-';
      return `${(((current - base) / Math.abs(base)) * 100).toFixed(2)}%`;
    }

    function loadCompareDemoTemplate() {
      state.dataMode = 'demo';
      state.compareCases = defaultCompareCases().map((item, i) => ({
        ...item,
        status: i === 0 ? 'SUCCESS' : 'draft',
        parameters: {},
        metrics: { status: i === 0 ? 'SUCCESS' : 'draft', objective_value: item.metrics.objective, solve_time_seconds: '-' },
        output_metrics: {}
      }));
      state.compare = state.compareCases.map(item => item.id);
      toast('已加载经济调度敏感性分析演示模板，当前为演示数据');
      render();
    }

    function addCompareFromInvocation() {
      const item = (state.skillInvocations || [])[0];
      if (!item) return toast('暂无历史调用记录');
      const id = `inv_${Date.now()}`;
      state.compareCases.push({ id, name: `历史调用 ${item.invocation_id || id}`, status: item.status || 'SUCCESS', invocation_id: item.invocation_id, parameters: item.parameters || {}, metrics: { status: item.status, objective_value: item.objective_value ?? getPath(item, 'result.metrics.objective_value', '-'), solve_time_seconds: item.duration_seconds ?? '-' }, output_metrics: {} });
      state.compare.push(id);
      render();
    }

    function importCompareJson() {
      const text = prompt('请输入方案 JSON 数组或单个方案 JSON', '[]');
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        rows.forEach(row => {
          const id = row.id || `scenario_${Date.now()}_${Math.random().toString(16).slice(2)}`;
          state.compareCases.push({ id, name: row.name || '导入方案', status: row.status || 'draft', parameters: row.parameters || row, metrics: row.metrics || {}, output_metrics: row.output_metrics || {} });
          state.compare.push(id);
        });
        render();
      } catch (e) {
        toast(`导入失败：${e.message}`);
      }
    }

    function setInvocationPage(page) {
      const total = Math.max(1, Math.ceil((state.skillInvocations || []).length / Number(state.invocationPageSize || 10)));
      state.invocationPage = Math.min(total, Math.max(1, Number(page) || 1));
      render();
    }

    function setInvocationPageSize(size) {
      state.invocationPageSize = Number(size) || 10;
      state.invocationPage = 1;
      render();
    }

    function invocationLogHtml(records) {
      if (!Array.isArray(records) || !records.length) {
        return `<div class="empty-state"><div class="empty-icon">📋</div><strong>暂无调用记录</strong><p>发布模型后提交求解任务，调用记录将在此处显示。</p></div>`;
      }
      const pageSize = Number(state.invocationPageSize || 10);
      const total = records.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(totalPages, Math.max(1, Number(state.invocationPage || 1)));
      const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
      const pager = totalPages > 1 ? `<div class="actions" style="justify-content:flex-end;margin-top:10px">
        <span class="chip">共 ${total} 条</span>
        <button class="btn" onclick="setInvocationPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="chip">${page} / ${totalPages}</span>
        <button class="btn" onclick="setInvocationPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>` : `<p class="muted" style="font-size:13px;margin-top:6px">共 ${total} 条记录</p>`;
      return `<div class="table-scroll"><table class="sticky-table table-density-comfortable">
        <thead><tr><th>调用时间</th><th>调用编号</th><th>接口名称</th><th>绑定模型</th><th>调用来源</th><th>状态</th><th>目标值</th><th>耗时</th><th class="ops-col">操作</th></tr></thead>
        <tbody>${pageRecords.map(item => `<tr>
          <td class="cell-truncate" title="${escapeHtml(item.created_at || item.started_at || '-')}">${escapeHtml(item.created_at || item.started_at || '-')}</td>
          <td class="cell-truncate" title="${escapeHtml(item.invocation_id || '-')}">${escapeHtml(item.invocation_id || '-')}</td>
          <td class="cell-truncate" title="${escapeHtml(item.skill_name || '-')}">${escapeHtml(item.skill_name || '-')}</td>
          <td>${escapeHtml(item.model_name || item.model_id || '-')}<br><span class="muted">${escapeHtml(item.model_version || '-')}</span></td>
          <td>${escapeHtml(item.caller || item.source || '接口调用')}</td>
          <td>${pill(item.status || '-')}</td>
          <td>${escapeHtml(item.objective_value ?? getPath(item, 'result.metrics.objective_value', '-'))}</td>
          <td>${escapeHtml(item.duration_seconds ?? item.solve_time_seconds ?? '-')}s</td>
          <td class="ops-col"><button class="btn" onclick="openInvocationDetail('${escapeHtml(item.invocation_id || '')}')">详情</button></td>
        </tr>`).join('')}</tbody>
      </table></div>${pager}`;
    }

    function pageIntegration() {
      return shell('接口状态配置', '对接生产实时库、调度交易、EAM、燃料供应链和数据中台，实现数据输入、任务调用与结果回写。', `<button class="btn primary" disabled title="后续开放">新增接口</button>`) +
      panel('接口清单', `<table><thead><tr><th>接口</th><th>类型</th><th>状态</th><th>延迟</th><th>操作</th></tr></thead><tbody>${state.apis.map((a, i) => `<tr><td>${a.name}</td><td>${a.type}</td><td>${pill(a.status)}</td><td>${a.latency}</td><td><button class="btn" onclick="testApi(${i})">测试</button></td></tr>`).join('')}</tbody></table>`) +
      `<div class="grid cols-3 mt"><div class="card"><strong>统一调用API</strong><p>POST /optimize/tasks</p></div><div class="card"><strong>状态查询API</strong><p>GET /optimize/tasks/{id}</p></div><div class="card"><strong>结果回写API</strong><p>POST /optimize/results/callback</p></div></div>`;
    }

    function pageOps() {
      return shell('系统配置', '面向集团级部署提供权限、租户、算力、日志审计、告警和版本发布配置。', `<button class="btn primary" disabled title="后续开放">保存配置</button>`) +
      `<div class="grid cols-3">
        ${panel('资源水位', `<div class="field"><label>CPU使用率 62%</label><div class="progress"><div style="width:62%"></div></div></div><div class="field"><label>内存使用率 71%</label><div class="progress"><div style="width:71%"></div></div></div><div class="field"><label>HiGHS 任务并发 1/4</label><div class="progress"><div style="width:25%"></div></div></div>`)}
        ${panel('权限策略', `<div class="chips"><span class="chip">集团管理员</span><span class="chip">业务负责人</span><span class="chip">建模工程师</span><span class="chip">调度用户</span><span class="chip">审计只读</span></div>`)}
        ${panel('告警规则', `<label class="card" style="display:block;margin-bottom:8px"><input type="checkbox" checked /> 求解超时告警</label><label class="card" style="display:block;margin-bottom:8px"><input type="checkbox" checked /> 无解任务告警</label><label class="card" style="display:block"><input type="checkbox" /> 许可证到期预警</label>`)}
      </div>
      <div class="mt">${panel('审计日志', `<table><tr><th>时间</th><th>用户</th><th>动作</th><th>对象</th></tr><tr><td>2026-04-29 11:20</td><td>调度员A</td><td>提交求解</td><td>水风光储协同优化</td></tr><tr><td>2026-04-29 11:12</td><td>建模工程师B</td><td>发布约束组件</td><td>储能SOC约束包</td></tr><tr><td>2026-04-29 10:58</td><td>管理员</td><td>调整并发</td><td>HiGHS 运行队列</td></tr></table>`)}</div>
      <div class="mt">${panel('高级调试', `<details><summary>连接与示例数据</summary><div class="grid cols-2 mt"><div class="field"><label>API 地址</label><input value="${escapeHtml(state.apiBase)}" onchange="setApiBase(this.value)" /></div><div class="actions"><button class="btn" onclick="setApiBase('http://127.0.0.1:8000/api')">连接 8000</button><button class="btn" onclick="setApiBase('http://127.0.0.1:8090/api')">连接 8090</button><button class="btn" onclick="checkBackend()">自动探测</button><button class="btn" onclick="enterDemoMode()">进入演示模式</button><button class="btn" onclick="installPowerTemplateDemoDock()">打开本地演示面板</button></div></div><p class="muted">演示模式仅用于本地展示，不代表真实资产。</p></details>`)}</div>`;
    }

    function taskSolveResultHtml(task, result) {
      if (isHydroResult(result)) return hydroResultHtml(result, task);
      const normalized = normalizedResult(result);
      const metrics = normalized.metrics || {};
      const objective = normalized.objective_value ?? metrics.objective_value ?? metrics.total_cost ?? getPath(normalized, 'result.objective_value', '-');
      const status = normalized.status || normalized.solve_status || metrics.status || task.status || '-';
      const variables = normalized.variable_values || normalized.variables || getPath(normalized, 'result.variable_values', {}) || {};
      const constraints = normalized.constraint_status || normalized.constraint_satisfaction || normalized.constraints || getPath(normalized, 'result.constraint_status', {});
      return `<div class="grid cols-2">
        ${panel('任务基本信息', `<table class="compact-table"><tr><th>任务ID</th><td>${escapeHtml(task.id || '-')}</td></tr><tr><th>模型</th><td>${escapeHtml(task.model || task.model_id || '-')}</td></tr><tr><th>场景</th><td>${escapeHtml(task.scene || '-')}</td></tr><tr><th>状态</th><td>${pill(status)}</td></tr></table>`)}
        ${panel('求解摘要', `<table class="compact-table"><tr><th>目标函数值</th><td>${escapeHtml(objective)}</td></tr><tr><th>求解状态</th><td>${pill(status)}</td></tr></table>`)}
      </div>
      <div class="grid cols-2 mt">
        ${panel('关键变量表', `<div class="table-scroll">${keyValueTableHtml(variables)}</div>`)}
        ${panel('约束满足情况', `<div class="table-scroll">${keyValueTableHtml(constraints)}</div>`)}
      </div>
      <details class="mt"><summary>原始结果 JSON（调试用）</summary><pre>${escapeHtml(safeJson(result))}</pre></details>`;
    }

    function pageSkillAssets() {
      const skills = state.skills || [];
      if (!state.backendOnline && !isDemoMode()) {
        return shell('模型服务接口', '默认仅展示后端真实模型服务接口和调用记录。', `<button class="btn" onclick="refreshSkills()">刷新清单</button><button class="btn" onclick="refreshInvocations()">刷新调用记录</button>`) + offlineStateHtml('真实模型服务接口与调用记录');
      }
      const invocations = state.skillInvocations || [];
      const todayInvocations = invocations.filter(r => {
        const d = r.created_at || r.started_at || '';
        return d.startsWith(new Date().toISOString().slice(0, 10));
      });
      const failedInvocations = invocations.filter(r => ['FAILED','INFEASIBLE','TIMEOUT'].includes(String(r.status || '').toUpperCase()));
      const onlineSkills = skills.filter(s => !['disabled','deprecated','offline'].includes(s.skill_status || s.status));
      return shell('模型服务接口', '模型发布后的服务化调用配置，负责输入输出契约、任务提交和结果回写。', `<button class="btn" onclick="refreshSkills()">刷新清单</button><button class="btn" onclick="refreshInvocations()">刷新调用记录</button>`) +
        demoModeBanner() +
        `<div class="stat-bar">
          <div class="stat-card blue"><span>接口总数</span><b>${skills.length}</b></div>
          <div class="stat-card green"><span>在线接口</span><b>${onlineSkills.length}</b></div>
          <div class="stat-card amber"><span>今日调用</span><b>${todayInvocations.length}</b></div>
          <div class="stat-card red"><span>失败调用</span><b>${failedInvocations.length}</b></div>
        </div>
        ${panel('执行策略', skillExecutionPolicyCards(skills))}
        <div class="mt">${skillInterfaceListShell(skills)}</div>
        <div class="mt">${invocationListShell(invocations)}</div>`;
    }

    function skillInterfaceListShell(skills) {
      const rows = skillAssetRows(skills);
      return `<div class="list-shell">
        <div class="list-toolbar">
          <div class="list-summary">
            <span class="chip">接口清单</span>
            <span class="chip">共 ${skills.length} 个</span>
          </div>
          <div class="actions">
            <button class="btn" onclick="refreshSkills()">刷新</button>
          </div>
        </div>
        <div class="list-body">
          <div class="table-scroll">
            <table class="sticky-table table-density-comfortable">
              <thead>
                <tr>
                  <th style="min-width:140px">接口名称</th>
                  <th>接口编码</th>
                  <th>绑定模型</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>调用次数</th>
                  <th>最近调用时间</th>
                  <th class="ops-col">操作</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    }

    function invocationListShell(records) {
      return `<div class="list-shell">
        <div class="list-toolbar">
          <div class="list-summary">
            <span class="chip">调用记录</span>
            <span class="chip">共 ${(records || []).length} 条</span>
          </div>
          <div class="actions">
            <select onchange="toast('筛选状态：'+this.value)"><option value="">全部状态</option><option>SUCCESS</option><option>FAILED</option><option>RUNNING</option></select>
            <select style="width:88px" onchange="setInvocationPageSize(this.value)">
              <option value="10" ${(state.invocationPageSize||10)===10 ? 'selected' : ''}>10条</option>
              <option value="20" ${(state.invocationPageSize||10)===20 ? 'selected' : ''}>20条</option>
              <option value="50" ${(state.invocationPageSize||10)===50 ? 'selected' : ''}>50条</option>
            </select>
            <button class="btn" onclick="refreshInvocations()">刷新</button>
          </div>
        </div>
        <div class="list-body">
          <div class="table-scroll">
            ${invocationTableHtml(records)}
          </div>
        </div>
        ${invocationPagerHtml(records)}
      </div>`;
    }

    function invocationTableHtml(records) {
      if (!Array.isArray(records) || !records.length) {
        return `<div class="empty-state"><div class="empty-icon">📋</div><strong>暂无调用记录</strong><p>发布模型并通过任务调度中心提交求解后，调用记录将出现在这里。</p></div>`;
      }
      const pageSize = Number(state.invocationPageSize || 10);
      const total = records.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(totalPages, Math.max(1, Number(state.invocationPage || 1)));
      const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
      return `<table class="sticky-table table-density-comfortable">
        <thead>
          <tr>
            <th>调用时间</th>
            <th>调用编号</th>
            <th>接口名称</th>
            <th>绑定模型</th>
            <th>调用来源</th>
            <th>状态</th>
            <th>目标值</th>
            <th>耗时</th>
            <th class="ops-col">操作</th>
          </tr>
        </thead>
        <tbody>
          ${pageRecords.map(item => `<tr>
            <td class="cell-truncate" title="${escapeHtml(item.created_at || item.started_at || '-')}">${escapeHtml(item.created_at || item.started_at || '-')}</td>
            <td class="cell-truncate" title="${escapeHtml(item.invocation_id || '-')}">${escapeHtml(item.invocation_id || '-')}</td>
            <td class="cell-truncate" title="${escapeHtml(item.skill_name || '-')}">${escapeHtml(item.skill_name || '-')}</td>
            <td>${escapeHtml(item.model_name || item.model_id || '-')}<br><span class="muted">${escapeHtml(item.model_version || '-')}</span></td>
            <td>${escapeHtml(item.caller || item.source || '接口调用')}</td>
            <td>${pill(item.status || '-')}</td>
            <td>${escapeHtml(item.objective_value ?? getPath(item, 'result.metrics.objective_value', '-'))}</td>
            <td>${escapeHtml(item.duration_seconds ?? item.solve_time_seconds ?? '-')}s</td>
            <td class="ops-col"><button class="btn" onclick="openInvocationDetail('${escapeHtml(item.invocation_id || '')}')">详情</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }

    function invocationPagerHtml(records) {
      const pageSize = Number(state.invocationPageSize || 10);
      const total = (records || []).length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(totalPages, Math.max(1, Number(state.invocationPage || 1)));
      if (totalPages <= 1) return '';
      return `<div class="list-footer">
        <button class="btn" onclick="setInvocationPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="chip">${page} / ${totalPages}</span>
        <button class="btn" onclick="setInvocationPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>`;
    }

    function skillExecutionPolicyCards(skills) {
      const allowedCallers = [...new Set((skills || []).flatMap(s => s.allowed_callers || s.allowedCallers || ['api', 'service_console']))].map(callerLabel);
      return `<div class="grid cols-4">
        <div class="card"><strong>仅提供决策建议</strong><p>${(skills || []).filter(s => (s.execution_policy || 'advisory_only') === 'advisory_only').length} 个接口</p></div>
        <div class="card"><strong>需要人工确认</strong><p>${(skills || []).filter(s => s.requires_human_review).length} 个接口</p></div>
        <div class="card"><strong>允许异步调用</strong><p>${(skills || []).filter(s => s.allow_async || s.allowed_modes?.includes?.('async')).length} 个接口</p></div>
        <div class="card"><strong>允许调用方</strong><p>${escapeHtml(allowedCallers.join(', ') || '-')}</p></div>
      </div>`;
    }

    function modelInterfaceServiceStatusPanel() {
      const health = state.modelInterfaceServiceHealth || {};
      const llm = health.llm || {};
      const capabilities = Array.isArray(health.capabilities) ? health.capabilities : [];
      return `<div class="grid cols-2">
        <div class="panel">
          <div class="panel-title"><span>接口服务状态</span>${pill(state.modelInterfaceServiceOnline ? 'online' : 'offline')}</div>
          <div class="field"><label>MODEL_API_BASE_URL</label><input value="${escapeHtml(modelInterfaceApiBase())}" onchange="setModelInterfaceApiBase(this.value)" /></div>
          <table class="compact-table">
            <tr><th>检查地址</th><td>${escapeHtml(modelInterfaceHealthUrl())}</td></tr>
            <tr><th>service</th><td>${escapeHtml(health.service || '-')}</td></tr>
            <tr><th>服务提供方</th><td>${escapeHtml(llm.provider || '-')}</td></tr>
            <tr><th>增强能力</th><td>${pill(Boolean(llm.enabled))}</td></tr>
            <tr><th>API key configured</th><td>${pill(Boolean(llm.api_key_configured))}</td></tr>
            <tr><th>最近检查时间</th><td>${escapeHtml(state.modelInterfaceServiceCheckedAt || '-')}</td></tr>
            <tr><th>延迟</th><td>${state.modelInterfaceServiceLatency == null ? '-' : `${state.modelInterfaceServiceLatency} ms`}</td></tr>
          </table>
          <div class="actions mt"><button class="btn primary" onclick="checkModelInterfaceServiceStatus()">测试接口</button></div>
        </div>
        <div class="panel">
          <div class="panel-title"><span>接口能力</span><span class="pill blue">${capabilities.length}</span></div>
          ${capabilities.length ? `<div class="chips">${capabilities.map(item => `<span class="chip">${escapeHtml(item)}</span>`).join('')}</div>` : emptyState('尚未获取接口能力')}
          <div class="mt"><pre>${escapeHtml(safeJson(health))}</pre></div>
        </div>
      </div>`;
    }

    function pageIntegrationEnhanced() {
      return shell('接口状态配置', '对接生产实时库、调度交易、EAM、燃料供应链和数据中台，只展示接口状态。', `<button class="btn" onclick="checkModelInterfaceServiceStatus()">测试接口</button><button class="btn primary" disabled title="后续开放">新增接口</button>`) +
      `${modelInterfaceServiceStatusPanel()}
      <div class="mt">${panel('接口清单', `<table><thead><tr><th>接口</th><th>类型</th><th>状态</th><th>延迟</th><th>操作</th></tr></thead><tbody>${state.apis.map((a, i) => `<tr><td>${a.name}</td><td>${a.type}</td><td>${pill(a.status)}</td><td>${a.latency}</td><td><button class="btn" onclick="testApi(${i})">测试</button></td></tr>`).join('')}</tbody></table>`)}</div>
      <div class="grid cols-3 mt"><div class="card"><strong>统一调用API</strong><p>POST /optimize/tasks</p></div><div class="card"><strong>状态查询API</strong><p>GET /optimize/tasks/{id}</p></div><div class="card"><strong>结果回写API</strong><p>POST /optimize/results/callback</p></div></div>`;
    }

