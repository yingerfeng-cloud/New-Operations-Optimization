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

test('blocks missing component dependencies', () => {
  const draft = baseDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.variables = [];
  draft.formulas = [];
  draft.components = [{ component_id: 'storage_soc', dependencies: ['storage_power_limit'] }];
  const result = validateModelDraft(draft);
  expect(result.sections.component_dependencies.errors).toContain('storage_soc 缺少依赖 storage_power_limit');
});
