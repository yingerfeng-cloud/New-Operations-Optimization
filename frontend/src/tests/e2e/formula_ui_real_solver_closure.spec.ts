import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

const sets = [
  { code: 'unit', name: '机组', values: ['U1'], type: 'enum', dimensionType: 'enum' },
  { code: 'time', name: '决策时段', values: [0, 1], type: 'time_period', dimensionType: 'time_period', managed_by: 'time_dimension' },
  { code: 'state_time', name: '状态时点', values: [0, 1, 2], type: 'state_time', dimensionType: 'state_time', base_set: 'time', managed_by: 'time_dimension' },
];

const parameters = [
  { code: 'a', name: '除数参数', dimension: [], default: 2, positive: true },
  { code: 'b', name: '系数参数', dimension: [], default: 0.5, positive: true },
  { code: 'eta_in', name: '充入效率', dimension: [], default: 0.5, positive: true },
  { code: 'eta_out', name: '放出效率', dimension: [], default: 0.8, positive: true },
  { code: 'delta_t', name: '时间步长', dimension: [], default: 1, positive: true },
  { code: 'upper', name: '出力上界', dimension: ['unit'], default: [20] },
  { code: 'demand', name: '需求', dimension: ['time'], default: [3, 4] },
  { code: 'target', name: '系数约束目标', dimension: ['time'], default: [6, 8] },
  { code: 'input_fixed', name: '固定充入', dimension: ['time'], default: [2, 4] },
  { code: 'output_fixed', name: '固定放出', dimension: ['time'], default: [0, 0] },
  { code: 'initial', name: '初始状态', dimension: [], default: 10 },
];

const variables = [
  { code: 'power', name: '机组出力', dimension: ['unit', 'time'], domain: 'NonNegativeReals' },
  { code: 'state', name: '储能状态', dimension: ['state_time'], domain: 'NonNegativeReals' },
  { code: 'input', name: '充入功率', dimension: ['time'], domain: 'NonNegativeReals' },
  { code: 'output', name: '放出功率', dimension: ['time'], domain: 'NonNegativeReals' },
];

const formulaRows = [
  ['chain', '链式约束', 'constraint', '0 <= power[u,t] <= upper[u]', [['u', 'unit'], ['t', 'time']]],
  ['division', '参数除法', 'constraint', 'power[u,t] / a >= demand[t]', [['u', 'unit'], ['t', 'time']]],
  ['multi', '多参数系数', 'constraint', 'a * b * power[u,t] >= target[t]', [['u', 'unit'], ['t', 'time']]],
  ['state', '状态偏移', 'constraint', 'state[t+1] == state[t] + eta_in * input[t] * delta_t - output[t] / eta_out * delta_t', [['t', 'time']]],
  ['input_fix', '固定充入', 'constraint', 'input[t] == input_fixed[t]', [['t', 'time']]],
  ['output_fix', '固定放出', 'constraint', 'output[t] == output_fixed[t]', [['t', 'time']]],
  ['initial_fix', '固定初始状态', 'constraint', 'state[0] == initial', []],
  ['objective', '最小化总出力', 'objective', 'sum(power[u,t] for u in unit for t in time)', []],
] as const;

function formula([formulaId, name, kind, expression, scope]: (typeof formulaRows)[number]) {
  const timestamp = new Date().toISOString();
  return {
    formula_id: formulaId,
    name,
    kind,
    objective_direction: kind === 'objective' ? 'minimize' : undefined,
    solve_participation: 'solve_active',
    display_formula: expression,
    dsl_formula: expression,
    tokens: [],
    foreach: scope.map(([, set]) => set),
    scope: scope.map(([alias, set]) => ({ alias, set })),
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: scope.map(([alias]) => alias),
    compile_status: 'draft',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function seedDraft(api: APIRequestContext) {
  const modelDraft = {
    basic_info: { name: 'UI 权威公式真实求解验收', model_code: `formula_ui_${Date.now()}`, scenario: 'unit_commitment_day_ahead', builder_mode: 'generic_linear', solver: 'HiGHS' },
    semantic: { sets, parameters, variables },
    components: [],
    formulas: formulaRows.map(formula),
    time_dimension: { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 2, time_set: 'time', state_time_set: 'state_time', interval_minutes: 60, delta_t: 1, editable: false },
    runtime_parameters: Object.fromEntries(parameters.map(item => [item.code, item.default])),
    parameter_groups: { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} },
    advanced: {},
  };
  return json<Record<string, any>>(await api.post('/api/models', { data: {
    name: modelDraft.basic_info.name,
    scene: modelDraft.basic_info.scenario,
    template_id: modelDraft.basic_info.model_code,
    status: 'developing',
    solver: 'HiGHS',
    build_mode: 'generic_linear',
    model_problem_type: 'LP',
    model_draft: modelDraft,
    semantic_spec: modelDraft.semantic,
    parameters: modelDraft.runtime_parameters,
  } }));
}

test('@real UI authoritative artifacts preserve four boundary semantics through the real Builder and HiGHS', async ({ page, request }) => {
  test.setTimeout(240_000);
  const seeded = await seedDraft(request);
  await page.goto(`/models/${seeded.id}/edit`);
  await page.getByRole('button', { name: /数学展开/ }).click();

  await page.getByRole('button', { name: /批量权威编译/ }).first().click();
  await expect(page.getByText(/8 条全部通过/)).toBeVisible();
  await page.getByRole('button', { name: '编译模型（后端权威）' }).click();
  const compileModal = page.locator('.ant-modal-confirm:visible');
  await expect(compileModal.locator('.ant-modal-confirm-title')).toHaveText('generic_spec 权威编译成功');
  await compileModal.getByRole('button', { name: '知道了' }).click();
  const saveResponsePromise = page.waitForResponse(response => response.url().endsWith(`/api/models/${seeded.id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存草稿' }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();

  const saved = await json<Record<string, any>>(await request.get(`/api/models/${seeded.id}`));
  const spec = saved.generic_spec;
  expect(spec.formula_compiler).toBe('backend_authoritative_v2');
  expect(spec.formula_artifacts).toHaveLength(8);
  expect(spec.constraints.filter((row: Record<string, any>) => row.source_formula_id === 'chain').map((row: Record<string, any>) => row.split_sequence)).toEqual([1, 2]);
  expect(spec.constraints.find((row: Record<string, any>) => row.source_formula_id === 'division').terms[0].coefficient.factors).toContainEqual(expect.objectContaining({ parameter: 'a', power: -1 }));
  expect(spec.constraints.find((row: Record<string, any>) => row.source_formula_id === 'multi').terms[0].coefficient.factors.map((item: Record<string, any>) => item.parameter)).toEqual(['a', 'b']);
  expect(spec.constraints.find((row: Record<string, any>) => row.source_formula_id === 'state').terms.some((term: Record<string, any>) => term.key?.some((key: Record<string, any>) => key.type === 'index_offset' && key.offset === 1))).toBe(true);

  // Finish the production path through visible UI actions. API calls below
  // are used only to cross-check the state created by those UI actions.
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByTestId('model-test-run-button')).toBeEnabled();
  const testResponsePromise = page.waitForResponse(response => response.url().endsWith(`/api/models/${seeded.id}/test`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const testResponse = await testResponsePromise;
  expect(testResponse.ok(), await testResponse.text()).toBeTruthy();
  await expect(page.getByText('测试运行结果')).toBeVisible();

  const publishButton = page.getByRole('button', { name: '发布模型' });
  await expect(publishButton).toBeEnabled();
  const publishResponsePromise = page.waitForResponse(response => response.url().endsWith(`/api/models/${seeded.id}/publish`) && response.request().method() === 'POST');
  await publishButton.click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/models/${seeded.id}$`));

  await page.goto(`/tasks?create=1&model=${encodeURIComponent(seeded.id)}`);
  const taskDrawer = page.getByRole('dialog', { name: '创建求解任务' });
  await expect(taskDrawer).toBeVisible();
  await expect(taskDrawer.getByRole('button', { name: '下一步' })).toBeEnabled();
  await taskDrawer.getByRole('button', { name: '下一步' }).click();
  await expect(taskDrawer.getByText('问题 0')).toBeVisible();
  await taskDrawer.getByRole('button', { name: '下一步' }).click();
  await expect(taskDrawer.getByText('参数检查通过，可以提交求解')).toBeVisible();
  const taskResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
  await taskDrawer.getByRole('button', { name: '提交求解并打开详情' }).click();
  const taskResponse = await taskResponsePromise;
  expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy();
  const task = await taskResponse.json() as Record<string, any>;
  expect(task.status).toBe('SUCCESS');

  const taskDetail = page.getByRole('dialog', { name: `任务 ${task.id}` });
  await expect(taskDetail).toBeVisible();
  await expect(taskDetail.locator('.ant-tabs-tab-active')).toContainText('优化结果');
  const metricsCard = taskDetail.locator('.ant-card').filter({ hasText: '关键指标' });
  await expect(metricsCard).toContainText('objective_value');
  await expect(metricsCard).toContainText('14');

  const published = await json<Record<string, any>>(await request.get(`/api/models/${seeded.id}`));
  expect(published.status).toBe('published');
  const result = await json<Record<string, any>>(await request.get(`/api/tasks/${task.id}/result`));
  expect(result.objective_value).toBeCloseTo(14, 8);
  expect(result.raw_result || result.business_output).toBeTruthy();
});
