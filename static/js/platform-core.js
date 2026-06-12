// Core constants, default data, shared rendering helpers.
    const menus = [
      ['dashboard', '总览驾驶舱', '▦'],
      ['domains', '业务场景库', '▤'],
      ['builder', '模型创建', '▧'],
      ['assets', '模型资产中心', '▥'],
      ['components', '组件库管理', '▩'],
      ['solver', '求解运行环境', '◫'],
      ['tasks', '任务调度中心', '◷'],
      ['results', '结果报告库', '▨'],
      ['skills', '模型服务接口', '⚡'],
      ['compare', '方案对比分析', '≋'],
      ['ops', '系统配置', '⚙']
    ];

    // Legacy domain list (kept for asset modal only)
    const domainNames = ['日前机组组合优化', '经济负荷分配', '储能充放电优化', '风光储协同优化', '梯级水电日前调度', '热电协同优化', '电力市场交易', '碳排放优化'];

    // Normalized name map for legacy data migration
    const SCENARIO_NAME_MAP = {
      '日前机组组合': '日前机组组合优化',
      '储能调度': '储能充放电优化',
      '热电协同': '热电协同优化',
      '电热协同优化': '热电协同优化',
      '风光储协同': '风光储协同优化',
      '水电调度': '梯级水电日前调度'
    };

    const SCENARIO_CATALOG_KEY = 'opti_platform_scenario_catalog';

    const defaultScenarioCatalog = [
      {
        id: 'unit_commitment',
        name: '日前机组组合优化',
        description: '面向日前机组启停、出力和备用安排的 MILP 优化模型。',
        status: 'published',
        models: [
          { id: 'unit_commitment_day_ahead', name: '日前机组组合优化模型', type: 'MILP', status: 'published', objective: 'total_cost_min', builderMode: 'generic_linear' }
        ]
      },
      {
        id: 'economic_dispatch',
        name: '经济负荷分配',
        description: '在机组在线状态已知时，按成本和约束分配各机组出力。',
        status: 'published',
        models: [
          { id: 'economic_dispatch_model', name: '经济负荷分配模型', type: 'LP', status: 'published', objective: 'total_cost_min', builderMode: 'generic_linear' }
        ]
      },
      {
        id: 'storage_dispatch',
        name: '储能充放电优化',
        description: '面向电价、SOC、容量和并网限制的储能充放电计划优化。',
        status: 'published',
        models: [
          { id: 'storage_dispatch_model', name: '储能充放电优化模型', type: 'LP', status: 'published', objective: 'cost_min', builderMode: 'generic_linear' }
        ]
      },
      {
        id: 'renewable_storage_dispatch',
        name: '风光储协同优化',
        description: '面向新能源消纳、储能协同和并网约束的联合调度优化。',
        status: 'published',
        models: [
          { id: 'renewable_storage_dispatch_model', name: '风光储协同优化模型', type: 'LP', status: 'published', objective: 'curtailment_min', builderMode: 'generic_linear' }
        ]
      },
      {
        id: 'cascade_hydro_dispatch',
        name: '梯级水电日前调度',
        description: '面向多级水电站日前调度，考虑梯级拓扑、水流传播时滞、水库水量平衡、机组检修、弃水和负荷跟踪。',
        status: 'trial',
        models: [
          { id: 'cascade_hydro_dispatch_model', name: '梯级水电日前调度优化模型', type: 'LP / MILP', status: 'trial', objective: 'dispatch_cost_min', builderMode: 'component_based', templateCode: 'cascade_hydro_dispatch' }
        ]
      },
      {
        id: 'thermal_power_coupling',
        name: '热电协同优化',
        description: '面向热电联产机组、电负荷、热负荷和可运行区的协同优化。',
        status: 'published',
        models: [
          { id: 'thermal_power_coupling_model', name: '热电协同优化模型', type: 'LP / MILP', status: 'published', objective: 'total_cost_min', builderMode: 'generic_linear' }
        ]
      },
      {
        id: 'market_trading',
        name: '电力市场交易',
        description: '面向市场报价、交易计划和约束条件的优化分析。',
        status: 'draft',
        models: []
      },
      {
        id: 'carbon_optimization',
        name: '碳排放优化',
        description: '面向碳排放约束、成本和发电计划的协同优化。',
        status: 'draft',
        models: []
      }
    ];

    function normalizeScenarioName(name) {
      return SCENARIO_NAME_MAP[name] || name;
    }

    function migrateScenarioCatalog(list) {
      const result = [];
      const seen = new Map();
      list.forEach(item => {
        const name = normalizeScenarioName(item.name || '');
        if (!name) return;
        const entry = { ...item, name };
        delete entry.domain;
        if (seen.has(name)) {
          const existing = seen.get(name);
          if (Array.isArray(item.models) && item.models.length) {
            const existingIds = new Set((existing.models || []).map(m => m.id || m.name));
            item.models.forEach(m => {
              if (!existingIds.has(m.id || m.name)) {
                existing.models = existing.models || [];
                existing.models.push(m);
                existingIds.add(m.id || m.name);
              }
            });
          }
        } else {
          seen.set(name, entry);
          result.push(entry);
        }
      });
      defaultScenarioCatalog.forEach(def => {
        if (!seen.has(def.name)) result.push(def);
      });
      return result;
    }

    function getScenarioCatalog() {
      try {
        const saved = localStorage.getItem(SCENARIO_CATALOG_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length) return migrateScenarioCatalog(parsed);
        }
      } catch (e) {}
      return defaultScenarioCatalog.slice();
    }

    function saveScenarioCatalog(list) {
      try { localStorage.setItem(SCENARIO_CATALOG_KEY, JSON.stringify(list)); } catch (e) {}
    }

    function addScenario(payload) {
      const catalog = getScenarioCatalog();
      const name = (payload.name || '').trim();
      if (!name) throw new Error('场景名称不能为空。');
      if (catalog.some(s => s.name === name)) throw new Error(`场景名称"${name}"已存在，请使用其他名称。`);
      const newScenario = {
        id: payload.id || ('custom_' + Date.now()),
        name,
        description: (payload.description || '').trim(),
        status: payload.status || 'draft',
        models: Array.isArray(payload.models) ? payload.models : []
      };
      catalog.push(newScenario);
      saveScenarioCatalog(catalog);
      return newScenario;
    }

    // Extra V2 models merged into 风光储协同优化 (not standalone scene)
    const _V2_MODELS = [
      { name: '光储一体化调度 V2', code: 'pv_storage_dispatch_v2', builderMode: 'component_based', templateCode: 'pv_storage_dispatch_v2', type: 'MILP', target: '收益成本综合优化', status: '试运行', gap: '0.00%', desc: '光储一体化组件化调度模板。' },
      { name: '光储协同日前调度 V2', code: 'pv_storage_day_ahead_dispatch_v2', builderMode: 'component_based', templateCode: 'pv_storage_day_ahead_dispatch_v2', type: 'MILP', target: '日前计划跟踪与偏差考核', status: '试运行', gap: '0.00%', desc: '光储日前计划跟踪与偏差考核模板。' },
      { name: '光储协同日内滚动调度 V2', code: 'pv_storage_intraday_dispatch_v2', builderMode: 'component_based', templateCode: 'pv_storage_intraday_dispatch_v2', type: 'MILP', target: '日内滚动修正与 SOC 传递', status: '试运行', gap: '0.00%', desc: '光储日内滚动修正模板。' }
    ];

    const _STATUS_LABEL = { published: '已发布', trial: '试运行', draft: '草稿', developing: '开发中' };

    const SCENARIO_MODEL_META = {
      unit_commitment_day_ahead: {
        problemType: 'MILP',
        paradigmSummary: 'MILP / 机组组合',
        objectiveSummary: '总成本最小，包含燃料成本、启停成本、备用约束等',
        setSummary: '机组集合、调度时段集合'
      },
      economic_dispatch_model: {
        problemType: 'LP',
        paradigmSummary: 'LP / 经济调度',
        objectiveSummary: '发电成本最小，按机组边际成本分配出力',
        setSummary: '机组集合、调度时段集合'
      },
      storage_dispatch_model: {
        problemType: 'LP / MILP',
        paradigmSummary: '储能调度优化',
        objectiveSummary: '充放电收益最大或成本最小，考虑 SOC 边界',
        setSummary: '储能集合、调度时段集合'
      },
      renewable_storage_dispatch_model: {
        problemType: 'LP / MILP',
        paradigmSummary: '新能源消纳与储能协同',
        objectiveSummary: '弃电最小、储能收益最大或总成本最小',
        setSummary: '新能源场站集合、储能集合、调度时段集合'
      },
      cascade_hydro_dispatch_model: {
        problemType: 'LP / MILP',
        paradigmSummary: 'LP / MILP，梯级水电调度优化',
        objectiveSummary: '负荷跟踪偏差、弃水惩罚、期末库容偏差等',
        setSummary: '水库/电站集合、调度时段集合、河段拓扑'
      },
      thermal_power_coupling_model: {
        problemType: 'LP / MILP',
        paradigmSummary: '热电联产协同优化',
        objectiveSummary: '电热总成本最小，兼顾电负荷和热负荷',
        setSummary: '热电机组集合、调度时段集合'
      }
    };

    function scenarioModelMetaFor(scene, model) {
      const byId = SCENARIO_MODEL_META[model?.id] || SCENARIO_MODEL_META[model?.code];
      if (byId) return byId;
      const modelName = `${model?.name || ''} ${scene?.name || ''}`;
      if (modelName.includes('Unit Commitment') || modelName.includes('机组组合')) return SCENARIO_MODEL_META.unit_commitment_day_ahead;
      if (modelName.includes('Economic Dispatch') || modelName.includes('经济')) return SCENARIO_MODEL_META.economic_dispatch_model;
      if (modelName.includes('Storage Dispatch') || modelName.includes('储能')) return SCENARIO_MODEL_META.storage_dispatch_model;
      if (modelName.includes('Renewable') || modelName.includes('风光储') || modelName.includes('新能源')) return SCENARIO_MODEL_META.renewable_storage_dispatch_model;
      if (modelName.includes('梯级水电') || modelName.includes('水电')) return SCENARIO_MODEL_META.cascade_hydro_dispatch_model;
      if (modelName.includes('热电') || modelName.includes('CHP')) return SCENARIO_MODEL_META.thermal_power_coupling_model;
      return {};
    }

    function scenarioModelCatalog() {
      const catalog = getScenarioCatalog();
      const result = catalog.map(scene => {
        const models = (scene.models || []).map(m => ({
          ...scenarioModelMetaFor(scene, m),
          name: m.name,
          code: m.id || m.code || '',
          builderMode: m.builderMode || 'generic_linear',
          templateCode: m.templateCode || m.code || '',
          type: m.type || 'LP/MILP',
          target: m.objective || '用户自定义',
          status: _STATUS_LABEL[m.status] || m.status || '试运行',
          gap: m.gap || '0.00%',
          desc: m.description || m.desc || scene.description || '',
          problemType: m.problemType || m.problem_type || scenarioModelMetaFor(scene, m).problemType || m.type || '',
          paradigmSummary: m.paradigmSummary || m.paradigm_summary || scenarioModelMetaFor(scene, m).paradigmSummary || '',
          objectiveSummary: m.objectiveSummary || m.objective_summary || scenarioModelMetaFor(scene, m).objectiveSummary || '',
          setSummary: m.setSummary || m.set_summary || scenarioModelMetaFor(scene, m).setSummary || ''
        }));
        // Merge V2 models into 风光储协同优化
        if (scene.name === '风光储协同优化') {
          _V2_MODELS.forEach(m => {
            if (!models.some(em => em.name === m.name)) models.push(m);
          });
        }
        return {
          name: scene.name,
          desc: scene.description || scene.desc || '',
          status: _STATUS_LABEL[scene.status] || scene.status || '试运行',
          models
        };
      });
      // Always append generic builder scene (not in main catalog tabs)
      result.push({
        name: '通用线性/MILP建模',
        desc: '从语义层扩展自定义变量、约束和目标函数，由平台编译为 Pyomo 模型并调用求解器。',
        status: '试运行',
        models: [
          { name: '自定义通用MILP模型', code: 'custom_optimization_model', builderMode: 'generic_linear', type: 'LP/MILP', target: '用户自定义', status: '试运行', gap: '0.00%', desc: '从空白语义和公式结构创建通用线性/MILP模型。' }
        ]
      });
      return result;
    }
    const models = [
      { name: '水风光储协同优化', domain: '水风光储', type: 'MILP', status: '已发布', use: 126, gap: '0.10%' },
      { name: '火电机组组合优化', domain: '机组组合', type: 'MILP', status: '试运行', use: 58, gap: '0.20%' },
      { name: '燃煤采购与库存优化', domain: '燃料供应', type: 'LP/MILP', status: '开发中', use: 31, gap: '0.30%' },
      { name: '检修窗口滚动排程', domain: '检修计划', type: 'CP/MILP', status: '已发布', use: 73, gap: '0.15%' },
      { name: '应急资源调拨优化', domain: '应急调度', type: '网络流/MILP', status: '试运行', use: 24, gap: '0.50%' },
      { name: '运行人员排班优化', domain: '人员排班', type: 'MILP/启发式', status: '开发中', use: 19, gap: '1.00%' }
    ];

    function defaultSavedModels() {
      return [
        { id: '', name: '日前水风光储MILP精确模型', scene: '水风光储协同优化', version: 'v1.3', status: '已发布', caller: '调度交易系统' },
        { id: '', name: '日内滚动快速修正模型', scene: '水风光储协同优化', version: 'v0.9', status: '试运行', caller: '调度辅助服务' },
        { id: '', name: '日前机组组合MILP模型', scene: '火电机组组合优化', version: 'v1.1', status: '试运行', caller: '生产计划系统' }
      ];
    }

    const state = {
      page: 'dashboard',
      apiBase: resolveApiBase(),
      backendOnline: false,
      apiError: '',
      dataMode: localStorage.getItem('power-or-data-mode') === 'demo' ? 'demo' : 'api',
      solverHealth: { solver: 'HiGHS', pyomoInstalled: null, highspyInstalled: null, checked: false },
      templates: [],
      skills: [],
      skillInvocations: [],
      invocationPage: 1,
      invocationPageSize: 10,
      demoRunning: false,
      reportExporting: false,
      lastResult: null,
      runtimeTemplateId: '',
      runtimeParametersText: defaultRuntimeParametersText(),
      runtimeObjectiveText: defaultRuntimeObjectiveText(),
      runtimeConstraintText: defaultRuntimeConstraintText(),
      activeDomain: '日前机组组合优化',
      activeModel: '日前机组组合优化 Unit Commitment',
      expandedScene: '',
      managedScene: '',
      sceneManageTab: '基础信息',
      assetCategory: '场景模板',
      selectedAssetName: '',
      builderStep: 0,
      selectedGenericRule: 0,
      selectedBasicConstraint: 0,
      mappedFields: 6,
      mappingBindings: defaultMappingBindings(),
      ruleConfigs: defaultRuleConfigs(),
      objective: '成本最小',
      builderPriority: '安全约束不可放松',
      builderPenalty: '弃电:100 / 越限:300 / 延误:50',
      builderExplainTemplate: '调度计划解释',
      builderSecondaryObjective: '新能源消纳优先',
      useGenericBuilder: true,
      builderMode: 'generic_linear',
      advancedMode: false,
      genericBuilderMode: 'indexed',
      genericSense: 'minimize',
      semanticSpecText: defaultSemanticSpecText(),
      modelDraft: {},
      componentRegistry: [],
      componentFilters: { domain: '全部', category: '全部', status: '全部', problemType: '全部' },
      componentSearch: '',
      componentPage: 1,
      componentPageSize: 8,
      componentDetailOpen: false,
      componentDetailTab: '基础信息',
      selectedComponentId: '',
      componentEditor: { active: false, mode: 'create', component: null, validationResult: null },
      componentSpecText: '{}',
      componentBuilder: {
        selectedScenario: 'cascade_hydro_dispatch',
        components: [],
        selectedComponentType: null,
        pendingComponentType: '',
        componentSpecExpanded: false,
        additionalConstraintsEnabled: false,
        additionalConstraints: [],
        componentSpecText: '{}',
        runtimeParametersText: '{}',
        validationMessages: []
      },
      editingSetCode: '',
      semanticSetFormDraft: null,
      semanticValidationResult: { errors: [], warnings: [], infos: [] },
      genericVariablesText: defaultGenericVariablesText(),
      genericConstraintsText: defaultGenericConstraintsText(),
      genericObjectiveText: defaultGenericObjectiveText(),
      genericSetsText: defaultGenericSetsText(),
      genericParametersText: defaultGenericParametersText(),
      genericIndexedVariablesText: defaultGenericIndexedVariablesText(),
      genericIndexedConstraintsText: defaultGenericIndexedConstraintsText(),
      genericIndexedObjectiveText: defaultGenericIndexedObjectiveText(),
      modelReady: false,
      customAssets: emptyCustomAssets(),
      recentSavedModel: '',
      savedModels: [],
      taskPage: 1,
      taskPageSize: 8,
      filterDomain: '全部',
      search: '',
      modalType: '',
      solverMode: '均衡模式',
      solverBackend: 'HiGHS',
      openSolver: 'HiGHS',
      solverGap: 0.1,
      timeLimit: 300,
      concurrency: 4,
      constraints: [
        { name: '外送通道容量约束', on: true, tag: '通用' },
        { name: '水库水位上下限', on: true, tag: '水电' },
        { name: '振动区规避', on: true, tag: '水电' },
        { name: '水流时滞', on: false, tag: '水电' },
        { name: '储能SOC安全区间', on: true, tag: '储能' },
        { name: '储能禁止同时充放', on: true, tag: '储能' },
        { name: '旋转备用要求', on: false, tag: '调度' },
        { name: '弃水弃风弃光惩罚', on: true, tag: '目标' }
      ],
      genericConstraints: [
        { name: '资源容量上限', on: true, tag: '通用' },
        { name: '供需平衡约束', on: true, tag: '通用' },
        { name: '时序连续性约束', on: true, tag: '通用' },
        { name: '互斥逻辑约束', on: true, tag: '通用' },
        { name: '安全边界约束', on: true, tag: '安全' },
        { name: '库存/库容边界', on: true, tag: '资源' },
        { name: '计划窗口约束', on: false, tag: '排程' },
        { name: '惩罚成本项', on: true, tag: '目标' }
      ],
      tasks: [],
      compareCases: [],
      compare: [],
      compareObjectType: 'model',
      compareSkillName: '',
      compareMetricReducer: 'sum',
      componentEditorTab: '基础信息',
      formulaEditor: null,
      apis: [
        { name: '数据中台-生产实时库', type: 'API', status: '在线', latency: '120ms' },
        { name: 'EAM检修工单系统', type: 'API', status: '在线', latency: '180ms' },
        { name: '燃料供应链系统', type: '批量文件', status: '待配置', latency: '-' },
        { name: '调度交易系统', type: '消息队列', status: '在线', latency: '95ms' },
      ]
    };

    const HYDRO_SEMANTIC_OBJECTS = [
      ['梯级电站', 'station', '参与联合调度的水电站', 'S1、S2、S3'],
      ['机组', 'unit', '每座电站下属发电机组', 'S1_U1、S1_U2'],
      ['调度时段', 'time', '日前调度时间点', '96个15分钟点'],
      ['库容时点', 'time_volume', '库容状态时点，比调度时段多一个终点', '0...96'],
      ['上下游边', 'edge', '梯级拓扑关系', 'S1->S2']
    ];

    const HYDRO_INPUT_PARAMETERS = [
      ['本地来水', 'local_inflow', '各电站各时段天然入库或区间来水', 'station,time', '每座电站、每个调度时段', 'm³/s；S1:[420,...]'],
      ['负荷预测', 'load_forecast', '系统要求水电跟踪的负荷曲线', 'time', '每个调度时段', 'MW；[380,420,...]'],
      ['机组可用状态', 'availability', '机组是否可用，1可用，0检修', 'unit,time', '每台机组、每个调度时段', '0/1；[1,0,...]'],
      ['梯级拓扑', 'edges', '上下游电站关系和传播时滞', 'edge', '上游、下游、delay', 'S1->S2 delay=1'],
      ['库容上下限', 'volume_min / volume_max', '水库安全运行边界', 'station', '每座电站', '百万m³'],
      ['出力转换系数', 'power_conversion', '发电流量折算为电站出力的线性系数', 'station', '每座电站', 'MW/(m³/s)']
    ];

    const HYDRO_OUTPUT_VARIABLES = [
      ['电站出力', 'station_power', '每座电站各时段发电功率', 'station,time', '每座电站、每个调度时段', 'MW'],
      ['发电流量', 'q_gen', '用于发电的过机流量', 'station,time', '每座电站、每个调度时段', 'm³/s'],
      ['弃水流量', 'q_spill', '未用于发电的弃水流量', 'station,time', '每座电站、每个调度时段', 'm³/s'],
      ['下泄流量', 'q_out', '发电流量与弃水流量之和', 'station,time', '每座电站、每个调度时段', 'm³/s'],
      ['库容', 'volume', '水库库容过程', 'station,time_volume', '每座电站、每个库容状态点', '百万m³']
    ];

    const HYDRO_CONSTRAINT_RELATIONS = [
      ['初始状态', '初始库容约束', 'V[s,0] = initial_volume[s]', 'hydro_initial_volume'],
      ['边界约束', '库容上下限', 'volume_min[s] ≤ V[s,t] ≤ volume_max[s]', 'hydro_volume_bounds'],
      ['容量约束', '检修可用出力', 'P[s,t] ≤ Σ unit_pmax[u] × availability[u,t]', 'hydro_station_available_capacity'],
      ['转换关系', '出力-流量转换', 'P[s,t] = k[s] × Qgen[s,t]', 'hydro_power_flow_conversion'],
      ['平衡关系', '下泄流量平衡', 'Qout[s,t] = Qgen[s,t] + Qspill[s,t]', 'hydro_outflow_balance'],
      ['边界约束', '下泄边界', 'outflow_min[s] ≤ Qout[s,t] ≤ outflow_max[s]', 'hydro_outflow_bounds'],
      ['边界约束', '弃水上限', 'Qspill[s,t] ≤ spill_max[s]', 'hydro_spill_bounds'],
      ['梯级关系', '传播时滞入库', 'Inflow[down,t] = LocalInflow[down,t] + Qout[up,t-delay]', 'hydro_cascade_inflow_delay'],
      ['状态递推', '水库水量平衡', 'V[s,t+1] = V[s,t] + (Inflow[s,t] - Qout[s,t]) × Δt', 'hydro_reservoir_balance'],
      ['负荷平衡', '负荷跟踪', 'ΣP[s,t] + dev_pos[t] - dev_neg[t] = Load[t]', 'hydro_load_tracking'],
      ['终端约束', '期末库容控制', 'V[s,T] - Vtarget[s] = terminal_dev_pos[s] - terminal_dev_neg[s]', 'hydro_terminal_volume'],
      ['平滑约束', '出力平滑', 'ramp_abs[s,t] ≥ |P[s,t] - P[s,t-1]|', 'hydro_ramp_smoothing']
    ];

    const HYDRO_OBJECTIVE_WEIGHTS = [
      ['负荷偏差权重', 'load_deviation', 1000, '优先满足负荷曲线', 'runtime_parameters.weights'],
      ['弃水权重', 'spill', 1, '尽量减少弃水', 'runtime_parameters.weights'],
      ['出力平滑权重', 'ramp', 0.1, '减少出力波动', 'runtime_parameters.weights'],
      ['期末库容权重', 'terminal_volume', 500, '控制期末库容接近目标', 'runtime_parameters.weights']
    ];

    function defaultMappingBindings() {
      return [
        { object: '资源对象', system: '设备主数据', field: '站点/机组/场站编码', status: '已绑定', scope: '主设备、储能、通道' },
        { object: '时序需求', system: '生产实时库', field: '负荷/预测时序', status: '已绑定', scope: '日前96点、日内滚动' },
        { object: '约束边界', system: '规则参数库', field: '容量/上下限/窗口', status: '已绑定', scope: '安全边界、资源边界' },
        { object: '成本收益', system: '经营指标库', field: '成本/收益/惩罚系数', status: '已绑定', scope: '运行成本、弃电惩罚' },
        { object: '拓扑关系', system: '资源拓扑台账', field: '上下游/线路/归属关系', status: '已绑定', scope: '水系、电网、物流网络' },
        { object: '安全阈值', system: '安全生产规则库', field: '越限阈值/禁区/告警线', status: '已绑定', scope: '硬约束、软约束' },
        { object: '计划窗口', system: '计划管理系统', field: '日内/周/月窗口', status: '待绑定', scope: '检修、采购、排班窗口' },
        { object: '初始状态', system: '生产实时库', field: 'SOC/库存/启停状态', status: '待绑定', scope: '滚动优化初值' }
      ];
    }

    function defaultCompareCases() {
      return [
        {
          id: 'baseline',
          name: '基准方案',
          model: '当前业务模型',
          source: '示例参数',
          changes: '采用模板默认预测、默认资源边界和默认约束',
          metrics: { objective: 126.0, cost: 126.0, revenue: 0, risk: '中', feasible: '可行' },
          status: '基准'
        },
        {
          id: 'resource_flex',
          name: '资源弹性方案',
          model: '当前业务模型',
          source: '参数扰动',
          changes: '提高可调资源容量或放宽部分运行边界',
          metrics: { objective: 118.6, cost: 118.6, revenue: 8.4, risk: '低', feasible: '可行' },
          status: '推荐'
        },
        {
          id: 'strict_security',
          name: '严格安全方案',
          model: '当前业务模型',
          source: '约束扰动',
          changes: '提高备用、SOC、安全裕度等硬约束要求',
          metrics: { objective: 132.5, cost: 132.5, revenue: -6.5, risk: '低', feasible: '可行' },
          status: '备选'
        },
        {
          id: 'stress_forecast',
          name: '预测压力方案',
          model: '当前业务模型',
          source: '预测扰动',
          changes: '提高负荷峰值或降低新能源预测，验证方案鲁棒性',
          metrics: { objective: 141.2, cost: 141.2, revenue: -15.2, risk: '高', feasible: '可行' },
          status: '压力测试'
        }
      ];
    }

    function defaultDemoTasks() {
      return [
        { id: 'DEMO-OPT-001', scene: '日前机组组合演示', model: '日前机组组合MILP模型', solver: 'HiGHS', status: 'SUCCESS', progress: 100, gap: '0.10%', cost: 118.6, risk: '低' },
        { id: 'DEMO-OPT-002', scene: '储能调度演示', model: '储能充放电优化 Storage Dispatch', solver: 'HiGHS', status: 'PENDING', progress: 15, gap: '-', cost: 0, risk: '中' }
      ];
    }

    function defaultRuleConfigs() {
      return [
        { scope: '全业务域', granularity: '时段', level: '硬约束', trigger: '资源上限生效', penalty: '0', note: '控制机组、库容、库存等资源上限。' },
        { scope: '全业务域', granularity: '时段', level: '硬约束', trigger: '供需差额不允许', penalty: '0', note: '保证生产、库存、运输、排班等供需平衡。' },
        { scope: '全业务域', granularity: '时序', level: '硬约束', trigger: '相邻时段自动关联', penalty: '0', note: '用于SOC、水位、库存、班次延续。' },
        { scope: '生产/储能/排班', granularity: '时段', level: '硬约束', trigger: '冲突状态不可并存', penalty: '0', note: '处理启停、充放电、岗位冲突。' },
        { scope: '安全生产', granularity: '时段', level: '硬约束', trigger: '越限即阻断', penalty: '500', note: '控制安全阈值、禁区、红线。' },
        { scope: '库存/仓储/能源', granularity: '时段', level: '硬约束', trigger: '库存或库容生效', penalty: '200', note: '控制库存、仓容、储能容量。' },
        { scope: '检修/物流/排班', granularity: '窗口', level: '软约束', trigger: '窗口不足触发惩罚', penalty: '120', note: '可按窗口占用和冲突进行惩罚。' },
        { scope: '目标层', granularity: '聚合', level: '软约束', trigger: '惩罚项进入目标函数', penalty: '100', note: '将越限、延误、弃电作为软惩罚项。' }
      ];
    }

    function defaultGenericVariablesText() {
      return JSON.stringify([
        { name: 'unit_output', indices: ['unit', 'time'], domain: 'NonNegativeReals', lb: 0 },
        { name: 'unit_on', indices: ['unit', 'time'], domain: 'Binary' },
        { name: 'unit_startup', indices: ['unit', 'time'], domain: 'Binary' }
      ], null, 2);
    }

    function defaultGenericConstraintsText() {
      return JSON.stringify([
        { name: 'power_balance', foreach: ['time'], terms: [{ var: 'unit_output', foreach: ['unit'], key: ['unit', 'time'], coef: 1 }], sense: '>=', rhs_param: 'load_forecast', rhs_key: ['time'] },
        { name: 'reserve_margin', foreach: ['time'], terms: [{ var: 'unit_on', foreach: ['unit'], key: ['unit', 'time'], coef_param: 'unit_max_output', param_key: ['unit'] }], sense: '>=', rhs_param: 'load_with_reserve', rhs_key: ['time'] }
      ], null, 2);
    }

    function defaultGenericObjectiveText() {
      return JSON.stringify({
        terms: [
          { var: 'unit_output', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'fuel_cost', param_key: ['unit'] },
          { var: 'unit_startup', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'startup_cost', param_key: ['unit'] }
        ],
        constant: 0
      }, null, 2);
    }

    function defaultSemanticSpecText() {
      return JSON.stringify({
        model_code: 'unit_commitment_day_ahead',
        industry: '电力',
        scenario: '日前机组组合优化 Unit Commitment',
        business_objects: [
          { key: 'thermal_unit', name: '火电机组', dimension: 'unit', unit: '台', source_system: '设备台账/EAM' },
          { key: 'dispatch_time', name: '调度时段', dimension: 'time', unit: '小时', source_system: '调度计划系统' },
          { key: 'system_load', name: '系统负荷', dimension: 'time', unit: 'MW', source_system: '时序预测模型' },
          { key: 'renewable_power', name: '新能源出力', dimension: 'site,time', unit: 'MW', source_system: '新能源预测系统' }
        ],
        sets: [
          { key: 'unit', name: '机组集合', values: ['U1', 'U2', 'U3'], business_object: 'thermal_unit', description: '参与调度的火电机组' },
          { key: 'time', name: '调度时段集合', values: Array.from({ length: 24 }, (_, i) => i), business_object: 'dispatch_time', description: '日前 24 个小时' }
        ],
        parameters: [
          { key: 'load_forecast', name: '负荷预测', math_param: 'load_forecast', unit: 'MW', dimension: ['time'], source_system: '时序预测模型', runtime_injected: true, validation: { type: 'array', length_ref: 'horizon', min: 0 }, meaning: '各时段系统负荷需求' },
          { key: 'renewable_forecast', name: '新能源出力预测', math_param: 'renewable_forecast', unit: 'MW', dimension: ['time'], source_system: '新能源预测系统', runtime_injected: true, validation: { type: 'array', length_ref: 'horizon', min: 0 }, meaning: '各时段风光可用出力' },
          { key: 'initial_unit_status', name: '机组初始开停机状态', math_param: 'initial_unit_status', unit: '0/1', dimension: ['unit'], source_system: '实时运行系统', runtime_injected: true, validation: { type: 'dict' }, meaning: '求解起点各机组在线状态' },
          { key: 'unit_min_output', name: '机组最小出力', math_param: 'unit_min_output', unit: 'MW', dimension: ['unit'], source_system: '设备台账', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '机组在线时最小稳定出力' },
          { key: 'unit_max_output', name: '机组最大出力', math_param: 'unit_max_output', unit: 'MW', dimension: ['unit'], source_system: '设备台账', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '机组最大可发功率' },
          { key: 'ramp_up_limit', name: '上爬坡限制', math_param: 'ramp_up_limit', unit: 'MW/h', dimension: ['unit'], source_system: '设备参数库', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '相邻时段出力最大上升幅度' },
          { key: 'ramp_down_limit', name: '下爬坡限制', math_param: 'ramp_down_limit', unit: 'MW/h', dimension: ['unit'], source_system: '设备参数库', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '相邻时段出力最大下降幅度' },
          { key: 'fuel_cost', name: '燃料成本', math_param: 'fuel_cost', unit: '元/MWh', dimension: ['unit'], source_system: '燃料/经营系统', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '机组单位发电燃料成本' },
          { key: 'startup_cost', name: '启动成本', math_param: 'startup_cost', unit: '元/次', dimension: ['unit'], source_system: '经营指标库', runtime_injected: false, validation: { type: 'dict', min: 0 }, meaning: '机组启动一次的成本' }
        ],
        variables: [
          { key: 'unit_output', name: '机组出力', math_var: 'unit_output', unit: 'MW', dimension: ['unit', 'time'], domain: '连续变量' },
          { key: 'unit_on', name: '机组开停机状态', math_var: 'unit_on', unit: '0/1', dimension: ['unit', 'time'], domain: '二进制变量' },
          { key: 'unit_startup', name: '机组启动状态', math_var: 'unit_startup', unit: '0/1', dimension: ['unit', 'time'], domain: '二进制变量' }
        ],
        constraints: [
          { code: 'power_balance', name: '功率平衡约束', description: '总供给必须满足负荷需求', type: 'balance', scenarios: ['unit_commitment_day_ahead'], hard: true, relaxable: false, math_expression: 'sum(unit_output[unit,time]) + renewable_forecast[time] >= load_forecast[time]' },
          { code: 'unit_output_bound', name: '机组出力上下限约束', description: '机组在线时出力需位于上下限之间', type: 'bound', scenarios: ['unit_commitment_day_ahead'], hard: true, relaxable: false, math_expression: 'unit_min_output[unit]*unit_on[unit,time] <= unit_output[unit,time] <= unit_max_output[unit]*unit_on[unit,time]' },
          { code: 'startup_logic', name: '启动逻辑约束', description: '机组由停机变在线时启动变量为1', type: 'logic', scenarios: ['unit_commitment_day_ahead'], hard: true, relaxable: false, math_expression: 'unit_startup[unit,time] >= unit_on[unit,time] - unit_on[unit,time-1]' },
          { code: 'ramp_limit', name: '机组爬坡约束', description: '相邻时段出力变化不得超过爬坡限制', type: 'temporal', scenarios: ['unit_commitment_day_ahead'], hard: true, relaxable: true, math_expression: '-ramp_down_limit <= unit_output[t]-unit_output[t-1] <= ramp_up_limit' }
        ],
        objectives: [
          { code: 'total_cost_min', name: '总成本最小', sense: 'minimize', weights: ['fuel_cost_weight', 'startup_cost_weight', 'carbon_cost_weight'], business_meaning: '最小化燃料成本、启动成本和碳成本' },
          { code: 'carbon_emission_min', name: '碳排放最小', sense: 'minimize', weights: ['carbon_cost_weight'], business_meaning: '降低高排放机组出力' }
        ],
        objective: { code: 'total_cost_min', name: '总成本最小', business_goal: '满足负荷、备用和机组运行约束下最小化总运行成本' },
        mapping: { business_to_math: '业务对象/参数通过 math_param、math_var、math_constraint 映射为 Pyomo 集合、参数、变量和约束', solver_layer: 'Pyomo ConcreteModel -> HiGHS SolverAdapter' }
      }, null, 2);
    }

    function defaultGenericSetsText() {
      return JSON.stringify({
        unit: ['U1', 'U2', 'U3'],
        time: Array.from({ length: 24 }, (_, i) => i)
      }, null, 2);
    }

    function defaultGenericParametersText() {
      return JSON.stringify({
        unit_min_output: { U1: 50, U2: 30, U3: 20 },
        unit_max_output: { U1: 180, U2: 120, U3: 80 },
        fuel_cost: { U1: 280, U2: 330, U3: 420 },
        startup_cost: { U1: 6000, U2: 3500, U3: 1500 },
        ramp_up_limit: { U1: 80, U2: 60, U3: 40 },
        ramp_down_limit: { U1: 80, U2: 60, U3: 40 },
        reserve_ratio: 0.1,
        load_forecast: [210,205,198,196,200,215,240,268,290,305,318,325,330,322,315,310,326,350,372,360,330,300,265,235],
        renewable_forecast: [35,36,38,40,45,52,68,82,96,110,118,120,116,108,96,82,70,58,48,42,40,38,36,35],
        load_with_reserve: [231,225.5,217.8,215.6,220,236.5,264,294.8,319,335.5,349.8,357.5,363,354.2,346.5,341,358.6,385,409.2,396,363,330,291.5,258.5]
      }, null, 2);
    }

    function defaultGenericIndexedVariablesText() {
      return JSON.stringify([
        { name: 'unit_output', indices: ['unit', 'time'], domain: 'NonNegativeReals', lb: 0 },
        { name: 'unit_on', indices: ['unit', 'time'], domain: 'Binary' },
        { name: 'unit_startup', indices: ['unit', 'time'], domain: 'Binary' }
      ], null, 2);
    }

    function defaultGenericIndexedConstraintsText() {
      return JSON.stringify([
        { name: 'power_balance', foreach: ['time'], terms: [{ var: 'unit_output', foreach: ['unit'], key: ['unit', 'time'], coef: 1 }], sense: '>=', rhs_param: 'load_forecast', rhs_key: ['time'] },
        { name: 'reserve_margin', foreach: ['time'], terms: [{ var: 'unit_on', foreach: ['unit'], key: ['unit', 'time'], coef_param: 'unit_max_output', param_key: ['unit'] }], sense: '>=', rhs_param: 'load_with_reserve', rhs_key: ['time'] }
      ], null, 2);
    }

    function defaultGenericIndexedObjectiveText() {
      return JSON.stringify({
        terms: [
          { var: 'unit_output', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'fuel_cost', param_key: ['unit'] },
          { var: 'unit_startup', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'startup_cost', param_key: ['unit'] }
        ],
        constant: 0
      }, null, 2);
    }

    function defaultRuntimeParametersText() {
      return JSON.stringify({
        load_forecast: [210,205,198,196,200,215,240,268,290,305,318,325,330,322,315,310,326,350,372,360,330,300,265,235],
        renewable_forecast: [35,36,38,40,45,52,68,82,96,110,118,120,116,108,96,82,70,58,48,42,40,38,36,35],
        initial_unit_status: { U1: 1, U2: 0, U3: 0 },
        initial_unit_output: { U1: 90, U2: 0, U3: 0 }
      }, null, 2);
    }

    function defaultRuntimeObjectiveText() {
      return JSON.stringify({
        sense: 'maximize'
      }, null, 2);
    }

    function defaultRuntimeConstraintText() {
      return JSON.stringify({}, null, 2);
    }

    function makeSemanticSpec({ modelCode, scenario, objects = [], parameters = [], variables = [], constraints = [], objectiveCode = 'total_cost_min', objectiveName = '总成本最小', sense = 'minimize' }) {
      return {
        model_code: modelCode,
        industry: '电力',
        scenario,
        business_objects: objects,
        objects,
        sets: [],
        parameters,
        variables,
        constraints,
        objectives: [
          { code: objectiveCode, name: objectiveName, sense, weights: ['fuel_cost_weight', 'startup_cost_weight', 'carbon_cost_weight', 'curtailment_weight'], business_meaning: objectiveName }
        ],
        objective: { code: objectiveCode, name: objectiveName, business_goal: objectiveName },
        mapping: { business_to_math: '业务对象、参数、变量和规则映射为 Pyomo 集合、参数、变量、目标和约束', solver_layer: 'Pyomo ConcreteModel -> HiGHS SolverAdapter' }
      };
    }

    function blankModelPreset(name = '自定义空白优化模型') {
      const semantic = {
        model_code: 'custom_optimization_model',
        scenario: name,
        objects: [],
        business_objects: [],
        sets: [],
        parameters: [],
        variables: [],
        constraints: [],
        objectives: [
          {
            code: 'custom_objective',
            name: '用户自定义目标',
            sense: 'minimize',
            business_goal: '用户自定义优化目标'
          }
        ],
        objective: { code: 'custom_objective', name: '用户自定义目标', business_goal: '用户自定义优化目标' },
        mapping: {
          business_to_math: '语义层对象映射为 Pyomo 集合、参数、变量、目标函数和约束',
          solver_layer: 'Pyomo ConcreteModel -> HiGHS SolverAdapter'
        }
      };
      return {
        scene: '自定义模型',
        model: name,
        modelCode: 'custom_optimization_model',
        objectiveCode: 'custom_objective',
        sense: 'minimize',
        sets: {},
        parameters: {},
        variables: [],
        constraints: [],
        objective: { terms: [], constant: 0 },
        runtimeParameters: {},
        semantic
      };
    }

    function modelPreset(scene, model) {
      const sceneName = scene || state.activeDomain;
      const modelName = model || state.activeModel;
      if (modelName.includes('Unit Commitment') || sceneName === '日前机组组合优化') {
        return {
          scene: '日前机组组合优化',
          model: '日前机组组合优化 Unit Commitment',
          modelCode: 'unit_commitment_day_ahead',
          objectiveCode: 'total_cost_min',
          sense: 'minimize',
          sets: JSON.parse(defaultGenericSetsText()),
          parameters: JSON.parse(defaultGenericParametersText()),
          variables: JSON.parse(defaultGenericIndexedVariablesText()),
          constraints: JSON.parse(defaultGenericIndexedConstraintsText()),
          objective: JSON.parse(defaultGenericIndexedObjectiveText()),
          runtimeParameters: JSON.parse(defaultRuntimeParametersText()),
          semantic: JSON.parse(defaultSemanticSpecText())
        };
      }
      if (modelName.includes('Economic Dispatch') || sceneName === '经济负荷分配') {
        const sets = { unit: ['U1', 'U2', 'U3'], time: Array.from({ length: 24 }, (_, i) => i) };
        const parameters = {
          load_forecast: [210,205,198,196,200,215,240,268,290,305,318,325,330,322,315,310,326,350,372,360,330,300,265,235],
          unit_min_output: { U1: 50, U2: 30, U3: 20 },
          unit_max_output: { U1: 180, U2: 120, U3: 80 },
          fuel_cost: { U1: 280, U2: 330, U3: 420 },
          ramp_up_limit: { U1: 80, U2: 60, U3: 40 },
          ramp_down_limit: { U1: 80, U2: 60, U3: 40 },
          initial_unit_output: { U1: 90, U2: 60, U3: 30 }
        };
        const variables = [{ name: 'unit_output', indices: ['unit', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'unit_max_output' }];
        const constraints = [
          { name: 'power_balance', foreach: ['time'], terms: [{ var: 'unit_output', foreach: ['unit'], key: ['unit', 'time'], coef: 1 }], sense: '>=', rhs_param: 'load_forecast', rhs_key: ['time'] },
          { name: 'unit_output_bound', foreach: ['unit', 'time'], terms: [{ var: 'unit_output', key: ['unit', 'time'], coef: 1 }], sense: '<=', rhs_param: 'unit_max_output', rhs_key: ['unit'] },
          { name: 'ramp_limit', foreach: ['unit', 'time'], terms: [{ var: 'unit_output', key: ['unit', 'time'], coef: 1 }], sense: '<=', rhs_param: 'ramp_up_limit', rhs_key: ['unit'] }
        ];
        return {
          scene: '经济负荷分配',
          model: '经济负荷分配 Economic Dispatch',
          modelCode: 'economic_dispatch',
          objectiveCode: 'total_cost_min',
          sense: 'minimize',
          sets, parameters, variables, constraints,
          objective: { terms: [{ var: 'unit_output', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'fuel_cost', param_key: ['unit'] }], constant: 0 },
          runtimeParameters: { load_forecast: parameters.load_forecast, initial_unit_output: parameters.initial_unit_output },
          semantic: makeSemanticSpec({
            modelCode: 'economic_dispatch',
            scenario: '经济负荷分配 Economic Dispatch',
            objectiveCode: 'total_cost_min',
            objectiveName: '发电成本最小',
            objects: [
              { key: 'thermal_unit', name: '火电机组', dimension: 'unit', unit: '台', source_system: '设备台账/EAM' },
              { key: 'dispatch_time', name: '调度时段', dimension: 'time', unit: '小时', source_system: '调度计划系统' }
            ],
            parameters: [
              { key: 'load_forecast', name: '负荷预测', math_param: 'load_forecast', unit: 'MW', dimension: ['time'], source_system: '时序预测模型', runtime_injected: true, meaning: '各时段系统负荷需求' },
              { key: 'fuel_cost', name: '燃料成本', math_param: 'fuel_cost', unit: '元/MWh', dimension: ['unit'], source_system: '燃料/经营系统', runtime_injected: false, meaning: '机组边际发电成本' }
            ],
            variables: [{ key: 'unit_output', name: '机组出力', math_var: 'unit_output', unit: 'MW', dimension: ['unit', 'time'], domain: '连续变量' }],
            constraints: [
              { code: 'power_balance', name: '功率平衡约束', business_rule: '机组出力满足系统负荷', math_constraint: 'sum(unit_output[unit,time]) >= load_forecast[time]' },
              { code: 'ramp_limit', name: '爬坡约束', business_rule: '机组出力变化不超过爬坡限制', math_constraint: 'unit_output[t]-unit_output[t-1] <= ramp_up_limit' }
            ]
          })
        };
      }
      if (modelName.includes('Storage Dispatch') || sceneName === '储能充放电优化') {
        const sets = { storage: ['BESS1', 'BESS2'], time: Array.from({ length: 24 }, (_, i) => i) };
        const parameters = {
          electricity_price: [320,300,280,260,255,270,310,420,520,560,580,600,610,590,560,540,580,680,720,690,610,520,430,360],
          storage_capacity: { BESS1: 200, BESS2: 120 },
          charge_power_limit: { BESS1: 60, BESS2: 40 },
          discharge_power_limit: { BESS1: 60, BESS2: 40 },
          initial_soc: { BESS1: 80, BESS2: 50 },
          soc_min: { BESS1: 30, BESS2: 20 },
          soc_max: { BESS1: 190, BESS2: 110 }
        };
        const variables = [
          { name: 'storage_charge', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'charge_power_limit' },
          { name: 'storage_discharge', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'discharge_power_limit' },
          { name: 'storage_soc', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb_param: 'soc_min', ub_param: 'soc_max' }
        ];
        const constraints = [
          { name: 'storage_soc_balance', foreach: ['storage', 'time'], terms: [{ var: 'storage_soc', key: ['storage', 'time'], coef: 1 }], sense: '>=', rhs_param: 'soc_min', rhs_key: ['storage'] },
          { name: 'storage_capacity_bound', foreach: ['storage', 'time'], terms: [{ var: 'storage_soc', key: ['storage', 'time'], coef: 1 }], sense: '<=', rhs_param: 'storage_capacity', rhs_key: ['storage'] },
          { name: 'storage_discharge_limit', foreach: ['storage', 'time'], terms: [{ var: 'storage_discharge', key: ['storage', 'time'], coef: 1 }], sense: '<=', rhs_param: 'discharge_power_limit', rhs_key: ['storage'] }
        ];
        return {
          scene: '储能充放电优化',
          model: '储能充放电优化 Storage Dispatch',
          modelCode: 'storage_dispatch',
          objectiveCode: 'profit_max',
          sense: 'maximize',
          sets, parameters, variables, constraints,
          objective: { terms: [{ var: 'storage_discharge', foreach: ['storage', 'time'], key: ['storage', 'time'], coef_param: 'electricity_price', param_key: ['time'] }], constant: 0 },
          runtimeParameters: { electricity_price: parameters.electricity_price, initial_soc: parameters.initial_soc },
          semantic: makeSemanticSpec({
            modelCode: 'storage_dispatch',
            scenario: '储能充放电优化 Storage Dispatch',
            objectiveCode: 'profit_max',
            objectiveName: '储能套利收益最大',
            sense: 'maximize',
            objects: [{ key: 'storage_asset', name: '储能电站', dimension: 'storage', unit: '座', source_system: '设备台账/EAM' }],
            parameters: [
              { key: 'electricity_price', name: '电价', math_param: 'electricity_price', unit: '元/MWh', dimension: ['time'], source_system: '市场系统', runtime_injected: true, meaning: '分时电价' },
              { key: 'initial_soc', name: '初始SOC', math_param: 'initial_soc', unit: 'MWh', dimension: ['storage'], source_system: '实时运行系统', runtime_injected: true, meaning: '求解起点储能电量' }
            ],
            variables: [
              { key: 'storage_charge', name: '储能充电功率', math_var: 'storage_charge', unit: 'MW', dimension: ['storage', 'time'], domain: '连续变量' },
              { key: 'storage_discharge', name: '储能放电功率', math_var: 'storage_discharge', unit: 'MW', dimension: ['storage', 'time'], domain: '连续变量' },
              { key: 'storage_soc', name: '储能荷电状态', math_var: 'storage_soc', unit: 'MWh', dimension: ['storage', 'time'], domain: '连续变量' }
            ],
            constraints: [
              { code: 'storage_soc_balance', name: 'SOC平衡约束', business_rule: 'SOC随充放电连续演化', math_constraint: 'soc[t]=soc[t-1]+charge-discharge' },
              { code: 'storage_capacity_bound', name: '储能容量边界', business_rule: 'SOC不超过设备容量', math_constraint: 'soc_min <= storage_soc <= storage_capacity' }
            ]
          })
        };
      }
      if (modelName.includes('Renewable') || sceneName === '风光储协同优化') {
        const sets = { site: ['WIND1', 'PV1'], storage: ['BESS1'], time: Array.from({ length: 24 }, (_, i) => i) };
        const parameters = {
          load_forecast: [210,205,198,196,200,215,240,268,290,305,318,325,330,322,315,310,326,350,372,360,330,300,265,235],
          renewable_forecast: { WIND1: 120, PV1: 90 },
          curtailment_penalty: { WIND1: 200, PV1: 180 },
          storage_capacity: { BESS1: 180 },
          initial_soc: { BESS1: 70 }
        };
        const variables = [
          { name: 'renewable_used', indices: ['site', 'time'], domain: 'NonNegativeReals', lb: 0 },
          { name: 'renewable_curtailment', indices: ['site', 'time'], domain: 'NonNegativeReals', lb: 0 },
          { name: 'storage_charge', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb: 0 },
          { name: 'storage_discharge', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb: 0 },
          { name: 'storage_soc', indices: ['storage', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'storage_capacity' }
        ];
        const constraints = [
          { name: 'renewable_balance', foreach: ['site', 'time'], terms: [{ var: 'renewable_used', key: ['site', 'time'], coef: 1 }, { var: 'renewable_curtailment', key: ['site', 'time'], coef: 1 }], sense: '<=', rhs_param: 'renewable_forecast', rhs_key: ['site'] },
          { name: 'power_balance', foreach: ['time'], terms: [{ var: 'renewable_used', foreach: ['site'], key: ['site', 'time'], coef: 1 }, { var: 'storage_discharge', foreach: ['storage'], key: ['storage', 'time'], coef: 1 }], sense: '>=', rhs_param: 'load_forecast', rhs_key: ['time'] },
          { name: 'storage_soc_balance', foreach: ['storage', 'time'], terms: [{ var: 'storage_soc', key: ['storage', 'time'], coef: 1 }], sense: '<=', rhs_param: 'storage_capacity', rhs_key: ['storage'] }
        ];
        return {
          scene: '风光储协同优化',
          model: '风光储协同优化 Renewable + Storage Scheduling',
          modelCode: 'renewable_storage_scheduling',
          objectiveCode: 'renewable_curtailment_min',
          sense: 'minimize',
          sets, parameters, variables, constraints,
          objective: { terms: [{ var: 'renewable_curtailment', foreach: ['site', 'time'], key: ['site', 'time'], coef_param: 'curtailment_penalty', param_key: ['site'] }], constant: 0 },
          runtimeParameters: { load_forecast: parameters.load_forecast, renewable_forecast: parameters.renewable_forecast, initial_soc: parameters.initial_soc },
          semantic: makeSemanticSpec({
            modelCode: 'renewable_storage_scheduling',
            scenario: '风光储协同优化 Renewable + Storage Scheduling',
            objectiveCode: 'renewable_curtailment_min',
            objectiveName: '弃风弃光最小',
            objects: [
              { key: 'renewable_site', name: '新能源场站', dimension: 'site', unit: '座', source_system: '新能源管理系统' },
              { key: 'storage_asset', name: '储能电站', dimension: 'storage', unit: '座', source_system: '设备台账/EAM' }
            ],
            parameters: [{ key: 'renewable_forecast', name: '新能源出力预测', math_param: 'renewable_forecast', unit: 'MW', dimension: ['site', 'time'], source_system: '新能源预测系统', runtime_injected: true, meaning: '场站可用出力' }],
            variables,
            constraints: [{ code: 'renewable_balance', name: '新能源电量平衡', business_rule: '可用新能源在消纳与弃电之间分配', math_constraint: 'renewable_used + curtailment <= renewable_forecast' }]
          })
        };
      }
      if (modelName.includes('CHP') || modelName.includes('热电协同') || sceneName === '热电协同优化' || sceneName === '电热协同优化') {
        const sets = { chp: ['CHP1', 'CHP2'], time: Array.from({ length: 24 }, (_, i) => i) };
        const parameters = {
          electricity_load_forecast: [180,176,170,168,172,190,220,248,260,268,272,270,265,260,258,262,285,310,320,305,280,250,220,195],
          heat_load_forecast: [120,118,116,115,116,122,130,138,140,142,145,146,144,143,142,144,148,152,155,150,142,136,130,124],
          chp_min_power: { CHP1: 40, CHP2: 25 },
          chp_max_power: { CHP1: 160, CHP2: 90 },
          heat_output_ratio: { CHP1: 0.8, CHP2: 1.1 },
          fuel_cost: { CHP1: 300, CHP2: 360 }
        };
        const variables = [
          { name: 'chp_power', indices: ['chp', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'chp_max_power' },
          { name: 'chp_heat', indices: ['chp', 'time'], domain: 'NonNegativeReals', lb: 0 },
          { name: 'chp_on', indices: ['chp', 'time'], domain: 'Binary' }
        ];
        const constraints = [
          { name: 'electric_balance', foreach: ['time'], terms: [{ var: 'chp_power', foreach: ['chp'], key: ['chp', 'time'], coef: 1 }], sense: '>=', rhs_param: 'electricity_load_forecast', rhs_key: ['time'] },
          { name: 'heat_balance', foreach: ['time'], terms: [{ var: 'chp_heat', foreach: ['chp'], key: ['chp', 'time'], coef: 1 }], sense: '>=', rhs_param: 'heat_load_forecast', rhs_key: ['time'] },
          { name: 'chp_output_bound', foreach: ['chp', 'time'], terms: [{ var: 'chp_power', key: ['chp', 'time'], coef: 1 }], sense: '<=', rhs_param: 'chp_max_power', rhs_key: ['chp'] }
        ];
        return {
          scene: '热电协同优化',
          model: '热电协同优化',
          modelCode: 'chp_dispatch',
          objectiveCode: 'total_cost_min',
          sense: 'minimize',
          sets, parameters, variables, constraints,
          objective: { terms: [{ var: 'chp_power', foreach: ['chp', 'time'], key: ['chp', 'time'], coef_param: 'fuel_cost', param_key: ['chp'] }], constant: 0 },
          runtimeParameters: { electricity_load_forecast: parameters.electricity_load_forecast, heat_load_forecast: parameters.heat_load_forecast },
          semantic: makeSemanticSpec({
            modelCode: 'chp_dispatch',
            scenario: '热电协同优化',
            objectiveCode: 'total_cost_min',
            objectiveName: '电热总成本最小',
            objects: [{ key: 'chp_unit', name: '热电联产机组', dimension: 'chp', unit: '台', source_system: '设备台账/EAM' }],
            parameters: [{ key: 'heat_load_forecast', name: '热负荷预测', math_param: 'heat_load_forecast', unit: 'MWth', dimension: ['time'], source_system: '热网预测系统', runtime_injected: true, meaning: '各时段供热需求' }],
            variables,
            constraints: [{ code: 'heat_balance', name: '热负荷平衡', business_rule: '供热必须满足热负荷需求', math_constraint: 'sum(chp_heat[chp,time]) >= heat_load_forecast[time]' }]
          })
        };
      }
      return blankModelPreset(modelName || '自定义空白优化模型');
    }

    function applyModelPreset(scene, model, options = {}) {
      const preset = modelPreset(scene, model);
      const preserveScene = options.preserveScene !== false;
      state.activeDomain = preserveScene ? (scene || state.activeDomain) : (options.sceneOverride || preset.scene);
      state.activeModel = options.preserveModel ? (model || preset.model) : preset.model;
      if (typeof resetModelWorkingStateForSwitch === 'function') resetModelWorkingStateForSwitch();
      state.builderMode = 'generic_linear';
      state.useGenericBuilder = true;
      state.componentSpecText = '{}';
      state.genericBuilderMode = 'indexed';
      state.selectedBasicConstraint = 0;
      state.selectedGenericRule = 0;
      state.genericSense = preset.sense || 'minimize';
      state.objective = preset.objectiveCode || state.objective;
      state.semanticSpecText = JSON.stringify(enrichSemanticWithPreset(preset.semantic || {}, preset), null, 2);
      state.genericSetsText = JSON.stringify(preset.sets || {}, null, 2);
      state.genericParametersText = JSON.stringify(preset.parameters || {}, null, 2);
      state.genericIndexedVariablesText = JSON.stringify(preset.variables || [], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify(preset.constraints || [], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify(preset.objective || { terms: [], constant: 0 }, null, 2);
      state.runtimeParametersText = JSON.stringify(preset.runtimeParameters || {}, null, 2);
      state.runtimeObjectiveText = JSON.stringify({ sense: state.genericSense, objective: state.objective }, null, 2);
      state.runtimeConstraintText = JSON.stringify({}, null, 2);
      state.expandedScene = '';
      state.managedScene = '';
      state.page = 'builder';
      state.builderStep = options.builderStep ?? 0;
      state.modelReady = false;
      if (options.showToast !== false) toast(`已加载模型结构：${state.activeModel}`);
      if (options.render !== false) render();
    }

    function enrichSemanticWithPreset(semantic, preset) {
      const spec = normalizeSemanticSpec(semantic);
      const setKeys = new Set((spec.sets || []).map(s => s.key));
      Object.entries(preset.sets || {}).forEach(([key, values]) => {
        if (!setKeys.has(key)) spec.sets.push({ key, name: `${key}集合`, values: Array.isArray(values) ? values : [], description: '模型模板内置集合' });
      });
      const paramKeys = new Set((spec.parameters || []).map(p => p.math_param || p.key));
      Object.entries(preset.parameters || {}).forEach(([key, value]) => {
        if (!paramKeys.has(key)) {
          spec.parameters.push({
            key,
            name: parameterMeaning(key).split('，')[0] || key,
            math_param: key,
            unit: '-',
            dimension: inferParamDimension(key, value),
            source_system: '模型模板',
            runtime_injected: false,
            default_value: value,
            validation: { required: false },
            meaning: parameterMeaning(key)
          });
        }
      });
      const varKeys = new Set((spec.variables || []).map(v => v.math_var || v.key));
      (preset.variables || []).forEach(variable => {
        if (!varKeys.has(variable.name)) {
          spec.variables.push({
            key: variable.name,
            name: variable.name,
            math_var: variable.name,
            unit: '-',
            dimension: variable.indices || [],
            domain: variable.domain || 'NonNegativeReals',
            lb: variable.lb,
            ub: variable.ub,
            lb_param: variable.lb_param,
            ub_param: variable.ub_param,
            meaning: '模型模板内置变量'
          });
        }
      });
      return spec;
    }

    function inferParamDimension(key, value) {
      if (Array.isArray(value)) return ['time'];
      if (value && typeof value === 'object') return ['unit'];
      return [];
    }

    function emptyCustomAssets() {
      return {
        '场景模板': [],
        '数据对象': [],
        '约束组件': [],
        '目标函数': [],
        '求解策略': [],
        '解释模板': []
      };
    }

    function assetCatalog() {
      const base = {
        '场景模板': {
          explain: '场景模板不是模型本身，而是某类业务问题的标准骨架。它规定需要哪些输入数据、默认启用哪些规则、常用目标函数和结果输出格式。',
          rows: [
            ['水风光储协同优化模板', '新能源消纳、水库调度、储能联动、外送计划', '已发布'],
            ['火电机组组合模板', '启停计划、爬坡、备用、煤耗与约束校核', '已发布'],
            ['燃料采购库存模板', '采购批次、运输计划、库存安全线、到港平衡', '试运行'],
            ['检修窗口排程模板', '检修资源、停机窗口、风险等级、窗口冲突', '试运行'],
            ['应急资源调拨模板', '物资、车辆、抢修队伍、最短到达路径', '开发中'],
            ['人员排班合规模板', '班次、资质、工时、轮休与特殊岗位限制', '开发中']
          ]
        },
        '数据对象': {
          explain: '数据对象是建模时使用的标准字段口径，把不同业务系统里的字段统一成资源、时序、边界、成本等对象。',
          rows: [
            ['资源对象', '机组、水库、储能站、仓库、班组、车辆', '已发布'],
            ['时序对象', '负荷、风光预测、需求、供货计划、检修窗口', '已发布'],
            ['边界对象', '容量上限、库存下限、SOC上下限、安全阈值', '已发布'],
            ['成本对象', '燃料、启停、弃电、库存、人工、物流成本', '试运行'],
            ['关系对象', '上下游、线路、仓储网络、人员技能关系', '试运行']
          ]
        },
        '约束组件': {
          explain: '约束组件是可复用的规则积木，例如供需平衡、容量上限、互斥逻辑、安全边界。',
          rows: [
            ['供需平衡组件', '生产、库存、运输、排班类模型共用', '已发布'],
            ['容量边界组件', '机组、库容、仓容、通道、人力容量上限', '已发布'],
            ['时序连续组件', 'SOC、水位、库存、班次连续性约束', '已发布'],
            ['互斥逻辑组件', '充放电互斥、启停互斥、人员岗位冲突', '试运行'],
            ['安全边界组件', '越限、禁区、检修安全、应急红线', '试运行']
          ]
        },
        '目标函数': {
          explain: '目标函数定义优化方向，例如成本最低、收益最大、风险最低或多目标优先级。',
          rows: [
            ['成本最小', '运行成本、燃料成本、库存成本、延误成本最小', '已发布'],
            ['收益最大', '发电收益、交易收益、辅助服务收益最大', '试运行'],
            ['风险最低', '安全风险、越限风险、缺货风险、缺员风险最低', '试运行'],
            ['多目标优先级', '先保安全、再保供、后求经济性', '已发布']
          ]
        },
        '求解策略': {
          explain: '求解策略封装求解器参数，包括Gap、时间限制、并发、启发式和降级策略。',
          rows: [
            ['快速模式', '较大Gap、较短时限，优先快速给可行解', '已发布'],
            ['均衡模式', '兼顾质量和耗时，适合日常业务运行', '已发布'],
            ['精确模式', '较小Gap，适合正式计划与批量分析', '试运行'],
            ['降级策略', '主求解器异常时切换HiGHS或规则求解', '试运行']
          ]
        },
        '解释模板': {
          explain: '解释模板把求解变量翻译成业务语言，用于结果页、报告和业务复核。',
          rows: [
            ['调度计划解释', '出力曲线、约束紧张点、风险提示与动作建议', '已发布'],
            ['成本收益解释', '成本构成、收益变化、边际改善项', '已发布'],
            ['无解诊断解释', '冲突约束、放宽建议、替代方案', '试运行'],
            ['管理汇报摘要', '面向集团管理层的指标摘要与结论', '开发中']
          ]
        }
      };
      Object.keys(state.customAssets).forEach(category => {
        if (base[category]) {
          base[category].rows = [...state.customAssets[category], ...base[category].rows];
        }
      });
      return base;
    }

    function navHtml() {
      const groups = [
        { label: '核心业务', ids: ['dashboard', 'domains', 'builder', 'assets'] },
        { label: '工具与运行', ids: ['components', 'solver', 'tasks'] },
        { label: '分析与接口', ids: ['results', 'skills', 'compare'] },
        { label: '系统', ids: ['ops'] }
      ];
      const menuMap = Object.fromEntries(menus.map(m => [m[0], m]));
      return groups.map(g =>
        `<div class="nav-group">
          <div class="nav-group-label">${g.label}</div>
          ${g.ids.map(id => {
            const [, name, icon] = menuMap[id] || [id, id, '·'];
            return `<button class="${state.page === id ? 'active' : ''}" onclick="go('${id}')"><span class="nav-icon">${icon}</span><span class="nav-label">${name}</span></button>`;
          }).join('')}
        </div>`
      ).join('');
    }

    function shell(title, desc, actions = '') {
      return `<div class="page-shell"><div class="page-head"><div class="page-title-group"><h1>${title}</h1><p>${desc}</p></div><div class="page-actions actions">${actions}</div></div></div>`;
    }

    function panel(title, body, tag = '') {
      return `<div class="panel content-card"><div class="panel-title"><span>${title}</span>${tag}</div>${body}</div>`;
    }

    function enterDemoMode() {
      state.dataMode = 'demo';
      localStorage.setItem('power-or-data-mode', 'demo');
      state.savedModels = defaultSavedModels();
      state.tasks = defaultDemoTasks();
      state.compareCases = defaultCompareCases();
      state.compare = state.compareCases.slice(0, 2).map(item => item.id);
      toast('已进入演示模式');
      render();
    }

    function exitDemoMode() {
      state.dataMode = 'api';
      localStorage.setItem('power-or-data-mode', 'api');
      state.savedModels = [];
      state.tasks = [];
      state.compareCases = [];
      state.compare = [];
      toast('已切回真实 API 模式');
      checkBackend();
    }

    function isDemoMode() {
      return state.dataMode === 'demo';
    }

    function demoModeBanner() {
      return isDemoMode() ? `<div class="validation-block amber"><strong>当前为演示数据，不代表后端真实资产。</strong><div class="actions mt"><button class="btn" onclick="exitDemoMode()">切回真实 API</button></div></div>` : '';
    }

    function offlineStateHtml(target = '真实资产') {
      return `<div class="validation-block amber"><strong>后端未连接，生产操作已禁用。</strong><p class="muted mt">当前无法加载${escapeHtml(target)}。请前往系统配置检查服务连接。</p><div class="actions mt"><button class="btn primary" onclick="go('ops')">前往系统配置</button></div></div>`;
    }

    function productionDisabledAttr() {
      return state.backendOnline ? '' : 'disabled title="后端未连接，生产操作不可用"';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function safeJson(value) {
      try { return JSON.stringify(value ?? {}, null, 2); } catch (e) { return String(value ?? ''); }
    }

    function getPath(obj, path, fallback) {
      return path.split('.').reduce((cur, key) => (cur && cur[key] !== undefined ? cur[key] : undefined), obj) ?? fallback;
    }

    function toast(text) {
      const el = document.getElementById('toast');
      el.textContent = String(text || '');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 1800);
    }

    function pill(status) {
      const map = {
        SUCCESS: 'green',
        RUNNING: 'blue',
        VALIDATING: 'blue',
        BUILDING_MODEL: 'blue',
        SOLVING: 'blue',
        FORMATTING_RESULT: 'blue',
        PENDING: 'amber',
        FAILED: 'red',
        INFEASIBLE: 'red',
        TIMEOUT: 'red',
        CANCELLED: 'amber',
        '完成': 'green',
        '建模': 'blue',
        '结果解析': 'blue',
        'HiGHS求解': 'blue',
        '排队': 'amber',
        '已发布': 'green',
        '试运行': 'blue',
        '开发中': 'amber',
        '已下线': 'amber',
        '启用': 'green',
        '停用': 'amber',
        '未实现': 'amber',
        '参与求解': 'green',
        published: 'green',
        trial: 'blue',
        developing: 'amber',
        offline: 'amber',
        '在线': 'green',
        '未连接': 'amber',
        '未上报': 'amber',
        '依赖异常': 'red',
        '已暂停': 'amber'
      };
      return `<span class="pill ${map[status] || 'blue'}">${escapeHtml(statusLabel(status))}</span>`;
    }

    function statusLabel(status) {
      return {
        PENDING: '排队',
        VALIDATING: '参数校验',
        BUILDING_MODEL: '建模中',
        SOLVING: '求解中',
        FORMATTING_RESULT: '结果解析',
        RUNNING: '运行中',
        SUCCESS: '成功',
        FAILED: '失败',
        INFEASIBLE: '无解',
        TIMEOUT: '超时',
        CANCELLED: '已取消',
        supported: '已支持',
        pending_linearization: '待线性化',
        published: '已发布',
        trial: '试运行',
        tested: '已测试',
        developing: '开发中',
        offline: '已下线'
      }[status] || status || '-';
    }

    function normalizeTask(t) {
      t = t || {};
      return {
        id: t.id || t.job_id || '-',
        model_id: t.model_id || null,
        scene: t.scene || '-',
        model: t.model || '-',
        solver: t.solver || 'HiGHS',
        status: t.status || 'PENDING',
        progress: Number(t.progress ?? 0),
        gap: t.gap || '-',
        cost: t.cost || 0,
        risk: t.risk || 'low',
        error: t.error || '',
        retry_count: t.retry_count || 0
      };
    }

    function friendlyApiError(error) {
      if (!error) return '接口请求失败';
      if (error.detail) return typeof error.detail === 'string' ? error.detail : safeJson(error.detail);
      return error.message || String(error);
    }

    function copyText(text, message = '已复制') {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => toast(message)).catch(() => toast('复制失败，请手动复制'));
        return;
      }
      toast('当前浏览器不支持自动复制，请手动复制');
    }

    function safeChartData(source) {
      const chartObj = source?.chart || source || {};
      if (Array.isArray(chartObj.soc) && chartObj.soc.length) return { labels: chartObj.labels || chartObj.soc.map((_, i) => String(i)), values: chartObj.soc };
      if (Array.isArray(chartObj.thermal) && chartObj.thermal.length) return { labels: chartObj.labels || chartObj.thermal.map((_, i) => String(i)), values: chartObj.thermal };
      if (Array.isArray(chartObj.load) && chartObj.load.length) return { labels: chartObj.labels || chartObj.load.map((_, i) => String(i)), values: chartObj.load };
      const unitOutput = source?.variable_values?.unit_output;
      if (unitOutput && typeof unitOutput === 'object') {
        const byTime = {};
        Object.entries(unitOutput).forEach(([key, value]) => {
          const parts = String(key).split(',');
          const time = parts[1] || parts[0];
          byTime[time] = (byTime[time] || 0) + (Number(value) || 0);
        });
        return { labels: Object.keys(byTime), values: Object.values(byTime) };
      }
      return { labels: [], values: [] };
    }

    function displayLabel(key) {
      const map = {
        objective_value: '目标函数值',
        total_cost: '总成本',
        arbitrage_profit: '峰谷套利收益',
        charge: '充电功率',
        discharge: '放电功率',
        soc: '储能SOC',
        storage: '储能设备',
        unit: '机组',
        time: '时段',
        output: '出力',
        value: '数值',
        status: '状态',
        fuel_cost: '燃料成本',
        startup_cost: '启停成本',
        reserve_margin: '备用裕度'
      };
      return map[key] || String(key).replace(/_/g, ' ');
    }

    function formatDisplayValue(value) {
      if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
      if (Array.isArray(value)) return value.map(formatDisplayValue).join(', ');
      if (value && typeof value === 'object') return safeJson(value);
      return value ?? '-';
    }

    function warningsHtml(items) {
      if (!Array.isArray(items) || !items.length) return '<p>暂无风险提示。</p>';
      return `<ul>${items.map(item => `<li>${escapeHtml(item.message || item)}</li>`).join('')}</ul>`;
    }

    function emptyState(text) {
      return `<div class="empty-state"><div class="empty-icon">--</div><strong>${escapeHtml(text || '暂无数据')}</strong><p>当前暂无可展示数据，请刷新或提交任务后查看。</p></div>`;
    }

    function chart(labels, values) {
      if (!Array.isArray(labels) || !Array.isArray(values) || !labels.length || !values.length) return emptyState('暂无可渲染图表数据');
      const numericValues = values.map(v => Math.max(0, Number(v) || 0));
      const maxValue = Math.max(1, ...numericValues);
      return `<div class="chart">${labels.map((l, i) => {
        const height = Math.max(3, Math.min(100, ((numericValues[i] || 0) / maxValue) * 100));
        return `<div class="bar ${['','green','amber','purple',''][i % 5]}" style="height:${height.toFixed(1)}%" title="${escapeHtml(displayLabel(l))}: ${escapeHtml(formatDisplayValue(numericValues[i] || 0))}"><span>${escapeHtml(displayLabel(l))}</span></div>`;
      }).join('')}</div>`;
    }

    function skillInfoModalHtml(skill) {
      const endpoint = skill.endpoint || `/api/skills/${skill.skill_name || '-'}/run`;
      return `<div class="grid cols-2">
        ${panel('模型服务接口信息', `<table class="compact-table"><tr><th>接口编码</th><td>${escapeHtml(skill.skill_name || '-')}</td></tr><tr><th>绑定模型</th><td>${escapeHtml(skill.model_id || '-')}</td></tr><tr><th>版本</th><td>${escapeHtml(skill.version || skill.model_version || '-')}</td></tr><tr><th>状态</th><td>${pill(skill.skill_status || skill.status || '-')}</td></tr><tr><th>执行策略</th><td>${escapeHtml(executionPolicyLabel(skill.execution_policy))}</td></tr><tr><th>人工确认</th><td>${pill(Boolean(skill.requires_human_review))}</td></tr></table>`)}
        ${panel('调用入口', `<div class="field"><label>Endpoint</label><input value="${escapeHtml(endpoint)}" readonly /></div><div class="actions"><button class="btn" onclick="copyText('${escapeHtml(skillAssetEndpoint(skill))}','接口地址已复制')">复制接口地址</button></div><p>${escapeHtml(skill.description || skill.safety || '')}</p>`)}
      </div>
      <div class="grid cols-2 mt">
        ${panel('输入参数', compactSchemaTable(skill.input_schema || [], [
          { label: '参数', value: item => item.key || '-' },
          { label: '名称', value: item => item.name || '-' },
          { label: '类型', value: item => item.type || '-' },
          { label: '维度', value: item => (item.dimension || []).join(', ') || '-' },
          { label: '样例/默认', value: item => safeJson(item.sample_value ?? item.default_value ?? '-') }
        ]))}
        ${panel('输出结构', `<pre>${escapeHtml(safeJson(skill.output_schema || {}))}</pre>`)}
      </div>
      <details class="mt"><summary>原始 JSON</summary><pre>${escapeHtml(safeJson(skill))}</pre></details>`;
    }

    function isTaskTerminal(task) {
      return ['SUCCESS', 'FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED', '完成'].includes(task?.status) || Number(task?.progress || 0) >= 100;
    }

    function keyValueTableHtml(value) {
      if (!value || (typeof value === 'object' && !Object.keys(value).length)) return '<p class="muted">暂无数据</p>';
      if (Array.isArray(value)) return `<pre>${escapeHtml(safeJson(value))}</pre>`;
      if (typeof value !== 'object') return `<pre>${escapeHtml(String(value))}</pre>`;
      return `<table class="compact-table">${Object.entries(value).slice(0, 80).map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(typeof v === 'object' ? safeJson(v) : v)}</td></tr>`).join('')}</table>`;
    }

    function copyEncodedText(encoded, message) {
      copyText(decodeURIComponent(encoded), message);
    }
