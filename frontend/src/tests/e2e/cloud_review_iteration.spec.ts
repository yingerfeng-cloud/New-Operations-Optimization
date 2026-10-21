import { expect, test, type APIRequestContext } from '@playwright/test';

async function post(request: APIRequestContext, url: string, data?: unknown) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('iteration: selective component update survives lost response, refresh and newer revision', async ({ page, request }, info) => {
  const suffix = Date.now();
  const c1 = `iter_browser_${suffix}`;
  const definition = { component_id: c1, name: '合成供给下限', version: '1.0.0', sets: [{ code: 'time' }],
    parameters: [{ code: 'demand', dimension: ['time'], default: [10, 10] }],
    variables: [{ code: 'output', dimension: ['time'], type: 'continuous', lower_bound: 0 }],
    constraints: [{ constraint_id: 'floor', indices: [{ set: 'time', alias: 't' }], expression: 'output[t] >= demand[t]' }] };
  await post(request, '/api/components/catalog', definition);
  await post(request, `/api/components/${c1}/publish`);
  async function version(id: string, factor: number) {
    await post(request, `/api/components/${c1}/copy-version`, { component_id: id, version: `v${factor}` });
    const response = await request.put(`/api/components/${id}`, { data: { constraints: [{ ...definition.constraints[0], expression: `output[t] >= ${factor} * demand[t]` }] } });
    expect(response.ok(), await response.text()).toBeTruthy();
    await post(request, `/api/components/${id}/publish`);
  }
  async function create(label: string) {
    const spec = { model_code: `iter_${label}_${suffix}`, build_mode: 'component_based', sets: [{ code: 'time', values: [0, 1] }],
      parameters: definition.parameters, variables: [{ code: 'output', name: 'output', indices: ['time'], dimension: ['time'], unit: 'MW', lower_bound: 0, upper_bound: 100 }],
      components: [{ type: c1 }], objective: { sense: 'minimize', terms: [{ term_id: 'cost', expression: 'sum(3 * output[t] for t in time)',
        weight: 1, weight_key: 'cost', supported_by_backend: true, solve_participation: 'solve_active' }] } };
    const model = await post(request, '/api/models', { name: spec.model_code, scene: '合成供给', build_mode: 'component_based', problem_type: 'LP', model_problem_type: 'LP',
      component_spec: spec, semantic_spec: { ...spec, parameters: [{ code: 'demand', dimension: ['time'], value_type: 'number', sample_value: [10, 10] }] }, parameters: { horizon: 2, demand: [10, 10] } });
    const task = await post(request, `/api/models/${model.id}/test-jobs`, { parameters: { horizon: 2, demand: [10, 10] } });
    await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('SUCCESS');
    await post(request, `/api/models/${model.id}/publish`);
    return model.id as string;
  }
  const a = await create('a'); const b = await create('b');
  const c2 = `${c1}_r2`; await version(c2, 1.2);
  await page.goto(`/models/${a}`);
  await page.getByRole('tab', { name: '组件更新与修订' }).click();
  await page.getByRole('combobox', { name: `${c1} 组件目标修订` }).click();
  await page.locator('.ant-select-item-option-content').getByText('r2 · v1.2', { exact: true }).click();
  await page.locator('.ant-table-row-expand-icon').first().click();
  await expect(page.getByText('使用相同输入与设置重新测试所选组件修订。')).toBeVisible();
  let captured: any;
  await page.route(`**/api/models/${a}/component-updates/test`, async route => {
    const response = await route.fetch(); expect(response.ok()).toBeTruthy(); captured = await response.json();
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: '更新组件并测试', exact: true }).click();
  await expect(page.getByText('组件更新提交尚未确认，可使用同一标识恢复')).toBeVisible();
  await expect.poll(() => captured?.model.id).toBeTruthy();
  await page.unroute(`**/api/models/${a}/component-updates/test`);
  await page.reload();
  await page.getByRole('tab', { name: '组件更新与修订' }).click();
  await page.getByRole('button', { name: '恢复组件更新并测试', exact: true }).click();
  const apply = page.getByRole('button', { name: '应用组件更新', exact: true });
  await expect(apply).toBeEnabled();
  const comparison = page.getByTestId('update-business-comparison');
  await expect(comparison.getByText('实际决策与物理量')).toBeVisible();
  const firstDecision = comparison.getByRole('row').filter({ hasText: 'output[0]' });
  await expect(firstDecision.getByRole('cell', { name: 'MW', exact: true })).toBeVisible();
  for (const numeric of ['10', '12', '2']) await expect(firstDecision.getByRole('cell', { name: numeric, exact: true })).toBeVisible();
  await expect(comparison.getByText('实际约束及残差')).toBeVisible();
  await page.screenshot({ path: info.outputPath('component-business-comparison.png'), fullPage: true });
  await version(`${c1}_r3`, 1.5);
  await post(request, `/api/components/${c1}/offline`);
  await apply.click();
  await expect(page).toHaveURL(new RegExp(`/models/${captured.model.id}$`));
  for (const [id, expected, output] of [[captured.model.id, 72, 12], [b, 60, 10]] as const) {
    const solved = await post(request, `/api/models/${id}/invoke`, { parameters: { horizon: 2, demand: [10, 10] }, options: { mode: 'sync', explain: false } });
    expect(solved.status).toBe('SUCCESS'); expect(solved.objective_value).toBeCloseTo(expected, 7);
    expect(Object.values(solved.variable_values.output)).toEqual([output, output]);
  }
  const candidates = await (await request.get('/api/models')).json();
  expect(candidates.filter((row: any) => row.ui_metadata?.component_update?.source_model_id === a)).toHaveLength(1);
  // RV-01 merge blocker: continue the same real journey beyond update/apply.
  await page.getByRole('button', { name: '创建新版本并修改', exact: true }).click();
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  const name = page.locator('[data-field-code="name"] input');
  await name.fill(`合成组件更新后普通版本 ${suffix}`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/MODEL-[^/]+\/edit$/);
  const nextId = new URL(page.url()).pathname.split('/')[2];
  await page.reload();
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await expect(name).toHaveValue(`合成组件更新后普通版本 ${suffix}`);
  await name.fill(`合成组件更新后再次保存 ${suffix}`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true }).first()).toBeVisible();
  await page.reload();
  const next = await (await request.get(`/api/models/${nextId}`)).json();
  expect(next.version).toBe('v0.3');
  expect(next.supersedes_model_id).toBe(captured.model.id);
  for (const metadata of [next.ui_metadata, next.model_draft.advanced.ui_metadata]) {
    expect(metadata).not.toHaveProperty('component_update');
    expect(metadata).not.toHaveProperty('function_update');
  }
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const tested = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/models/${nextId}/test-jobs`));
  await page.getByTestId('model-test-run-button').click();
  const testResponse = await tested;
  expect(testResponse.ok(), await testResponse.text()).toBeTruthy();
  const nextTask = await testResponse.json();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${nextTask.id}`)).json()).status, { timeout: 60_000 }).toBe('SUCCESS');
  const nextResult = await (await request.get(`/api/tasks/${nextTask.id}/result`)).json();
  expect(nextResult.objective_value).toBeCloseTo(72, 7);
  expect(Object.values(nextResult.variable_values.output)).toEqual([12, 12]);
  expect(nextResult.solution_evidence.max_constraint_violation).toBe(0);
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${nextId}$`));
  const final = await (await request.get(`/api/models/${nextId}`)).json();
  expect(final.status).toBe('published');
  expect(final.tested_content_hash).toBe(final.content_hash);
  expect(Object.keys(final.component_dependencies.assets)).toEqual([c2]);
  await info.attach('rv01-continuous-versions', { body: JSON.stringify({ source: a, applied: captured.model.id, ordinary: nextId,
    version: final.version, task: nextTask.id, objective: nextResult.objective_value,
    max_residual: nextResult.solution_evidence.max_constraint_violation, content_hash: final.content_hash,
    environment: nextResult.execution_environment }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('rv01-ordinary-version-published.png'), fullPage: true });
  await page.goto(`/tasks?task=${captured.task.id}`);
  await page.getByRole('tab', { name: '输入参数', exact: true }).click();
  const environment = page.getByTestId('execution-environment');
  await expect(environment.getByText('实际求解器版本')).toBeVisible();
  await expect(environment.getByText('未知（当前进程无法可信取得）')).toBeVisible();
  await page.getByRole('button', { name: '原环境历史重放', exact: true }).click();
  await expect(page.getByText('原环境未提供恢复能力，请使用当前内核重算；这不能作为严格历史复现。')).toBeVisible();
});

test('iteration RV-02: revoke then inspect, replace, test and publish a safe component revision', async ({ page, request }, info) => {
  const suffix = Date.now(); const c1 = `rv02_browser_${suffix}`; const c2 = `${c1}_safe`;
  const constraint = { constraint_id: 'floor', indices: [{ set: 'time', alias: 't' }], expression: 'output[t] >= demand[t]' };
  const parameters = [{ code: 'demand', dimension: ['time'], default: [10, 10] }];
  await post(request, '/api/components/catalog', { component_id: c1, name: '合成撤销恢复供给', version: '1.0.0', sets: [{ code: 'time' }], parameters,
    variables: [{ code: 'output', dimension: ['time'], type: 'continuous', lower_bound: 0 }], constraints: [constraint] });
  await post(request, `/api/components/${c1}/publish`);
  await post(request, `/api/components/${c1}/copy-version`, { component_id: c2, version: '2.0.0' });
  expect((await request.put(`/api/components/${c2}`, { data: { constraints: [{ ...constraint, expression: 'output[t] >= 1.2 * demand[t]' }] } })).ok()).toBeTruthy();
  await post(request, `/api/components/${c2}/publish`);
  const spec = { model_code: `rv02_model_${suffix}`, build_mode: 'component_based', sets: [{ code: 'time', values: [0, 1] }], parameters,
    variables: [{ code: 'output', name: 'output', indices: ['time'], dimension: ['time'], unit: 'MW', lower_bound: 0, upper_bound: 100 }],
    components: [{ type: c1 }], objective: { sense: 'minimize', terms: [{ term_id: 'cost', expression: 'sum(3 * output[t] for t in time)', weight: 1,
      weight_key: 'cost', supported_by_backend: true, solve_participation: 'solve_active' }] } };
  const source = await post(request, '/api/models', { name: spec.model_code, scene: '合成供给', build_mode: 'component_based', problem_type: 'LP', model_problem_type: 'LP', component_spec: spec,
    semantic_spec: { ...spec, parameters: [{ code: 'demand', dimension: ['time'], value_type: 'number', sample_value: [10, 10] }] }, parameters: { horizon: 2, demand: [10, 10] } });
  const oldTest = await post(request, `/api/models/${source.id}/test-jobs`, { parameters: { horizon: 2, demand: [10, 10] } });
  await expect.poll(async () => (await (await request.get(`/api/tasks/${oldTest.id}`)).json()).status, { timeout: 60_000 }).toBe('SUCCESS');
  const oldResult = await (await request.get(`/api/tasks/${oldTest.id}/result`)).json();
  expect(oldResult.objective_value).toBeCloseTo(60, 7);
  await post(request, `/api/models/${source.id}/publish`);
  const impact = await (await request.get(`/api/components/${c1}/revocation-impact`)).json();
  const reason = '合成安全撤销：通过安全修订恢复';
  await post(request, `/api/components/${c1}/revoke`, { reason, expected_impact_hash: impact.impact_hash });
  const blocked = await request.post('/api/tasks', { data: { model_id: source.id, parameters: { horizon: 2, demand: [10, 10] } } });
  expect(blocked.status()).toBe(409); expect((await blocked.json()).detail.code).toBe('COMPONENT_REVOKED');
  const replay = await request.post(`/api/tasks/${oldTest.id}/replay`, { data: { mode: 'current_kernel' } });
  expect(replay.status()).toBe(409); expect((await replay.json()).detail.code).toBe('COMPONENT_REVOKED');
  await page.goto(`/models/${source.id}`);
  await page.getByRole('tab', { name: '组件更新与修订' }).click();
  await expect(page.getByText(`已安全撤销：${reason}。仅可查看并替换，禁止执行。`)).toBeVisible();
  await page.getByRole('combobox', { name: `${c1} 组件目标修订` }).click();
  await page.locator('.ant-select-item-option-content').getByText('r2 · 2.0.0', { exact: true }).click();
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/component-updates/test'));
  await page.getByRole('button', { name: '更新组件并测试', exact: true }).click();
  const accepted = await submitted; expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const candidate = await accepted.json();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${candidate.task.id}`)).json()).status, { timeout: 60_000 }).toBe('SUCCESS');
  const actual = await (await request.get(`/api/tasks/${candidate.task.id}/result`)).json();
  expect(actual.objective_value).toBeCloseTo(72, 7);
  expect(Object.values(actual.variable_values.output)).toEqual([12, 12]);
  expect(actual.solution_evidence.max_constraint_violation).toBe(0);
  await expect(page.getByTestId('update-business-comparison').getByText('实际决策与物理量')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '组件更新与修订' }).click();
  await expect(page.getByRole('button', { name: '应用组件更新', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '应用组件更新', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${candidate.model.id}$`));
  const fixed = await (await request.get(`/api/models/${candidate.model.id}`)).json();
  expect(fixed.status).toBe('published');
  expect(Object.keys(fixed.component_dependencies.assets)).toEqual([c2]);
  expect(fixed.tested_content_hash).toBe(fixed.content_hash);
  await page.screenshot({ path: info.outputPath('rv02-safe-revision-published.png'), fullPage: true });
  await info.attach('rv02-recovery', { body: JSON.stringify({ source: source.id, candidate: fixed.id, old_task: oldTest.id, task: candidate.task.id,
    old_objective: oldResult.objective_value, objective: actual.objective_value, max_residual: actual.solution_evidence.max_constraint_violation,
    content_hash: fixed.content_hash, dependencies: fixed.component_dependencies, revocation_impact: impact }), contentType: 'application/json' });
});

test('iteration: function update shows physical changes with declared units', async ({ page, request }, info) => {
  const suffix = Date.now(); const fid = `iter_browser_f_${suffix}`;
  await post(request, '/api/function-assets', { function_id: fid, name: '合成曲线', points: [[0, 0], [20, 20]], solve_strategy: 'segment_binary', status: 'published' });
  const variables = [{ name: 'volume', indices: ['time'], lower_bound: 10, upper_bound: 10, unit: 'MWh' }, { name: 'level', indices: ['time'], lower_bound: 0, unit: 'MW' }];
  const spec = { model_code: `iter_curve_${suffix}`, build_mode: 'component_based', sets: [{ code: 'time', values: [0] }], variables,
    components: [{ type: 'function_mapping_component', function_asset_id: fid, x: 'volume[t]', y: 'level[t]', indices: [{ set: 'time', alias: 't' }], solve_strategy: 'segment_binary' }],
    objective: { sense: 'minimize', terms: [{ term_id: 'cost', expression: 'sum(level[t] for t in time)', weight_key: 'cost', weight: 1, supported_by_backend: true, solve_participation: 'solve_active' }] } };
  const asset = await post(request, '/api/models', { name: spec.model_code, scene: '通用合成曲线', build_mode: 'component_based', problem_type: 'MILP', model_problem_type: 'MILP', parameters: { horizon: 1 }, component_spec: spec,
    semantic_spec: { ...spec, parameters: [], variables: variables.map(row => ({ code: row.name, dimension: row.indices, unit: row.unit })) } });
  const task = await post(request, `/api/models/${asset.id}/test-jobs`, { parameters: { horizon: 1 } });
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('SUCCESS');
  await post(request, `/api/models/${asset.id}/publish`);
  expect((await request.put(`/api/function-assets/${fid}`, { data: { points: [[0, 0], [20, 40]] } })).ok()).toBeTruthy();
  await page.goto(`/models/${asset.id}`); await page.getByRole('tab', { name: '函数更新与修订' }).click();
  await page.getByRole('combobox', { name: `${fid} 目标修订` }).click();
  await page.locator('.ant-select-item-option-content').getByText('r2', { exact: true }).click();
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/function-updates/test'));
  await page.getByRole('button', { name: '更新并测试', exact: true }).click();
  const accepted = await submitted; expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const candidate = await accepted.json();
  // The asynchronous computation has its own bounded phase within the existing
  // 180 s test budget; the subsequent UI and numeric assertions stay unchanged.
  await expect.poll(async () => (await (await request.get(`/api/tasks/${candidate.task.id}`)).json()).status, { timeout: 60_000 }).toBe('SUCCESS');
  const actual = await (await request.get(`/api/tasks/${candidate.task.id}/result`)).json();
  expect(actual.objective_value).toBeCloseTo(20, 7);
  expect(Object.values(actual.variable_values.level)).toEqual([20]);
  expect(actual.solution_evidence.max_constraint_violation).toBe(0);
  const comparison = page.getByTestId('update-business-comparison');
  const physical = comparison.getByRole('row').filter({ hasText: 'level[0]' });
  await expect(physical.getByRole('cell', { name: 'MW', exact: true })).toBeVisible();
  await expect(physical.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  await expect(physical.getByRole('cell', { name: '10', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '应用更新', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('function-business-comparison.png'), fullPage: true });
});
