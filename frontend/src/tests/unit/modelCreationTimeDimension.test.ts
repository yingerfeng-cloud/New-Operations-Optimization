import { createInitialDraft } from '../../features/model-creation/stores/modelCreationStore';
import { applyTimeDimensionToDraft, inferTimeDimensionConfig, migrateModelDraft, normalizeTimeDimensionForMode } from '../../features/model-creation/utils/timeDimensionDraft';
import { normalizeModelDraft } from '../../features/model-creation/utils/normalizeModelDraft';
import { buildModelDraftPayload } from '../../features/model-creation/utils/saveModelDraftAsset';
import { modelAssetToDraft } from '../../features/model-creation/utils/modelAssetToDraft';

const choiceConfig = {
  schema_version: 1 as const,
  enabled: true,
  policy: 'runtime_variable' as const,
  default_horizon: 96,
  allowed_horizons: [24, 48, 96],
  time_set: 'time',
  state_time_set: 'time_volume',
  editable: true,
  interval_minutes_by_horizon: { '24': 60, '48': 30, '96': 15 },
  delta_t_by_horizon: { '24': 1, '48': 0.5, '96': 0.25 },
  label_set: 'time_labels',
  label_generation: 'auto' as const,
  label_format: 'HH:mm' as const,
};

test('blank draft defaults to not_applicable without system time values', () => {
  const draft = createInitialDraft();
  expect(draft.time_dimension).toEqual({ schema_version: 1, enabled: false, policy: 'not_applicable', editable: false });
  expect(draft.semantic.sets).toEqual([]);
  expect(draft.runtime_parameters).not.toHaveProperty('horizon');
});

test('normalization manages time sets only when enabled', () => {
  const fixed = normalizeModelDraft({ ...createInitialDraft(), time_dimension: { ...choiceConfig, policy: 'fixed', editable: false, default_horizon: 4, allowed_horizons: [] } });
  expect(fixed.semantic.sets.find(item => item.code === 'time')).toEqual(expect.objectContaining({ managed_by: 'time_dimension', type: 'time_period', defaultSize: 4 }));
  expect(fixed.semantic.sets.find(item => item.code === 'time_volume')?.values).toHaveLength(5);
  expect(fixed.runtime_parameters.horizon).toBe(4);

  const disabled = applyTimeDimensionToDraft(fixed, { schema_version: 1, enabled: false, policy: 'not_applicable', editable: false });
  expect(disabled.semantic.sets).toEqual([]);
  expect(disabled.runtime_parameters.horizon).toBeUndefined();
});

test('does not overwrite a non-managed set with the configured time_set name', () => {
  const draft = createInitialDraft();
  draft.semantic.sets = [{ code: 'time', name: '人工时段', values: ['A', 'B'], type: 'business' }];
  const normalized = applyTimeDimensionToDraft(draft, { ...choiceConfig, policy: 'fixed', editable: false, default_horizon: 2, allowed_horizons: [], state_time_set: null });
  expect(normalized.semantic.sets[0]).toEqual(expect.objectContaining({ name: '人工时段', values: ['A', 'B'], type: 'business' }));
  expect(normalized.semantic.sets[0].managed_by).toBeUndefined();
});

test('legacy draft migration is conservative and never infers runtime_variable', () => {
  const fallback = createInitialDraft();
  const migrated = migrateModelDraft({ semantic: { sets: [{ code: 'time', values: [0, 1, 2] }], parameters: [], variables: [] }, runtime_parameters: { horizon: 3 } }, fallback);
  expect(migrated.time_dimension.policy).toBe('fixed');
  expect(migrated.time_dimension.default_horizon).toBe(3);
  expect(inferTimeDimensionConfig(createInitialDraft()).policy).toBe('not_applicable');
});

test('data_derived preview uses the inner time length of nested mappings', () => {
  const draft = createInitialDraft();
  draft.semantic.parameters = [{ code: 'load_forecast', dimension: ['site', 'time'], sourceType: 'runtime' }];
  draft.runtime_parameters.load_forecast = { S1: [1, 2, 3, 4], S2: [2, 3, 4, 5] };
  const normalized = applyTimeDimensionToDraft(draft, { schema_version: 1, enabled: true, policy: 'data_derived', time_set: 'time', state_time_set: null, derive_from: 'load_forecast', editable: false });
  expect(normalized.runtime_parameters.horizon).toBe(4);
  expect(normalized.semantic.sets.find(item => item.code === 'time')?.values).toHaveLength(4);
});

test('data_derived recognizes the dimensions alias', () => {
  const draft = createInitialDraft();
  draft.semantic.parameters = [{ code: 'load_forecast', dimensions: ['time'], sourceType: 'runtime' }];
  draft.runtime_parameters.load_forecast = [1, 2, 3, 4, 5];
  const normalized = applyTimeDimensionToDraft(draft, { schema_version: 1, enabled: true, policy: 'data_derived', time_set: 'time', state_time_set: null, derive_from: 'load_forecast', interval_minutes: 15, delta_t: 0.25, editable: false });
  expect(normalized.runtime_parameters.horizon).toBe(5);
  expect(normalized.runtime_parameters.interval_minutes).toBe(15);
  expect(normalized.runtime_parameters.delta_t).toBe(0.25);
});

test('save payload and model asset round trip preserve one authoritative contract', () => {
  const draft = applyTimeDimensionToDraft(createInitialDraft(), choiceConfig);
  const payload = buildModelDraftPayload(draft);
  expect(payload.ui_metadata.time_dimension).toEqual(expect.objectContaining(choiceConfig));
  expect((payload.model_draft as unknown as { time_dimension: unknown }).time_dimension).toEqual(payload.ui_metadata.time_dimension);
  expect((payload.component_spec.ui_metadata as Record<string, unknown>).time_dimension).toEqual(payload.ui_metadata.time_dimension);

  const restored = modelAssetToDraft({
    ...payload,
    id: 'MODEL-TIME-ROUNDTRIP', name: '时间模型', scene: '测试', version: 'v1', status: 'developing', solver: 'HiGHS', problem_type: 'LP', build_mode: 'component_based', updated_at: '2026-07-10',
  });
  expect(restored.time_dimension.allowed_horizons).toEqual([24, 48, 96]);
  expect(restored.time_dimension.delta_t_by_horizon).toEqual(choiceConfig.delta_t_by_horizon);
  expect(restored.time_dimension.label_generation).toBe('auto');
});

test('explicit null state set survives normalization and round trip', () => {
  const draft = applyTimeDimensionToDraft(createInitialDraft(), { ...choiceConfig, policy: 'fixed', editable: false, default_horizon: 24, state_time_set: null });
  expect(draft.semantic.sets.some(item => item.code === 'time_volume')).toBe(false);
  expect(draft.runtime_parameters).not.toHaveProperty('time_volume');
  const payload = buildModelDraftPayload(draft);
  expect(payload.ui_metadata.time_dimension.state_time_set).toBeNull();
});

test('mode normalization removes stale choice mappings', () => {
  const free = normalizeTimeDimensionForMode(choiceConfig, 'free');
  expect(free.allowed_horizons).toBeUndefined();
  expect(free.interval_minutes_by_horizon).toBeUndefined();
  expect(free.delta_t_by_horizon).toBeUndefined();

  const fixed = normalizeTimeDimensionForMode(choiceConfig, 'fixed');
  expect(fixed.interval_minutes).toBe(15);
  expect(fixed.delta_t).toBe(0.25);
  expect(fixed.interval_minutes_by_horizon).toBeUndefined();
  expect(fixed.delta_t_by_horizon).toBeUndefined();

  const derived = normalizeTimeDimensionForMode(choiceConfig, 'data_derived');
  expect(derived.interval_minutes).toBe(15);
  expect(derived.delta_t).toBe(0.25);
  expect(derived.allowed_horizons).toBeUndefined();
  expect(derived.interval_minutes_by_horizon).toBeUndefined();
  expect(derived.delta_t_by_horizon).toBeUndefined();
});
