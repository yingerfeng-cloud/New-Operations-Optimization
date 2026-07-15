import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

type ModelAsset = {
  id: string;
  name: string;
  scene: string;
  status: string;
  model_code?: string;
  template_id?: string;
  model_family_id?: string;
  is_active_version?: boolean;
  published_at?: string;
};

const callable = new Set(['published', 'trial', 'tested']);

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function schema(api: APIRequestContext, model: ModelAsset) {
  return json<Record<string, any>>(await api.get(`/api/models/${model.id}/schema`));
}

async function solve(api: APIRequestContext, model: ModelAsset, parameters: Record<string, any>) {
  const response = await api.post('/api/tasks', {
    data: {
      model: model.name,
      scene: model.scene,
      solver: 'HiGHS',
      model_id: model.id,
      runtime_parameters: parameters,
      parameters,
      async_run: false,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

async function createPolicyModel(api: APIRequestContext, base: ModelAsset, policy: Record<string, any>, suffix: string) {
  const source = await json<Record<string, any>>(await api.get(`/api/models/${base.id}`));
  for (const key of ['id', 'created_at', 'updated_at', 'published_at', 'tested_at', 'dry_run_result', 'validation_warnings']) delete source[key];
  source.name = `Real E2E ${suffix}`;
  source.version = 'v0.1-e2e';
  source.status = 'developing';
  source.ui_metadata = { ...(source.ui_metadata || {}), time_dimension: policy };
  source.semantic_spec = structuredClone(source.semantic_spec || {});
  source.semantic_spec.name = source.name;
  source.semantic_spec.status = 'developing';
  source.semantic_spec.ui_metadata = { ...(source.semantic_spec.ui_metadata || {}), time_dimension: policy };
  if (policy.policy === 'data_derived' && policy.derive_from) {
    const deriveField = (source.semantic_spec.parameters || []).find((item: Record<string, any>) => item.code === policy.derive_from);
    if (deriveField) {
      deriveField.runtime_injected = true;
      deriveField.source_system = 'runtime';
    }
  }
  const sample = structuredClone(source.semantic_spec.sample_runtime_parameters || source.parameters || {});
  const originalHorizon = sample.horizon || 4;
  const horizon = policy.default_horizon || sample.horizon || 4;
  sample.horizon = horizon;
  for (const [key, value] of Object.entries(sample)) {
    if (Array.isArray(value) && value.length === originalHorizon) sample[key] = Array.from({ length: horizon }, (_, index) => value[index % value.length]);
  }
  source.parameters = sample;
  source.semantic_spec.sample_runtime_parameters = sample;
  const timeSet = (source.semantic_spec.sets || []).find((item: Record<string, any>) => item.code === (policy.time_set || 'time'));
  if (timeSet) {
    timeSet.values = Array.from({ length: horizon }, (_, index) => index);
    timeSet.members = timeSet.values;
    timeSet.horizon = horizon;
    timeSet.time_granularity = policy.interval_minutes;
  }
  const created = await json<ModelAsset>(await api.post(`/api/models/${base.id}/versions`, { data: source }));
  return json<ModelAsset>(await api.post(`/api/models/${created.id}/publish`));
}

test('controlled environment is healthy and contains callable seed models', async ({ request }) => {
  const health = await json<Record<string, any>>(await request.get('/api/health'));
  expect(health.ok).toBe(true);
  expect(health.highspy_installed).toBe(true);
  const models = await json<ModelAsset[]>(await request.get('/api/models'));
  expect(models.some(model => callable.has(String(model.status).toLowerCase()))).toBe(true);
});

test('published generic model solves with the real backend and emits result metadata', async ({ request }) => {
  test.setTimeout(180_000);
  const models = await json<ModelAsset[]>(await request.get('/api/models'));
  let selected: ModelAsset | undefined;
  let selectedSchema: Record<string, any> | undefined;
  for (const model of models.filter(item => String(item.status).toLowerCase() === 'published' && item.is_active_version === true)) {
    const candidate = await schema(request, model);
    if (candidate.model_problem_type !== 'NLP' && candidate.semantic_spec?.sample_runtime_parameters) {
      selected = model;
      selectedSchema = candidate;
      break;
    }
  }
  expect(selected, 'No published real-solver seed model').toBeTruthy();
  const parameters = structuredClone(selectedSchema!.semantic_spec.sample_runtime_parameters);
  const task = await solve(request, selected!, parameters);
  expect(task.status).toBe('SUCCESS');
  const result = await json<Record<string, any>>(await request.get(`/api/tasks/${task.id}/result`));
  expect(result.result_capabilities).toEqual(expect.arrayContaining(['summary', 'raw_result']));
  expect(result.result_metadata?.capabilities).toEqual(result.result_capabilities);
  expect(result.objective_value).not.toBeNull();
});

test('candidate horizon and data-derived horizon use real published contracts', async ({ request }) => {
  test.setTimeout(300_000);
  const models = await json<ModelAsset[]>(await request.get('/api/models'));
  let base: ModelAsset | undefined;
  const unitCommitmentVersions = models
    .filter(item => String(item.status).toLowerCase() === 'published' && item.template_id === 'unit_commitment_day_ahead')
    .sort((left, right) => String(right.published_at || '').localeCompare(String(left.published_at || '')));
  const activeUnitCommitmentVersions = unitCommitmentVersions.filter(item => item.is_active_version === true);
  for (const model of activeUnitCommitmentVersions.length ? activeUnitCommitmentVersions : unitCommitmentVersions) {
    const candidateSchema = await schema(request, model);
    const timeConfig = candidateSchema.ui_metadata?.time_dimension;
    if (timeConfig?.policy === 'runtime_variable' && Array.isArray(candidateSchema.semantic_spec?.sample_runtime_parameters?.load_forecast) && candidateSchema.model_problem_type !== 'NLP') {
      base = model;
      break;
    }
  }
  expect(base, 'No generic runtime-variable seed model').toBeTruthy();

  let fixedModel: ModelAsset | undefined;
  let fixedSchema: Record<string, any> | undefined;
  for (const model of models.filter(item => callable.has(String(item.status).toLowerCase()) && item.is_active_version === true)) {
    const candidateSchema = await schema(request, model);
    if (candidateSchema.ui_metadata?.time_dimension?.policy === 'fixed' && candidateSchema.model_problem_type !== 'NLP' && candidateSchema.semantic_spec?.sample_runtime_parameters) {
      fixedModel = model;
      fixedSchema = candidateSchema;
      break;
    }
  }
  expect(fixedModel, 'No fixed-horizon real-solver seed model').toBeTruthy();
  const fixedParameters = structuredClone(fixedSchema!.semantic_spec.sample_runtime_parameters);
  const fixedTask = await solve(request, fixedModel!, fixedParameters);
  expect(fixedTask.status).toBe('SUCCESS');
  const fixedResult = await json<Record<string, any>>(await request.get(`/api/tasks/${fixedTask.id}/result`));
  expect(fixedResult.result_capabilities).toContain('raw_result');

  const candidate = await createPolicyModel(request, base!, {
    schema_version: 1,
    enabled: true,
    policy: 'runtime_variable',
    default_horizon: 24,
    allowed_horizons: [24, 48, 96],
    time_set: 'time',
    interval_minutes_by_horizon: { 24: 60, 48: 30, 96: 15 },
    delta_t_by_horizon: { 24: 1, 48: 0.5, 96: 0.25 },
    editable: true,
  }, 'candidate_horizon');
  const candidateSchema = await schema(request, candidate);
  const candidateParameters = structuredClone(candidateSchema.semantic_spec.sample_runtime_parameters);
  candidateParameters.horizon = 96;
  for (const field of candidateSchema.input_schema || []) {
    if (Array.isArray(field.dimension) && field.dimension.includes('time') && Array.isArray(candidateParameters[field.key])) {
      const values = candidateParameters[field.key];
      candidateParameters[field.key] = Array.from({ length: 96 }, (_, index) => values[index % values.length]);
    }
  }
  const candidateTask = await solve(request, candidate, candidateParameters);
  expect(candidateTask.status).toBe('SUCCESS');
  const candidateResult = await json<Record<string, any>>(await request.get(`/api/tasks/${candidateTask.id}/result`));
  expect(candidateResult.chart?.labels).toHaveLength(96);

  const derived = await createPolicyModel(request, base!, {
    schema_version: 1,
    enabled: true,
    policy: 'data_derived',
    time_set: 'time',
    derive_from: 'load_forecast',
    interval_minutes: 60,
    editable: false,
  }, 'data_derived');
  const derivedSchema = await schema(request, derived);
  const derivedParameters = structuredClone(derivedSchema.semantic_spec.sample_runtime_parameters);
  delete derivedParameters.horizon;
  derivedParameters.load_forecast = [160, 190, 175, 150];
  const derivedTask = await solve(request, derived, derivedParameters);
  expect(derivedTask.status).toBe('SUCCESS');
  const derivedResult = await json<Record<string, any>>(await request.get(`/api/tasks/${derivedTask.id}/result`));
  expect(derivedResult.chart?.labels).toHaveLength(4);
});

test('hydro capability is selected from semantic structure and solved through the generic task API', async ({ request }) => {
  test.setTimeout(240_000);
  const models = await json<ModelAsset[]>(await request.get('/api/models'));
  let selected: ModelAsset | undefined;
  let selectedSchema: Record<string, any> | undefined;
  for (const model of models.filter(item => callable.has(String(item.status).toLowerCase()))) {
    const candidate = await schema(request, model);
    const components = candidate.semantic_spec?.component_spec?.components || [];
    const capabilityTags = candidate.semantic_spec?.tags || [];
    const hasHydroCapability = capabilityTags.includes('hydro');
    const hasPwlCapability = capabilityTags.includes('pwl_2d') && components.some((item: Record<string, any>) => Boolean(item.function_asset_id) && String(item.type).includes('function_mapping'));
    if (hasHydroCapability && hasPwlCapability && candidate.semantic_spec?.sample_runtime_parameters && candidate.model_problem_type !== 'NLP') {
      selected = model;
      selectedSchema = candidate;
      break;
    }
  }
  expect(selected, 'No metadata-described hydro/PWL seed model').toBeTruthy();
  const task = await solve(request, selected!, structuredClone(selectedSchema!.semantic_spec.sample_runtime_parameters));
  expect(task.status).toBe('SUCCESS');
  const result = await json<Record<string, any>>(await request.get(`/api/tasks/${task.id}/result`));
  expect(result.result_capabilities).toEqual(expect.arrayContaining(['hydro_process', 'pwl_diagnostics', 'raw_result']));
  expect(result.business_output?.water_balance_check?.length || result.business_output?.storage_curve?.length).toBeGreaterThan(0);
});

test('real infeasible submission returns actionable diagnosis instead of a generic failure only', async ({ request }) => {
  test.setTimeout(180_000);
  const models = await json<ModelAsset[]>(await request.get('/api/models'));
  let selected: ModelAsset | undefined;
  let selectedSchema: Record<string, any> | undefined;
  for (const model of models.filter(item => String(item.status).toLowerCase() === 'published')) {
    const candidate = await schema(request, model);
    if (Array.isArray(candidate.semantic_spec?.sample_runtime_parameters?.load_forecast)) {
      selected = model;
      selectedSchema = candidate;
      break;
    }
  }
  expect(selected).toBeTruthy();
  const parameters = structuredClone(selectedSchema!.semantic_spec.sample_runtime_parameters);
  parameters.load_forecast = parameters.load_forecast.map(() => 1_000_000);
  const task = await solve(request, selected!, parameters);
  expect(['INFEASIBLE', 'FAILED']).toContain(task.status);
  expect(task.error || task.recent_logs?.length).toBeTruthy();
  const resultResponse = await request.get(`/api/tasks/${task.id}/result`);
  if (resultResponse.ok()) {
    const result = await resultResponse.json();
    expect(result.diagnosis || result.business_explanation || result.error).toBeTruthy();
  }
});

test('agent performs automatic skill matching without a hidden requested skill', async ({ request }) => {
  test.setTimeout(120_000);
  const conversation = await json<Record<string, any>>(await request.post('/api/agent/conversations', { data: { title: 'real gate' } }));
  const response = await request.post('/api/agent/analyze', {
    data: { conversation_id: conversation.conversation_id, message: '请根据负荷预测安排经济调度并给出参数检查建议' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const analyzed = await response.json();
  expect(analyzed.conversation_id).toBe(conversation.conversation_id);
  expect(analyzed.agent_skill_name || analyzed.resolved_skill_name || analyzed.workflow_state).toBeTruthy();
});
