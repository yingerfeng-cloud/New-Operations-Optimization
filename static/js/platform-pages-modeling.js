// Model creation and modeling workflow.
    function loadMinimalEconomicDispatchExample() {
      const sets = { unit: ['U1', 'U2'], time: ['T0', 'T1', 'T2'] };
      const parameters = {
        load_forecast: { T0: 100, T1: 120, T2: 90 },
        fuel_cost: { U1: 10, U2: 20 },
        unit_max_output: { U1: 80, U2: 100 }
      };
      const semantic = {
        model_code: 'custom_optimization_model',
        scenario: '最小经济调度自定义模型',
        objects: [
          { key: 'thermal_unit', name: '火电机组', dimension: 'unit', unit: '台', source_system: '设备台账/EAM', description: '参与经济调度的发电机组' },
          { key: 'dispatch_time', name: '调度时段', dimension: 'time', unit: '小时', source_system: '调度计划系统', description: '优化计算时段' }
        ],
        business_objects: [],
        sets: [
          { key: 'unit', name: '机组集合', values: sets.unit, business_object: 'thermal_unit', description: '参与优化的机组' },
          { key: 'time', name: '时段集合', values: sets.time, business_object: 'dispatch_time', description: '调度优化时段' }
        ],
        parameters: [
          { key: 'load_forecast', name: '负荷预测', math_param: 'load_forecast', unit: 'MW', dimension: ['time'], source_system: '负荷预测系统', runtime_injected: true, default_value: parameters.load_forecast, validation: { required: true, type: 'dict', min: 0 }, meaning: '各时段系统负荷需求' },
          { key: 'fuel_cost', name: '燃料成本', math_param: 'fuel_cost', unit: '元/MWh', dimension: ['unit'], source_system: '燃料成本台账', runtime_injected: true, default_value: parameters.fuel_cost, validation: { required: true, type: 'dict', min: 0 }, meaning: '各机组单位出力成本' },
          { key: 'unit_max_output', name: '机组最大出力', math_param: 'unit_max_output', unit: 'MW', dimension: ['unit'], source_system: '设备台账/EAM', runtime_injected: true, default_value: parameters.unit_max_output, validation: { required: true, type: 'dict', min: 0, default: 999 }, meaning: '各机组最大可用出力' }
        ],
        variables: [
          { key: 'unit_output', name: '机组出力', math_var: 'unit_output', unit: 'MW', dimension: ['unit', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'unit_max_output', meaning: '各机组各时段发电出力' }
        ],
        constraints: [
          { code: 'power_balance', name: '功率平衡约束', foreach: ['time'], business_rule: '各时段所有机组出力之和满足系统负荷', math_constraint: 'sum(unit_output[unit,time]) >= load_forecast[time]' },
          { code: 'output_bound', name: '机组出力上限', foreach: ['unit', 'time'], business_rule: '机组出力不超过最大可用出力', math_constraint: 'unit_output[unit,time] <= unit_max_output[unit]' }
        ],
        objectives: [
          { code: 'total_cost_min', name: '总发电成本最小', sense: 'minimize', business_goal: '优先调用低成本机组并满足负荷需求' }
        ],
        objective: { code: 'total_cost_min', name: '总发电成本最小', business_goal: '优先调用低成本机组并满足负荷需求' },
        mapping: {
          business_to_math: '语义层对象映射为 Pyomo 集合、参数、变量、目标函数和约束',
          solver_layer: 'Pyomo ConcreteModel -> HiGHS SolverAdapter'
        }
      };
      state.activeDomain = '自定义模型';
      state.activeModel = '最小经济调度自定义模型';
      state.builderMode = 'generic_linear';
      state.useGenericBuilder = true;
      state.genericBuilderMode = 'indexed';
      state.genericSense = 'minimize';
      state.objective = 'total_cost_min';
      state.semanticSpecText = JSON.stringify(semantic, null, 2);
      state.genericSetsText = JSON.stringify(sets, null, 2);
      state.genericParametersText = JSON.stringify(parameters, null, 2);
      state.genericIndexedVariablesText = JSON.stringify([
        { name: 'unit_output', indices: ['unit', 'time'], domain: 'NonNegativeReals', lb: 0, ub_param: 'unit_max_output', ub_key: ['unit'] }
      ], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify([
        { name: 'power_balance', foreach: ['time'], terms: [{ var: 'unit_output', foreach: ['unit'], key: ['unit', 'time'], coef: 1 }], sense: '>=', rhs_param: 'load_forecast', rhs_key: ['time'] },
        { name: 'output_bound', foreach: ['unit', 'time'], terms: [{ var: 'unit_output', key: ['unit', 'time'], coef: 1 }], sense: '<=', rhs_param: 'unit_max_output', rhs_key: ['unit'] }
      ], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify({
        terms: [{ var: 'unit_output', foreach: ['unit', 'time'], key: ['unit', 'time'], coef_param: 'fuel_cost', param_key: ['unit'] }],
        constant: 0
      }, null, 2);
      state.runtimeParametersText = JSON.stringify(parameters, null, 2);
      state.builderStep = 1;
      state.modelReady = false;
      state.semanticValidationResult = validateSemanticAndGenericSpec(semantic, getGenericSpec());
      toast('已加载最小经济调度示例：time = T0/T1/T2，可直接校验、保存、发布并调用求解');
      render();
    }

    async function loadComponentTemplateExample(templateCode = 'cascade_hydro_dispatch', options = {}) {
      const currentStep = state.builderStep || 0;
      const preserveScene = options.preserveScene !== false;
      const sceneBefore = state.activeDomain;
      const modelBefore = state.activeModel;
      let template;
      try {
        template = await apiFetch(`/templates/${encodeURIComponent(templateCode)}`);
        state.backendOnline = true;
      } catch (e) {
        state.activeDomain = options.rollbackScene || sceneBefore;
        state.activeModel = options.rollbackModel || modelBefore;
        toast('无法从后端组件库加载组件模板，请先启动平台服务并刷新组件库。');
        render();
        return;
      }
      resetModelWorkingStateForSwitch();
      const draft = template.model_draft || buildComponentModelDraftFromTemplate(template);
      state.modelDraft = draft;
      state.componentRegistry = template.component_schema?.components || draft.advanced?.component_catalog || state.componentRegistry || [];
      const componentSpec = template.component_spec || {};
      const sample = template.sample_runtime_parameters || {};
      state.activeDomain = preserveScene ? sceneBefore : normalizeTemplateScene(template.scenario || template.name || '组件化模型');
      state.activeModel = options.modelName || template.name || modelBefore || '组件化模型';
      state.builderMode = 'component_based';
      state.useGenericBuilder = false;
      state.componentBuilder.additionalConstraintsEnabled = false;
      state.genericBuilderMode = 'indexed';
      state.objective = (template.objectives || [{ code: 'weighted_dispatch_objective' }])[0].code;
      state.semanticSpecText = JSON.stringify(template, null, 2);
      state.componentSpecText = JSON.stringify(componentSpec, null, 2);
      state.componentBuilder = componentBuilderStateFromDraft(draft, componentSpec, sample);
      state.genericSetsText = JSON.stringify({}, null, 2);
      state.genericParametersText = JSON.stringify({}, null, 2);
      state.genericIndexedVariablesText = JSON.stringify([], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify([], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify({ terms: [], constant: 0 }, null, 2);
      state.runtimeParametersText = JSON.stringify(sample, null, 2);
      state.componentBuilder.runtimeParametersText = state.runtimeParametersText;
      state.runtimeObjectiveText = JSON.stringify(componentSpec.objective || { type: 'weighted_sum', sense: 'minimize' }, null, 2);
      state.runtimeConstraintText = JSON.stringify({}, null, 2);
      state.semanticValidationResult = { errors: [], warnings: [], infos: ['已加载推荐 Model Draft，组件、约束、目标函数和数学展开由统一草稿派生。'] };
      state.builderStep = currentStep;
      state.modelReady = false;
      toast('已从后端组件库加载推荐组件模板，请点击“下一步”查看模型语义、组件清单和数学展开。');
      render();
    }

    function normalizeTemplateScene(scene) {
      const matched = getScenes().find(s => s.name === scene || s.domain === scene);
      return matched?.name || scene || state.activeDomain;
    }

    function buildComponentModelDraftFromTemplate(template = {}) {
      const componentSpec = template.component_spec || {};
      const sample = template.sample_runtime_parameters || {};
      const components = (componentSpec.components || []).map(item => {
        const type = item.type || item.code;
        const definition = componentRegistryMeta(type);
        return {
          component_id: type,
          type,
          enabled: item.enabled !== false,
          required: !!definition.required,
          config: item.config || {},
          definition,
          generated_constraints: definition.generated_constraints || [],
          generated_objective_terms: definition.generated_objective_terms || []
        };
      });
      const draft = {
        basic_info: {
          name: template.name || '梯级水电日前调度优化模型',
          scenario: template.scenario || '梯级水电日前调度',
          model_code: template.model_code || template.code || 'cascade_hydro_dispatch',
          builder_mode: 'component_based',
          solver: template.solver || 'HiGHS'
        },
        semantic: {
          objects: template.business_objects || [],
          sets: mergeRequiredSets(componentSpec.sets || template.sets || [], components),
          parameters: template.parameters || [],
          variables: componentSpec.variables || template.variables || [],
          derived_expressions: [],
          outputs: template.outputs || []
        },
        components,
        constraints: componentSpec.additional_custom_constraints || [],
        objective: buildObjectiveFromComponents(components, componentSpec.objective || {}),
        mathematical_expansion: {},
        runtime_parameters: sample,
        advanced: { component_spec: componentSpec, generic_spec: {}, ui_metadata: template.ui_metadata || {}, component_catalog: state.componentRegistry || [] }
      };
      draft.objective_strategy = generateObjectiveStrategyForUi(draft.objective || {});
      draft.mathematical_expansion = generateMathematicalExpansionFromDraft(draft);
      applyProblemTypeDiagnosis(draft, componentSpec);
      return draft;
    }

    function buildObjectiveFromComponents(components = [], objectiveSpec = {}) {
      const terms = [];
      components.forEach(component => {
        const definition = component.definition || componentRegistryMeta(component.type || component.component_id);
        const componentId = component.type || component.component_id || component.code || '';
        (definition.generated_objective_terms || component.generated_objective_terms || []).forEach(term => terms.push({ ...term, source: term.source || 'component_generated', source_component: term.source_component || componentId, owner_component: term.owner_component || componentId, generated_by_component: term.generated_by_component || componentId, enabled: term.enabled !== false }));
      });
      return { sense: objectiveSpec.sense || 'minimize', terms };
    }

    function loadSelectedModelStructure() {
      selectModel(state.runtimeTemplateId ? `asset:${state.runtimeTemplateId}` : state.activeModel);
    }

    function createBlankModel(options = {}) {
      const name = options.promptForName === false
        ? (options.modelName || '自定义空白优化模型')
        : prompt('请输入新模型名称', options.modelName || '自定义空白优化模型');
      if (!name) return;
      const scene = state.activeDomain || '通用线性/MILP建模';
      const preset = blankModelPreset(name.trim());
      preset.scene = scene;
      preset.semantic.scenario = scene;
      resetBlankModelState(preset, scene, name.trim());
      state.builderStep = 1;
      toast(`已创建空白模型：${state.activeModel}`);
      render();
    }

    function resetBlankModelState(preset, scene, modelName) {
      const semantic = normalizeSemanticSpec({ ...(preset.semantic || {}), scenario: scene, model_code: 'custom_optimization_model' });
      semantic.objects = [];
      semantic.business_objects = [];
      semantic.sets = [];
      semantic.parameters = [];
      semantic.variables = [];
      semantic.constraints = [];
      state.activeDomain = scene;
      state.activeModel = modelName;
      state.builderMode = 'generic_linear';
      state.useGenericBuilder = true;
      state.componentSpecText = '{}';
      state.modelDraft = {};
      state.editingSetCode = '';
      state.semanticSetFormDraft = null;
      state.componentBuilder = componentBuilderStateFromDraft(createEmptyModelDraft(), {}, {});
      state.genericBuilderMode = 'indexed';
      state.genericSense = 'minimize';
      state.objective = preset.objectiveCode || 'custom_objective';
      state.semanticSpecText = JSON.stringify(semantic, null, 2);
      state.genericSetsText = JSON.stringify({}, null, 2);
      state.genericParametersText = JSON.stringify({}, null, 2);
      state.genericIndexedVariablesText = JSON.stringify([], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify([], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify({ terms: [], constant: 0 }, null, 2);
      state.genericVariablesText = JSON.stringify([], null, 2);
      state.genericConstraintsText = JSON.stringify([], null, 2);
      state.genericObjectiveText = JSON.stringify({ terms: [], constant: 0 }, null, 2);
      state.runtimeParametersText = JSON.stringify({}, null, 2);
      state.runtimeObjectiveText = JSON.stringify({ sense: 'minimize', objective: state.objective }, null, 2);
      state.runtimeConstraintText = JSON.stringify({}, null, 2);
      state.semanticValidationResult = { errors: [], warnings: [], infos: [] };
      state.modelReady = false;
    }

    function buildModelPackage(options = {}) {
      const validate = options.validate !== false;
      const isComponentBased = isComponentBuilderMode();
      if (state.useGenericBuilder && !isComponentBased) syncGenericSpecFromSemantic({ preserveFormula: true });
      const semanticSpec = getSemanticSpec();
      const genericSpec = state.useGenericBuilder && !isComponentBased ? getGenericSpec() : {};
      if (state.useGenericBuilder && !isComponentBased) completeGenericParameterDefaults(genericSpec, semanticSpec);
      const componentSpec = isComponentBased ? getComponentSpecFromBuilder(semanticSpec) : {};
      const modelDraft = isComponentBased ? buildModelDraftFromState(semanticSpec, componentSpec) : {};
      if (validate && !isComponentBased) {
        const validation = validateSemanticAndGenericSpec(semanticSpec, genericSpec);
        state.semanticValidationResult = validation;
        if (validation.errors.length) {
          throw new Error(`模型语义一致性校验失败：${validation.errors[0]}`);
        }
      } else if (validate && isComponentBased && (!(componentSpec.components || []).length || !(componentSpec.variables || []).length)) {
        throw new Error('组件化 Builder 模型必须包含组件清单和变量清单');
      }
      const runtimeDefaults = parseRuntimeParametersForBuild(isComponentBased, semanticSpec);
      if (isComponentBased && !Object.keys(runtimeDefaults).length) {
        throw new Error('组件化模型缺少运行参数，请先填写或加载样例运行参数。');
      }
      const packageParameters = isComponentBased ? runtimeDefaults : {
        ...runtimeDefaults,
        storage_power: state.genericConstraints.find(r => r.name === '库存/库容边界')?.on ? 24 : 16,
        soc_min: 20,
        soc_max: 100,
        hydro_min: 18,
        hydro_max: state.genericConstraints.find(r => r.name === '资源容量上限')?.on ? 82 : 95,
        curtail_penalty: state.objective === '收益最大' ? 60 : 100,
        unserved_penalty: 1000,
        hydro_cost: 2,
        storage_cost: 1.2,
        builder_priority: state.builderPriority,
        builder_penalty: state.builderPenalty,
        builder_explain_template: state.builderExplainTemplate,
        builder_secondary_objective: state.builderSecondaryObjective
      };
      const runtimeSchema = buildRuntimeParameterSchemaFromSemantic(semanticSpec);
      const mathematicalExpansion = isComponentBased ? (modelDraft.mathematical_expansion || buildMathematicalExpansion(semanticSpec, componentSpec)) : {};
      if (isComponentBased) {
        applyProblemTypeDiagnosis(modelDraft, componentSpec);
      }
      const effectiveProblemType = isComponentBased ? (modelDraft.problem_type_diagnosis?.effective_problem_type || componentSpec.model_problem_type || 'LP') : 'LP';
      const objectiveStrategySummary = isComponentBased ? (modelDraft.objective_strategy?.summary || componentSpec.objective_strategy?.summary || '') : '';
      const hasTimeSet = modelHasTimeSetForUi(isComponentBased ? (modelDraft.semantic?.sets || componentSpec.sets || []) : (semanticSpec.sets || []));
      return {
        name: state.activeModel,
        scene: state.activeDomain,
        version: 'v0.1',
        status: '开发中',
        solver: state.solverBackend,
        objective: objectiveStrategySummary || state.objective || null,
        time_granularity: hasTimeSet ? inferTimeGranularity(packageParameters) : null,
        build_mode: isComponentBased ? 'component_based' : 'generic_linear',
        problem_type: effectiveProblemType,
        component_spec: componentSpec,
        component_schema: semanticSpec.component_schema || {},
        model_draft: modelDraft,
        objective_config: modelDraft.objective || {},
        draft_constraints: modelDraft.generated_constraints || [],
        mathematical_expansion: mathematicalExpansion,
        model_problem_type: effectiveProblemType,
        required_solver_capabilities: isComponentBased ? [effectiveProblemType] : ['LP'],
        ui_metadata: {
          ...(semanticSpec.ui_metadata || {}),
          builder_mode_label: builderModeText(),
          formula_source: formulaSourceText(),
          additional_custom_constraints: state.componentBuilder?.additionalConstraints || []
        },
        constraints: Object.fromEntries(state.genericConstraints.map(r => [r.name, r.on])),
        mapping_bindings: state.mappingBindings.map(row => ({ ...row })),
        rule_configs: state.genericConstraints.map((rule, i) => ({
          name: rule.name,
          enabled: rule.on,
          tag: rule.tag,
          ...state.ruleConfigs[i]
        })),
        semantic_spec: semanticSpec,
        generic_spec: genericSpec,
        parameters: packageParameters,
        parameter_schema: { runtime_parameters: runtimeSchema },
        input_contract: { runtime_parameters: runtimeSchema.map(p => p.key || p.code || p.name || p.math_param).filter(Boolean) },
        output_contract: { variables: (semanticSpec.variables || []).map(v => v.math_var || v.key || v.name).filter(Boolean) }
      };
    }

    function inferTimeGranularity(parameters = {}) {
      const seconds = Number(parameters.time_step_seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) return '60分钟';
      const minutes = seconds / 60;
      if (Number.isInteger(minutes) && minutes < 60) return `${minutes}分钟`;
      const hours = minutes / 60;
      if (Number.isInteger(hours)) return `${hours}小时`;
      return `${minutes.toFixed(1)}分钟`;
    }

    function modelHasTimeSetForUi(sets = []) {
      return (sets || []).some(item => {
        const code = item.code || item.key || '';
        return code === 'time' || item.type === 'time_period' || item.type === 'state_time';
      });
    }

    function buildModelDraftFromState(semanticSpec = getSemanticSpec(), componentSpec = null) {
      componentSpec = componentSpec || parseJsonOr(state.componentBuilder?.componentSpecText || state.componentSpecText || '{}', '{}');
      const runtimeParams = currentRuntimeParameters();
      const components = (state.componentBuilder?.components || componentSpec.components || []).map(item => {
        const type = item.type || item.code || item.component_id;
        const definition = item.definition || componentRegistryMeta(type);
        return {
          component_id: type,
          type,
          enabled: item.enabled !== false,
          required: !!item.required || !!definition.required,
          config: item.config || {},
          definition,
          generated_constraints: definition.generated_constraints || [],
          generated_objective_terms: definition.generated_objective_terms || []
        };
      });
      const draft = {
        basic_info: {
          name: state.activeModel,
          scenario: state.activeDomain,
          model_code: componentSpec.model_code || semanticSpec.model_code || 'cascade_hydro_dispatch',
          builder_mode: 'component_based',
          solver: state.solverBackend || 'HiGHS'
        },
        semantic: {
          objects: semanticSpec.business_objects || semanticSpec.objects || [],
          sets: mergeRequiredSets((componentSpec.sets && componentSpec.sets.length ? componentSpec.sets : semanticSpec.sets) || [], components),
          parameters: semanticSpec.parameters || [],
          variables: (componentSpec.variables && componentSpec.variables.length ? componentSpec.variables : semanticSpec.variables) || [],
          derived_expressions: semanticSpec.derived_expressions || [],
          outputs: semanticSpec.outputs || []
        },
        components,
        constraints: state.componentBuilder?.additionalConstraints || componentSpec.additional_custom_constraints || [],
        objective: state.componentBuilder?.objective || buildObjectiveFromComponents(components, componentSpec.objective || {}),
        mathematical_expansion: {},
        runtime_parameters: runtimeParams,
        advanced: { component_spec: componentSpec, generic_spec: {}, ui_metadata: semanticSpec.ui_metadata || {}, component_catalog: state.componentRegistry || [] }
      };
      draft.generated_constraints = buildConstraintsFromDraft(draft);
      draft.objective_strategy = generateObjectiveStrategyForUi(draft.objective || {});
      draft.mathematical_expansion = generateMathematicalExpansionFromDraft(draft);
      applyProblemTypeDiagnosis(draft, componentSpec);
      state.modelDraft = draft;
      return draft;
    }

    function generateObjectiveStrategyForUi(objective = {}) {
      const terms = objective.terms || [];
      const active = terms.filter(term => term.enabled !== false && !['display_only', 'remark_only', 'none'].includes(String(term.solve_participation || 'solve_active')));
      const inactive = terms.filter(term => !active.includes(term));
      if (!active.length) return { status: 'not_generated', summary: '未生成', active_terms: [], inactive_terms: inactive, publish_blocking: true };
      const names = active.map(term => term.name || term.term_id || term.weight_key || '目标项');
      const suffix = String(objective.sense || 'minimize').toLowerCase() === 'maximize' ? '综合最大' : '综合最小';
      return { status: 'generated', summary: `${names.slice(0, 3).join('、')}${names.length > 3 ? '等' : ''}${suffix}`, active_terms: active, inactive_terms: inactive, publish_blocking: false };
    }

    function mergeRequiredSets(baseSets = [], components = []) {
      const rows = [];
      const byCode = {};
      const activeComponentIds = new Set((components || []).filter(c => c.enabled !== false).map(c => c.type || c.component_id || c.code).filter(Boolean));
      const activeRequiredCodes = new Set();
      const requiredOwnersByCode = {};
      (components || []).filter(c => c.enabled !== false).forEach(component => {
        const componentId = component.type || component.component_id || component.code || '';
        const definition = component.definition || {};
        (definition.required_sets || definition.sets || []).forEach(raw => {
          const code = raw.code || raw.key || raw.name;
          if (code) {
            activeRequiredCodes.add(code);
            requiredOwnersByCode[code] = [...new Set([...(requiredOwnersByCode[code] || []), componentId].filter(Boolean))];
          }
        });
      });
      const activeOwners = owners => [...new Set((owners || []).filter(owner => activeComponentIds.has(owner)))];
      const normalizeSet = (raw = {}, source = 'user_defined') => {
        const code = raw.code || raw.key || raw.name || '';
        const type = raw.type || (code === 'time' ? 'time_period' : ['time_volume', 'state_time', 'soc_time'].includes(code) ? 'state_time' : 'normal');
        const members = Array.isArray(raw.members) ? raw.members : Array.isArray(raw.values) ? raw.values : [];
        const sourceText = raw.source || source;
        const rawOwner = raw.source_component || raw.owner_component || raw.generated_by_component || (String(sourceText).startsWith('component_required_set:') ? String(sourceText).split(':')[1] : '');
        const owners = activeOwners([...(raw.required_by || []), ...(raw.used_by || []), ...(rawOwner ? [rawOwner] : []), ...(requiredOwnersByCode[code] || [])]);
        const owner = activeComponentIds.has(rawOwner) ? rawOwner : (owners[0] || '');
        const item = { ...raw, code, key: raw.key || code, name: raw.name || code, type, members, values: members, source: sourceText, source_component: owner, owner_component: owner, generated_by_component: owner, required_by: owners, used_by: activeOwners([...(raw.used_by || []), ...owners]), required: raw.required !== false, configured: !!members.length };
        if (type === 'state_time') {
          item.base_set = item.base_set || 'time';
          item.generation_rule = item.generation_rule || 'horizon_plus_1';
        }
        return item;
      };
      const add = (raw, source) => {
        const item = normalizeSet(raw, source);
        if (!item.code) return;
        if (!byCode[item.code]) {
          byCode[item.code] = item;
          rows.push(item);
          return;
        }
        const existing = byCode[item.code];
        if (existing.type !== item.type) existing.conflicts = [...(existing.conflicts || []), { source, type: item.type, expected_type: existing.type }];
        Object.keys(item).forEach(key => {
          if ((existing[key] === undefined || existing[key] === '' || (Array.isArray(existing[key]) && !existing[key].length)) && item[key] !== undefined) existing[key] = item[key];
        });
        existing.required_by = [...new Set([...(existing.required_by || []), ...(item.required_by || [])])];
        existing.used_by = [...new Set([...(existing.used_by || []), ...(item.used_by || [])])];
        existing.required = existing.required || item.required;
      };
      (baseSets || []).forEach(item => {
        const code = item.code || item.key || item.name;
        const source = String(item.source || '');
        const inferredOwners = requiredOwnersByCode[code] || [];
        const rawOwner = item.source_component || item.owner_component || item.generated_by_component || (source.startsWith('component_required_set:') ? source.split(':')[1] : '') || '';
        const owner = activeComponentIds.has(rawOwner) ? rawOwner : (inferredOwners[0] || '');
        const isComponentGenerated = source.startsWith('component_required_set') || source === 'component_generated' || source === 'component_required_set' || owner;
        if (isComponentGenerated && !activeComponentIds.has(owner) && !activeRequiredCodes.has(code)) return;
        const sourceForItem = item.source || (inferredOwners.length ? `component_required_set:${owner}` : 'user_defined');
        const owners = activeOwners([...(item.required_by || []), ...(item.used_by || []), ...inferredOwners, ...(owner ? [owner] : [])]);
        add({ ...item, source_component: owner, owner_component: owner, generated_by_component: owner, required_by: owners, used_by: owners }, sourceForItem);
      });
      (components || []).filter(c => c.enabled !== false).forEach(component => {
        const definition = component.definition || {};
        const componentId = component.type || component.component_id || '';
        (definition.required_sets || definition.sets || []).forEach(item => add({ ...item, source_component: componentId, owner_component: componentId, generated_by_component: componentId }, `component_required_set:${componentId}`));
      });
      return generateSetMembersForUi(rows);
    }

    function generateSetMembersForUi(sets = []) {
      const byCode = Object.fromEntries(sets.map(item => [item.code, item]));
      sets.forEach(item => {
        if (item.type !== 'time_period') return;
        if (!item.horizon && item.members?.length) item.horizon = item.members.length;
        if (item.horizon) item.members = Array.from({ length: Number(item.horizon) }, (_, i) => i);
        item.values = item.members || [];
        if (item.time_granularity) {
          const minutes = Number(item.time_granularity) * (item.time_unit === 'hour' ? 60 : item.time_unit === 'day' ? 1440 : 1);
          item.delta_t = minutes / 60;
          item.delta_t_unit = 'hour';
          item.window_minutes = Number(item.horizon || 0) * minutes;
          item.window_hours = item.window_minutes / 60;
          item.window_days = item.window_hours / 24;
        }
        item.configured = !!(item.horizon && item.time_granularity && item.members?.length);
      });
      sets.forEach(item => {
        if (item.type !== 'state_time') return;
        const base = byCode[item.base_set || 'time'];
        const baseMembers = base?.members || base?.values || [];
        if (item.generation_rule === 'horizon_plus_1' && baseMembers.length && !(item.members || []).length) item.members = Array.from({ length: baseMembers.length + 1 }, (_, i) => i);
        item.values = item.members || [];
        item.configured = !!(item.base_set && item.members?.length);
      });
      return sets;
    }

    function buildConstraintsFromDraft(draft = {}) {
      const rows = [];
      (draft.components || []).forEach(component => {
        const componentId = component.component_id || component.type;
        (component.generated_constraints || component.definition?.generated_constraints || []).forEach(constraint => rows.push({
          ...constraint,
          formula: getConstraintDisplayFormula(constraint),
          expression: firstNonBlank(constraint.expression, constraint.formula, constraint.dsl, constraint.math_expression, constraint.generated_formula, constraint.display_formula, constraint.math_constraint),
          display_formula: getConstraintDisplayFormula(constraint),
          indices: constraint.indices || constraint.foreach || [],
          business_meaning: firstNonBlank(constraint.business_meaning, constraint.business_rule, constraint.description),
          source: 'component',
          source_component: componentId,
          enabled: component.enabled !== false,
          core: true,
          editable: false
        }));
      });
      (draft.constraints || []).forEach((item, index) => rows.push({
        constraint_id: item.constraint_id || item.name || `custom_constraint_${index + 1}`,
        name: item.name || `附加约束 ${index + 1}`,
        type: item.type || item.scope || 'additional_boundary',
        formula: getConstraintDisplayFormula(item),
        expression: firstNonBlank(item.expression, item.formula, item.dsl, item.math_expression, item.generated_formula, item.display_formula, item.math_constraint),
        display_formula: getConstraintDisplayFormula(item),
        business_meaning: item.business_meaning || '用户追加的合法补充约束。',
        indices: item.indices || [],
        source: 'custom',
        source_component: '',
        enabled: item.enabled !== false,
        core: false,
        editable: true
      }));
      return rows;
    }

    function generateMathematicalExpansionFromDraft(draft = {}) {
      const terms = (draft.objective?.terms || []).filter(term => term.enabled !== false);
      const formula = terms.map(term => `${term.weight_key || 'w'} * ${getObjectiveDisplayFormula(term)}`).join(' + ') || '0';
      return {
        source: 'model_draft_generated',
        sections: buildConstraintsFromDraft(draft).map(row => ({
          type: 'constraint',
          title: row.name,
          formula: getConstraintDisplayFormula(row),
          expression: getConstraintDisplayFormula(row),
          display_formula: getConstraintDisplayFormula(row),
          business_meaning: row.business_meaning,
          source_component: row.source_component,
          source: row.source,
          enabled: row.enabled,
          core: row.core,
          editable: row.editable
        })),
        objective: { sense: draft.objective?.sense || 'minimize', formula, terms: draft.objective?.terms || [] }
      };
    }

    function componentGeneratedOwner(item = {}) {
      const source = String(item.source || '');
      return item.source_component || item.owner_component || item.generated_by_component || (source.startsWith('component_required_set:') ? source.split(':')[1] : '');
    }

    function isComponentGeneratedArtifact(item = {}) {
      const source = String(item.source || '');
      return !!componentGeneratedOwner(item) || source === 'component_generated' || source === 'component_required_set' || source.startsWith('component_required_set:');
    }

    function keepSemanticArtifactForComponents(item = {}, activeComponentIds = new Set()) {
      if (item.source === 'user_defined' || item.user_modified === true) return true;
      if (!isComponentGeneratedArtifact(item)) return true;
      const owners = new Set([componentGeneratedOwner(item), ...(item.required_by || []), ...(item.used_by || [])].filter(Boolean));
      return [...owners].some(owner => activeComponentIds.has(owner));
    }

    function pruneComponentGeneratedArtifacts(componentId = '') {
      const activeComponentIds = new Set((state.componentBuilder?.components || []).filter(c => c.enabled !== false).map(c => c.type || c.component_id || c.code).filter(Boolean));
      const pruneList = list => (list || []).filter(item => keepSemanticArtifactForComponents(item, activeComponentIds));
      const spec = getSemanticSpec();
      spec.sets = pruneList(spec.sets);
      spec.parameters = pruneList(spec.parameters);
      spec.variables = pruneList(spec.variables);
      spec.constraints = pruneList(spec.constraints);
      spec.objectives = pruneList(spec.objectives);
      spec.business_objects = spec.objects = pruneList(spec.objects);
      state.semanticSpecText = JSON.stringify(normalizeSemanticSpec(spec), null, 2);
      const current = parseJsonOr(state.componentBuilder?.componentSpecText || state.componentSpecText || '{}', '{}');
      current.sets = pruneList(current.sets);
      current.parameters = pruneList(current.parameters);
      current.variables = pruneList(current.variables);
      current.additional_custom_constraints = pruneList(current.additional_custom_constraints);
      current.objective = { ...(current.objective || {}), terms: pruneList(current.objective?.terms || []) };
      state.componentBuilder.componentSpecText = JSON.stringify(current, null, 2);
      state.componentSpecText = state.componentBuilder.componentSpecText;
      const draft = getCurrentModelDraft();
      draft.semantic = {
        ...(draft.semantic || {}),
        sets: pruneList(draft.semantic?.sets),
        parameters: pruneList(draft.semantic?.parameters),
        variables: pruneList(draft.semantic?.variables),
        objects: pruneList(draft.semantic?.objects)
      };
      draft.constraints = pruneList(draft.constraints);
      draft.generated_constraints = pruneList(draft.generated_constraints);
      draft.objective = { ...(draft.objective || {}), terms: pruneList(draft.objective?.terms || []) };
      draft.mathematical_expansion = { sections: [], objective: { sense: draft.objective?.sense || 'minimize', formula: '0', terms: [] } };
      delete draft.problem_type_diagnosis;
      delete draft.objective_strategy;
      state.modelDraft = draft;
      if (state.editingSetCode && !((draft.semantic?.sets || []).some(s => (s.code || s.key) === state.editingSetCode))) {
        state.editingSetCode = '';
        state.semanticSetFormDraft = null;
      }
      return draft;
    }

    function componentSemanticKeys(component = {}) {
      const definition = component.definition || componentRegistryMeta(component.type || component.component_id || component.code) || {};
      const keyOf = item => item.key || item.code || item.name || item.math_param || item.math_var;
      return {
        componentId: component.type || component.component_id || component.code || definition.component_id || definition.type || '',
        parameters: new Set([
          ...(definition.inputs || []),
          ...(definition.required_parameters || []),
          ...(definition.parameters || []).map(keyOf)
        ].filter(Boolean)),
        variables: new Set([
          ...(definition.outputs || []),
          ...(definition.variables || []).map(keyOf)
        ].filter(Boolean)),
        constraints: new Set([
          ...(definition.generated_constraints || []).map(item => item.constraint_id || item.code || item.name)
        ].filter(Boolean)),
        objectives: new Set([
          ...(definition.generated_objective_terms || []).map(item => item.term_id || item.code || item.name || item.weight_key)
        ].filter(Boolean))
      };
    }

    function tagSemanticArtifactsForComponents(spec = {}, components = []) {
      const active = (components || []).filter(c => c.enabled !== false).map(componentSemanticKeys).filter(item => item.componentId);
      const tagList = (items = [], kind = 'parameters') => (items || []).map(item => {
        if (item.source === 'user_defined' || item.user_modified === true) return item;
        const key = item.math_param || item.math_var || item.key || item.code || item.name || item.constraint_id || item.term_id || item.weight_key;
        const owners = active.filter(meta => meta[kind]?.has(key)).map(meta => meta.componentId);
        if (!owners.length) return item;
        const owner = item.source_component || item.owner_component || item.generated_by_component || owners[0];
        return {
          ...item,
          source: item.source || 'component_generated',
          source_component: owner,
          owner_component: owner,
          generated_by_component: owner,
          required_by: [...new Set([...(item.required_by || []), ...owners])],
          used_by: [...new Set([...(item.used_by || []), ...owners])]
        };
      });
      return {
        ...spec,
        parameters: tagList(spec.parameters, 'parameters'),
        variables: tagList(spec.variables, 'variables'),
        constraints: tagList(spec.constraints, 'constraints'),
        objectives: tagList(spec.objectives, 'objectives')
      };
    }

    function buildMathematicalExpansion(semanticSpec = {}, componentSpec = {}) {
      if (state.modelDraft?.components?.length) return generateMathematicalExpansionFromDraft(buildModelDraftFromState(semanticSpec, componentSpec));
      const enabled = new Set((componentSpec.components || []).map(c => c.type || c.code));
      return {
        model_code: componentSpec.model_code || semanticSpec.model_code || 'cascade_hydro_dispatch',
        build_mode: 'component_based',
        constraints: HYDRO_CONSTRAINT_RELATIONS
          .filter(([, , , component]) => enabled.has(component))
          .map(([kind, name, expression, component]) => ({ kind, name, expression, source_component: component })),
        balance_relations: HYDRO_CONSTRAINT_RELATIONS
          .filter(([kind, , , component]) => enabled.has(component) && ['平衡关系', '水量关系', '状态递推', '负荷平衡', '梯级关系'].includes(kind))
          .map(([kind, name, expression, component]) => ({ kind, name, expression, source_component: component })),
        objective: componentSpec.objective || { type: 'weighted_sum', sense: 'minimize', terms: HYDRO_OBJECTIVE_WEIGHTS.map(([, code, weight]) => ({ code, weight })) },
        additional_custom_constraints: (componentSpec.additional_custom_constraints || []).map(item => ({
          ...item,
          participation: '参与求解',
          supported_expression: 'simple_boundary'
        }))
      };
    }

    function parseRuntimeParametersForBuild(isComponentBased, semanticSpec) {
      if (!isComponentBased) return buildRuntimeParameterDefaultsFromSemantic(semanticSpec);
      try {
        const text = state.runtimeParametersText || state.componentBuilder?.runtimeParametersText || '{}';
        return JSON.parse(text || '{}');
      } catch (e) {
        throw new Error(`组件化模型运行参数 JSON 解析失败：${e.message}`);
      }
    }

    function getComponentSpecFromBuilder(semanticSpec = getSemanticSpec()) {
      if (state.builderMode === 'component_based' && state.componentBuilder?.components?.length) {
        return refreshComponentSpecFromUi();
      }
      try {
        const spec = JSON.parse(state.componentSpecText || '{}');
        return Object.keys(spec).length ? spec : (semanticSpec.component_spec || {});
      } catch (e) {
        throw new Error(`组件化模型JSON解析失败：${e.message}`);
      }
    }

    function getGenericSpec() {
      try {
        if (state.genericBuilderMode === 'indexed') {
          return normalizeIndexedGenericParts({
            sense: state.genericSense,
            sets: JSON.parse(state.genericSetsText || '{}'),
            parameters: JSON.parse(state.genericParametersText || '{}'),
            variables: JSON.parse(state.genericIndexedVariablesText || '[]'),
            constraints: JSON.parse(state.genericIndexedConstraintsText || '[]'),
            objective: JSON.parse(state.genericIndexedObjectiveText || '{}')
          });
        }
        return {
          sense: state.genericSense,
          parameters: JSON.parse(state.genericParametersText || '{}'),
          variables: JSON.parse(state.genericVariablesText || '[]'),
          constraints: JSON.parse(state.genericConstraintsText || '[]'),
          objective: JSON.parse(state.genericObjectiveText || '{}')
        };
      } catch (e) {
        throw new Error(`通用模型JSON解析失败：${e.message}`);
      }
    }

    function pageBuilder() {
      return shell('模型创建', '创建可发布的优化模型：固定业务语义、变量结构、目标函数和约束逻辑；求解时由任务中心注入运行时参数并生成实例化模型。', '') +
      (!state.backendOnline ? offlineStateHtml('真实模型资产') : '') +
      `<div class="builder-layout">
        <div class="mt">${builderWizard()}</div>
        <div class="mt builder-step-body">${builderCurrentStepPanel()}</div>
        <div class="builder-footer">
          <span class="muted" style="font-size:13px;margin-right:auto">第 ${(state.builderStep || 0) + 1} / 5 步</span>
          <button class="btn" onclick="setBuilderStep(Math.max(0,state.builderStep-1))">上一步</button>
          <button class="btn" onclick="setBuilderStep(Math.min(4,state.builderStep+1))">下一步</button>
          ${state.builderStep < 4 ? `<button class="btn" onclick="validateGenericSpec()">校验模型</button><button class="btn" onclick="generateModelPackage()">生成模型包</button>` : ''}
          <button class="btn primary" ${productionDisabledAttr()} onclick="saveModelToAssets('overwrite')">保存草稿</button>
          <button class="btn green" ${productionDisabledAttr()} onclick="saveModelToAssets('copy')">发布模型</button>
        </div>
      </div>`;
    }

    function generateModelPackage() {
      try {
        if (state.builderMode === 'component_based' || !state.useGenericBuilder) {
          refreshComponentSpecFromUi();
        } else {
          validateGenericSpec();
        }
        state.modelReady = true;
        toast('模型包已生成，可继续保存或发布');
        render();
      } catch (e) {
        toast(`生成模型包失败：${e.message}`);
      }
    }

    function isHydroBuilderScene() {
      return String(state.activeDomain || '').includes('梯级水电') || String(state.activeModel || '').includes('梯级水电');
    }

    function builderCurrentStepPanel() {
      const step = state.builderStep || 0;
      if (step === 0) return panel('第 1 步：基本信息', builderObjectPanel(), '<span class="pill blue">基本信息</span>');
      if (step === 1) return panel('第 2 步：模型语义', semanticLayerEditor(), '<span class="pill green">semantic_spec</span>');
      if (step === 2) return panel('第 3 步：数学展开', isComponentBuilderMode() ? componentModelBuilder() : genericModelBuilder(), `<span class="pill ${isComponentBuilderMode() ? 'green' : state.useGenericBuilder ? 'green' : 'amber'}">${builderModeText()}</span>`);
      if (step === 3) return panel('第 4 步：运行参数', runtimeContractPanel(), '<span class="pill blue">runtime schema</span>');
      return `<div class="grid cols-2">${panel('模型生成预览', modelPreview())}${panel('第 5 步：校验发布', builderStepPanel())}</div>`;
    }

    function nextBuilderStep() {
      if ((state.builderStep || 0) === 1) {
        const spec = getSemanticSpec();
        if (isComponentBuilderMode()) {
          const componentSpec = getComponentSpecFromBuilder(spec);
          if (!(componentSpec.components || []).length) return toast('请先加载或添加至少一个组件');
        } else if (!(spec.sets || []).length) return toast('请先定义至少一个集合');
      }
      if ((state.builderStep || 0) === 2) {
        if (isComponentBuilderMode()) {
          const spec = getComponentSpecFromBuilder();
          if (!(spec.components || []).length) return toast('请先配置组件清单');
          if (!(spec.variables || []).length) return toast('请先生成包含变量清单的 Component Spec');
        } else {
          const spec = getSemanticSpec();
          if (!(spec.variables || []).length) return toast('请先定义至少一个变量');
        }
      }
      state.builderStep = Math.min(4, (state.builderStep || 0) + 1);
      render();
    }

    function semanticLayerEditor() {
      let spec = {};
      try { spec = getSemanticSpec(); } catch (e) {}
      return `<div class="semantic-step-scroll-list">
        ${panel('1. 索引集合', semanticObjectsAndSetsEditor(spec))}
        ${panel('2. 参数与变量', semanticParametersAndVariablesEditor(spec))}
        ${panel('3. 约束与目标', semanticRulesAndObjectivesEditor(spec))}
        ${state.advancedMode ? `<div class="field mt"><label>Semantic Spec JSON（高级模式）</label><textarea onchange="updateSemanticJson(this.value)">${state.semanticSpecText}</textarea></div>` : ''}
      </div>`;
    }

    function componentSemanticOverview(draft = getCurrentModelDraft(), spec = {}) {
      const semantic = draft.semantic || {};
      const sets = semantic.sets || spec.sets || [];
      const params = semantic.parameters || spec.parameters || [];
      const variables = semantic.variables || spec.variables || [];
      const outputs = semantic.outputs || spec.outputs || [];
      const hasSemantic = sets.length || params.length || variables.length || outputs.length;
      const advanced = state.advancedMode ? `<div class="field mt"><label>高级语义配置：Semantic Spec JSON</label><textarea onchange="updateSemanticJson(this.value)">${state.semanticSpecText}</textarea></div>` : '';
      const rowName = item => item.name || item.display_name || item.key || item.code || item.math_param || item.math_var || '-';
      const rowCode = item => item.key || item.code || item.math_param || item.math_var || item.id || '-';
      const dimensions = item => Array.isArray(item.dimension) ? item.dimension.join(', ') : (item.dimension || item.indices || '-');
      const table = (headers, rows, emptyText) => {
        if (!rows.length) return `<div class="empty-state" style="min-height:60px"><strong>${emptyText}</strong></div>`;
        return `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, ci) => `<td ${ci > 1 ? 'class="cell-truncate"' : ''} title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      };
      if (!hasSemantic) {
        return `<div>
          ${emptyState('当前模型暂未配置组件化建模模板。可以从组件库添加组件，或切换为通用线性 Builder。')}
          <div class="mt">${componentSetConfigurationEditor(draft)}</div>
          <div class="actions mt"><button class="btn ${state.advancedMode ? 'primary' : ''}" onclick="toggleAdvancedMode()">${state.advancedMode ? '收起高级语义配置' : '展开高级语义配置'}</button></div>
          ${advanced}
        </div>`;
      }
      return `<div>
        <div class="mt">${componentSetConfigurationEditor(draft)}</div>
        <div class="grid cols-2">
          <div>${panel('索引集合', table(['中文名称', '编码', '业务含义', '成员/维度', '单位', '示例'], sets.map(s => [rowName(s), rowCode(s), s.description || s.business_meaning || '-', Array.isArray(s.values) ? s.values.join(', ') : dimensions(s), s.unit || '-', s.example || '-']), '暂无集合。'))}</div>
          <div>${panel('参数与变量', `
            ${table(['中文名称', '编码', '业务含义', '维度', '单位', '示例'], params.map(p => [rowName(p), rowCode(p), p.meaning || p.description || p.business_meaning || '-', dimensions(p), p.unit || '-', p.example || JSON.stringify(p.default_value ?? '-')]), '暂无参数。')}
            <div class="mt">${table(['中文名称', '编码', '业务含义', '维度', '单位', '示例'], variables.map(v => [rowName(v), rowCode(v), v.meaning || v.description || v.business_meaning || '-', dimensions(v), v.unit || '-', v.example || v.domain || '-']), '暂无变量。')}</div>
          `)}</div>
        </div>
        <div class="mt">${panel('输出结果', table(['中文名称', '编码', '业务含义', '维度', '单位', '示例'], outputs.map(o => [rowName(o), rowCode(o), o.meaning || o.description || o.business_meaning || '-', dimensions(o), o.unit || '-', o.example || '-']), '暂无输出定义。'))}</div>
        <div class="grid cols-2 mt">
          <div class="card"><strong>当前建模方式</strong><p>${builderModeText()}</p></div>
          <div class="card"><strong>公式来源</strong><p>${formulaSourceText()}</p></div>
        </div>
        <div class="actions mt"><button class="btn ${state.advancedMode ? 'primary' : ''}" onclick="toggleAdvancedMode()">${state.advancedMode ? '收起高级语义配置' : '展开高级语义配置'}</button></div>
        ${advanced}
      </div>`;
    }

    function domainSemanticOverview(spec = {}) {
      return semanticLayerOverview(spec);
      const advanced = state.advancedMode ? `<div class="field mt"><label>高级语义配置：Semantic Spec JSON</label><textarea onchange="updateSemanticJson(this.value)">${state.semanticSpecText}</textarea></div>` : '';
      const table = (headers, rows) => `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td class="cell-truncate" title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return `<div>
        <div class="card">
          <div class="panel-title"><span>水电业务语义总览</span><span class="pill green">组件化水电</span></div>
          <div class="grid cols-4">
            <div><strong>调度对象</strong><p>梯级水电站、水库、机组、上下游河段和 15 分钟调度时段。</p></div>
            <div><strong>输入数据</strong><p>负荷预测、来水、库容边界、机组检修、流量边界、传播时滞和目标权重。</p></div>
            <div><strong>输出结果</strong><p>各站出力、发电流量、弃水、下泄流量、库容轨迹、负荷偏差和期末库容偏差。</p></div>
            <div><strong>优化目标</strong><p>负荷偏差最小、弃水最小、期末库容偏差可控，并平滑出力波动。</p></div>
          </div>
        </div>
        <div class="mt">${panel('业务对象表', table(['业务对象', '编码', '说明', '示例'], HYDRO_SEMANTIC_OBJECTS))}</div>
        <div class="mt">${panel('输入参数表', table(['中文名称', '英文编码', '业务含义', '维度', '维度含义', '单位/示例'], HYDRO_INPUT_PARAMETERS))}</div>
        <div class="mt">${panel('输出变量表', table(['中文名称', '英文编码', '业务含义', '维度', '维度含义', '单位'], HYDRO_OUTPUT_VARIABLES))}</div>
        <div class="grid cols-2 mt">
          <div class="card"><strong>当前建模方式</strong><p>${builderModeText()}</p></div>
          <div class="card"><strong>公式来源</strong><p>${formulaSourceText()}</p></div>
        </div>
        <div class="actions mt"><button class="btn ${state.advancedMode ? 'primary' : ''}" onclick="toggleAdvancedMode()">${state.advancedMode ? '收起高级语义配置' : '展开高级语义配置'}</button></div>
        ${advanced}
      </div>`;
    }

    function optionList(items, valueFn = item => item.key, labelFn = item => item.name || item.key, selected = '') {
      return (items || []).map(item => {
        const value = valueFn(item);
        return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(labelFn(item))}</option>`;
      }).join('');
    }

    function multiCheckSelect(id, items = [], selected = [], placeholder = '请选择') {
      const selectedSet = new Set((selected || []).map(String));
      const options = (items || []).map(item => {
        const value = item.key || item.code || item.name || '';
        const label = item.name && item.name !== value ? `${item.name} ${value}` : value;
        const checked = selectedSet.has(String(value));
        return {
          value: String(value),
          label: String(label || value),
          checked
        };
      }).filter(item => item.value);
      const selectedLabels = options.filter(item => item.checked).map(item => item.label);
      const buttonText = selectedLabels.length ? selectedLabels.join('、') : placeholder;
      const hiddenOptions = options.map(item => `<option value="${escapeHtml(item.value)}" ${item.checked ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
      const checks = options.length
        ? options.map(item => `<label class="multi-check-option"><input type="checkbox" data-multi-for="${escapeHtml(id)}" value="${escapeHtml(item.value)}" ${item.checked ? 'checked' : ''} onchange="syncMultiCheckSelect('${escapeHtml(id)}')" /> <span>${escapeHtml(item.label)}</span></label>`).join('')
        : '<div class="multi-check-empty">暂无可选集合</div>';
      return `<div class="multi-check-select" id="${escapeHtml(id)}Dropdown">
        <button type="button" class="multi-check-trigger" onclick="toggleMultiCheckSelect('${escapeHtml(id)}')" aria-haspopup="listbox" aria-expanded="false"><span id="${escapeHtml(id)}Text" class="${selectedLabels.length ? '' : 'muted'}">${escapeHtml(buttonText)}</span><span class="multi-check-caret">⌄</span></button>
        <div class="multi-check-menu">${checks}</div>
        <select id="${escapeHtml(id)}" multiple hidden>${hiddenOptions}</select>
      </div>`;
    }

    function toggleMultiCheckSelect(id) {
      document.querySelectorAll('.multi-check-select.open').forEach(el => {
        if (el.id !== `${id}Dropdown`) el.classList.remove('open');
      });
      const root = document.getElementById(`${id}Dropdown`);
      if (!root) return;
      root.classList.toggle('open');
      root.querySelector('.multi-check-trigger')?.setAttribute('aria-expanded', root.classList.contains('open') ? 'true' : 'false');
    }

    function syncMultiCheckSelect(id) {
      const root = document.getElementById(`${id}Dropdown`);
      const select = document.getElementById(id);
      if (!root || !select) return;
      const checkedValues = new Set(Array.from(root.querySelectorAll(`input[data-multi-for="${id}"]:checked`)).map(input => input.value));
      Array.from(select.options || []).forEach(option => { option.selected = checkedValues.has(option.value); });
      updateMultiCheckSelectLabel(id);
    }

    function updateMultiCheckSelectLabel(id) {
      const root = document.getElementById(`${id}Dropdown`);
      const text = document.getElementById(`${id}Text`);
      const select = document.getElementById(id);
      if (!root || !text || !select) return;
      const labels = Array.from(select.selectedOptions || []).map(option => option.textContent.trim()).filter(Boolean);
      text.textContent = labels.length ? labels.join('、') : '请选择';
      text.classList.toggle('muted', !labels.length);
      const selectedValues = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
      root.querySelectorAll(`input[data-multi-for="${id}"]`).forEach(input => { input.checked = selectedValues.has(input.value); });
    }

    function variableDomainOptions(selected = '') {
      const rows = [
        ['NonNegativeReals', '非负连续变量'],
        ['Reals', '连续变量'],
        ['Integers', '整数变量'],
        ['NonNegativeIntegers', '非负整数变量'],
        ['Binary', '0/1 二进制变量']
      ];
      return rows.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}（${value}）</option>`).join('');
    }

    function variableDomainLabel(value) {
      return {
        NonNegativeReals: '非负连续变量',
        Reals: '连续变量',
        Integers: '整数变量',
        NonNegativeIntegers: '非负整数变量',
        Binary: '0/1 二进制变量',
        '连续变量': '连续变量',
        '二进制变量': '0/1 二进制变量'
      }[value] || value || '-';
    }

    function semanticParameterFormSeed(sets = []) {
      const hasSets = (sets || []).length > 0;
      return {
        key: '',
        name: '',
        unit: '',
        source_system: '',
        default_value_text: hasSets ? '{}' : '0',
        meaning: '',
        validation_text: ''
      };
    }

    function semanticVariableFormSeed() {
      return {
        key: '',
        name: '',
        unit: '',
        meaning: '',
        source_system: '',
        lb: '0',
        ub: '',
        output: true
      };
    }

    function semanticConstraintFormSeed() {
      return {
        code: '',
        name: '',
        business_rule: '',
        math_constraint: '',
        source: 'user_defined'
      };
    }

    function semanticObjectsAndSetsEditor(spec) {
      const sets = spec.sets || [];
      const requiredByLabel = item => [...new Set([...(item.required_by || []), ...(item.used_by || [])].filter(Boolean))].join('、') || '-';
      const valueText = value => {
        if (value === undefined || value === null || value === '') return '-';
        if (Array.isArray(value)) return value.join(', ') || '-';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      };
      const detailBlock = value => `<div class="semantic-detail-cell" title="${escapeHtml(valueText(value))}">${escapeHtml(valueText(value))}</div>`;
      const codeNameCell = (name, code) => `${escapeHtml(name || code || '-')}<br><span class="muted">${escapeHtml(code || '-')}</span>`;
      const setRows = sets.map((s, i) =>
        `<tr><td>${codeNameCell(s.name, s.key || s.code)}</td><td>${escapeHtml(setTypeLabel(s.type || 'normal'))}</td><td><div class="formula-cell">${escapeHtml(valueText(s.members || s.values || s.rule || s.generator || '-'))}</div></td><td>${detailBlock(s.description || s.meaning || s.business_meaning)}</td><td>${detailBlock(s.source)}</td><td>${detailBlock(s.source_component)}</td><td>${detailBlock(requiredByLabel(s))}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('sets', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('sets', ${i})">删除</button></div></td></tr>`
      ).join('') || `<tr><td colspan="8"><div class="empty-state" style="min-height:60px"><strong>暂无集合</strong></div></td></tr>`;
      return `<div class="formula-editor-shell">
        <div class="formula-subblock">
          <div class="formula-subtitle"><span>索引集合 sets</span><button class="btn" onclick="addSemanticSetFromForm()">新增/更新集合</button></div>
          <div class="notice blue"><strong>配置说明</strong><p>索引集合直接用于参数、变量、约束和目标函数展开；业务对象不再单独维护。</p></div>
          ${semanticSetEditorForm([], sets)}
          <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-set-table"><colgroup><col style="width:180px"><col style="width:120px"><col style="width:360px"><col style="width:240px"><col style="width:170px"><col style="width:170px"><col style="width:170px"><col style="width:132px"></colgroup><thead><tr><th>集合</th><th>集合类型</th><th>成员/生成规则</th><th>说明</th><th>来源</th><th>来源组件</th><th>依赖项</th><th class="ops-col">操作</th></tr></thead><tbody>${setRows}</tbody></table></div>
        </div>
      </div>`;
    }

    function semanticParametersAndVariablesEditor(spec) {
      const sets = spec.sets || [];
      const params = spec.parameters || [];
      const variables = spec.variables || [];
      const paramSeed = semanticParameterFormSeed(sets);
      const variableSeed = semanticVariableFormSeed();
      const valueText = value => {
        if (value === undefined || value === null || value === '') return '-';
        if (Array.isArray(value)) return value.join(', ') || '-';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      };
      const detailBlock = value => `<div class="semantic-detail-cell" title="${escapeHtml(valueText(value))}">${escapeHtml(valueText(value))}</div>`;
      const jsonBlock = value => `<pre class="json-cell semantic-json-cell">${escapeHtml(valueText(value))}</pre>`;
      const paramDefaultBlock = p => `<pre class="json-cell semantic-json-cell">${escapeHtml(parameterDefaultDisplayValue(p, spec))}</pre>`;
      const codeNameCell = (name, code) => `${escapeHtml(name || code || '-')}<br><span class="muted">${escapeHtml(code || '-')}</span>`;
      const paramRows = params.map((p, i) =>
        `<tr><td>${codeNameCell(p.name, p.math_param || p.key || p.code)}</td><td>${escapeHtml(p.unit || '-')}</td><td>${escapeHtml((p.dimension || []).join(',') || '-')}</td><td>${detailBlock(p.source_system || p.source)}</td><td>${escapeHtml(p.runtime_injected === false ? '否' : '是')}</td><td>${paramDefaultBlock(p)}</td><td>${jsonBlock(parameterValidationRule(p))}</td><td>${detailBlock(p.meaning || p.description || p.business_meaning)}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('parameters', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('parameters', ${i})">删除</button></div></td></tr>`
      ).join('') || `<tr><td colspan="9"><div class="empty-state" style="min-height:60px"><strong>暂无参数</strong></div></td></tr>`;
      const varRows = variables.map((v, i) =>
        `<tr><td>${codeNameCell(v.name, v.math_var || v.key || v.code)}</td><td>${escapeHtml(v.unit || '-')}</td><td>${escapeHtml((v.dimension || []).join(',') || '-')}</td><td>${escapeHtml(variableDomainLabel(v.domain))}</td><td>${escapeHtml(v.lb ?? v.lower_bound ?? '-')}</td><td>${escapeHtml(v.ub ?? v.upper_bound ?? '-')}</td><td>${escapeHtml(v.ub_param || '-')}</td><td>${detailBlock(v.source_system || v.source)}</td><td>${escapeHtml(v.output === false ? '否' : '是')}</td><td>${detailBlock(v.meaning || v.description || v.business_meaning)}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('variables', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('variables', ${i})">删除</button></div></td></tr>`
      ).join('') || `<tr><td colspan="11"><div class="empty-state" style="min-height:60px"><strong>暂无变量</strong></div></td></tr>`;
      return `<div class="formula-editor-shell">
        <div class="formula-subblock">
          <div class="formula-subtitle"><span>运行参数 parameters</span><button class="btn" onclick="addSemanticParameterFromForm()">新增/更新参数</button></div>
          <div class="notice blue"><strong>字段说明</strong><p>默认值用于发布 dry-run 和缺省兜底；校验规则由系统按维度和运行时注入状态自动生成。带维度默认值填 {} 时，系统会按集合自动展开。</p></div>
          <div class="grid form-grid-compact">
            <div class="field"><label>参数编码</label><input id="semanticParamKey" value="${escapeHtml(paramSeed.key)}" placeholder="runtime_parameter" /></div>
            <div class="field"><label>中文名称</label><input id="semanticParamName" value="${escapeHtml(paramSeed.name)}" placeholder="运行参数" /></div>
            <div class="field"><label>单位</label><input id="semanticParamUnit" value="${escapeHtml(paramSeed.unit)}" placeholder="-" /></div>
            <div class="field"><label>维度</label>${multiCheckSelect('semanticParamDimension', sets, [], '请选择维度')}</div>
            <div class="field"><label>来源系统</label><input id="semanticParamSource" value="${escapeHtml(paramSeed.source_system)}" placeholder="业务系统/人工录入" /></div>
            <div class="field"><label>默认值</label><input id="semanticParamDefault" value="${escapeHtml(paramSeed.default_value_text)}" placeholder="标量填 0；带维度可填 {} 自动展开" title="标量直接填值；数组/对象使用 JSON 的 [] 或 {}；带维度参数可填 {}，系统按集合成员自动生成默认值。" /></div>
            <div class="field"><label>是否运行时注入</label><select id="semanticParamRuntime"><option value="true">是</option><option value="false">否</option></select></div>
            <div class="field"><label>含义</label><input id="semanticParamMeaning" value="${escapeHtml(paramSeed.meaning)}" placeholder="业务运行时输入参数" /></div>
            <div class="field"><label>校验规则</label><input id="semanticParamValidation" value="${escapeHtml(paramSeed.validation_text)}" readonly placeholder="系统自动生成" /></div>
          </div>
          <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-param-table"><colgroup><col style="width:180px"><col style="width:90px"><col style="width:120px"><col style="width:170px"><col style="width:90px"><col style="width:220px"><col style="width:240px"><col style="width:230px"><col style="width:132px"></colgroup><thead><tr><th>参数名称</th><th>单位</th><th>维度</th><th>来源系统</th><th>运行时注入</th><th>默认值</th><th>校验规则</th><th>含义</th><th class="ops-col">操作</th></tr></thead><tbody>${paramRows}</tbody></table></div>
        </div>
        <div class="formula-subblock">
          <div class="formula-subtitle"><span>决策变量 variables</span><button class="btn" onclick="addSemanticVariableFromForm()">新增/更新变量</button></div>
          <div class="grid form-grid-compact">
            <div class="field"><label>变量编码</label><input id="semanticVarKey" value="${escapeHtml(variableSeed.key)}" placeholder="decision_variable" /></div>
            <div class="field"><label>中文名称</label><input id="semanticVarName" value="${escapeHtml(variableSeed.name)}" placeholder="决策变量" /></div>
            <div class="field"><label>单位</label><input id="semanticVarUnit" value="${escapeHtml(variableSeed.unit)}" placeholder="-" /></div>
            <div class="field"><label>索引集合</label>${multiCheckSelect('semanticVarDimension', sets, [], '请选择索引集合')}</div>
            <div class="field"><label>变量类型</label><select id="semanticVarDomain">${variableDomainOptions('NonNegativeReals')}</select></div>
            <div class="field"><label>上界参数</label><select id="semanticVarUbParam"><option value="">无</option>${optionList(params, p => p.math_param || p.key)}</select></div>
            <div class="field"><label>下界</label><input id="semanticVarLb" value="${escapeHtml(variableSeed.lb)}" /></div>
            <div class="field"><label>上界</label><input id="semanticVarUb" value="${escapeHtml(variableSeed.ub)}" placeholder="可选常数上界" /></div>
            <div class="field"><label>来源系统</label><input id="semanticVarSource" value="${escapeHtml(variableSeed.source_system)}" placeholder="优化模型输出/业务系统" /></div>
            <div class="field"><label>是否输出</label><select id="semanticVarOutput"><option value="true" ${variableSeed.output !== false ? 'selected' : ''}>是</option><option value="false" ${variableSeed.output === false ? 'selected' : ''}>否</option></select></div>
            <div class="field"><label>含义</label><input id="semanticVarMeaning" value="${escapeHtml(variableSeed.meaning)}" placeholder="业务决策变量" /></div>
          </div>
          <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-var-table"><colgroup><col style="width:180px"><col style="width:90px"><col style="width:130px"><col style="width:180px"><col style="width:90px"><col style="width:110px"><col style="width:150px"><col style="width:170px"><col style="width:90px"><col style="width:230px"><col style="width:132px"></colgroup><thead><tr><th>变量名称</th><th>单位</th><th>维度</th><th>变量类型</th><th>下界</th><th>上界</th><th>上界参数</th><th>来源系统</th><th>是否输出</th><th>含义</th><th class="ops-col">操作</th></tr></thead><tbody>${varRows}</tbody></table></div>
        </div>
      </div>`;
    }

    function semanticRulesAndObjectivesEditor(spec) {
      const constraints = spec.constraints || [];
      const objectives = spec.objectives || [];
      const sets = spec.sets || [];
      const constraintSeed = semanticConstraintFormSeed();
      const valueText = value => {
        if (value === undefined || value === null || value === '') return '-';
        if (Array.isArray(value)) return value.join(', ') || '-';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      };
      const detailBlock = value => `<div class="semantic-detail-cell" title="${escapeHtml(valueText(value))}">${escapeHtml(valueText(value))}</div>`;
      const codeNameCell = (name, code) => `${escapeHtml(name || code || '-')}<br><span class="muted">${escapeHtml(code || '-')}</span>`;
      const constraintRows = constraints.map((c, i) =>
        `<tr><td>${codeNameCell(c.name, c.code || c.key)}</td><td>${escapeHtml((c.foreach || c.indices || []).join(',') || '-')}</td><td>${detailBlock(c.business_rule || c.description)}</td><td>${detailBlock(c.math_constraint || c.expression || c.formula)}</td><td>${detailBlock(c.source || c.source_component || c.generated_by_component)}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('constraints', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('constraints', ${i})">删除</button></div></td></tr>`
      ).join('') || `<tr><td colspan="6"><div class="empty-state" style="min-height:60px"><strong>暂无约束</strong></div></td></tr>`;
      const objectiveRows = objectives.map((o, i) =>
        `<tr><td>${codeNameCell(o.name, o.code || o.key)}</td><td><span class="pill ${o.sense === 'maximize' ? 'green' : 'blue'}">${escapeHtml(o.sense || 'minimize')}</span></td><td>${detailBlock(o.business_goal || o.business_meaning || o.description)}</td><td>${detailBlock(o.source)}</td><td>${escapeHtml(o.weight_key || o.weight || '-')}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('objectives', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('objectives', ${i})">删除</button></div></td></tr>`
      ).join('') || `<tr><td colspan="6"><div class="empty-state" style="min-height:60px"><strong>暂无目标函数</strong></div></td></tr>`;
      return `<div class="formula-editor-shell">
        <div class="formula-subblock">
          <div class="formula-subtitle"><span>业务约束 constraints</span><button class="btn" onclick="addSemanticConstraintFromForm()">新增/更新约束</button></div>
          <div class="grid form-grid-compact">
            <div class="field"><label>约束编码</label><input id="semanticConstraintCode" value="${escapeHtml(constraintSeed.code)}" placeholder="business_constraint" /></div>
            <div class="field"><label>中文名称</label><input id="semanticConstraintName" value="${escapeHtml(constraintSeed.name)}" placeholder="业务约束" /></div>
            <div class="field"><label>作用索引</label>${multiCheckSelect('semanticConstraintForeach', sets, [], '请选择作用索引')}</div>
            <div class="field"><label>业务规则</label><input id="semanticConstraintRule" value="${escapeHtml(constraintSeed.business_rule)}" placeholder="业务约束说明" /></div>
            <div class="field"><label>数学说明</label><input id="semanticConstraintMath" value="${escapeHtml(constraintSeed.math_constraint || '从图形化公式编辑器生成')}" /></div>
            <div class="field"><label>来源</label><input id="semanticConstraintSource" value="${escapeHtml(constraintSeed.source)}" placeholder="user_defined / component_generated" /></div>
          </div>
          <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-rule-table"><colgroup><col style="width:190px"><col style="width:130px"><col style="width:280px"><col style="width:280px"><col style="width:190px"><col style="width:132px"></colgroup><thead><tr><th>约束名称</th><th>作用索引</th><th>业务规则</th><th>数学说明</th><th>来源</th><th class="ops-col">操作</th></tr></thead><tbody>${constraintRows}</tbody></table></div>
        </div>
        <div class="formula-subblock">
          <div class="formula-subtitle"><span>目标函数 objectives</span><button class="btn" onclick="addSemanticObjectiveFromForm()">新增/更新目标</button></div>
          <div class="grid form-grid-compact">
            <div class="field"><label>目标编码</label><input id="semanticObjectiveCode" value="${objectives[0]?.code || 'custom_objective'}" /></div>
            <div class="field"><label>中文名称</label><input id="semanticObjectiveName" value="${objectives[0]?.name || '用户自定义目标'}" /></div>
            <div class="field"><label>方向</label><select id="semanticObjectiveSense"><option value="minimize" ${objectives[0]?.sense !== 'maximize' ? 'selected' : ''}>minimize</option><option value="maximize" ${objectives[0]?.sense === 'maximize' ? 'selected' : ''}>maximize</option></select></div>
            <div class="field"><label>业务目标</label><input id="semanticObjectiveGoal" value="${objectives[0]?.business_goal || '用户自定义优化目标'}" /></div>
            <div class="field"><label>来源</label><input id="semanticObjectiveSource" value="${escapeHtml(objectives[0]?.source || 'user_defined')}" /></div>
            <div class="field"><label>权重参数</label><input id="semanticObjectiveWeight" value="${escapeHtml(objectives[0]?.weight_key || '')}" placeholder="可选，如 weights.cost" /></div>
          </div>
          <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-rule-table"><colgroup><col style="width:190px"><col style="width:120px"><col style="width:320px"><col style="width:180px"><col style="width:150px"><col style="width:132px"></colgroup><thead><tr><th>目标名称</th><th>方向</th><th>业务目标</th><th>来源</th><th>权重参数</th><th class="ops-col">操作</th></tr></thead><tbody>${objectiveRows}</tbody></table></div>
          <div class="actions mt"><button class="btn" onclick="syncGenericSpecFromSemantic();render();toast('已按语义层同步公式编辑器')">同步到公式编辑器</button></div>
        </div>
      </div>`;
    }

    function runtimeContractPanel() {
      let spec;
      try { spec = getSemanticSpec(); } catch (e) { return `<p>${escapeHtml(e.message)}</p>`; }
      if (isComponentBuilderMode()) return componentRuntimePanel(spec);
      const schema = buildRuntimeParameterSchemaFromSemantic(spec);
      if (!schema.length) {
        return `<div class="empty-state"><div class="empty-icon">📋</div><strong>暂无 runtime_injected 参数</strong><p>在参数表中标记"运行时注入"后，此处自动生成数据契约。</p></div>`;
      }
      return `<div>
        <div class="notice blue"><strong>默认值填写规则</strong><p>标量直接填值即可；数组和对象使用 JSON 的 [] / {}；文本可以直接填，也可以写成 JSON 字符串。</p></div>
        <div class="table-scroll mt"><table class="sticky-table compact-table" style="table-layout:fixed;width:100%"><colgroup><col style="width:130px"><col style="width:110px"><col style="width:80px"><col style="width:22%"><col style="width:22%"><col></colgroup><thead><tr><th>参数编码</th><th>名称/单位</th><th>维度</th><th>默认值</th><th>校验规则</th><th>来源/含义</th></tr></thead><tbody>${schema.map(p => `<tr><td><code>${escapeHtml(p.math_param)}</code></td><td>${escapeHtml(p.name)}<br><span class="muted">${escapeHtml(p.unit)}</span></td><td>${escapeHtml((p.dimension || []).join(',') || '-')}</td><td><pre class="json-cell">${escapeHtml(JSON.stringify(p.default_value, null, 2))}</pre></td><td><pre class="json-cell">${escapeHtml(JSON.stringify(p.validation, null, 2))}</pre></td><td class="cell-truncate" title="${escapeHtml(p.source_system + '；' + p.meaning)}">${escapeHtml(p.source_system)}；${escapeHtml(p.meaning)}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
    }

    function componentRuntimePanel(spec = {}) {
      const params = parseJsonOr(state.runtimeParametersText || state.componentBuilder?.runtimeParametersText || '{}', '{}');
      const schema = buildRuntimeParameterSchemaFromSemantic(spec);
      return `<div>
        <div class="grid cols-3">
          <div class="card"><strong>运行参数职责</strong><p>这里维护任务提交时注入的 runtime_parameters，不再编辑 Component Spec。</p></div>
          <div class="card"><strong>调度时段</strong><p>horizon = ${escapeHtml(params.horizon ?? '-')}；time 长度 = ${Array.isArray(params.time) ? params.time.length : 0}；time_volume 长度 = ${Array.isArray(params.time_volume) ? params.time_volume.length : 0}</p></div>
          <div class="card"><strong>常见错误</strong><p>horizon 与 time/time_volume 长度不一致、负荷或来水序列长度不足、机组 availability 长度不一致。</p></div>
        </div>
        <div class="grid cols-2 mt">
          ${panel('运行参数 JSON', `<textarea style="min-height:360px" onchange="state.runtimeParametersText=this.value;state.componentBuilder.runtimeParametersText=this.value;state.modelReady=false">${escapeHtml(state.runtimeParametersText || '{}')}</textarea><div class="actions mt"><button class="btn" onclick="loadComponentTemplateExample('cascade_hydro_dispatch')">加载样例参数</button><button class="btn" onclick="generateRuntimeTimeSets()">根据 horizon 生成 time/time_volume</button><button class="btn primary" onclick="validateComponentRuntimeParameters()">校验运行参数</button></div>`)}
          ${panel('参数中文说明', compactSchemaTable(schema, [
            { label: '参数', value: item => item.key || item.code || item.math_param || '-' },
            { label: '名称', value: item => item.name || '-' },
            { label: '维度', value: item => (item.dimension || []).join(', ') || '-' },
            { label: '说明', value: item => item.meaning || item.description || parameterMeaning(item.key || item.code || item.math_param || '') }
          ]))}
        </div>
        <div class="mt">${panel('目标权重表单', hydroRuntimeWeightFormHtml(params))}</div>
      </div>`;
    }

    function hydroRuntimeWeightFormHtml(params = currentRuntimeParameters()) {
      const weights = params.weights || {};
      return `<div><p class="muted">weights 会同步写入 runtime_parameters.weights，并在第 3 步目标函数配置中使用。</p>
        <div class="grid form-grid-compact">${HYDRO_OBJECTIVE_WEIGHTS.map(([name, code, fallback, meaning]) => `<div class="field"><label>${name}（${code}）</label><input value="${escapeHtml(weights[code] ?? fallback)}" onchange="updateHydroWeight('${code}', this.value)" /><small>${escapeHtml(meaning)}</small></div>`).join('')}</div>
      </div>`;
    }

    function generateRuntimeTimeSets() {
      try {
        const params = parseJsonOr(state.runtimeParametersText || '{}', '{}');
        const horizon = Number(params.horizon || (Array.isArray(params.load_forecast) ? params.load_forecast.length : 96));
        if (!Number.isInteger(horizon) || horizon <= 0) return toast('horizon 必须是正整数');
        params.horizon = horizon;
        params.time = Array.from({ length: horizon }, (_, i) => i);
        params.time_volume = Array.from({ length: horizon + 1 }, (_, i) => i);
        const selectedModel = state.savedModels.find(m => m.id === state.runtimeTemplateId) || {};
        const normalized = normalizeHydroRuntimeParameters(params, selectedModel);
        state.runtimeParametersText = JSON.stringify(normalized, null, 2);
        state.componentBuilder.runtimeParametersText = state.runtimeParametersText;
        state.modelReady = false;
        toast(`已根据 horizon=${horizon} 生成 time/time_volume`);
        render();
      } catch (e) {
        toast(`运行参数 JSON 解析失败：${e.message}`);
      }
    }

    function validateComponentRuntimeParameters() {
      try {
        const params = parseJsonOr(state.runtimeParametersText || '{}', '{}');
        const horizon = Number(params.horizon);
        if (!Number.isInteger(horizon) || horizon <= 0) throw new Error('horizon 必须是正整数');
        if (!Array.isArray(params.time) || params.time.length !== horizon) throw new Error(`time 长度必须等于 horizon：当前 ${Array.isArray(params.time) ? params.time.length : 0}/${horizon}`);
        if (!Array.isArray(params.time_volume) || params.time_volume.length !== horizon + 1) throw new Error(`time_volume 长度必须等于 horizon + 1：当前 ${Array.isArray(params.time_volume) ? params.time_volume.length : 0}/${horizon + 1}`);
        ['load_forecast'].forEach(key => {
          if (!Array.isArray(params[key]) || params[key].length !== horizon) throw new Error(`${key} 长度必须等于 horizon`);
        });
        state.semanticValidationResult = { errors: [], warnings: [], infos: ['组件化水电运行参数校验通过'] };
        toast('组件化水电运行参数校验通过');
      } catch (e) {
        state.semanticValidationResult = { errors: [e.message], warnings: [], infos: [] };
        toast(`运行参数校验失败：${e.message}`);
      }
      render();
    }

    function selectedValues(id) {
      return Array.from(document.getElementById(id)?.selectedOptions || []).map(option => option.value).filter(Boolean);
    }

    function setSelectedValues(id, values = []) {
      const wanted = new Set((values || []).map(String));
      Array.from(document.getElementById(id)?.options || []).forEach(option => {
        option.selected = wanted.has(option.value);
      });
      updateMultiCheckSelectLabel(id);
    }

    function setInputValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    }

    function editSemanticItem(section, index) {
      const spec = getSemanticSpec();
      const item = (spec[section] || [])[index];
      if (!item) return;
      if (section === 'sets') {
        state.editingSetCode = item.key || item.code || '';
        state.semanticSetFormDraft = { ...item, key: item.key || item.code, code: item.code || item.key };
        render();
        setTimeout(() => {
          document.getElementById('semanticSetEditor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.getElementById('semanticSetEditor')?.classList.add('editing-highlight');
          updateSemanticSetTypeVisibility();
        }, 0);
        toast('已载入集合表单，修改后点击“保存集合配置”');
        return;
      }
      if (section === 'parameters') {
        const key = item.math_param || item.key;
        setInputValue('semanticParamKey', key);
        setInputValue('semanticParamName', item.name);
        setInputValue('semanticParamUnit', item.unit);
        setSelectedValues('semanticParamDimension', item.dimension || []);
        setInputValue('semanticParamSource', item.source_system);
        setInputValue('semanticParamDefault', semanticParameterDefaultInputValue(item, spec));
        setInputValue('semanticParamRuntime', String(item.runtime_injected !== false));
        setInputValue('semanticParamMeaning', item.meaning);
        setInputValue('semanticParamValidation', safeJson(parameterValidationRule(item)));
      }
      if (section === 'variables') {
        const key = item.math_var || item.key;
        setInputValue('semanticVarKey', key);
        setInputValue('semanticVarName', item.name);
        setInputValue('semanticVarUnit', item.unit);
        setSelectedValues('semanticVarDimension', item.dimension || []);
        setInputValue('semanticVarDomain', normalizeVariableDomain(item.domain));
        setInputValue('semanticVarUbParam', item.ub_param || '');
        setInputValue('semanticVarLb', item.lb ?? '');
        setInputValue('semanticVarUb', item.ub ?? '');
        setInputValue('semanticVarSource', item.source_system || '');
        setInputValue('semanticVarOutput', String(item.output !== false));
        setInputValue('semanticVarMeaning', item.meaning);
      }
      if (section === 'constraints') {
        setInputValue('semanticConstraintCode', item.code || item.name);
        setInputValue('semanticConstraintName', item.name);
        setSelectedValues('semanticConstraintForeach', item.foreach || []);
        setInputValue('semanticConstraintRule', item.business_rule || item.description);
        setInputValue('semanticConstraintMath', item.math_constraint || item.math_expression);
        setInputValue('semanticConstraintSource', item.source || '');
      }
      if (section === 'objectives') {
        setInputValue('semanticObjectiveCode', item.code);
        setInputValue('semanticObjectiveName', item.name);
        setInputValue('semanticObjectiveSense', item.sense || 'minimize');
        setInputValue('semanticObjectiveGoal', item.business_goal || item.business_meaning);
        setInputValue('semanticObjectiveSource', item.source || '');
        setInputValue('semanticObjectiveWeight', item.weight_key || '');
      }
      toast('已载入表单，修改后点击保存按钮即可覆盖保存');
    }

    function parseDefaultValue(raw, dimension) {
      const text = raw?.trim();
      if (!text) return (Array.isArray(dimension) && dimension.length) ? {} : defaultValueForDimension(dimension);
      try { return JSON.parse(text); } catch (e) {
        const numeric = Number(text);
        return Number.isNaN(numeric) ? text : numeric;
      }
    }

    function parameterValidationRule(param = {}) {
      const dimension = Array.isArray(param.dimension) ? param.dimension : [];
      const required = param.runtime_injected === false ? false : true;
      const rule = { required };
      if (!dimension.length) {
        rule.type = 'number';
      } else {
        rule.type = 'dict';
        rule.keys = dimension.slice();
      }
      const existing = param.validation && typeof param.validation === 'object' ? param.validation : {};
      ['min', 'max', 'greater_than', 'less_than', 'length_matches', 'allowed_values'].forEach(key => {
        if (existing[key] !== undefined) rule[key] = existing[key];
      });
      return rule;
    }

    function semanticParameterDefaultInputValue(item, semanticSpec = null) {
      const value = item.default_value ?? item.default;
      if (isAutoGeneratedDimensionDefault(value, item.dimension || [], semanticSpec)) return '{}';
      return safeJson(value ?? '');
    }

    function parameterDefaultDisplayValue(item, semanticSpec = null) {
      const value = item.default_value ?? item.default;
      const dimension = Array.isArray(item.dimension) ? item.dimension : [];
      if (isAutoGeneratedDimensionDefault(value, dimension, semanticSpec)) {
        return `自动生成：${dimension.join(', ')} 全部为 0`;
      }
      if (dimension.length && isEmptyStructuredDefault(value)) return `自动生成：${dimension.join(', ')} 全部为 0`;
      if (value === undefined || value === null || value === '') return '-';
      if (Array.isArray(value)) return value.join(', ') || '-';
      if (typeof value === 'object') return JSON.stringify(value, null, 2);
      return String(value);
    }

    function parseOptionalSemanticValue(raw) {
      const text = raw?.trim();
      if (!text) return undefined;
      try { return JSON.parse(text); } catch (e) {
        const numeric = Number(text);
        return Number.isNaN(numeric) ? text : numeric;
      }
    }

    function semanticParamDimension(paramKey) {
      try {
        const spec = getSemanticSpec();
        const item = (spec.parameters || []).find(p => (p.math_param || p.key) === paramKey);
        return Array.isArray(item?.dimension) ? item.dimension : [];
      } catch (e) {
        return [];
      }
    }

    function semanticVariableDimension(varKey) {
      try {
        const spec = getSemanticSpec();
        const item = (spec.variables || []).find(v => (v.math_var || v.key) === varKey);
        return Array.isArray(item?.dimension) ? item.dimension : [];
      } catch (e) {
        return [];
      }
    }

    function updateSemanticJson(value) {
      try {
        state.semanticSpecText = value;
        syncGenericSpecFromSemantic({ preserveFormula: true });
        state.semanticValidationResult = validateSemanticAndGenericSpec(getSemanticSpec(), getGenericSpec());
      } catch (e) {
        state.semanticSpecText = value;
        state.semanticValidationResult = { errors: [e.message], warnings: [], infos: [] };
      }
      state.modelReady = false;
      render();
    }

    function addSemanticSetFromForm() {
      const spec = getSemanticSpec();
      updateSemanticSetFormDraftFromDom();
      const draftItem = semanticSetFormDraft();
      const key = document.getElementById('semanticSetKey')?.value?.trim();
      const name = document.getElementById('semanticSetName')?.value?.trim();
      const type = inferSemanticSetType(key, name, document.getElementById('semanticSetType')?.value || 'normal');
      const values = (document.getElementById('semanticSetValues')?.value || '').split(',').map(v => v.trim()).filter(Boolean);
      const item = {
        ...draftItem,
        key,
        code: key,
        name,
        type,
        values,
        members: values,
        description: document.getElementById('semanticSetDesc')?.value?.trim(),
        source: document.getElementById('semanticSetSource')?.value?.trim() || draftItem.source || '',
        source_component: document.getElementById('semanticSetSourceComponent')?.value?.trim() || draftItem.source_component || ''
      };
      if (!item.key) return toast('集合编码不能为空');
      if (type === 'time_period') {
        item.horizon = Number(document.getElementById('semanticSetHorizon')?.value || 0);
        item.time_granularity = Number(document.getElementById('semanticSetGranularity')?.value || 0);
        item.time_unit = document.getElementById('semanticSetTimeUnit')?.value || 'minute';
        item.start_time = document.getElementById('semanticSetStartTime')?.value || '';
        item.values = [];
        item.members = [];
        Object.assign(item, generateSetMembersForUi([item])[0]);
        const generatedMembers = Array.isArray(item.members) && item.members.length ? item.members : (Array.isArray(item.values) ? item.values : []);
        item.members = generatedMembers.slice();
        item.values = generatedMembers.slice();
      }
      if (type === 'state_time') {
        item.base_set = document.getElementById('semanticSetBaseSet')?.value || 'time';
        item.generation_rule = document.getElementById('semanticSetGenerationRule')?.value || 'horizon_plus_1';
        const existingSets = [...(isComponentBuilderMode() ? (getCurrentModelDraft().semantic?.sets || []) : (spec.sets || []))].filter(s => (s.code || s.key) !== item.key);
        Object.assign(item, generateSetMembersForUi([...existingSets, item]).find(s => (s.code || s.key) === item.key) || item);
      }
      item.configured = type === 'time_period'
        ? Boolean(item.horizon && item.time_granularity && item.members?.length)
        : type === 'state_time'
          ? Boolean(item.base_set && item.members?.length)
          : Boolean(item.members?.length || type === 'derived' || type === 'custom');
      item.source = draftItem.source || item.source || (item.source_component ? 'component_required_set' : 'user_defined');
      item.user_modified = true;
      spec.sets = [...(spec.sets || []).filter(s => (s.key || s.code) !== item.key), item];
      setSemanticSpec(spec);
      if (isComponentBuilderMode()) {
        const draft = getCurrentModelDraft();
        draft.semantic = { ...(draft.semantic || {}), sets: mergeRequiredSets(spec.sets, draft.components || []) };
        state.modelDraft = draft;
        refreshComponentSpecFromUi();
      }
      state.editingSetCode = item.key;
      state.semanticSetFormDraft = item;
      render();
    }

    function previewSemanticSetGeneration() {
      const type = document.getElementById('semanticSetType')?.value || 'normal';
      const preview = document.getElementById('semanticSetGeneratedPreview');
      if (!preview) return;
      if (type === 'time_period') {
        const horizon = Number(document.getElementById('semanticSetHorizon')?.value || 0);
        const granularity = Number(document.getElementById('semanticSetGranularity')?.value || 0);
        const unit = document.getElementById('semanticSetTimeUnit')?.value || 'minute';
        const minutes = granularity * (unit === 'hour' ? 60 : unit === 'day' ? 1440 : 1);
        const hours = horizon * minutes / 60;
        const days = hours / 24;
        preview.value = horizon > 0 ? `members=0..${horizon - 1}; delta_t=${minutes / 60} hour; window=${hours}h (${days.toFixed(2)}d)` : '-';
        return;
      }
      if (type === 'state_time') {
        preview.value = `${document.getElementById('semanticSetBaseSet')?.value || 'time'}; ${document.getElementById('semanticSetGenerationRule')?.value || 'horizon_plus_1'}`;
        return;
      }
      preview.value = '手工成员或自定义规则';
    }

    function updateSemanticSetTypeVisibility() {
      const type = document.getElementById('semanticSetType')?.value || 'normal';
      const showTimePeriod = type === 'time_period';
      const showStateTime = type === 'state_time';
      document.querySelectorAll('.semantic-time-period-field').forEach(el => { el.style.display = showTimePeriod ? '' : 'none'; });
      document.querySelectorAll('.semantic-state-time-field').forEach(el => { el.style.display = showStateTime ? '' : 'none'; });
      document.querySelectorAll('.semantic-generated-preview-field').forEach(el => { el.style.display = (showTimePeriod || showStateTime) ? '' : 'none'; });
      const manualMembers = document.getElementById('semanticSetValues');
      if (manualMembers) {
        manualMembers.disabled = showTimePeriod;
        manualMembers.placeholder = showTimePeriod ? 'time_period members are generated from horizon' : '';
        if (showTimePeriod) manualMembers.value = '';
      }
      previewSemanticSetGeneration();
    }

    function addSemanticParameterFromForm() {
      const spec = getSemanticSpec();
      const dimension = selectedValues('semanticParamDimension');
      const key = document.getElementById('semanticParamKey')?.value?.trim();
      if (!key) return toast('参数编码不能为空');
      const runtimeInjected = document.getElementById('semanticParamRuntime')?.value !== 'false';
      const item = {
        key,
        name: document.getElementById('semanticParamName')?.value?.trim() || key,
        math_param: key,
        unit: document.getElementById('semanticParamUnit')?.value?.trim() || '-',
        dimension,
        source_system: document.getElementById('semanticParamSource')?.value?.trim() || '-',
        runtime_injected: runtimeInjected,
        default_value: parseDefaultValue(document.getElementById('semanticParamDefault')?.value || '', dimension),
        meaning: document.getElementById('semanticParamMeaning')?.value?.trim() || '',
        source: 'user_defined',
        user_modified: true
      };
      item.validation = parameterValidationRule(item);
      spec.parameters = [...(spec.parameters || []).filter(p => (p.math_param || p.key) !== key), item];
      setSemanticSpec(spec);
      render();
    }

    function addSemanticVariableFromForm() {
      const spec = getSemanticSpec();
      const key = document.getElementById('semanticVarKey')?.value?.trim();
      if (!key) return toast('变量编码不能为空');
      const lbRaw = document.getElementById('semanticVarLb')?.value?.trim();
      const item = {
        key,
        name: document.getElementById('semanticVarName')?.value?.trim() || key,
        math_var: key,
        unit: document.getElementById('semanticVarUnit')?.value?.trim() || '-',
        dimension: selectedValues('semanticVarDimension'),
        domain: document.getElementById('semanticVarDomain')?.value || 'NonNegativeReals',
        ub_param: document.getElementById('semanticVarUbParam')?.value || '',
        source_system: document.getElementById('semanticVarSource')?.value?.trim() || '',
        output: document.getElementById('semanticVarOutput')?.value !== 'false',
        meaning: document.getElementById('semanticVarMeaning')?.value?.trim() || '',
        source: 'user_defined',
        user_modified: true
      };
      if (lbRaw !== '') {
        const lb = Number(lbRaw);
        if (!Number.isNaN(lb)) item.lb = lb;
      }
      const ubRaw = document.getElementById('semanticVarUb')?.value?.trim();
      if (ubRaw !== '') {
        const ub = Number(ubRaw);
        item.ub = Number.isNaN(ub) ? ubRaw : ub;
      }
      spec.variables = [...(spec.variables || []).filter(v => (v.math_var || v.key) !== key), item];
      setSemanticSpec(spec);
      render();
    }

    function addSemanticConstraintFromForm() {
      const spec = getSemanticSpec();
      const code = document.getElementById('semanticConstraintCode')?.value?.trim();
      if (!code) return toast('约束编码不能为空');
      const item = {
        code,
        name: document.getElementById('semanticConstraintName')?.value?.trim() || code,
        foreach: selectedValues('semanticConstraintForeach'),
        business_rule: document.getElementById('semanticConstraintRule')?.value?.trim() || '',
        math_constraint: document.getElementById('semanticConstraintMath')?.value?.trim() || '',
        source: document.getElementById('semanticConstraintSource')?.value?.trim() || 'user_defined',
        user_modified: true
      };
      spec.constraints = [...(spec.constraints || []).filter(c => (c.code || c.name) !== code), item];
      setSemanticSpec(spec);
      render();
    }

    function addSemanticObjectiveFromForm() {
      const spec = getSemanticSpec();
      const code = document.getElementById('semanticObjectiveCode')?.value?.trim() || 'custom_objective';
      const item = {
        code,
        name: document.getElementById('semanticObjectiveName')?.value?.trim() || code,
        sense: document.getElementById('semanticObjectiveSense')?.value || 'minimize',
        business_goal: document.getElementById('semanticObjectiveGoal')?.value?.trim() || '',
        source: document.getElementById('semanticObjectiveSource')?.value?.trim() || 'user_defined',
        weight_key: document.getElementById('semanticObjectiveWeight')?.value?.trim() || '',
        user_modified: true
      };
      spec.objectives = [item];
      spec.objective = { code: item.code, name: item.name, business_goal: item.business_goal };
      state.genericSense = item.sense;
      setSemanticSpec(spec);
      render();
    }

    function removeSemanticItem(section, index) {
      const spec = getSemanticSpec();
      const item = (spec[section] || [])[index];
      const key = item?.math_param || item?.math_var || item?.key || item?.code;
      const refs = findGenericReferences(section, key);
      if (refs.length) {
        toast(`该对象正在被公式层引用，请先删除相关公式项：${refs.join('、')}`);
        return;
      }
      spec[section] = (spec[section] || []).filter((_, i) => i !== index);
      if (section === 'objects') spec.business_objects = spec.objects;
      if (section === 'objectives') spec.objective = (spec.objectives || [])[0] || {};
      setSemanticSpec(spec);
      render();
    }

    function findGenericReferences(section, key) {
      if (!key) return [];
      let generic;
      try { generic = getGenericSpec(); } catch (e) { return []; }
      const refs = [];
      if (section === 'sets') {
        (generic.variables || []).forEach(v => { if ((v.indices || []).includes(key)) refs.push(`变量 ${v.name}`); });
        (generic.constraints || []).forEach(c => {
          if ((c.foreach || []).includes(key)) refs.push(`约束 ${c.name}`);
          (c.terms || []).forEach(t => { if ((t.key || []).includes(key) || (t.foreach || []).includes(key)) refs.push(`约束项 ${c.name}`); });
        });
        (generic.objective?.terms || []).forEach(t => { if ((t.foreach || []).includes(key) || (t.key || []).includes(key) || (t.param_key || []).includes(key)) refs.push('目标函数项'); });
      }
      if (section === 'parameters') {
        (generic.variables || []).forEach(v => { if (v.ub_param === key || v.lb_param === key) refs.push(`变量边界 ${v.name}`); });
        (generic.constraints || []).forEach(c => {
          if (c.rhs_param === key) refs.push(`约束右端 ${c.name}`);
          (c.terms || []).forEach(t => { if (t.coef_param === key) refs.push(`约束系数 ${c.name}`); });
        });
        (generic.objective?.terms || []).forEach(t => { if (t.coef_param === key) refs.push('目标函数系数'); });
      }
      if (section === 'variables') {
        (generic.constraints || []).forEach(c => (c.terms || []).forEach(t => { if (t.var === key) refs.push(`约束 ${c.name}`); }));
        (generic.objective?.terms || []).forEach(t => { if (t.var === key) refs.push('目标函数项'); });
      }
      return [...new Set(refs)];
    }

    function builderWizard() {
      const steps = ['基本信息', '模型语义', '数学展开', '运行参数', '校验发布'];
      return `<div style="display:flex;gap:10px;align-items:stretch">${steps.map((s, i) => `<button class="flow-step" onclick="setBuilderStep(${i})" style="flex:1;min-width:0;text-align:left;border-color:${state.builderStep === i ? '#2166c2' : 'var(--line)'};background:${state.builderStep === i ? 'var(--soft-blue)' : '#fff'}"><strong>${i + 1}. ${s}</strong><small>${builderDesc(i)}</small></button>`).join('')}</div>`;
    }

    function getSelectedScenarioModelMeta() {
      const catalog = scenarioModelCatalog();
      const scene = catalog.find(item => item.name === state.activeDomain);
      const models = scene?.models || [];
      const selected = models.find(item => item.name === state.activeModel || item.code === state.activeModel)
        || (models.length === 1 ? models[0] : null);
      if (!selected) return null;
      const hasSummary = selected.paradigmSummary || selected.objectiveSummary || selected.setSummary || selected.problemType;
      return hasSummary ? selected : null;
    }

    function builderBasicSummaryCards() {
      const meta = getSelectedScenarioModelMeta();
      const missing = '待补充模型元数据';
      const paradigm = meta?.paradigmSummary || meta?.problemType || missing;
      const objective = meta?.objectiveSummary || missing;
      const sets = meta?.setSummary || missing;
      return `
        <div class="card"><strong>模型范式</strong><p>${escapeHtml(paradigm)}</p><p class="muted">后续根据变量类型、组件约束、piecewise、Big-M、目标函数表达式和求解器能力自动诊断。</p></div>
        <div class="card"><strong>目标策略</strong><p>${escapeHtml(objective)}</p><p class="muted">第 4 步配置 solve_active 目标项后自动汇总，不覆盖模型目录摘要。</p></div>
        <div class="card"><strong>集合配置</strong><p>${escapeHtml(sets)}</p><p class="muted">如模型需要时间维度，请在第 2 步新增 time_period 集合并配置 horizon 与时间粒度。</p></div>`;
    }

    function builderObjectPanel() {
      const scene = currentScene();
      const model = currentModelMeta();
      const desc = model?.desc && model.desc !== scene.desc ? model.desc : (scene.desc || '模型保存业务结构，任务只注入运行时参数并实例化求解。');
      return `<div class="grid cols-3">
        <div class="field"><label>当前场景</label><select onchange="selectScene(this.value)">${sceneOptions()}</select></div>
        <div class="field"><label>当前模型</label><select onchange="selectModel(this.value)">${modelOptions()}</select></div>
        <div class="field"><label>建模模式</label><select onchange="setBuilderModeOption(this.value)">${builderModeOptions()}</select></div>
        ${builderBasicSummaryCards()}
        <div class="card" style="grid-column:span 3;display:flex;align-items:flex-start;gap:24px">
          <div style="flex:1"><strong>说明</strong><p style="margin-top:6px">${escapeHtml(desc)}</p><p class="muted">${escapeHtml(builderModeGuidance())}</p></div>
          <div class="actions" style="flex-shrink:0;padding-top:2px"><button class="btn" onclick="loadSelectedModelStructure()">按选择加载结构</button><button class="btn" onclick="createBlankModel()">从空白创建</button></div>
        </div>
      </div>`;
    }

    function setTypeOptions(selected = 'normal') {
      const labels = {
        normal: '普通集合',
        time_period: '时间时段集合',
        state_time: '状态时点集合',
        derived: '派生集合',
        custom: '自定义集合'
      };
      return ['normal', 'time_period', 'state_time', 'derived', 'custom']
        .map(type => `<option value="${type}" ${String(selected || 'normal') === type ? 'selected' : ''}>${labels[type]}</option>`)
        .join('');
    }

    function setTypeLabel(type = 'normal') {
      return {
        normal: '普通集合',
        time_period: '时间时段集合',
        state_time: '状态时点集合',
        derived: '派生集合',
        custom: '自定义集合'
      }[type] || type || '-';
    }

    function setConfigurationRows(sets = []) {
      const rows = generateSetMembersForUi((sets || []).map(item => ({ ...item })));
      return rows.map((s, i) => {
        const code = s.code || s.key || '';
        const members = s.members || s.values || [];
        const rule = s.type === 'time_period'
          ? `horizon=${s.horizon ?? '-'}; granularity=${s.time_granularity ?? '-'} ${s.time_unit || 'minute'}; members=0..${Math.max(0, members.length - 1)}; window=${formatTimeWindow(s)}`
          : s.type === 'state_time'
            ? `base_set=${s.base_set || '-'}; generation_rule=${s.generation_rule || '-'}`
            : (members.length ? members.join(', ') : '-');
        const status = s.configured ? '<span class="pill green">已配置</span>' : '<span class="pill amber">待配置</span>';
        return `<tr><td>${escapeHtml(s.name || code)}<br><span class="muted">${escapeHtml(code)}</span></td><td>${escapeHtml(setTypeLabel(s.type || 'normal'))}</td><td class="cell-truncate" title="${escapeHtml(rule)}">${escapeHtml(rule)}</td><td>${status}</td><td>${escapeHtml(s.source || '-')}</td><td class="ops-col"><div class="ops-stack"><button class="btn" onclick="editSemanticItem('sets', ${i})">编辑</button><button class="btn" onclick="removeSemanticItem('sets', ${i})">删除</button></div></td></tr>`;
      }).join('') || `<tr><td colspan="6"><div class="empty-state" style="min-height:60px"><strong>暂无集合</strong></div></td></tr>`;
    }

    function semanticSetFormDraft() {
      const draft = state.semanticSetFormDraft || {};
      return {
        key: draft.key || draft.code || '',
        code: draft.code || draft.key || '',
        name: draft.name || '',
        type: draft.type || 'normal',
        members: Array.isArray(draft.members) ? draft.members : Array.isArray(draft.values) ? draft.values : [],
        values: Array.isArray(draft.values) ? draft.values : Array.isArray(draft.members) ? draft.members : [],
        horizon: draft.horizon ?? '',
        time_granularity: draft.time_granularity ?? '',
        time_unit: draft.time_unit || 'minute',
        start_time: draft.start_time || '',
        base_set: draft.base_set || 'time',
        generation_rule: draft.generation_rule || 'horizon_plus_1',
        description: draft.description || '',
        source: draft.source || '',
        source_component: draft.source_component || draft.owner_component || draft.generated_by_component || '',
        owner_component: draft.owner_component || draft.source_component || '',
        generated_by_component: draft.generated_by_component || draft.source_component || ''
      };
    }

    function inferSemanticSetType(key = '', name = '', selectedType = 'normal') {
      const normalizedKey = String(key || '').trim().toLowerCase();
      const normalizedName = String(name || '').trim();
      if (selectedType === 'normal' && (normalizedKey === 'time' || normalizedName.includes('调度时段') || normalizedName.includes('时段集合'))) {
        return 'time_period';
      }
      return selectedType || 'normal';
    }

    function updateSemanticSetFormDraftFromDom() {
      const existing = semanticSetFormDraft();
      const rawType = document.getElementById('semanticSetType')?.value || existing.type || 'normal';
      const key = document.getElementById('semanticSetKey')?.value?.trim() || existing.key;
      const name = document.getElementById('semanticSetName')?.value?.trim() || existing.name;
      const type = inferSemanticSetType(key, name, rawType);
      const typeSelect = document.getElementById('semanticSetType');
      if (typeSelect && typeSelect.value !== type) typeSelect.value = type;
      const values = (document.getElementById('semanticSetValues')?.value || '').split(',').map(v => v.trim()).filter(Boolean);
      state.semanticSetFormDraft = {
        ...existing,
        key,
        code: key || existing.code,
        name,
        type,
        values,
        members: values,
        horizon: document.getElementById('semanticSetHorizon')?.value || existing.horizon,
        time_granularity: document.getElementById('semanticSetGranularity')?.value || existing.time_granularity,
        time_unit: document.getElementById('semanticSetTimeUnit')?.value || existing.time_unit || 'minute',
        start_time: document.getElementById('semanticSetStartTime')?.value || '',
        base_set: document.getElementById('semanticSetBaseSet')?.value || existing.base_set || 'time',
        generation_rule: document.getElementById('semanticSetGenerationRule')?.value || existing.generation_rule || 'horizon_plus_1',
        description: document.getElementById('semanticSetDesc')?.value?.trim() || '',
        source: document.getElementById('semanticSetSource')?.value?.trim() || existing.source || '',
        source_component: document.getElementById('semanticSetSourceComponent')?.value?.trim() || existing.source_component || ''
      };
    }

    function semanticSetPreviewText(item = semanticSetFormDraft()) {
      if (item.type === 'time_period') {
        const generated = generateSetMembersForUi([{ ...item, horizon: Number(item.horizon || 0), time_granularity: Number(item.time_granularity || 0) }])[0] || item;
        const members = generated.members || [];
        return `horizon=${generated.horizon || '-'}; time_granularity=${generated.time_granularity || '-'}; time_unit=${generated.time_unit || 'minute'}; delta_t=${generated.delta_t ?? '-'}; members=${members.length ? `0..${members.length - 1}` : '-'}; window=${formatTimeWindow(generated)}`;
      }
      if (item.type === 'state_time') {
        return `base_set=${item.base_set || 'time'}; generation_rule=${item.generation_rule || 'horizon_plus_1'}; members=${(item.members || item.values || []).join(',') || '-'}`;
      }
      return (item.members || item.values || []).join(',') || '-';
    }

    function semanticSetEditorForm(objects = [], sets = []) {
      const form = semanticSetFormDraft();
      const isEditing = !!(state.editingSetCode || form.key || form.code);
      const editingLabel = isEditing ? `<div class="inline-empty-state" style="grid-column:1/-1"><strong>正在编辑集合：${escapeHtml(form.name || form.key || form.code)}(${escapeHtml(form.key || form.code)})</strong></div>` : '';
      const baseOptions = (sets || []).map(s => s.code || s.key).filter(Boolean).map(code => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join('');
      const selectedUnit = unit => form.time_unit === unit ? 'selected' : '';
      const selectedRule = rule => form.generation_rule === rule ? 'selected' : '';
      return `<div class="grid form-grid-compact ${isEditing ? 'editing-highlight' : ''}" id="semanticSetEditor" data-supported-types="normal,time_period,state_time,derived,custom" data-editing-set-code="${escapeHtml(state.editingSetCode || '')}">
        ${editingLabel}
        <div class="field"><label>集合编码</label><input id="semanticSetKey" value="${escapeHtml(form.key || form.code)}" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field"><label>中文名称</label><input id="semanticSetName" value="${escapeHtml(form.name)}" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field"><label>集合类型</label><select id="semanticSetType" onchange="updateSemanticSetFormDraftFromDom();updateSemanticSetTypeVisibility()">${setTypeOptions(form.type || 'normal')}</select></div>
        <div class="field"><label>成员</label><input id="semanticSetValues" value="${escapeHtml((form.members || form.values || []).join(','))}" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field semantic-time-period-field" style="display:none"><label>时段数</label><input id="semanticSetHorizon" type="number" min="1" value="${escapeHtml(form.horizon)}" onchange="updateSemanticSetFormDraftFromDom();previewSemanticSetGeneration()" /></div>
        <div class="field semantic-time-period-field" style="display:none"><label>时间粒度</label><input id="semanticSetGranularity" type="number" min="1" value="${escapeHtml(form.time_granularity)}" onchange="updateSemanticSetFormDraftFromDom();previewSemanticSetGeneration()" /></div>
        <div class="field semantic-time-period-field" style="display:none"><label>时间单位</label><select id="semanticSetTimeUnit" onchange="updateSemanticSetFormDraftFromDom();previewSemanticSetGeneration()"><option value="minute" ${selectedUnit('minute')}>分钟</option><option value="hour" ${selectedUnit('hour')}>小时</option><option value="day" ${selectedUnit('day')}>天</option></select></div>
        <div class="field semantic-time-period-field" style="display:none"><label>起始时间</label><input id="semanticSetStartTime" value="${escapeHtml(form.start_time)}" placeholder="可选" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field semantic-state-time-field" style="display:none"><label>基础集合</label><select id="semanticSetBaseSet" onchange="updateSemanticSetFormDraftFromDom();previewSemanticSetGeneration()"><option value="time" ${form.base_set === 'time' ? 'selected' : ''}>time</option>${baseOptions}</select></div>
        <div class="field semantic-state-time-field" style="display:none"><label>生成规则</label><select id="semanticSetGenerationRule" onchange="updateSemanticSetFormDraftFromDom();previewSemanticSetGeneration()"><option value="horizon_plus_1" ${selectedRule('horizon_plus_1')}>基于时段生成 horizon+1 个时点</option><option value="same_as_base" ${selectedRule('same_as_base')}>与基础集合一致</option><option value="custom_rule" ${selectedRule('custom_rule')}>自定义规则</option></select></div>
        <div class="field"><label>说明</label><input id="semanticSetDesc" value="${escapeHtml(form.description)}" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field"><label>来源</label><input id="semanticSetSource" value="${escapeHtml(form.source)}" placeholder="user_defined / component_required_set" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field"><label>来源组件</label><input id="semanticSetSourceComponent" value="${escapeHtml(form.source_component)}" placeholder="可选" onchange="updateSemanticSetFormDraftFromDom()" /></div>
        <div class="field semantic-generated-preview-field" style="display:none"><label>自动生成结果</label><input id="semanticSetGeneratedPreview" readonly value="${escapeHtml(semanticSetPreviewText(form))}" /></div>
        <div class="field"><label>操作</label><button class="btn primary" onclick="addSemanticSetFromForm()">保存集合配置</button></div>
      </div>`;
    }

    function formatTimeWindow(set = {}) {
      const granularity = Number(set.time_granularity || 0);
      const horizon = Number(set.horizon || 0);
      const unit = set.time_unit || 'minute';
      const minutes = granularity * (unit === 'hour' ? 60 : unit === 'day' ? 1440 : 1);
      if (!horizon || !minutes) return '-';
      const hours = horizon * minutes / 60;
      const days = hours / 24;
      return `${hours}h / ${days.toFixed(2)}d`;
    }

    function componentSetConfigurationEditor(draft = getCurrentModelDraft()) {
      const semantic = draft.semantic || {};
      const sets = semantic.sets || [];
      const pending = sets.filter(s => s.required && !s.configured);
      const prompt = pending.length
        ? `<div class="notice amber"><strong>待配置集合</strong><p>${pending.map(s => `${s.name || s.code}(${s.code || s.key})`).join('、')}</p></div>`
        : '';
      return panel('集合配置', `${prompt}${semanticSetEditorForm(semantic.objects || [], sets)}
        <div class="table-scroll semantic-table-scroll mt"><table class="sticky-table compact-table semantic-table semantic-set-config-table"><colgroup><col style="width:20%"><col style="width:12%"><col style="width:auto"><col style="width:11%"><col style="width:15%"><col style="width:132px"></colgroup><thead><tr><th>中文名称/编码</th><th>集合类型</th><th>成员/生成规则</th><th>状态</th><th>来源</th><th class="ops-col">操作</th></tr></thead><tbody>${setConfigurationRows(sets)}</tbody></table></div>`);
    }

    function isComponentBuilderMode() {
      return state.builderMode === 'component_based';
    }

    function getCurrentModelDraft() {
      if (state.modelDraft && Object.keys(state.modelDraft).length) return state.modelDraft;
      return createEmptyModelDraft();
    }

    function createEmptyModelDraft() {
      return {
        basic_info: {
          name: state.activeModel,
          scenario: state.activeDomain,
          domain: state.activeDomain,
          model_code: '',
          builder_mode: 'component_based'
        },
        semantic: { objects: [], sets: [], parameters: [], variables: [], outputs: [] },
        components: [],
        constraints: [],
        objective: { sense: 'minimize', terms: [] },
        mathematical_expansion: { sections: [], objective: { sense: 'minimize', formula: '0', terms: [] } },
        runtime_parameters: {},
        advanced: { component_spec: {}, generic_spec: {}, ui_metadata: {}, component_catalog: [] }
      };
    }

    function resetModelWorkingStateForSwitch() {
      state.modelReady = false;
      state.problemTypeDiagnosis = null;
      state.selectedBasicConstraint = 0;
      state.selectedGenericRule = 0;
      state.componentSpecText = '{}';
      state.modelDraft = createEmptyModelDraft();
      state.componentBuilder = componentBuilderStateFromDraft(state.modelDraft, {}, {});
      state.genericSetsText = JSON.stringify({}, null, 2);
      state.genericParametersText = JSON.stringify({}, null, 2);
      state.genericIndexedVariablesText = JSON.stringify([], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify([], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify({ terms: [], constant: 0 }, null, 2);
      state.runtimeParametersText = '{}';
      state.runtimeObjectiveText = '{}';
      state.runtimeConstraintText = '{}';
      state.semanticValidationResult = { errors: [], warnings: [], infos: [] };
    }

    function isAdditionalConstraintMode() {
      return isComponentBuilderMode() && !!state.componentBuilder?.additionalConstraintsEnabled;
    }

    function builderModeValue() {
      if (state.builderMode === 'component_based' && state.componentBuilder?.additionalConstraintsEnabled) return 'component_based_with_custom';
      return state.builderMode === 'component_based' ? 'component_based' : 'generic_linear';
    }

    function builderModeText() {
      return {
        generic_linear: '通用线性 Builder',
        component_based: '组件化 Builder',
        component_based_with_custom: '组件化 Builder + 附加自定义约束'
      }[builderModeValue()] || '通用线性 Builder';
    }

    function formulaSourceText() {
      if (builderModeValue() === 'generic_linear') return '由用户在数学展开中手工配置';
      if (builderModeValue() === 'component_based_with_custom') return '核心公式由组件自动生成，附加约束由用户补充';
      return '由启用组件自动生成';
    }

    function builderModeOptions() {
      const current = builderModeValue();
      return [
        ['generic_linear', '通用线性 Builder'],
        ['component_based', '组件化 Builder'],
        ['component_based_with_custom', '组件化 Builder + 附加自定义约束']
      ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
    }

    function builderModeGuidance() {
      if (state.activeDomain === '梯级水电日前调度') {
        return '梯级水电涉及时序递推、传播时滞、梯级拓扑和水量平衡，建议使用组件化 Builder。附加自定义约束只能叠加临时边界，不能覆盖组件生成的核心约束。';
      }
      return '简单模型可使用通用线性 Builder；复杂调度场景建议使用组件化 Builder，由组件生成核心约束和目标函数。';
    }

    function setBuilderModeOption(value) {
      if (value === 'generic_linear') {
        state.builderMode = 'generic_linear';
        state.useGenericBuilder = true;
        if (state.activeDomain === '梯级水电日前调度') {
          toast('梯级水电核心约束必须由组件化 Builder 生成，通用线性模式仅建议用于非水电简单模型。');
        } else {
          toast('已切换为通用线性 Builder');
        }
      } else {
        state.builderMode = 'component_based';
        state.useGenericBuilder = false;
        state.componentBuilder.additionalConstraintsEnabled = value === 'component_based_with_custom';
        if (!state.modelDraft || !Object.keys(state.modelDraft).length || state.modelDraft.basic_info?.scenario !== state.activeDomain) {
          if (state.activeDomain === '梯级水电日前调度') {
            restoreRecommendedComponentsForScenario(false);
          } else {
            state.modelDraft = createEmptyModelDraft();
            state.componentBuilder = componentBuilderStateFromDraft(state.modelDraft, {}, currentRuntimeParameters());
            state.componentSpecText = '{}';
          }
        }
        toast(value === 'component_based_with_custom' ? '已启用附加自定义约束入口，不能覆盖核心组件约束。' : '已切换为组件化 Builder');
      }
      state.modelReady = false;
      render();
    }

    function currentScene() {
      return getScenes().find(s => s.name === state.activeDomain) || {
        name: state.activeDomain,
        domain: '自定义模型',
        desc: '从模型资产中心加载的模型',
        children: [{ name: state.activeModel, type: 'LP/MILP', target: state.objective || '用户自定义', status: '试运行' }]
      };
    }

    function currentModelMeta() {
      const s = currentScene();
      return (s.children || []).find(m => m.name === state.activeModel) || null;
    }

    function sceneOptions() {
      const scenes = scenarioModelCatalog();
      const hasActive = scenes.some(s => s.name === state.activeDomain);
      return `${hasActive ? '' : `<option selected>${state.activeDomain}</option>`}${scenes.map(s => `<option ${s.name === state.activeDomain ? 'selected' : ''}>${s.name}</option>`).join('')}`;
    }

    function normalizeSceneNameForMatch(scene = '') {
      const value = String(scene || '').trim();
      if (value.includes('Unit Commitment') || value.includes('机组组合') || value.includes('机组启停')) return '日前机组组合优化';
      if (value.includes('梯级水电') || value.includes('水电日前调度')) return '梯级水电日前调度';
      if (value.includes('风光储') || value.includes('光储') || value.includes('新能源消纳')) return '风光储协同优化';
      if (value.includes('经济') || value.includes('负荷分配')) return '经济负荷分配';
      if (value.includes('储能') && !value.includes('风光储') && !value.includes('光储')) return '储能充放电优化';
      if (value.includes('热电') || value.includes('CHP')) return '热电协同优化';
      return value;
    }

    function sceneMatchesActive(scene = '') {
      return sceneMatchesName(scene, state.activeDomain);
    }

    function sceneMatchesName(scene = '', target = '') {
      return normalizeSceneNameForMatch(scene) === normalizeSceneNameForMatch(target);
    }

    function modelOptions() {
      const saved = state.savedModels
        .filter(m => m.id && sceneMatchesActive(m.scene))
        .map(m => ({
          kind: 'asset',
          value: `asset:${m.id}`,
          name: m.display_name || m.name,
          label: `${m.display_name || m.name}${m.version ? ` ${m.version}` : ''}（资产${m.status ? `/${modelStatusText(m.status)}` : ''}）`,
          selected: Boolean(m.id && state.runtimeTemplateId === m.id)
        }));
      const activeModel = state.runtimeTemplateId
        ? state.savedModels.find(m => m.id === state.runtimeTemplateId)
        : null;
      const activeSaved = activeModel && sceneMatchesActive(activeModel.scene) && !saved.some(m => m.value === `asset:${activeModel.id}`)
        ? [{
          kind: 'asset',
          value: `asset:${activeModel.id}`,
          name: activeModel.display_name || activeModel.name,
          label: `${activeModel.display_name || activeModel.name}${activeModel.version ? ` ${activeModel.version}` : ''}（资产${activeModel.status ? `/${modelStatusText(activeModel.status)}` : ''}）`,
          selected: true
        }]
        : [];
      const all = [...saved, ...activeSaved];
      const empty = all.length ? '' : '<option disabled>该场景暂无模型资产，可从空白创建。</option>';
      return `${empty}${all.map(m => `<option value="${escapeHtml(m.value)}" ${m.selected ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}<option value="__blank_model__">+ 在当前场景下创建空白模型</option>`;
    }

    function builderStepPanel() {
      return `<div class="grid cols-2"><div class="card"><strong>校验状态</strong><p>变量需绑定索引集合和类型；参数需有来源、单位、维度和默认值；约束需有业务说明，公式层负责展开为可求解的数学关系。</p><div class="actions mt"><button class="btn" onclick="validateModel()">校验模型</button><button class="btn primary" onclick="generateModel()">生成模型包</button><button class="btn green" ${productionDisabledAttr()} onclick="saveModelToAssets('overwrite')">覆盖保存</button><button class="btn" ${productionDisabledAttr()} onclick="saveModelToAssets('copy')">另存为</button></div><div class="mt">${validationReportHtml(state.semanticValidationResult)}</div></div><div class="card"><strong>生成结果</strong><p>${state.modelReady ? '模型包已生成，可覆盖当前模型，也可另存为新的模型版本。' : '模型尚未生成，请完成校验后生成模型包。'}</p><p>发布时执行结构 dry-run：检查 Pyomo ConcreteModel 可构建；求解 dry-run 只在用户提供测试用例时作为强校验。</p>${dryRunResultHtml((state.savedModels.find(m => m.name === state.activeModel) || {}).dry_run_result)}</div></div>`;
    }

    function constraintEditor() {
      const selected = state.genericConstraints[state.selectedGenericRule];
      const config = state.ruleConfigs[state.selectedGenericRule];
      return `<div class="constraint-editor">
        <div class="rule-list">${state.genericConstraints.map((r, i) => `<div class="card rule-card ${state.selectedGenericRule === i ? 'active' : ''}" style="padding:12px;margin-bottom:10px"><div class="panel-title" style="margin-bottom:6px"><span onclick="selectGenericRule(${i})" style="cursor:pointer">${r.name}</span><button class="switch ${r.on ? 'on' : ''}" onclick="toggleGenericRule(${i})"><span></span></button></div><p class="muted">${r.tag}组件，${r.on ? '已参与模型装配' : '当前不参与模型装配'}</p><div class="actions mt"><button class="btn" onclick="selectGenericRule(${i})">编辑属性</button></div></div>`).join('')}</div>
        <div>
          <div class="card">
            <div class="panel-title"><span>规则编辑器：${selected.name}</span><span class="pill ${selected.on ? 'green' : 'amber'}">${selected.on ? '已启用' : '未启用'}</span></div>
            <div class="grid cols-2">
              <div class="field"><label>适用范围</label><select onchange="updateRuleConfig(${state.selectedGenericRule}, 'scope', this.value)"><option ${config.scope === '全业务域' ? 'selected' : ''}>全业务域</option><option ${config.scope === '生产/储能/排班' ? 'selected' : ''}>生产/储能/排班</option><option ${config.scope === '安全生产' ? 'selected' : ''}>安全生产</option><option ${config.scope === '库存/仓储/能源' ? 'selected' : ''}>库存/仓储/能源</option><option ${config.scope === '检修/物流/排班' ? 'selected' : ''}>检修/物流/排班</option><option ${config.scope === '目标层' ? 'selected' : ''}>目标层</option></select></div>
              <div class="field"><label>作用粒度</label><select onchange="updateRuleConfig(${state.selectedGenericRule}, 'granularity', this.value)"><option ${config.granularity === '时段' ? 'selected' : ''}>时段</option><option ${config.granularity === '时序' ? 'selected' : ''}>时序</option><option ${config.granularity === '窗口' ? 'selected' : ''}>窗口</option><option ${config.granularity === '聚合' ? 'selected' : ''}>聚合</option></select></div>
              <div class="field"><label>约束等级</label><select onchange="updateRuleConfig(${state.selectedGenericRule}, 'level', this.value)"><option ${config.level === '硬约束' ? 'selected' : ''}>硬约束</option><option ${config.level === '软约束' ? 'selected' : ''}>软约束</option></select></div>
              <div class="field"><label>触发条件</label><input value="${config.trigger}" onchange="updateRuleConfig(${state.selectedGenericRule}, 'trigger', this.value)" /></div>
              <div class="field"><label>惩罚系数</label><input value="${config.penalty}" onchange="updateRuleConfig(${state.selectedGenericRule}, 'penalty', this.value)" /></div>
              <div class="field"><label>装配说明</label><input value="${config.note}" onchange="updateRuleConfig(${state.selectedGenericRule}, 'note', this.value)" /></div>
            </div>
            <div class="actions mt"><button class="btn primary" onclick="toast('规则属性已保存')">保存规则属性</button><button class="btn" onclick="toggleGenericRule(${state.selectedGenericRule})">${selected.on ? '停用规则' : '启用规则'}</button></div>
          </div>
          <div class="card mt"><strong>组件装配说明</strong><p>约束组件按资源对象、时间粒度和业务域自动展开为约束矩阵。当前规则将按“${config.scope} / ${config.granularity} / ${config.level}”参与装配，触发条件为“${config.trigger}”。</p><div class="actions mt"><button class="btn" onclick="enableCoreRules()">启用核心约束</button><button class="btn" onclick="disableOptionalRules()">关闭可选约束</button></div></div>
        </div>
      </div>`;
    }

    function modelPreview() {
      const enabled = state.genericConstraints.filter(r => r.on).length;
      if (isComponentBuilderMode()) {
        let spec = {};
        try { spec = getComponentSpecFromBuilder(); } catch (e) {}
        const components = spec.components || [];
        const variables = spec.variables || [];
        return `<table class="compact-table"><tr><th>模型项</th><th>估算规模/说明</th><th>状态</th></tr><tr><td>建模模式</td><td>组件化自定义 Builder</td><td>${pill('在线')}</td></tr><tr><td>问题类型</td><td>${escapeHtml(spec.model_problem_type || 'LP')}</td><td>${pill('线性规划')}</td></tr><tr><td>组件清单</td><td>${components.length} 个组件，按注册表顺序编译为 Pyomo 约束和表达式</td><td>${pill('在线')}</td></tr><tr><td>变量结构</td><td>${variables.length} 个变量结构</td><td>${pill('在线')}</td></tr><tr><td>模型包</td><td>${state.modelReady ? '已生成' : '待生成'}</td><td>${state.modelReady ? pill('试运行') : '<span class="pill amber">待配置</span>'}</td></tr></table>`;
      }
      const variableCount = 12000 + state.mappedFields * 860 + enabled * 420;
      const constraintCount = 18000 + state.mappedFields * 920 + enabled * 680;
      return `<table class="compact-table"><tr><th>模型项</th><th>估算规模/说明</th><th>状态</th></tr><tr><td>决策变量结构</td><td>${variableCount.toLocaleString()}，按资源、时间、状态生成</td><td>${pill('在线')}</td></tr><tr><td>约束逻辑结构</td><td>${constraintCount.toLocaleString()}，由业务规则组件装配</td><td>${pill('在线')}</td></tr><tr><td>目标函数结构</td><td>${state.objective}</td><td>${pill('在线')}</td></tr><tr><td>模型包</td><td>${state.modelReady ? '已生成' : '待生成'}</td><td>${state.modelReady ? pill('试运行') : '<span class="pill amber">待配置</span>'}</td></tr></table>`;
    }

    function componentBuilderStateFromSpec(componentSpec = {}, runtimeParams = {}) {
      const components = (componentSpec.components || []).map(c => ({ ...c, type: c.type || c.code, enabled: c.enabled !== false }));
      return {
        ...(state.componentBuilder || {}),
        selectedScenario: componentSpec.model_code || 'cascade_hydro_dispatch',
        components,
        selectedComponentType: components[0]?.type || null,
        pendingComponentType: '',
        componentSpecExpanded: state.componentBuilder?.componentSpecExpanded || false,
        componentSpecText: JSON.stringify(componentSpec || {}, null, 2),
        runtimeParametersText: JSON.stringify(runtimeParams || {}, null, 2),
        validationMessages: []
      };
    }

    function componentBuilderStateFromDraft(draft = {}, componentSpec = {}, runtimeParams = {}) {
      const draftComponents = (draft.components || []).map(c => ({
        type: c.type || c.component_id,
        component_id: c.component_id || c.type,
        enabled: c.enabled !== false,
        required: !!c.required,
        config: c.config || {},
        definition: c.definition || componentRegistryMeta(c.type || c.component_id)
      }));
      const stateFromSpec = componentBuilderStateFromSpec(componentSpec, runtimeParams);
      return {
        ...stateFromSpec,
        components: draftComponents.length ? draftComponents : stateFromSpec.components,
        selectedComponentType: draftComponents[0]?.type || stateFromSpec.selectedComponentType,
        additionalConstraints: draft.constraints || stateFromSpec.additionalConstraints || [],
        objective: draft.objective || stateFromSpec.objective || { sense: 'minimize', terms: [] }
      };
    }

    function componentRegistryMeta(type) {
      const registry = state.componentRegistry || [];
      const row = registry.find(item => (item.component_id || item.type) === type);
      if (row) return row;
      return {
        component_id: type,
        type,
        name: type,
        display_name: type,
        category: '组件库未加载',
        description: '组件库未返回该组件定义，请刷新组件库或检查后端组件资产。',
        depends_on: [],
        inputs: [],
        outputs: [],
        generated_constraints: [],
        generated_objective_terms: []
      };
    }

    function objectiveTermsForComponent(type) {
      const meta = componentRegistryMeta(type);
      return meta.generated_objective_terms || meta.objective_terms || [];
    }

    function componentRowHtml(component, index) {
      const type = component.type || component.code || '';
      const meta = component.definition || componentRegistryMeta(type);
      const enabled = component.enabled !== false;
      const depends = meta.depends_on || meta.dependsOn || [];
      const depLabel = depends.length > 1 ? `${escapeHtml(depends[0])} +${depends.length - 1}` : depends.length === 1 ? escapeHtml(depends[0]) : '-';
      const depTitle = depends.map(escapeHtml).join(', ') || '-';
      const nameStr = escapeHtml(meta.zhName || meta.name || meta.display_name || type);
      const btnStyle = 'padding:2px 5px;font-size:11.5px;white-space:nowrap';
      return `<tr>
        <td><input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleComponentEnabled(${index}, this.checked)" /></td>
        <td>${index + 1}</td>
        <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${nameStr}">${nameStr}</td>
        <td style="overflow:hidden"><code style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(type)}">${escapeHtml(type)}</code></td>
        <td>${escapeHtml(meta.category || '-')}</td>
        <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${depTitle}">${depLabel}</td>
        <td><div style="display:grid;grid-template-columns:1fr 1fr;gap:2px"><button class="btn" style="${btnStyle}" onclick="moveComponentUp(${index})">上移</button><button class="btn" style="${btnStyle}" onclick="moveComponentDown(${index})">下移</button><button class="btn" style="${btnStyle}" onclick="selectComponentDetail('${escapeHtml(type)}')">说明</button><button class="btn" style="${btnStyle}" onclick="removeComponentFromDraft(${index})">删除</button></div></td>
      </tr>`;
    }

    function componentDetailHtml() {
      const type = state.componentBuilder?.selectedComponentType;
      if (!type) return `<div class="card"><p class="muted">请选择一个组件查看说明。</p></div>`;
      const meta = componentRegistryMeta(type);
      const generated = {
        dependencies: [...(meta.inputs || []), ...(meta.depends_on || meta.dependsOn || [])].join('、') || '-',
        generated: (meta.outputs || []).join('、') || meta.formula || meta.math_template?.formula || '-',
        objective: (meta.generated_objective_terms || []).length ? '是，组件目标项进入目标函数配置' : '否',
        feasibility: (meta.generated_constraints || []).length ? '影响：组件生成的约束参与 dry-run 与求解' : '仅展示：当前组件未生成求解约束'
      };
      const list = values => `<ul>${(values || []).map(x => `<li>${escapeHtml(x)}</li>`).join('') || '<li>-</li>'}</ul>`;
      const formula = meta.formula || meta.math_template?.formula || (meta.generated_constraints || [])[0]?.formula || '-';
      return `<div class="card">
        <strong>${escapeHtml(meta.zhName || meta.name || meta.display_name || type)}（${escapeHtml(type)}）</strong>
        <p class="mt">${escapeHtml(meta.description || '')}</p>
        <div class="mt"><strong>数学公式</strong><pre>${escapeHtml(formula)}</pre></div>
        <div class="grid cols-2 mt">
          <div><strong>输入参数 / 变量</strong>${list(meta.inputs)}</div>
          <div><strong>输出变量 / 约束</strong>${list(meta.outputs)}</div>
        </div>
        <div class="mt"><strong>启用后生成了什么</strong>
          <table class="compact-table mt"><tbody>
            <tr><th>依赖参数/变量</th><td>${escapeHtml(generated.dependencies)}</td></tr>
            <tr><th>生成内容</th><td>${escapeHtml(generated.generated)}</td></tr>
            <tr><th>是否进入目标函数</th><td>${escapeHtml(generated.objective)}</td></tr>
            <tr><th>是否影响模型可行性</th><td>${escapeHtml(generated.feasibility)}</td></tr>
          </tbody></table>
        </div>
        <div class="mt"><strong>示例说明</strong><p>${escapeHtml(meta.example || '-')}</p></div>
        <div class="mt"><strong>常见错误</strong>${list(meta.commonErrors)}</div>
      </div>`;
    }

    function refreshComponentSpecFromUi() {
      const current = parseJsonOr(state.componentBuilder?.componentSpecText || state.componentSpecText || '{}', '{}');
      const enabledComponents = (state.componentBuilder?.components || []).filter(c => c.enabled !== false).map(c => {
        const item = { type: c.type || c.code || c.component_id };
        if (c.config && Object.keys(c.config).length) item.config = c.config;
        return item;
      });
      const draftComponents = (state.componentBuilder?.components || []).map(c => {
        const type = c.type || c.code || c.component_id;
        const definition = c.definition || componentRegistryMeta(type);
        const generated_constraints = (definition.generated_constraints || []).map(item => ({ ...item, source: item.source || 'component_generated', source_component: item.source_component || type, owner_component: item.owner_component || type, generated_by_component: item.generated_by_component || type }));
        const generated_objective_terms = (definition.generated_objective_terms || []).map(item => ({ ...item, source: item.source || 'component_generated', source_component: item.source_component || type, owner_component: item.owner_component || type, generated_by_component: item.generated_by_component || type }));
        return { ...c, component_id: type, type, definition, generated_constraints, generated_objective_terms };
      });
      const taggedSemantic = tagSemanticArtifactsForComponents(getSemanticSpec(), draftComponents);
      state.semanticSpecText = JSON.stringify(normalizeSemanticSpec(taggedSemantic), null, 2);
      const objective = state.componentBuilder.objective || buildObjectiveFromComponents(draftComponents, current.objective || {});
      state.componentBuilder.objective = objective;
      const draft = getCurrentModelDraft();
      const basic = draft?.basic_info || {};
      const nextSpec = {
        ...current,
        model_code: current.model_code || basic.model_code || 'custom_component_model',
        build_mode: 'component_based',
        name: current.name || basic.name || '组件化自定义模型',
        model_problem_type: basic.problem_type || current.model_problem_type || '',
        required_solver_capabilities: [],
        sets: mergeRequiredSets(current.sets || getCurrentModelDraft().semantic?.sets || [], draftComponents),
        components: enabledComponents,
        objective: { type: 'weighted_sum', sense: objective.sense || 'minimize', terms: objective.terms || [] },
        objective_strategy: generateObjectiveStrategyForUi(objective),
        additional_custom_constraints: state.componentBuilder?.additionalConstraints || []
      };
      const draftForDiagnosis = {
        ...getCurrentModelDraft(),
        basic_info: { ...(basic || {}), problem_type: nextSpec.model_problem_type, solver: state.solverBackend || 'HiGHS' },
        semantic: { ...(getCurrentModelDraft().semantic || {}), variables: nextSpec.variables || getCurrentModelDraft().semantic?.variables || [] },
        components: draftComponents,
        constraints: nextSpec.additional_custom_constraints || [],
        objective
      };
      applyProblemTypeDiagnosis(draftForDiagnosis, nextSpec);
      state.componentBuilder.componentSpecText = JSON.stringify(nextSpec, null, 2);
      state.componentSpecText = state.componentBuilder.componentSpecText;
      state.modelDraft = buildModelDraftFromState(getSemanticSpec(), nextSpec);
      const visibleSemantic = getSemanticSpec();
      visibleSemantic.sets = state.modelDraft.semantic?.sets || visibleSemantic.sets || [];
      visibleSemantic.parameters = state.modelDraft.semantic?.parameters || visibleSemantic.parameters || [];
      visibleSemantic.variables = state.modelDraft.semantic?.variables || visibleSemantic.variables || [];
      state.semanticSpecText = JSON.stringify(normalizeSemanticSpec(visibleSemantic), null, 2);
      state.modelReady = false;
      return nextSpec;
    }

    function componentLibraryOptions() {
      const existing = new Set((state.componentBuilder?.components || []).map(c => c.type || c.code));
      const registry = availableComponentsForCurrentDraft().filter(item => item.implemented !== false && item.enabled !== false && (!item.status || ['published','trial','tested','已发布','试运行','已测试'].includes(item.status)));
      const implemented = registry.map(meta => {
        const type = meta.component_id || meta.type;
        return `<option value="${type}" ${existing.has(type) ? 'disabled' : ''}>${escapeHtml(meta.name || meta.display_name || type)}（${type}${existing.has(type) ? '，已加入' : ''}）</option>`;
      }).join('');
      return `<option value="">选择已发布组件</option><optgroup label="组件库已发布组件">${implemented || '<option disabled>暂无可用组件，请刷新组件库或先发布组件</option>'}</optgroup>`;
    }

    function availableComponentsForCurrentDraft() {
      const draft = getCurrentModelDraft();
      const scenario = draft?.basic_info?.scenario || state.activeDomain;
      const domain = draft?.basic_info?.domain || scenario;
      const registry = state.componentRegistry || [];
      if (!registry.length) return [];
      return registry.filter(c =>
        c.domain === domain ||
        c.domain === scenario ||
        c.domain === '通用' ||
        c.domain === '光储一体化' ||
        c.category === '基础组件'
      );
    }

    function addComponentToDraft(componentId = state.componentBuilder?.pendingComponentType) {
      const type = componentId;
      if (!type) return toast('请先选择要添加的组件');
      const meta = componentRegistryMeta(type);
      if (!meta || meta.implemented === false) return toast('该组件暂未实现，不能加入当前 LP 模型');
      if (meta.enabled === false || (meta.status && !['published','trial','tested','已发布','试运行','已测试'].includes(meta.status))) return toast('只有已发布且启用的组件才能加入模型');
      if ((state.componentBuilder.components || []).some(c => (c.type || c.code) === type)) return toast('该组件已在清单中');
      const beforeSets = new Set((getCurrentModelDraft().semantic?.sets || []).map(s => s.code || s.key).filter(Boolean));
      state.componentBuilder.components.push({ type, component_id: type, enabled: true, definition: meta, config: {} });
      state.componentBuilder.pendingComponentType = '';
      state.componentBuilder.selectedComponentType = type;
      refreshComponentSpecFromUi();
      const afterSets = state.modelDraft?.semantic?.sets || [];
      const added = afterSets.filter(s => !beforeSets.has(s.code || s.key));
      const pending = afterSets.filter(s => s.required && !s.configured);
      state.componentBuilder.requiredSetPrompt = { component: meta.name || meta.display_name || type, added, pending };
      const suffix = added.length || pending.length ? `；新增集合 ${added.map(s => s.code || s.key).join('、') || '无'}，待配置 ${pending.map(s => s.code || s.key).join('、') || '无'}` : '';
      toast(`已添加组件：${meta.name || meta.display_name || type}${suffix}`);
      render();
    }

    function requiredSetsPromptHtml() {
      const prompt = state.componentBuilder?.requiredSetPrompt;
      if (!prompt || (!prompt.added?.length && !prompt.pending?.length)) return '';
      const added = (prompt.added || []).map(s => `<li>${escapeHtml(s.name || s.code || s.key)}：${escapeHtml(s.type || 'normal')}</li>`).join('') || '<li>无</li>';
      const pending = (prompt.pending || []).map(s => `<li>${escapeHtml(s.name || s.code || s.key)}：待配置 ${escapeHtml(s.type || 'normal')}</li>`).join('') || '<li>无</li>';
      return `<div class="notice amber mt"><strong>组件 required_sets 已回写</strong><p>已添加组件：${escapeHtml(prompt.component || '-')}</p><div class="grid cols-2"><div><strong>新增集合</strong><ul>${added}</ul></div><div><strong>待配置集合</strong><ul>${pending}</ul></div></div><div class="actions mt"><button class="btn primary" onclick="goConfigureRequiredSets()">去配置集合</button><button class="btn" onclick="state.componentBuilder.requiredSetPrompt=null;render()">稍后配置</button></div></div>`;
    }

    function goConfigureRequiredSets() {
      state.builderStep = 1;
      state.focusSetConfiguration = true;
      toast('已跳转到第 2 步集合配置区');
      render();
    }

    function removeComponentFromDraft(index) {
      const list = state.componentBuilder.components || [];
      const removed = list.splice(index, 1)[0];
      state.componentBuilder.selectedComponentType = list[index]?.type || list[index - 1]?.type || list[0]?.type || null;
      pruneComponentGeneratedArtifacts(removed?.type || removed?.component_id || removed?.code || '');
      state.modelDraft = {
        ...getCurrentModelDraft(),
        components: list.map(c => {
          const type = c.type || c.code || c.component_id;
          const definition = c.definition || componentRegistryMeta(type);
          return { ...c, type, component_id: type, definition };
        })
      };
      refreshComponentSpecFromUi();
      const removedMeta = componentRegistryMeta(removed?.type);
      toast(`已删除组件：${removedMeta?.name || removedMeta?.display_name || removed?.type || '-'}`);
      render();
    }

    function restoreRecommendedComponentsForScenario(showToast = true) {
      const draft = getCurrentModelDraft();
      const recommended = (draft?.components || [])
        .map(c => c.type || c.component_id)
        .filter(Boolean);
      if (!recommended.length) {
        state.modelDraft = createEmptyModelDraft();
        state.componentBuilder = componentBuilderStateFromDraft(state.modelDraft, {}, currentRuntimeParameters());
        if (showToast) toast('当前模型暂无推荐组件。可以从组件库添加组件，或切换为通用线性 Builder。');
        render();
        return;
      }
      state.componentBuilder.components = recommended.map(type => ({ type, component_id: type, enabled: true, definition: componentRegistryMeta(type), config: {} }));
      state.componentBuilder.selectedComponentType = recommended[0];
      refreshComponentSpecFromUi();
      if (showToast) {
        toast('已从 Model Draft 恢复推荐组件顺序');
        render();
      }
    }

    function syncComponentListFromSpec() {
      try {
        const spec = parseJsonOr(state.componentBuilder?.componentSpecText || state.componentSpecText || '{}', '{}');
        state.componentBuilder = componentBuilderStateFromSpec(spec, parseJsonOr(state.runtimeParametersText || '{}', '{}'));
        state.componentSpecText = JSON.stringify(spec, null, 2);
        toast('已从 Component Spec 同步组件清单');
        render();
      } catch (e) {
        toast(`Component Spec 解析失败：${e.message}`);
      }
    }

    function toggleComponentSpecExpanded() {
      state.componentBuilder.componentSpecExpanded = !state.componentBuilder.componentSpecExpanded;
      render();
    }

    function componentSpecFieldGuide() {
      const rows = [
        ['model_code', '模型编码，用于 API 调用和模型资产检索。'],
        ['build_mode', '构建模式，组件化模型固定为 component_based。'],
        ['model_problem_type', '数学问题类型，由系统诊断后写入；MIP 会统一归一为 MILP。'],
        ['variables', '系统根据组件需要声明的变量结构。'],
        ['components', '启用组件清单，Builder 会按顺序校验并展开数学约束。'],
        ['objective', '目标函数配置，当前为负荷偏差、弃水、平滑和期末库容的加权和。'],
        ['required_solver_capabilities', '求解器能力要求，发布前按最终 Model Draft 强校验。']
      ];
      return `<table class="compact-table"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
    }

    function generatedMathExpansionPreview(components = []) {
      const draft = buildModelDraftFromState();
      const sections = draft.mathematical_expansion?.sections || [];
      const objective = draft.mathematical_expansion?.objective || {};
      const html = sections.map((section, index) => `<div class="formula-subblock" style="${section.enabled !== false ? '' : 'opacity:.45'}"><div class="formula-subtitle">${index + 1}. ${escapeHtml(section.title || '-')} ${section.enabled !== false ? '' : '<span class="pill amber">未启用</span>'}</div>${formulaDisplayBlock(getConstraintDisplayFormula(section))}<p class="muted">${escapeHtml(section.business_meaning || '')}</p></div>`).join('');
      return `<div class="formula-editor-shell">${html}<div class="formula-subblock"><div class="formula-subtitle">目标函数</div>${formulaDisplayBlock(`${objective.sense || 'minimize'} ${objective.formula || '0'}`)}</div></div>`;
    }

    function mathematicalExpansionHtml(draft = getCurrentModelDraft()) {
      const expansion = draft.mathematical_expansion || { sections: [], objective: {} };
      const sections = expansion.sections || [];
      const objective = expansion.objective || {};
      if (!sections.length && !objective.formula) return emptyState('当前 draft 暂无数学展开。添加组件或生成 Component Spec 后会自动刷新数学展开。');
      const html = sections.map((section, index) => `<div class="formula-subblock" style="${section.enabled !== false ? '' : 'opacity:.45'}"><div class="formula-subtitle">${index + 1}. ${escapeHtml(section.title || section.name || '-')} ${section.enabled !== false ? '' : '<span class="pill amber">未启用</span>'}</div>${formulaDisplayBlock(getConstraintDisplayFormula(section))}<p class="muted">${escapeHtml(section.business_meaning || section.description || '')}</p></div>`).join('');
      return `<div class="formula-editor-shell">${html}<div class="formula-subblock"><div class="formula-subtitle">目标函数</div>${formulaDisplayBlock(`${objective.sense || draft.objective?.sense || 'minimize'} ${objective.formula || '0'}`)}</div></div>`;
    }

    function generatedConstraintRelationsHtml(components = []) {
      const constraints = buildConstraintsFromDraft(buildModelDraftFromState());
      return `<table class="compact-table"><thead><tr><th>约束类型</th><th>中文名称</th><th>数学表达</th><th>来源</th><th>核心</th><th>状态</th></tr></thead><tbody>${constraints.map(row => `<tr><td>${escapeHtml(row.type || '-')}</td><td>${escapeHtml(row.name || '-')}</td><td>${formulaDisplayBlock(getConstraintDisplayFormula(row))}</td><td>${row.source_component ? `<code>${escapeHtml(row.source_component)}</code>` : escapeHtml(row.source || 'custom')}</td><td>${row.core ? '核心约束' : '附加约束'}</td><td>${row.enabled !== false ? pill('启用') : '<span class="pill amber">未启用</span>'}</td></tr>`).join('')}</tbody></table>`;
    }

    function constraintRelationsHtml(draft = getCurrentModelDraft()) {
      const constraints = draft.generated_constraints || buildConstraintsFromDraft(draft);
      if (!constraints.length) return emptyState('当前 draft 暂无组件生成约束或附加约束。添加组件后会自动生成约束清单。');
      return `<div class="table-scroll"><table class="compact-table"><colgroup><col style="width:110px"><col style="width:120px"><col style="width:70px"><col style="min-width:160px"><col><col style="width:110px"><col style="width:70px"><col style="width:50px"><col style="width:68px"></colgroup><thead><tr><th>约束名称</th><th>约束编码</th><th>约束类型</th><th>数学表达</th><th>业务含义</th><th>来源组件</th><th>核心</th><th>启用</th><th>可编辑</th></tr></thead><tbody>${constraints.map(row => `<tr><td>${escapeHtml(row.name || '-')}</td><td><code>${escapeHtml(row.constraint_id || row.code || '-')}</code></td><td>${escapeHtml(row.type || '-')}</td><td>${formulaDisplayBlock(getConstraintDisplayFormula(row))}</td><td>${escapeHtml(row.business_meaning || row.description || '-')}</td><td>${row.source_component ? `<code>${escapeHtml(row.source_component)}</code>` : escapeHtml(row.source || 'custom')}</td><td>${row.core ? '核心' : '附加'}</td><td>${row.enabled !== false ? pill('启用') : '<span class="pill amber">未启用</span>'}</td><td>${row.editable ? '可改' : '系统'}</td></tr>`).join('')}</tbody></table></div>`;
    }

    const FORMULA_NOT_GENERATED = '公式未生成，请检查左端变量、右端参数和索引配置';
    const TRIVIAL_ZERO_CONSTRAINT_RE = /^\s*(?:∀\s*[^：:]+[：:]\s*)?0\s*(?:>=|<=|==)\s*0\s*$/;

    function firstNonBlank(...values) {
      for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
      }
      return '';
    }

    function getConstraintDisplayFormula(row = {}) {
      const formula = firstNonBlank(row.display_formula, row.formula, row.expression, row.dsl_formula, row.dsl, row.math_expression, row.generated_formula, row.math_constraint, row.expr);
      if (isTrivialZeroConstraintFormula(formula)) return FORMULA_NOT_GENERATED;
      if (formula) return formulaWithForallScope(formula, row);
      return indexedConstraintText(row);
    }

    function getObjectiveDisplayFormula(term = {}) {
      const formula = firstNonBlank(term.display_formula, term.formula, term.expression, term.dsl_formula, term.dsl, term.math_expression, term.generated_formula, term.expr);
      if (formula && formula !== '0') return formula;
      const generated = objectiveTermText(term);
      return generated && generated !== '0' ? generated : FORMULA_NOT_GENERATED;
    }

    function currentFormulaRenderContext(extra = {}) {
      let semantic = {};
      try { semantic = typeof getSemanticSpec === 'function' ? getSemanticSpec() : {}; } catch (e) {}
      return {
        sets: extra.sets || semantic.sets || [],
        parameters: extra.parameters || semantic.parameters || [],
        variables: extra.variables || semantic.variables || []
      };
    }

    function formulaScopeListFromRow(row = {}) {
      const scope = row.foreach || row.scope_indices || row.expansion_scope || row.indices || row.scope || [];
      if (Array.isArray(scope)) return scope.map(item => typeof item === 'string' ? item : item?.set || item?.code || item?.key || item?.name).filter(Boolean);
      return String(scope || '').split(',').map(item => item.trim()).filter(Boolean);
    }

    function formulaScopePrefix(scope = [], context = currentFormulaRenderContext()) {
      const dict = typeof getFormulaSymbolDictionary === 'function' ? getFormulaSymbolDictionary(context) : { byCode: {} };
      return (scope || []).map(code => {
        const item = dict.byCode?.[code] || {};
        const name = item.name && item.name !== code ? item.name : code;
        return `${name} ${code}`;
      }).join('、');
    }

    function formulaWithForallScope(formula = '', row = {}, context = currentFormulaRenderContext()) {
      const text = String(formula || '').trim();
      if (!text || /^∀\s/.test(text)) return text;
      const scope = formulaScopeListFromRow(row);
      if (!scope.length) return text;
      return `∀ ${formulaScopePrefix(scope, context)}：\n${text}`;
    }

    function formulaDisplayBlock(expression, context = currentFormulaRenderContext()) {
      const value = String(expression || '').trim();
      if (!value) return '<span class="muted">-</span>';
      if (typeof formulaDisplayHtml === 'function') return formulaDisplayHtml(value, context);
      return `<pre class="formula-cell">${escapeHtml(value)}</pre>`;
    }

    function isTrivialZeroConstraintFormula(formula = '') {
      return TRIVIAL_ZERO_CONSTRAINT_RE.test(String(formula || '').trim());
    }

    function getVariableDisplayExpansion(variable = {}) {
      const indices = variable.indices || variable.dimension || variable.key || variable.foreach || [];
      return Array.isArray(indices) && indices.length ? indices.join(',') : FORMULA_NOT_GENERATED;
    }

    function displayFormula(item = {}) {
      return getConstraintDisplayFormula(item);
    }

    function currentRuntimeParameters() {
      return parseJsonOr(state.runtimeParametersText || state.componentBuilder?.runtimeParametersText || '{}', '{}');
    }

    function generatedObjectiveConfigHtml() {
      const params = currentRuntimeParameters();
      const weights = params.weights || {};
      const draft = buildModelDraftFromState();
      const objective = draft.objective || { sense: 'minimize', terms: [] };
      const rows = (objective.terms || []).map((term, index) => {
        const code = term.weight_key || term.term_id;
        const value = weights[code] ?? term.weight ?? 1;
        return `<tr><td><input type="checkbox" ${term.enabled !== false ? 'checked' : ''} onchange="toggleObjectiveTerm(${index}, this.checked)" /> ${escapeHtml(term.name || code)}</td><td><code>${escapeHtml(code)}</code></td><td><input style="max-width:110px" value="${escapeHtml(value)}" onchange="updateHydroWeight('${code}', this.value)" /></td><td>${escapeHtml(term.business_meaning || '')}</td><td>${escapeHtml(term.source_component || term.source || 'custom')}</td></tr>`;
      }).join('');
      return `<div>
        ${formulaDisplayBlock(`${objective.sense || 'minimize'} ${draft.mathematical_expansion?.objective?.formula || '0'}`)}
        <table class="compact-table mt"><thead><tr><th>权重名称</th><th>编码</th><th>当前值</th><th>业务含义</th><th>参数来源</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="muted mt">权重越大，表示该目标越重要。第一版建议负荷偏差权重最高，其次期末库容，弃水和平滑作为辅助目标。</p>
      </div>`;
    }

    function objectiveBuilderHtml(draft = getCurrentModelDraft()) {
      const params = currentRuntimeParameters();
      const weights = params.weights || {};
      const objective = draft.objective || { sense: 'minimize', terms: [] };
      const rows = (objective.terms || []).map((term, index) => {
        const code = term.weight_key || term.term_id || term.code;
        const value = weights[code] ?? term.weight ?? 1;
        const supported = term.supported_by_backend !== false;
        return `<tr><td><input type="checkbox" ${term.enabled !== false ? 'checked' : ''} onchange="toggleObjectiveTerm(${index}, this.checked)" /> ${escapeHtml(term.name || code)}</td><td><code>${escapeHtml(code)}</code></td><td>${formulaDisplayBlock(getObjectiveDisplayFormula(term))}</td><td><input style="max-width:110px" value="${escapeHtml(value)}" onchange="updateHydroWeight('${code}', this.value)" /></td><td>${term.enabled !== false ? pill('启用') : '<span class="pill amber">未启用</span>'}</td><td>${escapeHtml(term.source_component || term.source || 'custom')}</td><td>${escapeHtml(term.business_meaning || '')}</td><td>${supported ? pill('参与求解') : '<span class="pill amber">仅保存说明</span>'}</td></tr>`;
      }).join('');
      if (!rows) return emptyState('当前 draft 暂无目标项。添加带目标项的组件后会自动生成目标函数配置。');
      return `<div>
        ${formulaDisplayBlock(`${objective.sense || 'minimize'} ${draft.mathematical_expansion?.objective?.formula || '0'}`)}
        <div class="table-scroll mt"><table class="compact-table"><colgroup><col style="width:130px"><col style="width:130px"><col style="min-width:160px"><col style="width:90px"><col style="width:50px"><col style="width:100px"><col><col style="width:80px"></colgroup><thead><tr><th>目标项名称</th><th>目标项编码</th><th>表达式</th><th>权重</th><th>启用</th><th>来源组件</th><th>业务含义</th><th>后端求解</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted mt">用户新增且后端暂不支持的目标项仅作为建模说明保存，不参与求解。</p>
      </div>`;
    }

    function updateHydroWeight(code, rawValue) {
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0) return toast('权重必须是非负数字');
      const params = currentRuntimeParameters();
      params.weights = { ...(params.weights || {}), [code]: value };
      const objective = state.componentBuilder.objective || buildModelDraftFromState().objective || { terms: [] };
      (objective.terms || []).forEach(term => { if (term.weight_key === code) term.weight = value; });
      state.componentBuilder.objective = objective;
      state.runtimeParametersText = JSON.stringify(params, null, 2);
      state.componentBuilder.runtimeParametersText = state.runtimeParametersText;
      state.modelReady = false;
      toast(`已同步权重 ${code} = ${value} 到 runtime_parameters.weights`);
      render();
    }

    function additionalCustomConstraintsHtml() {
      const enabled = isAdditionalConstraintMode();
      const constraints = state.componentBuilder?.additionalConstraints || [];
      const allowed = ['某电站某时段出力不超过调度指令上限', '某时段总出力必须不低于计划值', '某电站弃水量不超过临时控制值', '某机组检修窗口内保持零出力'];
      const denied = ['覆盖水量平衡约束', '重写下泄流量平衡', '删除传播时滞入库逻辑', '改写组件生成的核心变量索引'];
      const rows = constraints.map((item, index) => `<tr><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(item.expression || '-')}</td><td>${escapeHtml(item.scope || '-')}</td><td><button class="btn" onclick="removeAdditionalConstraint(${index})">删除</button></td></tr>`).join('');
      return `<div>
        <div class="validation-block ${enabled ? 'green' : 'amber'}"><strong>当前模型采用组件化建模方式。</strong><p class="muted mt">平台根据启用组件自动生成核心变量、约束、平衡关系和目标函数。附加自定义约束目前支持简单边界型表达式（如 station_power[S1,20] &lt;= 120），保存后会写入 component_spec 并由后端生成 Pyomo 约束参与求解。</p></div>
        <div class="grid cols-2 mt">
          <div><strong>允许的附加约束示例</strong><ul>${allowed.map(x => `<li>${x}</li>`).join('')}</ul></div>
          <div><strong>不允许的操作</strong><ul>${denied.map(x => `<li>${x}</li>`).join('')}</ul></div>
        </div>
        <div class="actions mt"><button class="btn ${enabled ? 'primary' : ''}" onclick="toggleAdditionalConstraintMode()">${enabled ? '关闭附加自定义约束' : '启用附加自定义约束'}</button></div>
        ${enabled ? `<div class="grid form-grid-compact mt">
          <div class="field"><label>约束名称</label><input id="additionalConstraintName" value="临时调度边界" /></div>
          <div class="field"><label>适用范围</label><input id="additionalConstraintScope" value="station,time" /></div>
          <div class="field"><label>附加约束表达式</label><input id="additionalConstraintExpr" value="station_power[S1,20] <= 120" /></div>
          <div class="field"><label>操作</label><button class="btn primary" onclick="addAdditionalConstraintFromForm()">添加附加约束</button></div>
        </div>
        <table class="compact-table mt"><thead><tr><th>名称</th><th>表达式</th><th>范围</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="4">暂无附加自定义约束。</td></tr>'}</tbody></table>` : '<p class="muted mt">未启用时，本模型仅使用组件生成的核心约束和目标函数。</p>'}
      </div>`;
    }

    function toggleAdditionalConstraintMode() {
      state.componentBuilder.additionalConstraintsEnabled = !state.componentBuilder.additionalConstraintsEnabled;
      state.modelReady = false;
      toast(state.componentBuilder.additionalConstraintsEnabled ? '已启用附加自定义约束入口' : '已关闭附加自定义约束入口');
      render();
    }

    function addAdditionalConstraintFromForm() {
      const name = document.getElementById('additionalConstraintName')?.value?.trim();
      const scope = document.getElementById('additionalConstraintScope')?.value?.trim();
      const expression = document.getElementById('additionalConstraintExpr')?.value?.trim();
      if (!name || !expression) return toast('请填写附加约束名称和表达式');
      const forbidden = ['volume', 'q_out', 'inflow', 'time_volume'];
      if (forbidden.some(key => expression.includes(`${key}[`) && /==|=/.test(expression))) {
        return toast('附加约束不能重写水量平衡、下泄平衡、入库传播或核心变量索引');
      }
      state.componentBuilder.additionalConstraints = [...(state.componentBuilder.additionalConstraints || []), { name, scope, expression }];
      state.modelReady = false;
      refreshComponentSpecFromUi();
      toast('已添加附加自定义约束');
      render();
    }

    function removeAdditionalConstraint(index) {
      state.componentBuilder.additionalConstraints.splice(index, 1);
      state.modelReady = false;
      refreshComponentSpecFromUi();
      toast('已删除附加自定义约束');
      render();
    }

    function validateComponentDependencies() {
      const enabled = new Set((state.componentBuilder?.components || []).filter(c => c.enabled !== false).map(c => c.type || c.code));
      const messages = [];
      (state.componentBuilder?.components || []).forEach(c => {
        const type = c.type || c.code;
        if (c.enabled === false) return;
        const meta = c.definition || componentRegistryMeta(type);
        (meta.depends_on || meta.dependsOn || []).forEach(dep => {
          const depMeta = componentRegistryMeta(dep);
          if (!enabled.has(dep)) messages.push(`${meta.name || meta.display_name || type} 依赖 ${depMeta.name || depMeta.display_name || dep}`);
        });
      });
      state.componentBuilder.validationMessages = messages;
      state.semanticValidationResult = messages.length ? { errors: messages, warnings: [], infos: [] } : { errors: [], warnings: [], infos: ['组件依赖校验通过'] };
      toast(messages.length ? `组件依赖存在 ${messages.length} 个问题` : '组件依赖校验通过');
      render();
    }

    function toggleComponentEnabled(index, checked) {
      state.componentBuilder.components[index].enabled = checked;
      refreshComponentSpecFromUi();
      render();
    }

    function moveComponentUp(index) {
      if (index <= 0) return;
      const list = state.componentBuilder.components;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      refreshComponentSpecFromUi();
      render();
    }

    function moveComponentDown(index) {
      const list = state.componentBuilder.components;
      if (index >= list.length - 1) return;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      refreshComponentSpecFromUi();
      render();
    }

    function selectComponentDetail(type) {
      state.componentBuilder.selectedComponentType = type;
      render();
    }

    function componentModelBuilder() {
      let spec = {};
      try { spec = getComponentSpecFromBuilder(); } catch (e) {}
      if (!(state.componentBuilder?.components || []).length && (spec.components || []).length) {
        state.componentBuilder = componentBuilderStateFromSpec(spec, parseJsonOr(state.runtimeParametersText || '{}', '{}'));
      }
      const draft = getCurrentModelDraft();
      const components = state.componentBuilder?.components || spec.components || [];
      const variables = spec.variables || [];
      const rows = components.map((c, i) => componentRowHtml(c, i)).join('');
      const specExpanded = state.componentBuilder?.componentSpecExpanded;
      const recommendedLabel = isHydroBuilderScene() ? '加载梯级水电推荐模板' : '加载当前场景推荐组件';
      const hydroTemplateButton = isHydroBuilderScene() ? `<button onclick="loadComponentTemplateExample('cascade_hydro_dispatch')">加载梯级水电推荐模板</button>` : '';
      return `<div class="seg"><button class="active" onclick="restoreRecommendedComponentsForScenario()">${recommendedLabel}</button><button onclick="validateComponentSpec()">校验组件模型</button>${hydroTemplateButton}</div>
      <div class="card mt">
        <div class="panel-title"><span>组件化 Builder 使用说明</span><span class="pill blue">推荐顺序</span></div>
        <div class="grid cols-3">
          <div><strong>组件</strong><p>组件是可维护的建模单元，负责把某类业务规则展开为变量、表达式或约束。</p></div>
          <div><strong>数学展开</strong><p>数学展开是启用组件合成后的模型级公式预览，用于确认业务逻辑是否完整。</p></div>
          <div><strong>Component Spec</strong><p>Component Spec 是系统自动生成的内部配置，一般无需直接编辑。</p></div>
        </div>
        <p class="muted">推荐操作：确认推荐组件 → 添加或删除组件 → 校验依赖 → 查看数学展开 → 生成 Component Spec → 下一步配置运行参数。</p>
      </div>
      <div class="grid cols-3 mt">
        <div class="card"><strong>当前建模方式</strong><p>${builderModeText()}</p></div>
        <div class="card"><strong>公式来源</strong><p>${formulaSourceText()}</p></div>
        <div class="card"><strong>组件数量</strong><p>${components.filter(c => c.enabled !== false).length} 个启用 / ${components.length} 个总组件 / ${variables.length} 个变量</p></div>
      </div>
      <div class="mt">${panel('模型类型诊断', problemTypeDiagnosisCard(draft))}</div>
      <div class="grid cols-2 mt panel-stretch-grid">
        <div>${panel('组件清单与启用状态', `<div class="grid form-grid-compact"><div class="field"><label>添加组件</label><select onchange="state.componentBuilder.pendingComponentType=this.value">${componentLibraryOptions()}</select></div><div class="field"><label>操作</label><button class="btn primary" onclick="addComponentToDraft()">添加组件</button></div></div>${requiredSetsPromptHtml()}<div class="table-scroll" style="flex:1;min-height:120px;overflow:auto;margin-top:8px"><table class="compact-table" style="table-layout:fixed;width:100%;min-width:554px"><colgroup><col style="width:34px"><col style="width:34px"><col style="width:110px"><col style="width:130px"><col style="width:60px"><col style="width:90px"><col style="width:96px"></colgroup><thead><tr><th>启用</th><th>顺序</th><th>组件名称</th><th>组件编码</th><th>分类</th><th>依赖</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7">当前场景暂无已加入组件。可以从组件库添加组件，或切换为通用线性 Builder。</td></tr>'}</tbody></table></div><div class="actions mt" style="flex-shrink:0"><button class="btn primary" onclick="refreshComponentSpecFromUi();toast('已根据启用组件生成 Component Spec');render()">生成 Component Spec</button><button class="btn" onclick="validateComponentDependencies()">校验组件依赖</button><button class="btn" onclick="restoreRecommendedComponentsForScenario()">恢复推荐组件</button></div>`)}</div>
        <div>${panel('当前组件说明', componentDetailHtml())}</div>
      </div>
      <div class="mt">${panel('约束与平衡关系', constraintRelationsHtml(draft))}</div>
      <div class="mt">${panel('目标函数配置', objectiveBuilderHtml(draft))}</div>
      <div class="mt">${panel('附加自定义约束', additionalCustomConstraintsHtml())}</div>
      <div class="mt">${panel('高级配置：Component Spec（系统自动生成，一般无需修改）', `
        <div class="grid cols-2">
          ${componentSpecFieldGuide()}
          <div><strong>摘要</strong><p>底层配置已自动生成；组件：${components.filter(c => c.enabled !== false).length} 个启用；变量：${variables.length} 个；问题类型：${escapeHtml(spec.model_problem_type || 'LP')}；求解器能力：${escapeHtml((spec.required_solver_capabilities || ['LP']).join(', '))}</p><p class="muted">Component Spec 是系统内部配置，供 Builder 编译 Pyomo 模型使用，普通用户一般无需修改。</p>
          <div class="actions mt"><button class="btn" onclick="toggleComponentSpecExpanded()">${specExpanded ? '收起高级 JSON' : '展开高级 JSON'}</button><button class="btn" onclick="refreshComponentSpecFromUi();toast('已重新生成 Component Spec');render()">重新生成</button><button class="btn" onclick="copyText(state.componentSpecText, 'Component Spec 已复制')">复制</button><button class="btn" onclick="syncComponentListFromSpec()">从 Spec 同步组件清单</button></div></div>
        </div>
        ${specExpanded ? `<textarea class="mt" style="min-height:280px" onchange="state.componentSpecText=this.value;state.componentBuilder.componentSpecText=this.value;state.modelReady=false">${escapeHtml(state.componentSpecText || '{}')}</textarea>` : ''}
      `)}</div>`;
    }

    function validateComponentSpec() {
      try {
        const spec = getComponentSpecFromBuilder();
        if (!(spec.components || []).length) throw new Error('component_spec.components 不能为空');
        if (!(spec.variables || []).length) throw new Error('component_spec.variables 不能为空');
        state.semanticValidationResult = { errors: [], warnings: [], infos: [`组件化模型校验通过：${spec.components.length} 个组件，${spec.variables.length} 个变量结构`] };
        toast(`组件化模型校验通过：${spec.components.length} 个组件`);
        render();
      } catch (e) {
        state.semanticValidationResult = { errors: [e.message], warnings: [], infos: [] };
        toast(`组件化模型校验失败：${e.message}`);
        render();
      }
    }

    function genericModelBuilder() {
      return `<div class="seg"><button class="active" onclick="loadSelectedModelStructure()">加载当前模型结构</button><button onclick="scrollToGenericAdvancedJson()">高级JSON</button></div>
      <p class="mt">第 3 步只定义数学展开，所有可选集合、参数和变量均来自第 2 步 semantic_spec。</p>
      <p class="muted">如需从零开始，可在当前模型基础上直接调整语义结构和数学展开。</p>
      <div class="grid cols-2 mt">
        <div class="field"><label>优化方向</label><select onchange="state.genericSense=this.value"><option value="minimize" ${state.genericSense === 'minimize' ? 'selected' : ''}>minimize</option><option value="maximize" ${state.genericSense === 'maximize' ? 'selected' : ''}>maximize</option></select></div>
        <div class="field"><label>建模模式</label><select onchange="setGenericBuilderMode(this.value)"><option value="indexed" selected>语义驱动集合索引模式</option></select></div>
      </div>
      <div class="mt">${panel('数学展开编辑器', genericVisualEditor())}</div>`;
    }

    function scrollToGenericAdvancedJson() {
      const target = document.getElementById('genericAdvancedJsonSection');
      if (!target) return toast('当前模式暂无高级 JSON 区域');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('editing-highlight');
      setTimeout(() => target.classList.remove('editing-highlight'), 1200);
    }

    function genericVisualEditor() {
      return state.genericBuilderMode === 'basic' ? genericBasicVisualEditor() : genericIndexedVisualEditor();
    }

    function parseJsonOr(text, fallback) {
      try { return JSON.parse(text || fallback); } catch (e) { return JSON.parse(fallback); }
    }

    function getBasicGenericParts() {
      return {
        parameters: parseJsonOr(state.genericParametersText, '{}'),
        variables: parseJsonOr(state.genericVariablesText, '[]'),
        constraints: parseJsonOr(state.genericConstraintsText, '[]'),
        objective: parseJsonOr(state.genericObjectiveText, '{"terms":[],"constant":0}')
      };
    }

    function setBasicGenericParts(parts) {
      state.genericParametersText = JSON.stringify(parts.parameters || {}, null, 2);
      state.genericVariablesText = JSON.stringify(parts.variables || [], null, 2);
      state.genericConstraintsText = JSON.stringify(parts.constraints || [], null, 2);
      state.genericObjectiveText = JSON.stringify(parts.objective || { terms: [], constant: 0 }, null, 2);
      state.modelReady = false;
    }

    function getIndexedGenericParts() {
      return normalizeIndexedGenericParts({
        sets: parseJsonOr(state.genericSetsText, '{}'),
        parameters: parseJsonOr(state.genericParametersText, '{}'),
        variables: parseJsonOr(state.genericIndexedVariablesText, '[]'),
        constraints: parseJsonOr(state.genericIndexedConstraintsText, '[]'),
        objective: parseJsonOr(state.genericIndexedObjectiveText, '{"terms":[],"constant":0}')
      });
    }

    function normalizeIndexedGenericParts(parts = {}) {
      const next = {
        sets: parts.sets || {},
        parameters: parts.parameters || {},
        variables: Array.isArray(parts.variables) ? parts.variables : [],
        constraints: Array.isArray(parts.constraints) ? parts.constraints : [],
        objective: parts.objective || { terms: [], constant: 0 }
      };
      next.variables = next.variables.map(variable => {
        const indices = variable.indices || variable.dimension || variable.key || variable.foreach || [];
        const item = { ...variable, indices: Array.isArray(indices) ? indices : [] };
        normalizeVariableBounds(item);
        item.display_formula = item.display_formula || (item.indices.length ? `${item.name}[${item.indices.join(',')}]` : item.name || '');
        return item;
      });
      next.constraints = next.constraints.map(constraint => {
        const item = { ...constraint };
        const formula = getConstraintDisplayFormula(item);
        if (formula !== FORMULA_NOT_GENERATED) {
          item.expression = firstNonBlank(item.expression, formula);
          item.formula = firstNonBlank(item.formula, formula);
          item.display_formula = firstNonBlank(item.display_formula, formula);
        }
        const scope = formulaScopeListFromRow(item);
        item.foreach = scope;
        item.scope_indices = item.scope_indices || scope;
        item.expansion_scope = item.expansion_scope || scope;
        item.indices = item.indices || scope;
        item.business_meaning = firstNonBlank(item.business_meaning, item.business_rule, item.description);
        return item;
      });
      next.objective.terms = (next.objective.terms || []).map(term => {
        const item = { ...term };
        const formula = getObjectiveDisplayFormula(item);
        if (formula !== FORMULA_NOT_GENERATED) {
          item.expression = firstNonBlank(item.expression, formula);
          item.formula = firstNonBlank(item.formula, formula);
          item.display_formula = firstNonBlank(item.display_formula, formula);
        }
        item.indices = item.indices || item.foreach || item.key || [];
        item.business_meaning = firstNonBlank(item.business_meaning, item.business_goal, item.description);
        return item;
      });
      return next;
    }

    function setIndexedGenericParts(parts) {
      const normalized = normalizeIndexedGenericParts(parts);
      state.genericSetsText = JSON.stringify(normalized.sets || {}, null, 2);
      state.genericParametersText = JSON.stringify(normalized.parameters || {}, null, 2);
      state.genericIndexedVariablesText = JSON.stringify(normalized.variables || [], null, 2);
      state.genericIndexedConstraintsText = JSON.stringify(normalized.constraints || [], null, 2);
      state.genericIndexedObjectiveText = JSON.stringify(normalized.objective || { terms: [], constant: 0 }, null, 2);
      state.modelReady = false;
    }

    function boundLabel(item, key) {
      const type = item[`${key}_type`];
      const value = item[`${key}_value`];
      if (type === 'none') return '-';
      if (type === 'constant') return value ?? item[key] ?? '-';
      if (type === 'parameter') return value || item[`${key}_param`] || '-';
      const paramKey = `${key}_param`;
      if (item[paramKey]) return item[paramKey];
      return item[key] ?? '-';
    }

    function normalizeVariableBounds(item = {}) {
      if (!item.lb_type) {
        if (item.lb_param) { item.lb_type = 'parameter'; item.lb_value = item.lb_param; }
        else if (item.lb !== undefined && item.lb !== '') { item.lb_type = 'constant'; item.lb_value = item.lb; }
        else item.lb_type = 'none';
      }
      if (!item.ub_type) {
        if (item.ub_param) { item.ub_type = 'parameter'; item.ub_value = item.ub_param; }
        else if (item.ub !== undefined && item.ub !== '') { item.ub_type = 'constant'; item.ub_value = item.ub; }
        else item.ub_type = 'none';
      }
      if (normalizeVariableDomain(item.domain) === 'Binary') {
        if (item.lb_type === 'none') { item.lb_type = 'constant'; item.lb_value = 0; item.lb = 0; }
        if (item.ub_type === 'none') { item.ub_type = 'constant'; item.ub_value = 1; item.ub = 1; }
      }
      if (item.lb_type === 'constant') item.lb = Number.isNaN(Number(item.lb_value)) ? item.lb_value : Number(item.lb_value);
      if (item.ub_type === 'constant') item.ub = Number.isNaN(Number(item.ub_value)) ? item.ub_value : Number(item.ub_value);
      if (item.lb_type === 'parameter') item.lb_param = item.lb_value;
      if (item.ub_type === 'parameter') item.ub_param = item.ub_value;
      return item;
    }

    function coefLabel(term) {
      if (term.coef_param) return term.coef_param;
      return term.coef ?? 1;
    }

    function rhsLabel(cons) {
      if (cons.rhs_param) return cons.rhs_param;
      return cons.rhs ?? 0;
    }

    function termText(term) {
      return `${coefLabel(term)}*${term.var}`;
    }

    function editorSection(title, note, actions, body) {
      return `<section class="formula-section"><div class="formula-section-head"><div><div class="formula-section-title">${title}</div><div class="formula-section-note">${note}</div></div><div class="actions">${actions || ''}</div></div>${body}</section>`;
    }

    function indexedTermText(term) {
      if (!term || !term.var) return FORMULA_NOT_GENERATED;
      const key = Array.isArray(term.key) ? term.key : [];
      const paramKey = Array.isArray(term.param_key) ? term.param_key : [];
      const varPart = key.length ? `${term.var}[${key.join(',')}]` : term.var;
      const coef = term.coef_param ? `${term.coef_param}${paramKey.length ? `[${paramKey.join(',')}]` : ''}` : (term.coef ?? 1);
      const body = String(coef) === '1' ? varPart : `${coef} * ${varPart}`;
      const foreach = Array.isArray(term.foreach) ? term.foreach : [];
      return foreach.length ? `sum(${body} for ${foreach.map(d => `${d} in ${d}`).join(' for ')})` : body;
    }

    function indexedRhsText(cons) {
      if (!cons || (cons.rhs_param === undefined && cons.rhs === undefined)) return FORMULA_NOT_GENERATED;
      const key = Array.isArray(cons.rhs_key) && cons.rhs_key.length ? `[${cons.rhs_key.join(',')}]` : '';
      return `${rhsLabel(cons)}${key}`;
    }

    function indexedConstraintText(cons) {
      const scope = Array.isArray(cons.foreach) && cons.foreach.length ? `∀ ${cons.foreach.join(', ')}：` : '';
      const leftTerms = (cons.terms || []).map(indexedTermText);
      if (!leftTerms.length || leftTerms.some(text => text === FORMULA_NOT_GENERATED)) return FORMULA_NOT_GENERATED;
      const left = leftTerms.join(' + ');
      const relation = cons.sense || cons.relation_type || '<=';
      if (relation === 'between') return `${scope}${(cons.lower_param || cons.lower) ?? '-'} <= ${left} <= ${(cons.upper_param || cons.upper) ?? '-'}`;
      if (relation === 'fixed') return `${scope}${left} == ${indexedRhsText(cons)}`;
      if (relation === 'bound') return `${scope}${left} bound(${(cons.lower_param || cons.lower) ?? '-'}, ${(cons.upper_param || cons.upper) ?? '-'})`;
      if (relation === 'non_negative') return `${scope}${left} >= 0`;
      const rhs = indexedRhsText(cons);
      if (rhs === FORMULA_NOT_GENERATED) return FORMULA_NOT_GENERATED;
      const formula = `${scope}${left} ${relation} ${rhs}`;
      return isTrivialZeroConstraintFormula(formula) ? FORMULA_NOT_GENERATED : formula;
    }

    function compileStatusForRelation(relation) {
      return ['<=', '>=', '=='].includes(String(relation || '')) ? 'supported' : 'pending_linearization';
    }

    function objectiveTermText(term) {
      if (term.expression) return term.expression;
      if (term.enabled === false) return `[disabled] ${term.name || term.var}`;
      if (!term.var) return FORMULA_NOT_GENERATED;
      const key = Array.isArray(term.key) && term.key.length ? `[${term.key.join(',')}]` : '';
      const weight = Number(term.weight ?? 1);
      const paramKey = Array.isArray(term.param_key) && term.param_key.length ? `[${term.param_key.join(',')}]` : '';
      const coef = term.coef_param ? `${term.coef_param}${paramKey}` : (term.coef ?? 1);
      const base = `${String(coef) === '1' ? '' : `${coef} * `}${term.var}${key}`;
      const weighted = weight !== 1 ? `${weight} * ${base}` : base;
      const foreach = Array.isArray(term.foreach) ? term.foreach : [];
      return foreach.length ? `sum(${weighted} for ${foreach.map(d => `${d} in ${d}`).join(' for ')})` : weighted;
    }

    function objectivePreviewText() {
      const parts = getIndexedGenericParts();
      const terms = (parts.objective?.terms || []).filter(t => t.enabled !== false);
      const lines = [state.genericSense || parts.objective?.sense || 'minimize'];
      terms.forEach((term, index) => {
        const prefix = term.sign === '-' ? '-' : (index === 0 ? '' : '+');
        lines.push(`${prefix} ${getObjectiveDisplayFormula(term)}`.trim());
      });
      if (terms.length === 0) lines.push('暂无启用目标项');
      return lines.join('\n');
    }

    function runtimeParamRows(params) {
      const entries = Object.entries(params || {});
      if (!entries.length) return '<p class="muted">当前模型没有声明运行时参数占位。</p>';
      return `<table class="compact-table"><thead><tr><th>参数名</th><th>当前默认值</th><th>业务含义</th></tr></thead><tbody>${entries.map(([name, value]) => `<tr><td class="nowrap-cell" title="${name}">${name}</td><td><pre class="json-cell">${escapeHtml(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))}</pre></td><td>${parameterMeaning(name)}</td></tr>`).join('')}</tbody></table>`;
    }

    function parameterMeaning(name) {
      const map = {
        load_forecast: '负荷预测，来源：时序预测模型，单位MW，维度time',
        renewable_forecast: '新能源出力预测，来源：新能源预测系统，单位MW，维度time/site,time',
        initial_unit_status: '机组初始开停机状态，来源：实时运行系统，维度unit',
        initial_unit_output: '机组初始出力，来源：实时运行系统，单位MW，维度unit',
        unit_min_output: '机组最小出力，来源：设备台账，单位MW，维度unit',
        unit_max_output: '机组最大出力，来源：设备台账，单位MW，维度unit',
        ramp_up_limit: '上爬坡限制，来源：设备参数库，单位MW/h，维度unit',
        ramp_down_limit: '下爬坡限制，来源：设备参数库，单位MW/h，维度unit',
        fuel_cost: '燃料成本，来源：燃料/经营系统，单位元/MWh，维度unit',
        startup_cost: '启动成本，来源：经营指标库，单位元/次，维度unit',
        electricity_price: '电价，来源：市场系统，单位元/MWh，维度time',
        storage_capacity: '储能容量，来源：设备台账，单位MWh，维度storage',
        initial_soc: '初始SOC，来源：实时运行系统，单位MWh，维度storage'
      };
      return map[name] || '运行时参数，可在任务提交时覆盖';
    }

    function genericBasicVisualEditor() {
      const parts = getBasicGenericParts();
      const constraints = parts.constraints || [];
      const currentIndex = Math.max(0, Math.min(state.selectedBasicConstraint, Math.max(0, constraints.length - 1)));
      const current = constraints[currentIndex];
      const variableOptions = (parts.variables || []).map(v => `<option value="${v.name}">${v.name}</option>`).join('');
      const parameterSection = editorSection('1. 运行时参数', '定义求解任务可注入的业务参数，任务中心会按这些参数名传入数据。', '', runtimeParamRows(parts.parameters));
      const variableSection = editorSection('2. 决策变量', '定义变量编码、取值类型和上下界。变量名应使用业务语义，不使用 x/y/z。', '<button class="btn" onclick="addBasicVariableFromForm()">新增变量</button>', `
        <div class="grid form-grid-compact">
          <div class="field"><label>变量编码</label><input id="basicVarName" value="business_var_${(parts.variables || []).length + 1}" /></div>
          <div class="field"><label>类型</label><select id="basicVarDomain"><option>NonNegativeReals</option><option>Reals</option><option>Integers</option><option>NonNegativeIntegers</option><option>Binary</option></select></div>
          <div class="field"><label>下界</label><input id="basicVarLb" value="0" /></div>
          <div class="field"><label>上界</label><input id="basicVarUb" value="100" /></div>
        </div>
        <table class="mt compact-table"><thead><tr><th>变量</th><th>类型</th><th>下界</th><th>上界</th><th>操作</th></tr></thead><tbody>${(parts.variables || []).map((v, i) => `<tr><td class="nowrap-cell" title="${v.name}">${v.name}</td><td>${v.domain}</td><td>${boundLabel(v, 'lb')}</td><td>${boundLabel(v, 'ub')}</td><td><button class="btn" onclick="removeBasicVariable(${i})">删除</button></td></tr>`).join('')}</tbody></table>`);
      const constraintSection = editorSection('3. 业务约束', '定义业务规则对应的数学关系，选中某条约束后可在下方维护左端变量项。', '<button class="btn" onclick="addBasicConstraintFromForm()">新增约束</button>', `
        <div class="grid form-grid-compact">
          <div class="field"><label>约束编码</label><input id="basicConstraintName" value="business_rule_${constraints.length + 1}" /></div>
          <div class="field"><label>关系</label><select id="basicConstraintSense"><option value="<=">&lt;=</option><option value=">=">&gt;=</option><option value="==">==</option></select></div>
          <div class="field"><label>右端</label><input id="basicConstraintRhs" value="0" /></div>
          <div class="field"><label>说明</label><input value="业务规则边界" disabled /></div>
        </div>
        <table class="mt compact-table"><thead><tr><th>约束</th><th>表达式</th><th>操作</th></tr></thead><tbody>${constraints.map((c, i) => { const formula = `${(c.terms || []).map(termText).join(' + ')} ${c.sense} ${rhsLabel(c)}`; return `<tr style="${currentIndex === i ? 'background:var(--soft-blue)' : ''}"><td class="nowrap-cell" title="${c.name}">${c.name}</td><td>${formulaDisplayBlock(formula)}</td><td><button class="btn" onclick="selectBasicConstraint(${i})">编辑</button> <button class="btn" onclick="removeBasicConstraint(${i})">删除</button></td></tr>`; }).join('')}</tbody></table>`);
      const termSection = current ? editorSection(`4. 约束项编辑：${current.name}`, '维护当前约束左端的变量项和系数。', '', `
        <div class="grid form-grid-compact">
          <div class="field"><label>变量</label><select id="basicTermVar">${variableOptions}</select></div>
          <div class="field"><label>系数</label><input id="basicTermCoef" value="1" /></div>
          <div class="field"><label>操作</label><button class="btn primary" onclick="addBasicConstraintTerm(${currentIndex})">追加到约束</button></div>
        </div>
        <table class="mt compact-table"><thead><tr><th>系数/参数</th><th>变量</th><th>操作</th></tr></thead><tbody>${(current.terms || []).map((t, i) => `<tr><td>${coefLabel(t)}</td><td class="nowrap-cell" title="${t.var}">${t.var}</td><td><button class="btn" onclick="removeBasicConstraintTerm(${currentIndex}, ${i})">删除</button></td></tr>`).join('')}</tbody></table>`) : editorSection('4. 约束项编辑', '先新增一条约束，再继续配置约束项。', '', '<p class="muted">暂无可编辑约束。</p>');
      const objectiveSection = editorSection('5. 目标函数', '维护目标函数项、系数和常数项。优化方向由上方“优化方向”控制。', '<button class="btn" onclick="addBasicObjectiveTermFromForm()">新增目标项</button>', `
        <div class="grid form-grid-compact">
          <div class="field"><label>变量</label><select id="basicObjectiveVar">${variableOptions}</select></div>
          <div class="field"><label>系数</label><input id="basicObjectiveCoef" value="1" /></div>
          <div class="field"><label>常数项</label><input value="${parts.objective?.constant ?? 0}" onchange="updateBasicObjectiveConstant(this.value)" /></div>
        </div>
        <table class="mt compact-table"><thead><tr><th>系数/参数</th><th>变量</th><th>操作</th></tr></thead><tbody>${(parts.objective?.terms || []).map((t, i) => `<tr><td>${coefLabel(t)}</td><td class="nowrap-cell" title="${t.var}">${t.var}</td><td><button class="btn" onclick="removeBasicObjectiveTerm(${i})">删除</button></td></tr>`).join('')}</tbody></table>`);
      return `<div class="formula-editor-shell">${parameterSection}${variableSection}${constraintSection}${termSection}${objectiveSection}</div>`;
    }

    function genericIndexedVisualEditor() {
      return semanticSpecDrivenFormulaEditor();
    }

    function semanticSpecDrivenFormulaEditor() {
      const options = getSemanticOptions();
      if (!options.sets.length || !options.parameters.length || !options.variables.length) {
        return `<div class="formula-editor-shell">${editorSection('第 3 步：数学展开', '公式层只引用第 2 步 semantic_spec 中的集合、参数、变量。', '', '<p class="muted">第 2 步尚未完整定义集合、参数或变量，请先返回第 2 步补充模型语义。</p><div class="actions mt"><button class="btn primary" onclick="setBuilderStep(1)">返回第 2 步</button></div>')}</div>`;
      }
      return `<div class="formula-editor-shell">
        ${formulaVariableExpansionBlock(options)}
        ${formulaConstraintBlock(options)}
        ${formulaObjectiveBlock(options)}
        ${formulaPreviewBlock()}
        ${formulaAdvancedJsonBlock()}
      </div>`;
    }

    function relationTypeOptions(selected = '>=') {
      const groups = {
        '基础关系': [['<=', '<='], ['>=', '>='], ['==', '==']],
        '区间关系': [['between', 'between 区间约束'], ['fixed', 'fixed 固定值约束'], ['bound', 'bound 上下界绑定'], ['non_negative', 'non_negative 非负约束']],
        '逻辑关系': [['if_then', 'if_then'], ['indicator', 'indicator'], ['either_or', 'either_or'], ['mutual_exclusive', 'mutual_exclusive']],
        '模板关系': [['at_least_one', 'at_least_one'], ['at_most_one', 'at_most_one'], ['exactly_one', 'exactly_one']]
      };
      return Object.entries(groups).map(([label, rows]) => `<optgroup label="${label}">${rows.map(([value, text]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</optgroup>`).join('');
    }

    function formulaVariableExpansionBlock(options) {
      const parts = getIndexedGenericParts();
      const parameterOptions = optionList(options.parameters, p => p.math_param || p.key);
      const variableOptions = optionList(options.variables, v => v.math_var || v.key);
      const defaultVariableCode = (options.variables || [])[0]?.math_var || (options.variables || [])[0]?.key || '';
      const defaultVariable = semanticVariableByCode(defaultVariableCode);
      const defaultDomain = normalizeVariableDomain(defaultVariable.domain || 'NonNegativeReals');
      const defaultIndices = semanticVariableDimension(defaultVariableCode);
      const setOptions = (options.sets || []).map(item => {
        const value = item.key || item.code || item.name;
        return `<option value="${escapeHtml(value)}" ${defaultIndices.includes(value) ? 'selected' : ''}>${escapeHtml(item.name || value)}</option>`;
      }).join('');
      const defaultBounds = normalizeVariableBounds({
        name: defaultVariableCode,
        domain: defaultDomain,
        lb: defaultVariable.lb,
        ub: defaultVariable.ub,
        lb_param: defaultVariable.lb_param,
        ub_param: defaultVariable.ub_param,
        lb_type: defaultVariable.lb_type,
        lb_value: defaultVariable.lb_value,
        ub_type: defaultVariable.ub_type,
        ub_value: defaultVariable.ub_value
      });
      return editorSection('1. 变量展开配置', '选择第 2 步定义的变量，并配置数学展开维度、类型和上下界绑定。', '<button class="btn primary" onclick="addIndexedVariableFromForm()">追加变量展开</button>', `
        <div class="grid cols-2 variable-expansion-config">
          <div class="formula-subblock variable-basic-config">
            <div class="formula-subtitle">变量基础配置</div>
            <div class="grid form-grid-compact">
              <div class="field"><label>选择变量</label><select id="indexedVarName" onchange="syncIndexedVariableDefaults(this.value)">${variableOptions}</select></div>
              <div class="field"><label>展开维度</label><select id="indexedVarIndices" multiple size="3">${setOptions}</select></div>
              <div class="field"><label>变量类型</label><select id="indexedVarDomain">${variableDomainOptions(defaultDomain)}</select></div>
            </div>
          </div>
          <div class="formula-subblock variable-bound-config">
            <div class="formula-subtitle">边界配置</div>
            <div class="grid bound-pair-grid">
              <div class="field"><label>下界类型</label><select id="indexedVarLbType"><option value="none" ${defaultBounds.lb_type === 'none' ? 'selected' : ''}>无</option><option value="constant" ${defaultBounds.lb_type === 'constant' ? 'selected' : ''}>常数</option><option value="parameter" ${defaultBounds.lb_type === 'parameter' ? 'selected' : ''}>参数</option></select></div>
              <div class="field"><label>下界值</label><input id="indexedVarLbValue" value="${escapeHtml(defaultBounds.lb_value ?? '')}" list="indexedParamList" /></div>
              <div class="field"><label>上界类型</label><select id="indexedVarUbType"><option value="none" ${defaultBounds.ub_type === 'none' ? 'selected' : ''}>无</option><option value="constant" ${defaultBounds.ub_type === 'constant' ? 'selected' : ''}>常数</option><option value="parameter" ${defaultBounds.ub_type === 'parameter' ? 'selected' : ''}>参数</option></select></div>
              <div class="field"><label>上界值</label><input id="indexedVarUbValue" value="${escapeHtml(defaultBounds.ub_value ?? '')}" list="indexedParamList" /></div>
            </div>
          </div>
          <datalist id="indexedParamList">${(options.parameters || []).map(p => `<option value="${escapeHtml(p.math_param || p.key)}">${escapeHtml(p.name || p.key)}</option>`).join('')}</datalist>
        </div>
        <table class="mt compact-table"><colgroup><col style="width:130px"><col><col style="width:160px"><col style="width:100px"><col style="width:112px"></colgroup><thead><tr><th>变量</th><th>展开维度</th><th>类型</th><th>上下界</th><th>操作</th></tr></thead><tbody>${(parts.variables || []).map((v, i) => `<tr><td class="nowrap-cell" title="${v.name}">${v.name}</td><td class="formula-cell">${escapeHtml(getVariableDisplayExpansion(v))}</td><td>${variableDomainLabel(v.domain)}</td><td>${boundLabel(v, 'lb')} / ${boundLabel(v, 'ub')}</td><td><button class="btn" onclick="removeIndexedVariable(${i})">删除展开</button></td></tr>`).join('') || '<tr><td colspan="5">暂无变量展开配置。</td></tr>'}</tbody></table>`);
    }

    function formulaConstraintBlock(options) {
      const parts = getIndexedGenericParts();
      const semanticConstraints = options.spec.constraints || [];
      const rows = (parts.constraints || []).map((c, i) => {
        const code = c.code || c.constraint_id || c.name || `constraint_${i + 1}`;
        const name = genericConstraintDisplayName(c, semanticConstraints, code);
        const scope = formulaScopeListFromRow(c);
        const scopeText = scope.length ? `∀ ${formulaScopePrefix(scope)}` : '-';
        const formula = getConstraintDisplayFormula(c);
        const source = formulaSourceLabel(c.source || c.source_component || c.business_rule || 'formula_editor');
        const status = c.compiled_status || c.compile_status || compileStatusForRelation(c.sense);
        return `<tr><td class="nowrap-cell" title="${escapeHtml(name)}">${escapeHtml(name)}</td><td><code>${escapeHtml(code)}</code></td><td class="formula-scope-cell" title="${escapeHtml(scopeText)}">${escapeHtml(scopeText)}</td><td class="formula-display-col" title="${escapeHtml(formula)}">${formulaDisplayBlock(formula)}</td><td class="formula-status-col">${formulaStatusPill(status)}</td><td class="formula-source-col">${escapeHtml(source)}</td><td class="formula-ops-col"><button class="btn" onclick="openGenericConstraintFormulaEditor(${i})">编辑公式</button> <button class="btn" onclick="removeIndexedConstraint(${i})">删除</button></td></tr>`;
      }).join('');
      return editorSection('2. 约束公式配置', '约束公式由统一公式编辑器维护；公式展示包含中文公式与可折叠原始 DSL。', '<button class="btn primary" style="white-space:nowrap" onclick="addGenericConstraintFormula()">添加约束公式</button>', `
        <div class="table-scroll formula-list-scroll"><table class="mt compact-table formula-list-table"><colgroup><col style="width:120px"><col style="width:112px"><col style="width:150px"><col class="formula-col"><col style="width:92px"><col style="width:96px"><col style="width:184px"></colgroup><thead><tr><th>约束名称</th><th>约束编码</th><th>作用范围 / foreach</th><th>公式展示</th><th>编译状态</th><th>来源</th><th class="formula-ops-col">操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7">暂无约束公式。请点击“添加约束公式”进入统一公式编辑器。</td></tr>'}</tbody></table></div>`);
    }

    function formulaObjectiveBlock(options) {
      const parts = getIndexedGenericParts();
      const objective = parts.objective || { terms: [], constant: 0 };
      const semanticObjectives = options.objectives || [];
      return editorSection('3. 目标函数配置', '目标项公式由统一公式编辑器维护；目标函数预览和表格公式使用同一来源。', '<button class="btn primary" onclick="addGenericObjectiveFormula()">添加目标项</button>', `
        <div class="grid form-grid-compact">
          <div class="field"><label>目标方向</label><select onchange="updateFormulaObjectiveSense(this.value)"><option value="minimize" ${state.genericSense === 'minimize' ? 'selected' : ''}>最小化 minimize</option><option value="maximize" ${state.genericSense === 'maximize' ? 'selected' : ''}>最大化 maximize</option></select></div>
        </div>
        ${formulaDisplayBlock(objectivePreviewText())}
        <div class="actions mt"><button class="btn" onclick="copyText(state.genericIndexedObjectiveText, '目标函数 JSON 已复制')">复制目标函数 JSON</button></div>
        <div class="table-scroll formula-list-scroll"><table class="mt compact-table formula-list-table"><colgroup><col style="width:52px"><col style="width:126px"><col style="width:112px"><col class="formula-col"><col style="width:84px"><col style="width:104px"><col style="width:184px"></colgroup><thead><tr><th>启用</th><th>目标项名称</th><th>目标项编码</th><th>公式</th><th>权重</th><th>排序</th><th class="formula-ops-col">操作</th></tr></thead><tbody>${(objective.terms || []).map((t, i) => { const code = t.code || t.term_id || t.name || `term_${i + 1}`; const formula = getObjectiveDisplayFormula(t); const name = genericObjectiveDisplayName(t, semanticObjectives, code); const weight = t.weight_key || t.weight || 1; return `<tr><td><input type="checkbox" ${t.enabled === false ? '' : 'checked'} onchange="toggleObjectiveTerm(${i})" /></td><td class="cell-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</td><td><code>${escapeHtml(code)}</code></td><td class="formula-display-col" title="${escapeHtml(getObjectiveDisplayFormula(t))}">${formulaDisplayBlock(formula)}</td><td>${escapeHtml(weight)}</td><td><button class="btn" onclick="moveObjectiveTerm(${i}, -1)">上移</button> <button class="btn" onclick="moveObjectiveTerm(${i}, 1)">下移</button></td><td class="formula-ops-col"><button class="btn" onclick="openGenericObjectiveFormulaEditor(${i})">编辑公式</button> <button class="btn" onclick="removeIndexedObjectiveTerm(${i})">删除</button></td></tr>`; }).join('') || '<tr><td colspan="7">暂无目标项。请点击“添加目标项”进入统一公式编辑器。</td></tr>'}</tbody></table></div>`);
    }

    function formulaPreviewBlock() {
      return editorSection('4. 展开预览', '汇总集合规模、变量结构、约束结构和目标方向，用于快速判断展开规模。', '', genericExpansionPreview());
    }

    function genericConstraintDisplayName(row = {}, semanticConstraints = [], fallback = '') {
      const code = row.code || row.constraint_id || row.name || fallback;
      const semantic = (semanticConstraints || []).find(item => [item.code, item.key, item.name].includes(code));
      return row.display_name || (row.name && row.name !== code ? row.name : '') || semantic?.name || code || fallback;
    }

    function genericObjectiveDisplayName(row = {}, semanticObjectives = [], fallback = '') {
      const code = row.code || row.term_id || row.name || fallback;
      const semantic = (semanticObjectives || []).find(item => [item.code, item.key, item.name].includes(code));
      return row.display_name || (row.name && row.name !== code ? row.name : '') || semantic?.name || code || fallback;
    }

    function formulaSourceLabel(source = '') {
      const value = String(source || '').trim();
      if (!value || value === 'formula_editor') return '公式编辑器';
      if (value === 'component_generated') return '组件生成';
      if (value === 'user_defined') return '用户维护';
      return value;
    }

    function formulaStatusPill(status = '') {
      const value = String(status || '').trim();
      if (['compiled', 'supported', 'ok', 'valid'].includes(value)) return '<span class="pill green">已支持</span>';
      if (['risk', 'warning', 'draft'].includes(value)) return '<span class="pill amber">有风险</span>';
      if (!value || value === FORMULA_NOT_GENERATED || value === 'not_generated') return '<span class="pill red">未生成</span>';
      return pill(value);
    }

    function firstSemanticConstraintSeed() {
      const constraints = getSemanticSpec().constraints || [];
      const item = constraints.find(c => c.code || c.name) || {};
      const code = item.code || item.key || item.name || `constraint_${getIndexedGenericParts().constraints.length + 1}`;
      return { code, name: item.name || code, source: 'formula_editor', enabled: true, compiled_status: 'draft' };
    }

    function firstSemanticObjectiveSeed() {
      const objectives = getSemanticSpec().objectives || [];
      const item = objectives.find(o => o.code || o.name) || {};
      const code = item.code || item.key || item.name || `objective_term_${(getIndexedGenericParts().objective?.terms || []).length + 1}`;
      return { code, term_id: code, name: item.name || code, source: 'formula_editor', enabled: true, weight: 1 };
    }

    function addGenericConstraintFormula() {
      const parts = getIndexedGenericParts();
      parts.constraints = parts.constraints || [];
      const row = firstSemanticConstraintSeed();
      parts.constraints.push(row);
      setIndexedGenericParts(parts);
      openGenericConstraintFormulaEditor(parts.constraints.length - 1);
    }

    function addGenericObjectiveFormula() {
      const parts = getIndexedGenericParts();
      parts.objective = parts.objective || { terms: [], constant: 0, sense: state.genericSense || 'minimize' };
      parts.objective.terms = parts.objective.terms || [];
      parts.objective.terms.push(firstSemanticObjectiveSeed());
      parts.objective.sense = state.genericSense || parts.objective.sense || 'minimize';
      setIndexedGenericParts(parts);
      openGenericObjectiveFormulaEditor(parts.objective.terms.length - 1);
    }

    function syncConstraintCodeFromRule(ruleCode) {
      const spec = getSemanticSpec();
      const rule = (spec.constraints || []).find(item => (item.code || item.name) === ruleCode);
      setInputValue('indexedConstraintName', rule?.code || rule?.name || ruleCode || '');
    }

    function syncObjectiveCodeFromSemantic(objectiveCode) {
      const spec = getSemanticSpec();
      const objective = (spec.objectives || []).find(item => (item.code || item.name) === objectiveCode);
      setInputValue('indexedObjectiveName', objective?.code || objective?.name || objectiveCode || '');
    }

    function semanticVariableByCode(code) {
      const spec = getSemanticSpec();
      return (spec.variables || []).find(item => (item.math_var || item.code || item.key || item.name) === code) || {};
    }

    function syncIndexedVariableDefaults(code) {
      const variable = semanticVariableByCode(code);
      const domain = normalizeVariableDomain(variable.domain || 'NonNegativeReals');
      setInputValue('indexedVarDomain', domain);
      const dimensions = semanticVariableDimension(code);
      const indexSelect = document.getElementById('indexedVarIndices');
      if (indexSelect) Array.from(indexSelect.options).forEach(option => { option.selected = dimensions.includes(option.value); });
      const bounds = normalizeVariableBounds({
        name: code,
        domain,
        lb: variable.lb,
        ub: variable.ub,
        lb_param: variable.lb_param,
        ub_param: variable.ub_param,
        lb_type: variable.lb_type,
        lb_value: variable.lb_value,
        ub_type: variable.ub_type,
        ub_value: variable.ub_value
      });
      setInputValue('indexedVarLbType', bounds.lb_type || 'none');
      setInputValue('indexedVarLbValue', bounds.lb_value ?? '');
      setInputValue('indexedVarUbType', bounds.ub_type || 'none');
      setInputValue('indexedVarUbValue', bounds.ub_value ?? '');
    }

    function updateFormulaObjectiveSense(sense) {
      state.genericSense = sense;
      const p = getIndexedGenericParts();
      p.objective = p.objective || {};
      p.objective.sense = sense;
      setIndexedGenericParts(p);
      toast(`目标方向已切换为${sense === 'maximize' ? '最大化' : '最小化'}`);
    }

    function formulaAdvancedJsonBlock() {
      return `<div id="genericAdvancedJsonSection">${editorSection('5. 高级 JSON 模式', '仅编辑数学展开 spec，不会反写第 2 步语义定义。', '', `<div class="grid cols-1">
        <div class="field"><label>变量展开 JSON</label><textarea onchange="state.genericIndexedVariablesText=this.value;state.modelReady=false">${state.genericIndexedVariablesText}</textarea></div>
        <div class="field"><label>约束公式 JSON</label><textarea onchange="state.genericIndexedConstraintsText=this.value;state.modelReady=false">${state.genericIndexedConstraintsText}</textarea></div>
        <div class="field"><label>目标函数 JSON</label><textarea onchange="state.genericIndexedObjectiveText=this.value;state.modelReady=false">${state.genericIndexedObjectiveText}</textarea></div>
      </div>`)}</div>`;
    }

    function genericFormulaHelper() {
      let options = { setKeys: [], parameterKeys: [], variableKeys: [] };
      try { options = getSemanticOptions(); } catch (e) {}
      const setOptionHtml = options.setKeys.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('');
      const paramOptionHtml = options.parameterKeys.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('');
      const varOptionHtml = options.variableKeys.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('');
      return `<div class="grid cols-2">
        <div class="field"><label>变量编码</label><input id="helperVarName" value="${state.genericBuilderMode === 'indexed' ? 'unit_output' : 'business_variable'}" /></div>
        <div class="field"><label>索引/维度</label><select id="helperVarIndices" multiple size="3">${setOptionHtml}</select></div>
        <div class="field"><label>变量类型</label><select id="helperVarDomain">${variableDomainOptions('NonNegativeReals')}</select></div>
        <div class="field"><label>上界参数</label><select id="helperVarUbParam"><option value="">无</option>${paramOptionHtml}</select></div>
      </div>
      <div class="actions mt"><button class="btn" onclick="appendVariableTemplate()">追加变量</button><button class="btn" onclick="appendConstraintTemplate()">追加约束</button><button class="btn" onclick="appendObjectiveTerm()">追加目标项</button></div>
      <div class="grid cols-2 mt">
        <div class="field"><label>约束编码</label><input id="helperConstraintName" value="${state.genericBuilderMode === 'indexed' ? 'power_balance_extension' : 'business_rule'}" /></div>
        <div class="field"><label>约束作用集合</label><select id="helperConstraintForeach" multiple size="3">${setOptionHtml}</select></div>
        <div class="field"><label>右端类型</label><select id="helperConstraintRhsType"><option value="const">常数 rhs</option><option value="param">参数 rhs_param</option></select></div>
        <div class="field"><label>右端值/参数</label><select id="helperConstraintRhs">${paramOptionHtml}<option value="0">常数0</option></select></div>
      </div>
      <div class="field mt"><label>自定义约束 JSON（可选）</label><textarea id="helperCustomConstraint" style="min-height:90px" placeholder='{"name":"power_balance","foreach":["time"],"terms":[{"var":"unit_output","foreach":["unit"],"key":["unit","time"],"coef":1}],"sense":">=","rhs_param":"load_forecast","rhs_key":["time"]}'></textarea></div>
      <div class="actions mt"><button class="btn" onclick="appendCustomConstraintJson()">追加自定义约束</button></div>
      <p class="muted mt">第 2 步只定义业务口径：有哪些集合、参数、变量和业务规则；第 3 步定义数学展开：变量如何求和、约束如何绑定右端参数、目标函数如何计算。简单公式用表单，复杂公式用上方 JSON。</p>`;
    }

    function genericExpansionPreview() {
      try {
        const spec = getGenericSpec();
        const semantic = getSemanticSpec();
        const scale = expansionScaleSummary(spec);
        const objective = spec.objective || {};
        return `<div class="expansion-preview-grid compact-preview">
          <div class="expansion-summary-cards">
            ${previewMetricCard('集合', Object.keys(spec.sets || {}).length, '个索引集合')}
            ${previewMetricCard('变量结构', (spec.variables || []).length, `约 ${scale.variableInstances} 个实例`)}
            ${previewMetricCard('约束结构', (spec.constraints || []).length, `约 ${scale.constraintInstances} 条约束`)}
            ${previewMetricCard('目标项', (objective.terms || []).filter(t => t.enabled !== false).length, objective.sense || state.genericSense || 'minimize')}
          </div>
          <div class="expansion-preview-group">
            <div class="formula-subtitle">结构摘要</div>
            ${previewListHtml([], '变量展开示例、约束展开示例已折叠为结构摘要，避免长列表遮挡页面。')}
            <div class="table-scroll expansion-summary-scroll">
              <table class="compact-table expansion-summary-table">
                <thead><tr><th>类型</th><th>名称</th><th>编码</th><th>索引/维度</th><th>展开规模</th></tr></thead>
                <tbody>${expansionStructureRows(spec, semantic) || '<tr><td colspan="5">暂无可预览结构。</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      } catch (e) {
        return `<p class="muted">当前定义尚未通过解析：${e.message}</p>`;
      }
    }

    function previewMetricCard(label, value, detail) {
      return `<div class="preview-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail || '')}</small></div>`;
    }

    function expansionScaleSummary(spec = {}) {
      const sizeOf = keys => (keys || []).reduce((total, key) => {
        const values = spec.sets?.[key];
        return total * (Array.isArray(values) && values.length ? values.length : 1);
      }, 1);
      const variableInstances = (spec.variables || []).reduce((sum, item) => sum + sizeOf(item.indices || item.dimension || []), 0);
      const constraintInstances = (spec.constraints || []).reduce((sum, item) => sum + sizeOf(formulaScopeListFromRow(item)), 0);
      return { variableInstances, constraintInstances };
    }

    function expansionStructureRows(spec = {}, semantic = getSemanticSpec()) {
      const lookup = semanticLookup(semantic);
      const sizeOf = keys => (keys || []).reduce((total, key) => {
        const values = spec.sets?.[key];
        return total * (Array.isArray(values) && values.length ? values.length : 1);
      }, 1);
      const setRows = Object.entries(spec.sets || {}).map(([code, values]) => {
        const item = lookup.sets[code] || {};
        return `<tr><td>集合</td><td>${escapeHtml(semanticDisplayName(item, code))}</td><td><code>${escapeHtml(code)}</code></td><td>-</td><td>${Array.isArray(values) ? values.length : 0} 个成员</td></tr>`;
      });
      const variableRows = (spec.variables || []).map(variable => {
        const indices = variable.indices || variable.dimension || [];
        const meta = lookup.variables[variable.name] || {};
        return `<tr><td>变量</td><td>${escapeHtml(semanticDisplayName(meta, variable.name))}</td><td><code>${escapeHtml(variable.name || '-')}</code></td><td>${escapeHtml(indices.join(', ') || '-')}</td><td>${sizeOf(indices)} 个实例</td></tr>`;
      });
      const constraintRows = (spec.constraints || []).map(constraint => {
        const scope = formulaScopeListFromRow(constraint);
        const meta = lookup.constraints[constraint.name] || {};
        return `<tr><td>约束</td><td>${escapeHtml(semanticDisplayName(meta, constraint.name))}</td><td><code>${escapeHtml(constraint.name || constraint.code || '-')}</code></td><td>${escapeHtml(scope.join(', ') || '-')}</td><td>${sizeOf(scope)} 条</td></tr>`;
      });
      return [...setRows, ...variableRows, ...constraintRows].join('');
    }

    function previewListHtml(items = [], emptyText = '暂无') {
      return items.length ? `<ul class="expansion-preview-list">${items.map(item => `<li>${item}</li>`).join('')}</ul>` : `<p class="muted">${escapeHtml(emptyText)}</p>`;
    }

    function semanticLookup(semantic = getSemanticSpec()) {
      const byCode = list => Object.fromEntries((list || []).map(item => [item.math_var || item.math_param || item.code || item.key || item.name, item]).filter(([key]) => key));
      return {
        sets: byCode(semantic.sets || []),
        parameters: byCode(semantic.parameters || []),
        variables: byCode(semantic.variables || []),
        constraints: byCode(semantic.constraints || [])
      };
    }

    function semanticDisplayName(item = {}, fallback = '') {
      return item.name && item.name !== fallback ? item.name : fallback;
    }

    function semanticSetInfoHtml(spec = {}, semantic = getSemanticSpec()) {
      const lookup = semanticLookup(semantic);
      const rows = Object.entries(spec.sets || {}).map(([code, values]) => {
        const item = lookup.sets[code] || {};
        const name = semanticDisplayName(item, code);
        const count = Array.isArray(values) && values.length ? values.length : semanticSetMembers(item).length;
        const unit = code === 'time' || item.type === 'time_period' ? '个时段' : '个成员';
        return `<li title="${escapeHtml(code)}"><span class="preview-main">${escapeHtml(name)}：${count} ${unit}</span><span class="preview-code">${escapeHtml(code)}</span></li>`;
      });
      return rows.length ? `<ul class="expansion-preview-list">${rows.join('')}</ul>` : '<p class="muted">无</p>';
    }

    function genericContexts(spec, names) {
      const keys = (names || []).filter(Boolean);
      if (!keys.length) return [{}];
      let contexts = [{}];
      keys.forEach(key => {
        const values = Array.isArray(spec.sets?.[key]) ? spec.sets[key] : [];
        contexts = contexts.flatMap(ctx => values.map(value => ({ ...ctx, [key]: value })));
      });
      return contexts;
    }

    function semanticMemberLabel(setCode, value, semantic = getSemanticSpec()) {
      const lookup = semanticLookup(semantic);
      const item = lookup.sets[setCode] || {};
      if (setCode === 'time' || item.type === 'time_period') return `第${value}时段`;
      return String(value);
    }

    function formatIndexedLabel(name, values, meta = {}) {
      const displayName = meta.displayName || name;
      const code = meta.code || name;
      const label = values && values.length ? `${displayName}[${values.join(', ')}]` : displayName;
      return `<span class="preview-main">${escapeHtml(label)}</span><span class="preview-code">${escapeHtml(code)}</span>`;
    }

    function expandGenericVariableLabels(spec, semantic = getSemanticSpec()) {
      const lookup = semanticLookup(semantic);
      return (spec.variables || []).flatMap(variable => {
        const indices = variable.indices || [];
        const meta = lookup.variables[variable.name] || {};
        const displayName = semanticDisplayName(meta, variable.name);
        if (!indices.length) return [`${displayName} ${variable.name}`];
        return genericContexts(spec, indices).map(ctx => formatIndexedLabel(variable.name, indices.map(key => semanticMemberLabel(key, ctx[key], semantic)), { displayName, code: variable.name }));
      });
    }

    function expandGenericConstraintLabels(spec, semantic = getSemanticSpec()) {
      const lookup = semanticLookup(semantic);
      return (spec.constraints || []).flatMap(constraint => {
        const foreach = formulaScopeListFromRow(constraint);
        const meta = lookup.constraints[constraint.name] || {};
        const displayName = semanticDisplayName(meta, constraint.name);
        if (!foreach.length) return [`${displayName} ${constraint.name}`];
        return genericContexts(spec, foreach).map(ctx => formatIndexedLabel(constraint.name, foreach.map(key => semanticMemberLabel(key, ctx[key], semantic)), { displayName, code: constraint.name }));
      });
    }

    function appendVariableTemplate() {
      try {
        const name = document.getElementById('helperVarName')?.value?.trim() || (state.genericBuilderMode === 'indexed' ? 'unit_output' : 'business_variable');
        const selectedIndices = selectedValues('helperVarIndices');
        const indices = selectedIndices.length ? selectedIndices : (document.getElementById('helperVarIndices')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const domain = document.getElementById('helperVarDomain')?.value || 'NonNegativeReals';
        const ubRaw = document.getElementById('helperVarUbParam')?.value?.trim() || '';
        if (state.genericBuilderMode === 'indexed') {
          const variables = JSON.parse(state.genericIndexedVariablesText || '[]');
          const variable = { name, domain, lb: 0 };
          if (indices.length) variable.indices = indices;
          if (ubRaw) variable.ub_param = ubRaw;
          variables.push(variable);
          state.genericIndexedVariablesText = JSON.stringify(variables, null, 2);
        } else {
          const variables = JSON.parse(state.genericVariablesText || '[]');
          const variable = { name, domain, lb: 0 };
          if (ubRaw) {
            const ub = Number(ubRaw);
            if (!Number.isNaN(ub)) variable.ub = ub;
          }
          variables.push(variable);
          state.genericVariablesText = JSON.stringify(variables, null, 2);
        }
        state.modelReady = false;
        render();
        toast('已追加变量');
      } catch (e) {
        toast(`变量追加失败：${e.message}`);
      }
    }

    function normalizeSemanticSpec(spec) {
      const next = spec && typeof spec === 'object' ? { ...spec } : {};
      const objects = Array.isArray(next.objects) ? next.objects : (Array.isArray(next.business_objects) ? next.business_objects : []);
      next.objects = objects;
      next.business_objects = objects;
      next.sets = Array.isArray(next.sets) ? next.sets : [];
      next.parameters = Array.isArray(next.parameters) ? next.parameters : [];
      next.variables = Array.isArray(next.variables) ? next.variables : [];
      next.constraints = Array.isArray(next.constraints) ? next.constraints : [];
      next.objectives = Array.isArray(next.objectives) && next.objectives.length ? next.objectives : [{
        code: next.objective?.code || 'custom_objective',
        name: next.objective?.name || '用户自定义目标',
        sense: next.objective?.sense || next.sense || state.genericSense || 'minimize',
        business_goal: next.objective?.business_goal || '用户自定义优化目标'
      }];
      next.model_code = next.model_code || 'custom_optimization_model';
      next.scenario = next.scenario || state.activeModel || '自定义空白优化模型';
      next.mapping = next.mapping || {
        business_to_math: '语义层对象映射为 Pyomo 集合、参数、变量、目标函数和约束',
        solver_layer: 'Pyomo ConcreteModel -> HiGHS SolverAdapter'
      };
      return next;
    }

    function getSemanticSpec() {
      try {
        return normalizeSemanticSpec(JSON.parse(state.semanticSpecText || '{}'));
      } catch (e) {
        throw new Error(`Semantic Spec JSON解析失败：${e.message}`);
      }
    }

    function setSemanticSpec(nextSpec, options = {}) {
      const normalized = normalizeSemanticSpec(nextSpec);
      state.semanticSpecText = JSON.stringify(normalized, null, 2);
      state.modelReady = false;
      if (options.sync !== false) syncGenericSpecFromSemantic({ preserveFormula: options.preserveFormula !== false });
    }

    function getSemanticOptions() {
      const spec = getSemanticSpec();
      const sets = spec.sets || [];
      const parameters = spec.parameters || [];
      const variables = spec.variables || [];
      return {
        spec,
        setKeys: sets.map(s => s.key).filter(Boolean),
        parameterKeys: parameters.map(p => p.math_param || p.key).filter(Boolean),
        variableKeys: variables.map(v => v.math_var || v.key).filter(Boolean),
        sets,
        parameters,
        variables,
        objectives: spec.objectives || []
      };
    }

    function semanticSpecToGenericSpec(semanticSpec, current = {}) {
      const spec = normalizeSemanticSpec(semanticSpec);
      const sets = {};
      (spec.sets || []).forEach(set => {
        const key = set.key || set.code;
        const members = semanticSetMembers(set);
        if (key) sets[key] = members;
      });
      const parameters = {};
      const parameterDims = {};
      (spec.parameters || []).forEach(param => {
        const key = param.math_param || param.key;
        if (key) {
          parameters[key] = defaultParameterValueForDimension(param, spec);
          parameterDims[key] = Array.isArray(param.dimension) ? param.dimension : [];
        }
      });
      const variables = (spec.variables || []).map(variable => {
        const item = {
          name: variable.math_var || variable.key,
          indices: Array.isArray(variable.dimension) ? variable.dimension : [],
          domain: normalizeVariableDomain(variable.domain)
        };
        if (variable.lb_type) item.lb_type = variable.lb_type;
        if (variable.lb_value !== undefined) item.lb_value = variable.lb_value;
        if (variable.ub_type) item.ub_type = variable.ub_type;
        if (variable.ub_value !== undefined) item.ub_value = variable.ub_value;
        if (variable.lb !== undefined && variable.lb !== '') { item.lb = Number(variable.lb); item.lb_type = item.lb_type || 'constant'; item.lb_value = item.lb_value ?? item.lb; }
        if (variable.ub !== undefined && variable.ub !== '') { item.ub = Number(variable.ub); item.ub_type = item.ub_type || 'constant'; item.ub_value = item.ub_value ?? item.ub; }
        if (variable.lb_param) item.lb_param = variable.lb_param;
        if (variable.lb_param) { item.lb_type = 'parameter'; item.lb_value = variable.lb_param; }
        if (variable.lb_param && parameterDims[variable.lb_param]) item.lb_key = parameterDims[variable.lb_param];
        if (variable.ub_param) item.ub_param = variable.ub_param;
        if (variable.ub_param) { item.ub_type = 'parameter'; item.ub_value = variable.ub_param; }
        if (variable.ub_param && parameterDims[variable.ub_param]) item.ub_key = parameterDims[variable.ub_param];
        return normalizeVariableBounds(item);
      }).filter(v => v.name);
      const currentConstraints = Array.isArray(current.constraints) ? current.constraints : [];
      const currentObjective = current.objective || {};
      const constraints = currentConstraints.length ? currentConstraints : (spec.constraints || []).map(c => ({
        name: c.code || c.name,
        foreach: Array.isArray(c.foreach) ? c.foreach : [],
        terms: [],
        sense: '>=',
        rhs: 0,
        description: c.business_rule || c.description || ''
      })).filter(c => c.name);
      const objective = currentObjective.terms ? currentObjective : { terms: [], constant: 0 };
      return { sense: (spec.objectives || [])[0]?.sense || state.genericSense || 'minimize', sets, parameters, variables, constraints, objective };
    }

    function normalizeVariableDomain(domain) {
      const value = String(domain || '').trim();
      const map = {
        '连续变量': 'NonNegativeReals',
        '非负连续变量': 'NonNegativeReals',
        '实数变量': 'Reals',
        '整数变量': 'Integers',
        '非负整数变量': 'NonNegativeIntegers',
        '二进制变量': 'Binary',
        binary: 'Binary'
      };
      return map[value] || value || 'NonNegativeReals';
    }

    function syncGenericSpecFromSemantic(options = {}) {
      const semantic = getSemanticSpec();
      const current = state.genericBuilderMode === 'indexed' ? getIndexedGenericParts() : { constraints: [], objective: {} };
      const generic = semanticSpecToGenericSpec(semantic, options.preserveFormula ? current : {});
      state.genericBuilderMode = 'indexed';
      state.genericSense = generic.sense || state.genericSense;
      setIndexedGenericParts(generic);
      state.semanticValidationResult = validateSemanticAndGenericSpec(semantic, generic);
    }

    function syncSemanticSpecFromGeneric() {
      const generic = getGenericSpec();
      const semantic = getSemanticSpec();
      const existingSet = new Set((semantic.sets || []).map(s => s.key));
      Object.entries(generic.sets || {}).forEach(([key, values]) => {
        if (!existingSet.has(key)) semantic.sets.push({ key, name: `${key}集合`, values, description: '从公式层同步生成' });
      });
      const existingParam = new Set((semantic.parameters || []).map(p => p.math_param || p.key));
      Object.keys(generic.parameters || {}).forEach(key => {
        if (!existingParam.has(key)) semantic.parameters.push({ key, name: key, math_param: key, unit: '-', dimension: [], source_system: '公式层同步', runtime_injected: true, default_value: generic.parameters[key], validation: { required: false }, meaning: '从公式层同步生成' });
      });
      const existingVar = new Set((semantic.variables || []).map(v => v.math_var || v.key));
      (generic.variables || []).forEach(v => {
        if (!existingVar.has(v.name)) semantic.variables.push({ key: v.name, name: v.name, math_var: v.name, unit: '-', dimension: v.indices || [], domain: v.domain || 'NonNegativeReals', lb: v.lb, ub: v.ub, lb_param: v.lb_param, ub_param: v.ub_param, meaning: '从公式层同步生成' });
      });
      setSemanticSpec(semantic, { sync: false });
      state.semanticValidationResult = validateSemanticAndGenericSpec(semantic, generic);
      render();
      toast('已从公式层同步语义定义');
    }

    function defaultValueForDimension(dimension, semanticSpec = null) {
      const dims = Array.isArray(dimension) ? dimension : [];
      if (!dims.length) return 0;
      let spec = semanticSpec;
      if (!spec) {
        try { spec = getSemanticSpec(); } catch (e) { spec = { sets: [] }; }
      }
      const findSet = key => semanticSetMembers((spec.sets || []).find(s => (s.key || s.code) === key) || {});
      if (dims.length === 1) {
        const values = findSet(dims[0]);
        return Object.fromEntries(values.map(value => [value, 0]));
      }
      if (dims.length === 2) {
        const first = findSet(dims[0]);
        const second = findSet(dims[1]);
        return Object.fromEntries(first.map(value => [value, Object.fromEntries(second.map(item => [item, 0]))]));
      }
      return {};
    }

    function isEmptyStructuredDefault(value) {
      if (Array.isArray(value)) return value.length === 0;
      return value && typeof value === 'object' && Object.keys(value).length === 0;
    }

    function isAutoGeneratedDimensionDefault(value, dimension = [], semanticSpec = null) {
      const dims = Array.isArray(dimension) ? dimension : [];
      if (!dims.length || value === undefined || value === null || value === '') return false;
      if (isEmptyStructuredDefault(value)) return true;
      try {
        return JSON.stringify(value) === JSON.stringify(defaultValueForDimension(dims, semanticSpec));
      } catch (e) {
        return false;
      }
    }

    function defaultParameterValueForDimension(param = {}, semanticSpec = null) {
      const dimension = Array.isArray(param.dimension) ? param.dimension : [];
      const value = param.default_value !== undefined ? param.default_value : param.default;
      if (dimension.length && (value === undefined || value === null || value === '' || isEmptyStructuredDefault(value))) {
        return defaultValueForDimension(dimension, semanticSpec);
      }
      return value !== undefined ? value : defaultValueForDimension(dimension, semanticSpec);
    }

    function completeGenericParameterDefaults(genericSpec = {}, semanticSpec = {}) {
      const genericParams = genericSpec.parameters || {};
      genericSpec.parameters = genericParams;
      const sets = genericSpec.sets || {};
      const setMembers = key => (Array.isArray(sets[key]) && sets[key].length)
        ? sets[key]
        : semanticSetMembers((semanticSpec.sets || []).find(item => (item.key || item.code) === key) || {});
      const scalarDefault = param => {
        const validation = param.validation || {};
        if (validation.default !== undefined) return validation.default;
        const raw = param.default_value !== undefined ? param.default_value : param.default;
        return raw !== undefined && raw !== null && raw !== '' && !isEmptyStructuredDefault(raw) ? raw : 0;
      };
      const mergeOneDim = (current, keys, fallbackValue) => {
        const result = {};
        keys.forEach((key, index) => {
          const stringKey = String(key);
          let value;
          if (current && typeof current === 'object' && !Array.isArray(current)) value = current[stringKey] ?? current[key];
          else if (Array.isArray(current)) value = current[index];
          else if (current !== undefined && current !== null && current !== '') value = current;
          result[stringKey] = value !== undefined && value !== null && value !== '' ? value : fallbackValue;
        });
        return result;
      };
      const mergeTwoDim = (current, firstKeys, secondKeys, fallbackValue) => Object.fromEntries(firstKeys.map(first => {
        const firstKey = String(first);
        const nested = current && typeof current === 'object' && !Array.isArray(current) ? (current[firstKey] ?? current[first]) : null;
        return [firstKey, mergeOneDim(nested, secondKeys, fallbackValue)];
      }));
      (semanticSpec.parameters || []).forEach(param => {
        const code = param.math_param || param.code || param.key || param.name;
        const dims = Array.isArray(param.dimension) ? param.dimension : [];
        if (!code || !dims.length) return;
        const fallbackValue = scalarDefault(param);
        const current = genericParams[code] ?? (semanticSpec.sample_runtime_parameters || {})[code] ?? param.sample_value ?? param.sample ?? param.default_value ?? param.default;
        if (dims.length === 1) genericParams[code] = mergeOneDim(current, setMembers(dims[0]), fallbackValue);
        else if (dims.length === 2) genericParams[code] = mergeTwoDim(current, setMembers(dims[0]), setMembers(dims[1]), fallbackValue);
      });
      return genericSpec;
    }

    function buildRuntimeParameterDefaultsFromSemantic(semanticSpec) {
      const sample = semanticSpec.sample_runtime_parameters || {};
      return Object.fromEntries((semanticSpec.parameters || []).map(p => {
        const key = p.math_param || p.code || p.key || p.name;
        return [key, sample[key] ?? p.sample_value ?? p.sample ?? defaultParameterValueForDimension(p, semanticSpec)];
      }).filter(([key]) => key));
    }

    function buildRuntimeParameterSchemaFromSemantic(semanticSpec) {
      return (semanticSpec.parameters || []).filter(p => p.runtime_injected !== false).map(p => ({
        key: p.math_param || p.code || p.key || p.name,
        math_param: p.math_param || p.code || p.key || p.name,
        name: p.name || p.code || p.key,
        unit: p.unit || '-',
        dimension: Array.isArray(p.dimension) ? p.dimension : [],
        source_system: p.source_system || '-',
        required: parameterValidationRule(p).required,
        default_value: (semanticSpec.sample_runtime_parameters || {})[p.math_param || p.code || p.key || p.name] ?? p.sample_value ?? p.sample ?? defaultParameterValueForDimension(p, semanticSpec),
        validation: parameterValidationRule(p),
        meaning: p.meaning || ''
      }));
    }

    function appendConstraintTemplate() {
      try {
        const name = document.getElementById('helperConstraintName')?.value?.trim() || (state.genericBuilderMode === 'indexed' ? 'power_balance_extension' : 'business_rule');
        const selectedForeach = selectedValues('helperConstraintForeach');
        const foreach = selectedForeach.length ? selectedForeach : (document.getElementById('helperConstraintForeach')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const rhsType = document.getElementById('helperConstraintRhsType')?.value || 'const';
        const rhsRaw = document.getElementById('helperConstraintRhs')?.value?.trim() || '0';
        if (state.genericBuilderMode === 'indexed') {
          const variables = JSON.parse(state.genericIndexedVariablesText || '[]');
          const constraints = JSON.parse(state.genericIndexedConstraintsText || '[]');
          const targetVariable = variables[0]?.name || (document.getElementById('helperVarName')?.value?.trim() || 'unit_output');
          const constraint = {
            name,
            terms: [{ var: targetVariable, key: foreach, coef: 1 }],
            sense: '<='
          };
          if (foreach.length) constraint.foreach = foreach;
          if (rhsType === 'param') {
            constraint.rhs_param = rhsRaw;
            if (foreach.length) constraint.rhs_key = foreach;
          } else {
            const rhs = Number(rhsRaw);
            constraint.rhs = Number.isNaN(rhs) ? 0 : rhs;
          }
          constraints.push(constraint);
          state.genericIndexedConstraintsText = JSON.stringify(constraints, null, 2);
        } else {
          const variables = JSON.parse(state.genericVariablesText || '[]');
          const constraints = JSON.parse(state.genericConstraintsText || '[]');
          const targetVariable = variables[0]?.name || 'business_variable';
          const rhs = Number(rhsRaw);
          constraints.push({
            name,
            terms: [{ var: targetVariable, coef: 1 }],
            sense: '<=',
            rhs: Number.isNaN(rhs) ? 0 : rhs
          });
          state.genericConstraintsText = JSON.stringify(constraints, null, 2);
        }
        state.modelReady = false;
        render();
        toast('已追加约束');
      } catch (e) {
        toast(`约束追加失败：${e.message}`);
      }
    }

    function appendCustomConstraintJson() {
      try {
        const raw = document.getElementById('helperCustomConstraint')?.value?.trim();
        if (!raw) return toast('请先输入自定义约束 JSON');
        const constraint = JSON.parse(raw);
        const parts = getIndexedGenericParts();
        parts.constraints = [...(parts.constraints || []), constraint];
        setIndexedGenericParts(parts);
        state.semanticValidationResult = validateSemanticAndGenericSpec(getSemanticSpec(), getGenericSpec());
        toast('已追加自定义约束，请在校验结果中确认引用一致性');
        render();
      } catch (e) {
        toast(`自定义约束 JSON 解析失败：${e.message}`);
      }
    }

    function appendObjectiveTerm() {
      try {
        if (state.genericBuilderMode === 'indexed') {
          const variables = JSON.parse(state.genericIndexedVariablesText || '[]');
          const parameters = JSON.parse(state.genericParametersText || '{}');
          const objective = JSON.parse(state.genericIndexedObjectiveText || '{}');
          const variable = variables[0] || { name: 'unit_output', indices: ['unit', 'time'] };
          const term = { var: variable.name };
          if (variable.indices?.length) {
            term.foreach = variable.indices;
            term.key = variable.indices;
          }
          const numericParam = Object.keys(parameters).find(key => typeof parameters[key] === 'number');
          const dictParam = Object.keys(parameters).find(key => parameters[key] && typeof parameters[key] === 'object' && !Array.isArray(parameters[key]));
          if (dictParam && variable.indices?.length) {
            term.coef_param = dictParam;
            term.param_key = variable.indices;
          } else if (numericParam) {
            term.coef_param = numericParam;
          } else {
            term.coef = 1;
          }
          objective.terms = objective.terms || [];
          objective.terms.push(term);
          if (typeof objective.constant !== 'number') objective.constant = 0;
          state.genericIndexedObjectiveText = JSON.stringify(objective, null, 2);
        } else {
          const variables = JSON.parse(state.genericVariablesText || '[]');
          const objective = JSON.parse(state.genericObjectiveText || '{}');
          const targetVariable = variables[0]?.name || 'business_variable';
          objective.terms = objective.terms || [];
          objective.terms.push({ var: targetVariable, coef: 1 });
          if (typeof objective.constant !== 'number') objective.constant = 0;
          state.genericObjectiveText = JSON.stringify(objective, null, 2);
        }
        state.modelReady = false;
        render();
        toast('已追加目标项');
      } catch (e) {
        toast(`目标项追加失败：${e.message}`);
      }
    }

    function selectBasicConstraint(index) {
      state.selectedBasicConstraint = index;
      render();
    }

    function addBasicVariableFromForm() {
      const parts = getBasicGenericParts();
      const name = document.getElementById('basicVarName')?.value?.trim();
      const domain = document.getElementById('basicVarDomain')?.value || 'NonNegativeReals';
      const lb = Number(document.getElementById('basicVarLb')?.value || 0);
      const ubRaw = document.getElementById('basicVarUb')?.value?.trim();
      if (!name) return toast('变量名不能为空');
      const variable = { name, domain, lb: Number.isNaN(lb) ? 0 : lb };
      if (ubRaw !== '') {
        const ub = Number(ubRaw);
        if (!Number.isNaN(ub)) variable.ub = ub;
      }
      parts.variables.push(variable);
      setBasicGenericParts(parts);
      render();
      toast('变量已新增');
    }

    function removeBasicVariable(index) {
      const parts = getBasicGenericParts();
      const removed = parts.variables.splice(index, 1)[0];
      parts.constraints.forEach(c => c.terms = (c.terms || []).filter(t => t.var !== removed?.name));
      parts.objective.terms = (parts.objective.terms || []).filter(t => t.var !== removed?.name);
      setBasicGenericParts(parts);
      render();
      toast('变量已删除');
    }

    function addBasicConstraintFromForm() {
      const parts = getBasicGenericParts();
      const name = document.getElementById('basicConstraintName')?.value?.trim();
      const sense = document.getElementById('basicConstraintSense')?.value || '<=';
      const rhs = Number(document.getElementById('basicConstraintRhs')?.value || 0);
      if (!name) return toast('约束名不能为空');
      parts.constraints.push({ name, terms: [], sense, rhs: Number.isNaN(rhs) ? 0 : rhs });
      state.selectedBasicConstraint = parts.constraints.length - 1;
      setBasicGenericParts(parts);
      render();
      toast('约束已新增');
    }

    function removeBasicConstraint(index) {
      const parts = getBasicGenericParts();
      parts.constraints.splice(index, 1);
      state.selectedBasicConstraint = Math.max(0, Math.min(state.selectedBasicConstraint, parts.constraints.length - 1));
      setBasicGenericParts(parts);
      render();
      toast('约束已删除');
    }

    function addBasicConstraintTerm(constraintIndex) {
      const parts = getBasicGenericParts();
      const variable = document.getElementById('basicTermVar')?.value;
      const coef = Number(document.getElementById('basicTermCoef')?.value || 0);
      if (!variable) return toast('请先选择变量');
      parts.constraints[constraintIndex].terms = parts.constraints[constraintIndex].terms || [];
      parts.constraints[constraintIndex].terms.push({ var: variable, coef: Number.isNaN(coef) ? 0 : coef });
      setBasicGenericParts(parts);
      render();
      toast('约束项已追加');
    }

    function removeBasicConstraintTerm(constraintIndex, termIndex) {
      const parts = getBasicGenericParts();
      parts.constraints[constraintIndex].terms.splice(termIndex, 1);
      setBasicGenericParts(parts);
      render();
      toast('约束项已删除');
    }

    function addBasicObjectiveTermFromForm() {
      const parts = getBasicGenericParts();
      const variable = document.getElementById('basicObjectiveVar')?.value;
      const coef = Number(document.getElementById('basicObjectiveCoef')?.value || 0);
      if (!variable) return toast('请先选择变量');
      parts.objective.terms = parts.objective.terms || [];
      parts.objective.terms.push({ var: variable, coef: Number.isNaN(coef) ? 0 : coef });
      setBasicGenericParts(parts);
      render();
      toast('目标项已新增');
    }

    function removeBasicObjectiveTerm(index) {
      const parts = getBasicGenericParts();
      parts.objective.terms.splice(index, 1);
      setBasicGenericParts(parts);
      render();
      toast('目标项已删除');
    }

    function updateBasicObjectiveConstant(value) {
      const parts = getBasicGenericParts();
      const constant = Number(value || 0);
      parts.objective.constant = Number.isNaN(constant) ? 0 : constant;
      setBasicGenericParts(parts);
      render();
    }

    function addIndexedSetFromForm() {
      const parts = getIndexedGenericParts();
      const name = document.getElementById('indexedSetName')?.value?.trim();
      const items = (document.getElementById('indexedSetItems')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!name) return toast('集合名不能为空');
      parts.sets[name] = items;
      setIndexedGenericParts(parts);
      const semantic = getSemanticSpec();
      semantic.sets = [...(semantic.sets || []).filter(s => s.key !== name), { key: name, name: `${name}集合`, values: items, description: '从公式编辑器新增' }];
      state.semanticSpecText = JSON.stringify(normalizeSemanticSpec(semantic), null, 2);
      render();
      toast('集合已新增');
    }

    function removeIndexedSet(name) {
      const parts = getIndexedGenericParts();
      delete parts.sets[name];
      setIndexedGenericParts(parts);
      render();
      toast('集合已删除');
    }

    function addIndexedScalarParamFromForm() {
      const parts = getIndexedGenericParts();
      const name = document.getElementById('indexedParamName')?.value?.trim();
      const type = document.getElementById('indexedParamType')?.value || 'scalar';
      const raw = document.getElementById('indexedParamValue')?.value?.trim() || '';
      if (!name) return toast('参数名不能为空');
      let value;
      if (type === 'dict') {
        const firstSet = Object.keys(parts.sets || {})[0];
        const values = firstSet ? Object.fromEntries((parts.sets[firstSet] || []).map(item => [item, Number(raw || 0)])) : {};
        value = values;
        parts.parameters[name] = value;
      } else {
        const num = Number(raw);
        value = Number.isNaN(num) ? raw : num;
        parts.parameters[name] = value;
      }
      setIndexedGenericParts(parts);
      const semantic = getSemanticSpec();
      semantic.parameters = [...(semantic.parameters || []).filter(p => (p.math_param || p.key) !== name), {
        key: name,
        name,
        math_param: name,
        unit: '-',
        dimension: type === 'dict' ? [Object.keys(parts.sets || {})[0]].filter(Boolean) : [],
        source_system: '公式编辑器',
        runtime_injected: true,
        default_value: value,
        validation: { required: false },
        meaning: '从公式编辑器新增'
      }];
      state.semanticSpecText = JSON.stringify(normalizeSemanticSpec(semantic), null, 2);
      render();
      toast('参数已新增');
    }

    function removeIndexedParameter(name) {
      const parts = getIndexedGenericParts();
      delete parts.parameters[name];
      setIndexedGenericParts(parts);
      render();
      toast('参数已删除');
    }

    function addIndexedVariableFromForm() {
      const parts = getIndexedGenericParts();
      const name = document.getElementById('indexedVarName')?.value?.trim();
      const selected = selectedValues('indexedVarIndices');
      const indices = selected.length ? selected : semanticVariableDimension(name);
      const domain = document.getElementById('indexedVarDomain')?.value || 'NonNegativeReals';
      const lbType = document.getElementById('indexedVarLbType')?.value || 'none';
      const lbValue = document.getElementById('indexedVarLbValue')?.value?.trim() ?? '';
      const ubType = document.getElementById('indexedVarUbType')?.value || 'none';
      const ubValue = document.getElementById('indexedVarUbValue')?.value?.trim() ?? '';
      if (!name) return toast('变量名不能为空');
      const semanticDomain = normalizeVariableDomain(semanticVariableByCode(name).domain);
      const variable = normalizeVariableBounds({ name, domain, lb_type: lbType, lb_value: lbValue, ub_type: ubType, ub_value: ubValue });
      if (indices.length) variable.indices = indices;
      const existing = parts.variables.findIndex(v => v.name === name);
      if (existing >= 0) parts.variables[existing] = variable;
      else parts.variables.push(variable);
      setIndexedGenericParts(parts);
      render();
      toast(semanticDomain === 'Binary' && domain !== 'Binary' ? '变量展开已更新；风险提示：语义定义为 Binary，但当前展开类型已被改为连续/整数域。' : '变量展开已更新');
    }

    function semanticSetMembers(set = {}) {
      if (set.type === 'time_period' && Number(set.horizon) > 0) return Array.from({ length: Number(set.horizon) }, (_, i) => i);
      if (Array.isArray(set.members) && set.members.length) return set.members.slice();
      if (Array.isArray(set.values) && set.values.length) return set.values.slice();
      return [];
    }

    function removeIndexedVariable(index) {
      const parts = getIndexedGenericParts();
      const removed = parts.variables.splice(index, 1)[0];
      parts.constraints.forEach(c => c.terms = (c.terms || []).filter(t => t.var !== removed?.name));
      parts.objective.terms = (parts.objective.terms || []).filter(t => t.var !== removed?.name);
      setIndexedGenericParts(parts);
      render();
      toast('索引变量已删除');
    }

    function removeIndexedConstraint(index) {
      const parts = getIndexedGenericParts();
      parts.constraints.splice(index, 1);
      setIndexedGenericParts(parts);
      render();
      toast('索引约束已删除');
    }

    function removeIndexedObjectiveTerm(index) {
      const parts = getIndexedGenericParts();
      parts.objective.terms.splice(index, 1);
      setIndexedGenericParts(parts);
      render();
      toast('索引目标项已删除');
    }

    function toggleObjectiveTerm(index, checked) {
      if (typeof checked === 'boolean') {
        const draft = buildModelDraftFromState();
        if (!draft.objective?.terms?.[index]) return;
        draft.objective.terms[index].enabled = checked;
        state.componentBuilder.objective = draft.objective;
        state.modelDraft = draft;
        refreshComponentSpecFromUi();
        render();
        return;
      }
      const parts = getIndexedGenericParts();
      const term = parts.objective?.terms?.[index];
      if (!term) return;
      term.enabled = term.enabled === false;
      setIndexedGenericParts(parts);
      render();
    }

    function moveObjectiveTerm(index, delta) {
      const parts = getIndexedGenericParts();
      const terms = parts.objective?.terms || [];
      const next = index + delta;
      if (next < 0 || next >= terms.length) return;
      const [item] = terms.splice(index, 1);
      terms.splice(next, 0, item);
      setIndexedGenericParts(parts);
      render();
    }

    function builderDesc(i) {
      if (isComponentBuilderMode()) {
        return ['选择业务场景、模型名称和建模模式。', '查看中文业务对象、输入参数、输出变量和维度含义。', '查看组件生成的约束、平衡关系、目标函数和数学展开。', '配置 runtime_parameters、样例数据、权重和时序数据。', '生成、校验、保存和发布模型包。'][i];
      }
      return ['选择业务场景、模型名称和建模模式。', '定义业务对象、集合、参数、变量、业务规则和目标口径。', '手工配置变量展开、约束公式和目标函数。', '确认运行时参数契约和接口输入输出。', '生成、校验、保存和发布模型包。'][i];
    }

    function constraintList() {
      const list = state.page === 'builder' ? state.genericConstraints : state.constraints;
      return `<div class="grid cols-4">${list.map((r, i) => `<div class="card"><div class="panel-title"><span>${r.name}</span><button class="switch ${r.on ? 'on' : ''}" onclick="${state.page === 'builder' ? `toggleGenericRule(${i})` : `toggleRule(${i})`}"><span></span></button></div><p>${r.tag}组件，${r.on ? '已参与模型装配' : '当前不参与模型装配'}</p></div>`).join('')}</div>`;
    }

    function validateModel() {
      if (isComponentBuilderMode()) {
        validateComponentSpec();
        return;
      }
      if (state.useGenericBuilder) {
        validateGenericSpec();
        return;
      }
      if (state.mappedFields < 6) {
        toast('校验未通过：至少需要完成6类数据对象映射');
        return;
      }
      if (state.genericConstraints.filter(r => r.on).length < 4) {
        toast('校验未通过：核心约束组件不足');
        return;
      }
      toast('模型校验通过');
    }

    function generateModel() {
      if (isComponentBuilderMode()) {
        try {
          const spec = getComponentSpecFromBuilder();
          if (!(spec.components || []).length || !(spec.variables || []).length) {
            toast('组件化模型必须包含组件清单和变量清单');
            return;
          }
          state.semanticValidationResult = { errors: [], warnings: [], infos: [`组件化模型包已生成：${spec.components.length} 个组件`] };
          state.modelReady = true;
          toast('组件化模型包已生成，请保存到模型资产中心');
          render();
        } catch (e) {
          toast(e.message);
        }
        return;
      }
      if (state.useGenericBuilder) {
        try {
          syncGenericSpecFromSemantic({ preserveFormula: true });
          const semantic = getSemanticSpec();
          const generic = getGenericSpec();
          const result = validateSemanticAndGenericSpec(semantic, generic);
          state.semanticValidationResult = result;
          if (result.errors.length) {
            toast(`校验失败：${result.errors[0]}`);
            render();
            return;
          }
        } catch (e) {
          toast(e.message);
          return;
        }
        state.modelReady = true;
        toast('通用模型包已生成，请保存到模型资产中心');
        render();
        return;
      }
      if (state.mappedFields < 6 || state.genericConstraints.filter(r => r.on).length < 4) {
        toast('请先补齐数据映射和核心约束');
        return;
      }
      state.modelReady = true;
      toast('模型包已生成，请保存到模型资产中心');
      render();
    }

    function validateGenericSpec() {
      try {
        syncGenericSpecFromSemantic({ preserveFormula: true });
        const semantic = getSemanticSpec();
        const spec = getGenericSpec();
        const result = validateSemanticAndGenericSpec(semantic, spec);
        state.semanticValidationResult = result;
        const variables = Array.isArray(spec.variables) ? spec.variables.length : 0;
        const constraints = Array.isArray(spec.constraints) ? spec.constraints.length : 0;
        const extra = state.genericBuilderMode === 'indexed' ? `，${Object.keys(spec.sets || {}).length} 个集合` : '';
        toast(result.errors.length ? `校验失败：${result.errors[0]}` : `通用模型校验通过：${variables} 个变量结构，${constraints} 条约束结构${extra}`);
        render();
      } catch (e) {
        toast(e.message);
      }
    }

    function validateSemanticAndGenericSpec(semanticSpec, genericSpec) {
      const result = { errors: [], warnings: [], infos: [] };
      const semantic = normalizeSemanticSpec(semanticSpec);
      const generic = genericSpec || {};
      const setKeys = new Set((semantic.sets || []).map(s => s.key).filter(Boolean));
      const paramKeys = new Set((semantic.parameters || []).map(p => p.math_param || p.key).filter(Boolean));
      const varKeys = new Set((semantic.variables || []).map(v => v.math_var || v.key).filter(Boolean));
      const varDims = Object.fromEntries((semantic.variables || []).map(v => [v.math_var || v.key, v.dimension || []]).filter(([k]) => k));
      const paramDim = key => ((semantic.parameters || []).find(p => (p.math_param || p.key) === key)?.dimension || []);
      const genericSets = generic.sets || {};
      const checkGenericSet = (field, key) => {
        if (!Object.prototype.hasOwnProperty.call(genericSets, key)) result.errors.push(`${field} 引用了 generic_spec.sets 中不存在的集合：${key}`);
        else if (!Array.isArray(genericSets[key]) || !genericSets[key].length) result.errors.push(`generic_spec.sets.${key} 不能为空`);
      };
      const dup = (items, keyFn) => {
        const seen = new Set();
        const duplicates = new Set();
        (items || []).forEach(item => {
          const key = keyFn(item);
          if (!key) return;
          if (seen.has(key)) duplicates.add(key);
          seen.add(key);
        });
        return [...duplicates];
      };
      dup(semantic.sets, s => s.key).forEach(key => result.errors.push(`集合重复定义：${key}`));
      dup(semantic.parameters, p => p.math_param || p.key).forEach(key => result.errors.push(`参数重复定义：${key}`));
      dup(semantic.variables, v => v.math_var || v.key).forEach(key => result.errors.push(`变量重复定义：${key}`));
      if (!(semantic.sets || []).length) result.errors.push('空白模型至少需要定义 1 个索引集合');
      if (!(semantic.variables || []).length) result.errors.push('空白模型至少需要定义 1 个决策变量');
      if (!generic.objective || !Array.isArray(generic.objective.terms) || !generic.objective.terms.length) result.errors.push('目标函数必须至少包含 1 个目标项');
      (generic.variables || []).forEach(variable => {
        (variable.indices || []).forEach(index => {
          if (!setKeys.has(index)) result.errors.push(`变量 ${variable.name} 引用了未定义集合：${index}`);
          checkGenericSet(`变量 ${variable.name}`, index);
        });
        ['ub_param', 'lb_param'].forEach(key => {
          if (variable[key] && !paramKeys.has(variable[key])) result.errors.push(`变量 ${variable.name} 的 ${key} 引用了未定义参数：${variable[key]}`);
          if (variable[key]) {
            const invalid = paramDim(variable[key]).filter(dim => !(variable.indices || []).includes(dim));
            if (invalid.length) result.errors.push(`变量 ${variable.name} 的 ${key} 参数维度不兼容：${variable[key]}[${paramDim(variable[key]).join(',')}]`);
          }
        });
        if (variable.lb !== undefined && variable.ub !== undefined && Number(variable.lb) > Number(variable.ub)) {
          result.errors.push(`变量 ${variable.name} 下界大于上界`);
        }
        if (variable.name && !varKeys.has(variable.name)) result.errors.push(`公式层变量未在语义层定义：${variable.name}`);
      });
      (generic.constraints || []).forEach(constraint => {
        const constraintFormula = getConstraintDisplayFormula(constraint);
        const isDisplayOnly = ['display_only', 'remark_only', 'none'].includes(String(constraint.solve_participation || constraint.participation || 'solve_active'));
        const rawConstraintFormula = firstNonBlank(constraint.formula, constraint.expression, constraint.display_formula, constraint.math_expression, constraint.math_constraint);
        if (constraintFormula === FORMULA_NOT_GENERATED && !(isDisplayOnly && isTrivialZeroConstraintFormula(rawConstraintFormula))) result.errors.push(`约束 ${constraint.name || constraint.code || '-'} 公式未生成，请检查左端变量、右端参数和索引配置`);
        if (!isDisplayOnly && isTrivialZeroConstraintFormula(constraintFormula)) result.errors.push(`约束 ${constraint.name || constraint.code || '-'} 是空约束 ${constraintFormula}，禁止发布`);
        const relation = String(constraint.sense || '<=');
        if (!['<=', '>=', '=='].includes(relation) && !['unsupported', 'pending_linearization'].includes(constraint.compile_status)) {
          result.errors.push(`复杂关系 ${constraint.name}.${relation} 必须标记 compile_status = unsupported 或 pending_linearization`);
        }
        (constraint.foreach || []).forEach(index => {
          if (!setKeys.has(index)) result.errors.push(`约束 ${constraint.name} 作用索引未定义：${index}`);
        });
        (constraint.terms || []).forEach(term => {
          if (term.var && !varKeys.has(term.var)) result.errors.push(`约束 ${constraint.name} 引用了未定义变量：${term.var}`);
          if (term.var && varDims[term.var] && JSON.stringify(term.key || []) !== JSON.stringify(varDims[term.var])) {
            result.errors.push(`约束 ${constraint.name} 中 ${term.var} 的 key 必须为 [${varDims[term.var].join(',')}]，当前为 [${(term.key || []).join(',')}]`);
          }
          [...(term.key || []), ...(term.foreach || [])].forEach(index => checkGenericSet(`约束 ${constraint.name}`, index));
          (term.key || []).forEach(index => {
            if (!setKeys.has(index)) result.errors.push(`约束 ${constraint.name} 变量索引未定义：${index}`);
          });
          if (term.coef_param && !paramKeys.has(term.coef_param)) result.errors.push(`约束 ${constraint.name} 系数参数未定义：${term.coef_param}`);
          if (term.coef_param) {
            const invalid = paramDim(term.coef_param).filter(dim => ![...(term.key || []), ...(term.foreach || []), ...(constraint.foreach || [])].includes(dim));
            if (invalid.length) result.errors.push(`约束 ${constraint.name} 系数参数维度不兼容：${term.coef_param}[${paramDim(term.coef_param).join(',')}]`);
          }
        });
        if (constraint.rhs_param && !paramKeys.has(constraint.rhs_param)) result.errors.push(`约束 ${constraint.name} 右端参数未定义：${constraint.rhs_param}`);
        (constraint.foreach || []).forEach(index => checkGenericSet(`约束 ${constraint.name}`, index));
        (constraint.rhs_key || []).forEach(index => checkGenericSet(`约束 ${constraint.name} rhs_key`, index));
        if (constraint.rhs_param) {
          const invalid = paramDim(constraint.rhs_param).filter(dim => !(constraint.foreach || []).includes(dim));
          if (invalid.length) result.errors.push(`约束 ${constraint.name} 右端参数维度不兼容：${constraint.rhs_param}[${paramDim(constraint.rhs_param).join(',')}]`);
        }
      });
      (generic.objective?.terms || []).forEach(term => {
        if (getObjectiveDisplayFormula(term) === FORMULA_NOT_GENERATED) result.errors.push(`目标项 ${term.name || term.term_id || term.var || '-'} 公式未生成，请检查变量、系数参数和索引配置`);
        if (term.var && !varKeys.has(term.var)) result.errors.push(`目标函数引用了未定义变量：${term.var}`);
        if (term.var && varDims[term.var] && JSON.stringify(term.key || []) !== JSON.stringify(varDims[term.var])) {
          result.errors.push(`目标函数中 ${term.var} 的 key 必须为 [${varDims[term.var].join(',')}]，当前为 [${(term.key || []).join(',')}]`);
        }
        if (term.coef_param && !paramKeys.has(term.coef_param)) result.errors.push(`目标函数系数参数未定义：${term.coef_param}`);
        [...(term.key || []), ...(term.foreach || []), ...(term.param_key || [])].forEach(index => checkGenericSet('目标函数项', index));
        if (term.coef_param) {
          const invalid = paramDim(term.coef_param).filter(dim => !(term.key || term.foreach || []).includes(dim));
          if (invalid.length) result.errors.push(`目标函数系数参数维度不兼容：${term.coef_param}[${paramDim(term.coef_param).join(',')}]`);
        }
        (term.foreach || []).forEach(index => {
          if (!setKeys.has(index)) result.errors.push(`目标函数求和索引未定义：${index}`);
        });
      });
      varKeys.forEach(key => {
        const used = (generic.variables || []).some(v => v.name === key)
          || (generic.constraints || []).some(c => (c.terms || []).some(t => t.var === key))
          || (generic.objective?.terms || []).some(t => t.var === key);
        if (!used) result.warnings.push(`语义层变量尚未在公式层使用：${key}`);
      });
      paramKeys.forEach(key => {
        const used = (generic.variables || []).some(v => v.ub_param === key || v.lb_param === key)
          || (generic.constraints || []).some(c => c.rhs_param === key || (c.terms || []).some(t => t.coef_param === key))
          || (generic.objective?.terms || []).some(t => t.coef_param === key);
        if (!used) result.warnings.push(`语义层参数尚未在公式层使用：${key}`);
      });
      if (!result.errors.length) result.infos.push('semantic_spec 与 generic_spec 引用一致性校验通过');
      return result;
    }

    function validationReportHtml(result = { errors: [], warnings: [], infos: [] }) {
      const normalize = item => {
        if (typeof item === 'string') return { message: item };
        return item || {};
      };
      const block = (title, items, cls, emptyText) => {
        const rows = (items || []).map(normalize);
        return `<div class="validation-block ${cls}">
          <div class="formula-subtitle"><span>${title}</span><span class="pill ${cls === 'red' ? 'red' : cls === 'amber' ? 'amber' : 'green'}">${rows.length}</span></div>
          ${rows.length ? `<div class="validation-list">${rows.map(item => `<div class="validation-item">
            <div><strong>${escapeHtml(item.section || item.field || item.rule || '模型校验')}</strong></div>
            <div>${escapeHtml(item.message || item.error || item.actual || JSON.stringify(item))}</div>
            ${item.suggestion ? `<div class="muted">建议：${escapeHtml(item.suggestion)}</div>` : ''}
            ${item.expected !== undefined ? `<div class="muted">期望：${escapeHtml(JSON.stringify(item.expected))}</div>` : ''}
          </div>`).join('')}</div>` : `<p class="muted">${emptyText}</p>`}
        </div>`;
      };
      return `<div class="validation-report">
        ${block('Errors', result.errors || [], 'red', '暂无阻断错误')}
        ${block('Warnings', result.warnings || [], 'amber', '暂无风险提示')}
        ${block('Infos', result.infos || [], 'green', '暂无信息')}
      </div>`;
    }

    function dryRunResultHtml(result = null) {
      if (!result || !result.structure_check) return '<p class="muted mt">暂无发布 dry-run 结果。</p>';
      const structure = result.structure_check || {};
      const solver = result.solver_check || {};
      const statusPill = status => `<span class="pill ${status === 'passed' ? 'green' : status === 'failed' ? 'red' : 'amber'}">${escapeHtml(status || '-')}</span>`;
      return `<table class="compact-table mt"><thead><tr><th>检查项</th><th>状态</th><th>说明</th></tr></thead><tbody>
        <tr><td>结构 dry-run</td><td>${statusPill(structure.status)}</td><td>${escapeHtml((structure.errors || []).map(e => e.error || e.message || e.actual).join('；') || 'ConcreteModel 构建检查通过')}</td></tr>
        <tr><td>求解 dry-run</td><td>${statusPill(solver.status)}</td><td>${escapeHtml((solver.warnings || []).map(e => e.error || e.message || e.actual).join('；') || '未提供测试用例时默认跳过')}</td></tr>
      </tbody></table>`;
    }

    function formatBackendFailure(error) {
      const detail = error?.payload?.detail ?? error?.payload ?? {};
      const parts = [];
      const push = value => {
        if (value !== undefined && value !== null && String(value).trim()) parts.push(String(value));
      };
      if (typeof detail === 'string') push(detail);
      else {
        push(detail.message);
        (detail.errors || []).forEach(item => push(`${item.field || item.section || '模型'}：${item.error || item.message || item.actual || safeJson(item)}`));
        const dry = detail.dry_run_result || detail.dryRunResult;
        (dry?.structure_check?.errors || []).forEach(item => push(`结构 dry-run：${item.field || item.section || '结构'} ${item.error || item.message || item.actual || safeJson(item)}`));
        (dry?.solver_check?.warnings || []).forEach(item => push(`求解器检查：${item.error || item.message || item.actual || safeJson(item)}`));
        if (dry?.structure_check?.status === 'failed' && !(dry.structure_check.errors || []).length) push('结构 dry-run 构建失败');
        if (dry?.solver_check?.status === 'failed') push('求解器 dry-run 失败或求解器不可用');
        (detail.solver_check?.warnings || []).forEach(item => push(`求解器检查：${item.error || item.message || item.actual || safeJson(item)}`));
      }
      push(state.apiError || error?.message);
      const unique = [...new Set(parts.filter(Boolean))];
      return unique.join('；') || '未知错误，请查看后端返回 detail';
    }

    async function saveModelToAssets(mode = 'overwrite') {
      if (!state.backendOnline) {
        toast('后端未连接，保存/发布等生产操作已禁用。基础表单仍可编辑。');
        return;
      }
      const saveMode = mode || 'overwrite';
      if (saveMode === 'copy') {
        const nextName = prompt('请输入另存为的新模型名称', `${state.activeModel} 副本`);
        if (!nextName || !nextName.trim()) return;
        state.activeModel = nextName.trim();
      }
      let modelPackage;
      try {
        modelPackage = buildModelPackage({ validate: state.modelReady });
        if (!state.modelReady) modelPackage.status = 'developing';
      } catch (e) {
        toast(e.message);
        return;
      }
      const activeModelId = saveMode === 'overwrite' ? (modelPackage.id || state.runtimeTemplateId || '') : '';
      const existingById = activeModelId ? state.savedModels.find(m => m.id === activeModelId) : null;
      const editableStatuses = new Set(['developing', '开发中', 'draft', '草稿', 'publish_failed', '发布失败', 'offline', '下线']);
      const isEditableSavedModel = item => item?.id && editableStatuses.has(String(item.status || 'developing'));
      const existingByName = state.savedModels.find(m => m.name === modelPackage.name && m.scene === modelPackage.scene && isEditableSavedModel(m));
      const existing = isEditableSavedModel(existingById) ? existingById : existingByName;
      const savingEditableCopy = saveMode === 'overwrite' && existingById?.id && !isEditableSavedModel(existingById) && !existingByName;
      try {
        const useUpdate = saveMode === 'overwrite' && existing?.id;
        if (useUpdate) {
          modelPackage.id = existing.id;
        } else {
          delete modelPackage.id;
        }
        const model = await apiFetch(useUpdate ? `/models/${existing.id}` : '/models', {
          method: useUpdate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modelPackage)
        });
        const normalized = normalizeModel(model);
        normalized.modelPackage = { ...modelPackage, ...normalized };
        state.runtimeTemplateId = normalized.id || state.runtimeTemplateId;
        state.savedModels = [normalized, ...state.savedModels.filter(m => m.id !== normalized.id)];
        state.backendOnline = true;
      } catch (e) {
        state.backendOnline = false;
        toast(`保存失败：${state.apiError || e.message || e}`);
        render();
        return;
      }
      state.recentSavedModel = state.activeModel;
      state.page = 'assets';
      toast(saveMode === 'copy' ? '模型已另存到“模型版本管理”' : savingEditableCopy ? '已基于已发布模型保存为可编辑草稿，原已发布版本不变' : '模型已覆盖保存到“模型版本管理”');
      render();
    }

    async function publishModel(i) {
      let model = state.savedModels[i];
      if (!confirmFeasibilityModelPublish(model?.modelPackage || model)) {
        render();
        return;
      }
      if (!model.id) {
        try {
          const payload = model.modelPackage || buildModelPackage({ validate: true });
          assertProblemTypePublishable(payload);
          delete payload.id;
          const created = await apiFetch('/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          model = normalizeModel(created);
          model.modelPackage = { ...payload, ...model };
          state.savedModels[i] = model;
          state.backendOnline = true;
        } catch (e) {
          markBackendFromError(e);
          toast(`发布前保存失败：${e.message || state.apiError || e}`);
          render();
          return;
        }
      }
      try {
        if (model.modelPackage) assertProblemTypePublishable(model.modelPackage);
        const updated = await apiFetch(`/models/${model.id}/publish`, { method: 'POST' });
        const normalized = normalizeModel(updated);
        normalized.modelPackage = { ...(model.modelPackage || {}), ...normalized };
        state.savedModels[i] = normalized;
        state.backendOnline = true;
        state.savedModels[i].caller = state.savedModels[i].caller === '待授权' ? '任务调度中心/API' : state.savedModels[i].caller;
        const warningCount = Array.isArray(updated.validation_warnings) ? updated.validation_warnings.length : 0;
        toast(`${state.savedModels[i].name} 已发布${warningCount ? `，${warningCount} 条警告` : ''}`);
      } catch (e) {
        markBackendFromError(e);
        toast(`发布失败：${formatBackendFailure(e)}`);
      }
      render();
    }

    function confirmFeasibilityModelPublish(model = {}) {
      const spec = model.component_spec || model.semantic_spec?.component_spec || {};
      const terms = (spec.objective?.terms || []).filter(term => term.enabled !== false);
      if (!terms.length) return true;
      const hasActive = terms.some(term => !['display_only', 'remark_only', 'none'].includes(term.solve_participation || 'solve'));
      if (hasActive) return true;
      const confirmed = confirm('当前所有目标项均为 display_only。请确认这是可行性模型；普通优化模型必须至少有一个 solve_active 目标项。');
      if (confirmed) {
        spec.objective = spec.objective || {};
        spec.objective.feasibility_model_confirmed = true;
        model.component_spec = spec;
        model.ui_metadata = { ...(model.ui_metadata || {}), feasibility_model_confirmed: true };
      }
      return confirmed;
    }

    async function testModelVersion(i) {
      const model = state.savedModels[i];
      if (!model?.id) {
        toast('请先保存到后端后再运行测试');
        return;
      }
      const defaults = model.parameters && Object.keys(model.parameters).length ? model.parameters : buildRuntimeParameterDefaultsFromSemantic(model.semantic_spec || {});
      const text = prompt('请输入测试用例参数 JSON', JSON.stringify(defaults, null, 2));
      if (!text) return;
      try {
        const parameters = JSON.parse(text);
        const updated = await apiFetch(`/models/${model.id}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parameters })
        });
        const normalized = normalizeModel(updated);
        normalized.modelPackage = { ...(model.modelPackage || {}), ...normalized };
        state.savedModels[i] = normalized;
        toast('测试用例通过，模型已标记为已测试');
      } catch (e) {
        const detail = e.payload?.detail;
        toast(`测试失败：${detail?.message || e.message || e}`);
      }
      render();
    }

    async function viewModelSchema(i) {
      const model = state.savedModels[i];
      if (!model?.id) return openInfoModal('模型 Schema', modelSchemaModalHtml({ semantic_schema: model?.semantic_spec || {}, model }));
      try {
        const schema = await apiFetch(`/models/${model.id}/schema`);
        openInfoModal('模型 Schema', modelSchemaModalHtml(schema));
      } catch (e) {
        toast(`Schema 加载失败：${state.apiError || e.message}`);
      }
    }

    async function copyModelVersion(i) {
      const model = state.savedModels[i];
      if (!model?.id) return toast('请先保存到后端后再复制版本');
      try {
        const copied = await apiFetch(`/models/${model.id}/copy`, { method: 'POST' });
        state.savedModels.unshift(normalizeModel(copied));
        toast('已复制为新版本');
        render();
      } catch (e) {
        toast(`复制失败：${state.apiError || e.message}`);
      }
    }

    async function offlineModel(i) {
      const model = state.savedModels[i];
      if (!model?.id) return toast('请先保存到后端后再下线');
      if (!isCallableModel(model)) return toast('模型当前不是已发布/试运行状态，无需下线');
      try {
        const updated = await apiFetch(`/models/${model.id}/offline`, { method: 'POST' });
        state.savedModels[i] = normalizeModel(updated);
        toast('模型已下线');
        render();
      } catch (e) {
        toast(`下线失败：${formatBackendFailure(e)}`);
      }
    }

    async function deleteModelVersion(i) {
      const model = state.savedModels[i];
      if (!model?.id) return toast('请先保存到后端后再删除');
      const confirmed = confirm(`确认删除模型“${model.name}”？该操作会从后端模型资产中移除，无法在列表中恢复。`);
      if (!confirmed) return;
      try {
        await apiFetch(`/models/${model.id}`, { method: 'DELETE' });
        state.savedModels = state.savedModels.filter((_, idx) => idx !== i);
        if (state.runtimeTemplateId === model.id) state.runtimeTemplateId = '';
        toast('模型已删除');
        render();
      } catch (e) {
        toast(`删除失败：${formatBackendFailure(e)}`);
      }
    }

    async function toggleModelPublishState(i) {
      return isCallableModel(state.savedModels[i]) ? offlineModel(i) : publishModel(i);
    }

    function viewModelTestResult(i) {
      const model = state.savedModels[i] || {};
      openInfoModal('模型测试结果', dryRunResultHtml(model.dry_run_result) + `<pre>${escapeHtml(safeJson(model.dry_run_result || model.validation_warnings || {}))}</pre>`);
    }

    async function viewModelAssetDetail(i) {
      const model = state.savedModels[i];
      if (!model?.id) return openInfoModal('模型资产详情', modelAssetDetailHtml({ basic_info: model, semantic_spec: model.semantic_spec || {}, component_spec: model.component_spec || {}, parameters: model.parameters || {} }), { wide: true });
      try {
        const detail = await apiFetch(`/models/${model.id}/asset-detail`);
        openInfoModal('模型资产详情', modelAssetDetailHtml(detail), { wide: true });
      } catch (e) {
        toast(`模型详情加载失败：${formatBackendFailure(e)}`);
      }
    }

    function modelAssetDetailHtml(detail = {}) {
      const basic = detail.basic_info || {};
      const draft = detail.model_draft || {};
      const semantic = draft.semantic || detail.semantic_spec || {};
      const components = (detail.component_spec || {}).components || draft.components || [];
      const constraints = detail.constraints || detail.draft_constraints || draft.generated_constraints || [];
      const objective = detail.objective || draft.objective || {};
      const expansion = detail.mathematical_expansion || draft.mathematical_expansion || {};
      const publish = detail.publish_info || {};
      const skill = detail.skill_info || {};
      const version = detail.version_info || {};
      const formulaContext = currentFormulaRenderContext({ sets: semantic.sets || [], parameters: semantic.parameters || [], variables: semantic.variables || [] });
      const constraintFormulaRows = constraints.map(item => `<tr><td>${escapeHtml(item.name || item.constraint_id || item.code || '-')}</td><td>${formulaDisplayBlock(item.formula || item.expression || '-', formulaContext)}</td><td>${escapeHtml(item.source_component || item.source || '-')}</td></tr>`).join('');
      const objectiveFormulaRows = (objective.terms || []).map(item => `<tr><td>${escapeHtml(item.name || item.term_id || '-')}</td><td>${formulaDisplayBlock(item.expression || item.formula || '-', formulaContext)}</td><td>${item.supported_by_backend === false ? '否' : '是'}</td></tr>`).join('');
      return `<div>
        <div class="grid cols-3">
          ${panel('基本信息', `<table class="compact-table"><tr><th>ID</th><td>${escapeHtml(basic.id || '-')}</td></tr><tr><th>名称</th><td>${escapeHtml(basic.name || '-')}</td></tr><tr><th>场景</th><td>${escapeHtml(basic.scene || '-')}</td></tr><tr><th>版本</th><td>${escapeHtml(basic.version || '-')}</td></tr><tr><th>状态</th><td>${pill(modelStatusText(basic.status))}</td></tr><tr><th>建模模式</th><td>${escapeHtml(basic.build_mode || '-')}</td></tr></table>`)}
          ${panel('发布状态', `${dryRunResultHtml(publish.dry_run_result || detail.test_result)}<table class="compact-table mt"><tr><th>published_at</th><td>${escapeHtml(publish.published_at || '-')}</td></tr><tr><th>tested_at</th><td>${escapeHtml(publish.tested_at || '-')}</td></tr><tr><th>dry-run</th><td>${escapeHtml(publish.dry_run_status || '-')}</td></tr></table>`)}
          ${panel('模型服务接口', `<table class="compact-table"><tr><th>接口编码</th><td>${escapeHtml(skill.skill_name || '-')}</td></tr><tr><th>模型版本</th><td>${escapeHtml(skill.model_version || '-')}</td></tr><tr><th>Endpoint</th><td><code>/api/skills/${escapeHtml(skill.skill_name || '-')}/run</code></td></tr></table>`)}
        </div>
        <div class="grid cols-2 mt">
          ${panel('模型语义', `<div class="grid cols-2"><div>${compactSchemaTable(semantic.parameters || [], [{ label: '参数', value: item => item.name || item.key || item.code || '-' }, { label: '维度', value: item => (item.dimension || []).join(', ') || '-' }])}</div><div>${compactSchemaTable(semantic.variables || [], [{ label: '变量', value: item => item.name || item.key || item.code || '-' }, { label: '维度', value: item => (item.dimension || []).join(', ') || '-' }])}</div></div>`)}
          ${panel('组件清单', compactSchemaTable(components, [{ label: '组件', value: item => item.type || item.component_id || '-' }, { label: '版本', value: item => item.version || '1.0.0' }, { label: '启用', value: item => item.enabled === false ? '否' : '是' }]))}
        </div>
        <div class="grid cols-2 mt">
          ${panel('约束清单', constraintFormulaRows ? `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr><th>约束</th><th>表达式</th><th>来源</th></tr></thead><tbody>${constraintFormulaRows}</tbody></table></div>` : emptyState('暂无约束清单'))}
          ${panel('目标函数', objectiveFormulaRows ? `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr><th>目标项</th><th>表达式</th><th>参与求解</th></tr></thead><tbody>${objectiveFormulaRows}</tbody></table></div>` : emptyState('暂无目标函数'))}
        </div>
        <div class="grid cols-2 mt">
          ${panel('数学展开', mathematicalExpansionHtml({ mathematical_expansion: expansion, objective }))}
          ${panel('版本记录', `<table class="compact-table"><tr><th>版本</th><td>${escapeHtml(version.version || '-')}</td></tr><tr><th>组件版本</th><td>${escapeHtml((version.component_versions || []).map(item => `${item.component_id}:${item.version}`).join(', ') || '-')}</td></tr><tr><th>参数 Schema</th><td>${escapeHtml(version.parameter_schema_version || '-')}</td></tr><tr><th>目标函数版本</th><td>${escapeHtml(version.objective_version || '-')}</td></tr></table>`)}
        </div>
        <div class="grid cols-2 mt">
          ${panel('最近调用记录', compactSchemaTable(detail.recent_invocations || [], [{ label: '时间', value: item => item.created_at || '-' }, { label: '来源', value: item => item.caller || item.source || 'api' }, { label: '状态', value: item => item.status || '-' }, { label: '目标值', value: item => item.objective_value ?? getPath(item, 'result.metrics.objective_value', '-') }]))}
          ${panel('最近任务日志', compactSchemaTable(detail.recent_tasks || [], [{ label: '任务', value: item => item.task_id || '-' }, { label: '状态', value: item => item.status || '-' }, { label: '耗时', value: item => item.duration_seconds ?? '-' }, { label: '错误', value: item => item.error || '-' }]))}
        </div>
        <details class="mt"><summary>原始资产 JSON</summary><pre>${escapeHtml(safeJson(detail))}</pre></details>
      </div>`;
    }

    function compactSchemaTable(items, columns) {
      if (!Array.isArray(items) || !items.length) {
        return `<div class="empty-state" style="min-height:60px"><strong>暂无</strong></div>`;
      }
      return `<div class="table-scroll"><table class="sticky-table compact-table"><thead><tr>${columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr></thead><tbody>${items.map(item => `<tr>${columns.map(col => { const v = escapeHtml(typeof col.value === 'function' ? col.value(item) : item[col.value] ?? '-'); return `<td class="cell-truncate" title="${v}">${v}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    }

    function modelSchemaModalHtml(schema) {
      const semantic = schema.semantic_schema || schema.semantic_spec || {};
      const parameters = semantic.parameters || schema.parameter_schema || [];
      const variables = semantic.variables || [];
      const constraints = semantic.constraints || [];
      const sets = semantic.sets || [];
      return `<div class="grid cols-2">
        ${panel('模型基本信息', `<table class="compact-table"><tr><th>模型ID</th><td>${escapeHtml(schema.model_id || schema.model?.id || '-')}</td></tr><tr><th>template_id</th><td>${escapeHtml(schema.template_id || schema.model?.template_id || '-')}</td></tr><tr><th>建模模式</th><td>${escapeHtml(modelBuildModeText(schema))}</td></tr><tr><th>问题类型</th><td>${escapeHtml(schema.model_problem_type || schema.problem_type || '-')}</td></tr><tr><th>求解器能力</th><td>${escapeHtml((schema.required_solver_capabilities || []).join(', ') || '-')}</td></tr><tr><th>参数数量</th><td>${parameters.length || 0}</td></tr></table>`)}
        ${panel('输入 / 输出契约', `<details open><summary>input_contract</summary><pre>${escapeHtml(safeJson(schema.input_contract || {}))}</pre></details><details class="mt"><summary>output_contract</summary><pre>${escapeHtml(safeJson(schema.output_contract || {}))}</pre></details>`)}
      </div>
      <div class="mt">${panel('组件化自定义 Builder', componentCatalogHtml(schema))}</div>
      <div class="mt">${panel('参数 Schema', compactSchemaTable(parameters, [
        { label: 'key/code', value: item => item.key || item.code || item.math_param || '-' },
        { label: '名称', value: item => item.name || '-' },
        { label: '维度', value: item => (item.dimension || []).join(', ') || '-' },
        { label: '单位', value: item => item.unit || '-' },
        { label: '样例/默认', value: item => safeJson(item.sample_value ?? item.default_value ?? item.default ?? '-') }
      ]))}</div>
      <div class="grid cols-2 mt">
        ${panel('集合', compactSchemaTable(sets, [{ label: '集合', value: item => item.key || item.code || '-' }, { label: '取值', value: item => (item.values || []).join(', ') || '-' }]))}
        ${panel('变量', compactSchemaTable(variables, [{ label: '变量', value: item => item.key || item.code || item.math_var || '-' }, { label: '名称', value: item => item.name || '-' }, { label: '维度', value: item => (item.dimension || []).join(', ') || '-' }]))}
      </div>
      <div class="mt">${panel('约束', compactSchemaTable(constraints, [{ label: '约束', value: item => item.key || item.code || '-' }, { label: '名称', value: item => item.name || '-' }, { label: '说明', value: item => item.description || item.expression || '-' }]))}</div>
      <details class="mt"><summary>原始 JSON</summary><pre>${escapeHtml(safeJson(schema))}</pre></details>`;
    }

    async function generateOrViewSkill(i) {
      const model = state.savedModels[i];
      if (!model?.id) return toast('请先保存到后端后再生成模型服务接口');
      try {
        const skill = await apiFetch(`/models/${model.id}/skills/generate`, { method: 'POST' });
        await refreshSkills(false);
        openInfoModal('模型服务接口信息', skillInfoModalHtml(skill));
      } catch (e) {
        toast(`模型服务接口生成失败：${state.apiError || e.message}`);
      }
    }

    function callModelFromAsset(i) {
      const model = state.savedModels[i];
      if (!model?.id) return toast('请先保存到后端后再调用模型');
      if (!isCallableModel(model)) return toast('模型未发布或未试运行，暂不可调用');
      state.runtimeTemplateId = model.id;
      applyRuntimeConfigFromModel(model);
      state.page = 'tasks';
      toast(`已载入运行参数：${model.name}`);
      render();
    }

    function applyModelPackageToBuilder(modelPackage) {
      state.activeDomain = normalizeSceneNameForMatch(modelPackage.scene || state.activeDomain);
      state.activeModel = modelPackage.name || state.activeModel;
      state.solverBackend = modelPackage.solver || state.solverBackend;
      state.objective = modelPackage.objective || state.objective;
      const buildMode = modelPackage.build_mode || modelPackage.semantic_spec?.build_mode || modelPackage.component_spec?.build_mode || 'generic_linear';
      state.builderMode = buildMode === 'component_based_with_custom' ? 'component_based' : buildMode;
      state.useGenericBuilder = !isComponentBuilderMode();
      state.componentSpecText = JSON.stringify(modelPackage.component_spec || modelPackage.semantic_spec?.component_spec || {}, null, 2);
      state.mappingBindings = (modelPackage.mapping_bindings && modelPackage.mapping_bindings.length ? modelPackage.mapping_bindings : defaultMappingBindings()).map(row => ({ ...row }));
      state.mappedFields = state.mappingBindings.filter(row => row.status === '已绑定字段').length || state.mappingBindings.length;
      if (Array.isArray(modelPackage.rule_configs) && modelPackage.rule_configs.length) {
        state.ruleConfigs = modelPackage.rule_configs.map(rule => ({
          scope: rule.scope || '全业务域',
          granularity: rule.granularity || '时段',
          level: rule.level || '硬约束',
          trigger: rule.trigger || '',
          penalty: rule.penalty || '0',
          note: rule.note || ''
        }));
      }
      if (modelPackage.constraints && Object.keys(modelPackage.constraints).length) {
        state.genericConstraints = state.genericConstraints.map(rule => ({
          ...rule,
          on: Object.prototype.hasOwnProperty.call(modelPackage.constraints, rule.name) ? !!modelPackage.constraints[rule.name] : rule.on
        }));
      }
      const params = modelPackage.parameters || {};
      if (modelPackage.semantic_spec && Object.keys(modelPackage.semantic_spec).length) {
        state.semanticSpecText = JSON.stringify(modelPackage.semantic_spec, null, 2);
      } else {
        state.semanticSpecText = defaultSemanticSpecText();
      }
      state.builderPriority = params.builder_priority || state.builderPriority;
      state.builderPenalty = params.builder_penalty || state.builderPenalty;
      state.builderExplainTemplate = params.builder_explain_template || state.builderExplainTemplate;
      state.builderSecondaryObjective = params.builder_secondary_objective || state.builderSecondaryObjective;
      const componentSpec = modelPackage.component_spec || modelPackage.semantic_spec?.component_spec || {};
      if (state.builderMode === 'component_based') {
        const runtimeParams = modelPackage.parameters || modelPackage.semantic_spec?.sample_runtime_parameters || {};
        state.builderMode = 'component_based';
        state.useGenericBuilder = false;
        state.componentSpecText = JSON.stringify(componentSpec || {}, null, 2);
        state.componentBuilder = componentBuilderStateFromSpec(componentSpec || {}, runtimeParams);
        state.componentBuilder.additionalConstraints = componentSpec.additional_custom_constraints || modelPackage.ui_metadata?.additional_custom_constraints || [];
        state.componentBuilder.additionalConstraintsEnabled = !!state.componentBuilder.additionalConstraints.length || modelPackage.ui_metadata?.builder_mode_label === '组件化 Builder + 附加自定义约束';
        state.runtimeParametersText = JSON.stringify(runtimeParams || {}, null, 2);
        state.runtimeObjectiveText = JSON.stringify(componentSpec.objective || { type: 'weighted_sum', sense: 'minimize' }, null, 2);
        state.runtimeConstraintText = JSON.stringify({}, null, 2);
        state.runtimeTemplateId = modelPackage.id || state.runtimeTemplateId;
        state.selectedBasicConstraint = 0;
        state.selectedGenericRule = 0;
        state.modelReady = true;
        return;
      }
      const genericSpec = modelPackage.generic_spec || {};
      if (genericSpec && Object.keys(genericSpec).length) {
        state.useGenericBuilder = true;
        state.genericSense = genericSpec.sense || 'minimize';
        const hasIndexedVariables = Array.isArray(genericSpec.variables) && genericSpec.variables.some(v => Array.isArray(v.indices) && v.indices.length);
        if (genericSpec.sets || hasIndexedVariables) {
          state.genericBuilderMode = 'indexed';
          state.genericSetsText = JSON.stringify(genericSpec.sets || {}, null, 2);
          state.genericParametersText = JSON.stringify(genericSpec.parameters || {}, null, 2);
          state.genericIndexedVariablesText = JSON.stringify(genericSpec.variables || [], null, 2);
          state.genericIndexedConstraintsText = JSON.stringify(genericSpec.constraints || [], null, 2);
          state.genericIndexedObjectiveText = JSON.stringify(genericSpec.objective || { terms: [], constant: 0 }, null, 2);
        } else {
          state.genericBuilderMode = 'basic';
          state.genericParametersText = JSON.stringify(genericSpec.parameters || {}, null, 2);
          state.genericVariablesText = JSON.stringify(genericSpec.variables || [], null, 2);
          state.genericConstraintsText = JSON.stringify(genericSpec.constraints || [], null, 2);
          state.genericObjectiveText = JSON.stringify(genericSpec.objective || { terms: [], constant: 0 }, null, 2);
        }
        state.runtimeTemplateId = modelPackage.id || state.runtimeTemplateId;
        state.runtimeParametersText = JSON.stringify(genericSpec.parameters || {}, null, 2);
        state.runtimeObjectiveText = JSON.stringify({ sense: genericSpec.sense || 'minimize' }, null, 2);
        state.runtimeConstraintText = JSON.stringify({}, null, 2);
      } else {
        state.useGenericBuilder = false;
      }
      state.selectedBasicConstraint = 0;
      state.selectedGenericRule = 0;
      state.builderStep = 0;
      state.modelReady = true;
    }

    async function loadModelVersion(i) {
      let model = state.savedModels[i];
      try {
        if (model.id) {
          const remote = await apiFetch(`/models/${model.id}`);
          const normalized = normalizeModel(remote);
          model = { ...model, ...normalized, modelPackage: normalized };
          state.savedModels[i] = model;
          state.backendOnline = true;
        }
      } catch (e) {
        state.backendOnline = false;
      }
      const modelPackage = model.modelPackage || model;
      applyModelPackageToBuilder(modelPackage);
      state.page = 'builder';
      toast(`已加载模型：${model.name}`);
      render();
    }

    function callModel(i) {
      const m = state.savedModels[i];
      if (!isCallableModel(m)) {
        toast('模型未发布，不能提交求解任务');
        return;
      }
      state.activeDomain = m.scene;
      state.activeModel = m.name;
      state.runtimeTemplateId = m.id || '';
      state.page = 'tasks';
      toast('已选择模型，请填写运行时参数后提交');
      render();
    }

    function setMode(mode) {
      state.solverMode = mode;
      if (mode === '快速模式') { state.solverGap = 0.5; state.timeLimit = 120; }
      if (mode === '均衡模式') { state.solverGap = 0.1; state.timeLimit = 300; }
      if (mode === '精确模式') { state.solverGap = 0.01; state.timeLimit = 900; }
      toast(`已切换为${mode}`);
      render();
    }

    function setSolverBackend(name) {
      state.solverBackend = 'HiGHS';
      if (name !== 'HiGHS') {
        toast('当前阶段仅启用 HiGHS');
      } else {
        toast('当前求解后端为 HiGHS');
      }
      render();
    }

    function updateSolver(key, value) {
      const n = parseFloat(value);
      if (key === 'gap' && !Number.isNaN(n)) state.solverGap = n;
      if (key === 'time' && !Number.isNaN(n)) state.timeLimit = n;
      if (key === 'concurrency' && !Number.isNaN(n)) state.concurrency = n;
      toast('求解参数已更新');
      render();
    }

    async function submitTask(model, modelId = null) {
      if (!state.backendOnline) {
        toast('后端未连接，生产操作已禁用。');
        return;
      }
      const selectedModel = model || state.activeModel;
      state.activeModel = selectedModel;
      let payload = {};
      if (state.useGenericBuilder && !modelId) {
        try {
          payload = { generic_spec: getGenericSpec() };
        } catch (e) {
          toast(e.message);
          return;
        }
      }
      try {
        const task = await apiFetch('/optimize/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scene: state.activeDomain,
            model: selectedModel,
            model_id: modelId,
            solver: state.solverBackend,
            mode: state.solverMode,
            mip_gap: state.solverGap / 100,
            time_limit_seconds: state.timeLimit,
            max_retries: 1,
            payload
          })
        });
        state.backendOnline = true;
        state.tasks.unshift(normalizeTask(task));
        state.page = 'tasks';
        toast(`任务已提交到后端：${task.id}`);
        render();
        setTimeout(refreshTasks, 900);
      } catch (e) {
        state.backendOnline = false;
        toast(`任务提交失败：${state.apiError || e.message || e}`);
        render();
      }
    }

    function applyRuntimeConfigFromModel(model) {
      const spec = model.generic_spec || model.modelPackage?.generic_spec || {};
      const semantic = model.semantic_spec || model.modelPackage?.semantic_spec || {};
      if ((model.build_mode || semantic.build_mode) === 'component_based') {
        const sample = normalizeHydroRuntimeParameters(
          model.parameters || model.modelPackage?.parameters || semantic.sample_runtime_parameters || {},
          model
        );
        const componentSpec = model.component_spec || semantic.component_spec || {};
        state.runtimeParametersText = JSON.stringify(sample || {}, null, 2);
        state.componentSpecText = JSON.stringify(componentSpec || {}, null, 2);
        state.componentBuilder = componentBuilderStateFromSpec(componentSpec || {}, sample || {});
        state.runtimeObjectiveText = JSON.stringify(componentSpec.objective || { type: 'weighted_sum', sense: 'minimize' }, null, 2);
        state.runtimeConstraintText = JSON.stringify({}, null, 2);
        state.runtimeTemplateId = model.id || state.runtimeTemplateId;
        return;
      }
      const semanticParams = {};
      (semantic.parameters || []).forEach(p => {
        const key = p.math_param || p.code || p.key || p.name;
        const mathParam = p.math_param || p.code || p.mapped_to || key;
        const defaults = spec.parameters || model.parameters || {};
        semanticParams[key] = defaults[mathParam] ?? defaults[key] ?? p.sample_value ?? p.sample ?? p.default_value ?? p.default ?? runtimeDefaultForParam(key);
      });
      const params = Object.keys(semanticParams).length ? semanticParams : (Object.keys(spec.parameters || {}).length ? spec.parameters : (model.parameters || {}));
      state.runtimeParametersText = JSON.stringify(params || {}, null, 2);
      state.runtimeObjectiveText = JSON.stringify({ sense: spec.sense || 'minimize' }, null, 2);
      state.runtimeConstraintText = JSON.stringify({}, null, 2);
      state.runtimeTemplateId = model.id || state.runtimeTemplateId;
    }

    function resizeRuntimeSeries(values, horizon) {
      if (!Array.isArray(values)) return values;
      if (!Number.isInteger(horizon) || horizon <= 0 || values.length === horizon) return values.slice();
      if (!values.length) return Array.from({ length: horizon }, () => 0);
      const result = values.slice();
      while (result.length < horizon) result.push(...values);
      return result.slice(0, horizon);
    }

    function normalizeHydroRuntimeParameters(parameters, model = {}) {
      const params = JSON.parse(JSON.stringify(parameters || {}));
      if (!isCascadeHydroModel(model) && !params.availability && !params.local_inflow) return params;
      const inferredHorizon = Number(params.horizon)
        || (Array.isArray(params.load_forecast) ? params.load_forecast.length : 0)
        || (Array.isArray(params.time) ? params.time.length : 0)
        || 24;
      const horizon = Math.max(1, Math.trunc(inferredHorizon));
      params.horizon = horizon;
      params.time = Array.from({ length: horizon }, (_, i) => i);
      params.time_volume = Array.from({ length: horizon + 1 }, (_, i) => i);
      if (Array.isArray(params.load_forecast)) params.load_forecast = resizeRuntimeSeries(params.load_forecast, horizon);
      ['availability', 'local_inflow'].forEach(key => {
        if (!params[key] || typeof params[key] !== 'object' || Array.isArray(params[key])) return;
        Object.keys(params[key]).forEach(name => {
          params[key][name] = resizeRuntimeSeries(params[key][name], horizon);
        });
      });
      return params;
    }

    function runtimeDefaultForParam(key) {
      const defaults = {
        load_forecast: [210,205,198,196,200,215,240,268,290,305,318,325,330,322,315,310,326,350,372,360,330,300,265,235],
        renewable_forecast: [35,36,38,40,45,52,68,82,96,110,118,120,116,108,96,82,70,58,48,42,40,38,36,35],
        initial_unit_status: { U1: 1, U2: 0, U3: 0 },
        initial_unit_output: { U1: 90, U2: 0, U3: 0 },
        electricity_price: [320,310,300,295,300,330,360,420,480,520,540,550,545,530,510,500,530,590,650,620,560,500,430,360],
        initial_soc: { BESS1: 80 }
      };
      return defaults[key] ?? '';
    }
