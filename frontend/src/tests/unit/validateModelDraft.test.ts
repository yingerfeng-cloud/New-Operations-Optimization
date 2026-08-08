import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

function baseDraft(): ModelDraft {
  const draft = createInitialDraft();
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0] }];
  draft.semantic.variables = [{ code: 'p', name: '出力', dimension: ['time'], domain: 'NonNegativeReals' }];
  draft.semantic.parameters = [{ code: 'load', name: '负荷', dimension: ['time'], sourceType: 'runtime', source_type: 'runtime', required: true }];
  draft.formulas = [{
    formula_id: 'obj',
    name: '目标',
    kind: 'objective',
    display_formula: 'p[t]',
    dsl_formula: 'p[t]',
    tokens: [],
    foreach: [],
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: [],
    compile_status: 'ready',
  }];
  return draft;
}

test('blocks generic linear publish before generic_spec compile', () => {
  const result = validateModelDraft(baseDraft());
  expect(result.valid).toBe(false);
  expect(result.sections.formula.errors).toContain('generic_spec 尚未编译');
});

test('blocks missing required runtime parameters', () => {
  const draft = baseDraft();
  draft.advanced.generic_spec = { variables: [{ name: 'p', indices: ['time'] }], objective: { terms: [{ var: 'p', key: ['time'] }] } };
  const result = validateModelDraft(draft);
  expect(result.sections.runtime_parameters.errors).toContain('运行参数 负荷 load 缺少必填值');
});

test('requires semantic and formula names for explainability', () => {
  const draft = baseDraft();
  draft.semantic.parameters[0].name = '';
  draft.formulas[0].name = '';

  const result = validateModelDraft(draft);

  expect(result.sections.semantic_structure.errors).toContain('参数 load名称必填（用于模型解释）');
  expect(result.sections.formula.errors).toContain('公式 obj名称必填（用于模型解释）');
});

test('requires unique names for user-authored formulas', () => {
  const draft = baseDraft();
  draft.formulas.push({ ...draft.formulas[0], formula_id: 'obj-copy' });

  expect(validateModelDraft(draft).sections.formula.errors).toContain('公式名称必须唯一：目标');
});

test('allows generated preview formulas to share a display name when their ids differ', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{ component_id: 'hydro_volume_bounds' }];
  draft.formulas = [
    { ...draft.formulas[0], formula_id: 'hydro_volume_min', name: '库容上下限组件', kind: 'constraint', solve_participation: 'preview_only' },
    { ...draft.formulas[0], formula_id: 'hydro_volume_max', name: '库容上下限组件', kind: 'constraint', solve_participation: 'preview_only' },
  ];

  expect(validateModelDraft(draft).sections.formula.errors).not.toContain('公式名称必须唯一：库容上下限组件');
});

test('blocks missing component dependencies', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.variables = [];
  draft.formulas = [];
  draft.components = [{ component_id: 'storage_soc', dependencies: ['storage_power_limit'] }];
  const result = validateModelDraft(draft);
  expect(result.sections.component_dependencies.errors).toContain('storage_soc 缺少依赖 storage_power_limit');
});

test('blocks self and cyclic component dependencies without duplicate messages', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [
    { component_id: 'self_component', depends_on: ['self_component'] },
    { component_id: 'cycle_a', depends_on: ['cycle_b'], dependencies: ['cycle_b'] },
    { component_id: 'cycle_b', depends_on: ['cycle_a'] },
  ];

  const errors = validateModelDraft(draft).sections.component_dependencies.errors;
  expect(errors).toContain('self_component 不能依赖自身');
  expect(errors).toContain('组件依赖存在循环：cycle_a → cycle_b → cycle_a');
  expect(errors.filter(error => error.includes('cycle_a 缺少依赖'))).toHaveLength(0);
});

test('disabled components do not introduce dependency blockers', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{
    component_id: 'disabled_component',
    enabled: false,
    depends_on: ['not_selected'],
    parameters: [{ code: 'disabled_parameter', required: true }],
  }];

  expect(validateModelDraft(draft).sections.component_dependencies.errors).toEqual([]);
  expect(validateModelDraft(draft).sections.parameter_bindings.errors).toEqual([]);
});

test('requires model-stage bindings for required component parameter interfaces', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{
    component_id: 'efficiency_component',
    parameters: [{ code: 'efficiency', name: '效率', required: true }],
  }];

  expect(validateModelDraft(draft).sections.parameter_bindings.errors).toContain(
    '组件 efficiency_component 参数绑定 efficiency 缺失',
  );

  draft.components[0].parameter_bindings = [{
    component_parameter: 'efficiency',
    model_parameter: 'load',
    required: true,
    status: 'bound',
  }];
  expect(validateModelDraft(draft).sections.parameter_bindings.errors).toEqual([]);
});
