import { vi } from 'vitest';
import { initialDraft, useModelCreationStore } from '../../features/model-creation/stores/modelCreationStore';
import { BLANK_MODEL_ID } from '../../features/model-creation/data/scenarioCatalog';
import { applyTemplateToDraft } from '../../features/model-creation/utils/applyTemplateToDraft';
import { inferModelProblemType } from '../../features/model-creation/utils/inferModelProblemType';
import { normalizeModelDraft } from '../../features/model-creation/utils/normalizeModelDraft';
import { buildModelDraftPayload, saveModelDraftAsset } from '../../features/model-creation/utils/saveModelDraftAsset';

beforeEach(() => useModelCreationStore.getState().reset());

test('persists draft changes in store', () => {
  useModelCreationStore.getState().updateDraft({ runtime_parameters: { horizon: 3 } });
  expect(useModelCreationStore.getState().draft.runtime_parameters.horizon).toBe(3);
});

test('normalizes time dimensions', () => {
  const d = normalizeModelDraft({ ...initialDraft, runtime_parameters: { horizon: 2 } });
  expect(d.semantic.sets.find(x => x.code === 'time')?.values).toHaveLength(2);
  expect(d.semantic.sets.find(x => x.code === 'time_volume')?.values).toHaveLength(3);
});

test('defaults to day-ahead unit commitment catalog model', () => {
  const state = useModelCreationStore.getState();
  expect(state.selectedScenarioId).toBe('day_ahead_unit_commitment');
  expect(state.draft.basic_info.name).toBe('日前机组组合优化模型');
  expect(state.draft.basic_info.scenario).toBe('日前机组组合优化');
  expect(state.draft.basic_info.builder_mode).toBe('generic_linear');
});

test('switching catalog model clears derived model state', () => {
  useModelCreationStore.getState().setDraft({
    ...useModelCreationStore.getState().draft,
    formulas: [{
      formula_id: 'f1',
      name: '旧公式',
      kind: 'constraint',
      display_formula: 'old',
      dsl_formula: 'old',
      tokens: [],
      foreach: [],
      referenced_sets: [],
      referenced_parameters: [],
      referenced_variables: [],
      free_indices: [],
      compile_status: 'ready',
    }],
    components: [{ code: 'old_component' }],
    advanced: { generic_spec: { old: true }, component_spec: { old: true } },
  });

  useModelCreationStore.getState().selectCatalogModel('cascade_hydro_day_ahead');
  const state = useModelCreationStore.getState();

  expect(state.selectedModelId).toBe('cascade_hydro_dispatch_lp');
  expect(state.draft.basic_info.name).toBe('梯级水电日前调度模型');
  expect(state.draft.basic_info.builder_mode).toBe('component_based');
  expect(state.draft.formulas).toHaveLength(0);
  expect(state.draft.components).toHaveLength(0);
  expect(state.draft.advanced.generic_spec).toBeUndefined();
  expect(state.validationResult).toBeNull();
});

test('blank model selection keeps current scenario and clears model metadata', () => {
  useModelCreationStore.getState().selectCatalogModel('chp_coordination', BLANK_MODEL_ID);
  const state = useModelCreationStore.getState();

  expect(state.selectedScenarioId).toBe('chp_coordination');
  expect(state.selectedModelId).toBe(BLANK_MODEL_ID);
  expect(state.draft.basic_info.scenario).toBe('热电协同优化');
  expect(state.draft.basic_info.name).toBe('');
  expect(state.draft.basic_info.model_code).toBe('');
  expect(state.draft.basic_info.template_code).toBeUndefined();
});

test('loading template after selecting cascade hydro keeps selected scenario', () => {
  useModelCreationStore.getState().selectCatalogModel('cascade_hydro_day_ahead');
  const state = useModelCreationStore.getState();
  const next = applyTemplateToDraft(state.draft, {
    code: 'unit_commitment_day_ahead',
    name: '模板返回的机组组合',
    scenario: '这是后端模板里的长业务描述，不应覆盖当前场景',
    build_mode: 'generic_linear',
    model_draft: {
      semantic: {
        sets: [{ code: 'unit', name: '机组' }],
        parameters: [],
        variables: [{ code: 'p', name: '出力', variableType: 'continuous' }],
      },
    },
  }, state.draft.basic_info.scenario);

  expect(next.basic_info.scenario).toBe('梯级水电日前调度');
  expect(next.basic_info.name).toBe('模板返回的机组组合');
  expect(next.basic_info.scenario).not.toContain('长业务描述');
});

test('infers MILP when integer variables exist and respects LP otherwise', () => {
  const lpDraft = normalizeModelDraft({
    ...initialDraft,
    semantic: { ...initialDraft.semantic, variables: [{ code: 'p', variableType: 'continuous' }] },
  });
  expect(inferModelProblemType(lpDraft)).toBe('LP');
  expect(inferModelProblemType({
    ...lpDraft,
    semantic: { ...lpDraft.semantic, variables: [{ code: 'on', variableType: 'binary' }] },
  })).toBe('MILP');
  expect(inferModelProblemType({ ...lpDraft, components: [{ component_id: 'commitment', metadata: { problemType: 'MILP' } }] })).toBe('MILP');
});

test('saving an existing draft asset updates instead of creating a duplicate', async () => {
  const draft = useModelCreationStore.getState().draft;
  const asset = {
    id: 'MODEL-1',
    name: draft.basic_info.name,
    scene: draft.basic_info.scenario,
    version: 'v1',
    status: 'draft',
    solver: draft.basic_info.solver,
    problem_type: 'LP',
    build_mode: draft.basic_info.builder_mode,
    updated_at: '2026-06-23',
  };
  const createModel = vi.fn(async () => asset);
  const updateModel = vi.fn(async (id: string) => ({ ...asset, id }));

  const created = await saveModelDraftAsset(draft, undefined, { createModel, updateModel });
  const updated = await saveModelDraftAsset(draft, created.id, { createModel, updateModel });

  expect(created.id).toBe('MODEL-1');
  expect(updated.id).toBe('MODEL-1');
  expect(createModel).toHaveBeenCalledTimes(1);
  expect(updateModel).toHaveBeenCalledTimes(1);
  expect(updateModel).toHaveBeenCalledWith('MODEL-1', expect.objectContaining({ model_problem_type: 'LP' }));
});

test('buildModelDraftPayload keeps Step3 function mapping components from template drafts', () => {
  const draft = normalizeModelDraft({
    ...initialDraft,
    basic_info: {
      ...initialDraft.basic_info,
      name: '梯级水电日前调度模型',
      model_code: 'cascade_hydro_dispatch',
      builder_mode: 'component_based',
    },
    semantic: {
      ...initialDraft.semantic,
      variables: [
        { code: 'volume', name: '库容', variableType: 'continuous', indices: ['time'] },
        { code: 'level', name: '水位', variableType: 'continuous', indices: ['time'] },
      ],
    },
    components: [
      { component_id: 'hydro_reservoir_balance', type: 'hydro_reservoir_balance', enabled: true },
      {
        component_id: 'function_mapping_component',
        type: 'function_mapping_component',
        enabled: true,
        function_asset_id: 'storage_level_curve',
        x: 'volume[t]',
        y: 'level[t]',
        indices: [{ set: 'time', alias: 't' }],
        solve_strategy: 'convex_combination_lp',
        constraint_id: 'storage_level_mapping',
      },
    ],
    advanced: {
      component_spec: {
        build_mode: 'component_based',
        components: [{ type: 'hydro_reservoir_balance' }],
        objective: { sense: 'minimize', terms: [] },
      },
    },
  });

  const payload = buildModelDraftPayload(draft);
  const components = payload.component_spec.components as Array<Record<string, unknown>>;

  expect(components).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'function_mapping_component',
      function_asset_id: 'storage_level_curve',
      x: 'volume[t]',
      y: 'level[t]',
      solve_strategy: 'convex_combination_lp',
    }),
  ]));
});
