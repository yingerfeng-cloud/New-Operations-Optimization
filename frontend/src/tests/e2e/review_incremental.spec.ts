import { expect, test, type Page } from '@playwright/test';

const headers = { Authorization: 'Bearer synthetic-review-token' };
async function enter(page: Page, path: string) {
  await page.addInitScript(() => sessionStorage.setItem('optiforge-platform-token', 'synthetic-review-token'));
  await page.goto(path);
}

test('incremental workbench resumes a running model test after refresh and a network failure', async ({ page, request }, info) => {
  await enter(page, '/models/create?mode=clone&source=MODEL-POWER-ECONOMIC-DISPATCH');
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  const name = `合成模型测试续接 ${Date.now()}`;
  await page.locator('[data-field-code="name"] input').fill(name);
  await page.getByText('高级编辑：模型编码', { exact: true }).click();
  await page.locator('[data-field-code="model_code"] input').fill(`review_slow_test_${Date.now()}`);
  await page.getByRole('button', { name: /校验发布/ }).click();
  let tests = 0;
  page.on('request', call => { if (call.method() === 'POST' && call.url().endsWith('/test-jobs')) tests += 1; });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/test-jobs'));
  await page.getByTestId('model-test-run-button').click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  const modelId = task.model_id;
  await expect(page).toHaveURL(new RegExp(`/models/${modelId}/edit$`));
  await expect(page.getByText(new RegExp(`模型测试任务：${task.id}`))).toBeVisible();
  await expect(page.getByTestId('model-test-run-button')).toBeDisabled();
  await page.reload();
  await expect(page.getByText(new RegExp(`模型测试任务：${task.id}`))).toBeVisible();
  await expect(page.getByTestId('model-test-run-button')).toBeDisabled();
  await page.route(`**/api/tasks/${task.id}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"synthetic network interruption"}' }));
  await expect(page.getByRole('button', { name: '恢复测试记录' })).toBeVisible();
  await page.unroute(`**/api/tasks/${task.id}`);
  await page.getByRole('button', { name: '恢复测试记录' }).click();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled({ timeout: 60_000 });
  expect(tests).toBe(1);
  const result = await request.get(`/api/tasks/${task.id}/result`, { headers });
  expect((await result.json()).objective_value).toBe(160300);
  const asset = await request.get(`/api/models/${modelId}`, { headers });
  const model = await asset.json();
  expect(model.tested_model_id).toBe(modelId);
  expect(model.tested_content_hash).toBe(model.content_hash);
  expect(model.test_task_id).toBe(task.id);
  await page.screenshot({ path: info.outputPath('model-test-resumed.png'), fullPage: true });
  // A local edit after recovery must immediately invalidate the publish action.
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await page.locator('[data-field-code="name"] input').fill(`${name} 已修改`);
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeDisabled();
});

test('incremental function update applies a tested revision while another model keeps its binding', async ({ page, request }, info) => {
  const suffix = Date.now();
  const functionId = `review_browser_F_${suffix}`;
  const createdFunction = await request.post('/api/function-assets', { headers, data: { function_id: functionId, name: `合成函数 F ${suffix}`, points: [[0, 0], [20, 20]], solve_strategy: 'segment_binary', status: 'published' } });
  expect(createdFunction.ok(), await createdFunction.text()).toBeTruthy();
  async function createModel(code: string) {
    const variables = [{ name: 'volume', indices: ['time'], lower_bound: 10, upper_bound: 10 }, { name: 'level', indices: ['time'], lower_bound: 0 }];
    const component = { model_code: code, build_mode: 'component_based', required_solver_capabilities: ['MILP'], sets: [{ code: 'time', values: [0] }], variables,
      components: [{ type: 'function_mapping_component', function_asset_id: functionId, x: 'volume[t]', y: 'level[t]', indices: [{ set: 'time', alias: 't' }], solve_strategy: 'segment_binary' }],
      objective: { sense: 'minimize', terms: [{ term_id: 'cost', expression: 'sum(level[t] for t in time)', weight_key: 'piecewise_cost', weight: 1, supported_by_backend: true, solve_participation: 'solve_active' }] } };
    const created = await request.post('/api/models', { headers, data: { name: code, scene: 'synthetic', build_mode: 'component_based', problem_type: 'MILP', model_problem_type: 'MILP', parameters: { horizon: 1 }, component_spec: component,
      semantic_spec: { ...component, parameters: [], variables: variables.map(row => ({ code: row.name, dimension: row.indices })) } } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const id = (await created.json()).id;
    const tested = await request.post(`/api/models/${id}/test`, { headers, data: { parameters: { horizon: 1 } } });
    expect(tested.ok(), await tested.text()).toBeTruthy();
    expect((await request.post(`/api/models/${id}/publish`, { headers })).ok()).toBeTruthy();
    return id;
  }
  const aCode = `review_browser_A_${suffix}`;
  const a = await createModel(aCode);
  const b = await createModel(`review_browser_B_${suffix}`);
  expect((await request.put(`/api/function-assets/${functionId}`, { headers, data: { points: [[0, 0], [20, 40]] } })).ok()).toBeTruthy();
  await enter(page, `/models/${a}`);
  await page.getByRole('tab', { name: '函数更新与修订' }).click();
  await page.getByRole('combobox', { name: `${functionId} 目标修订` }).click();
  await page.locator('.ant-select-item-option-content').getByText('r2', { exact: true }).click();
  await page.locator('.ant-table-row-expand-icon').first().click();
  await expect(page.getByText('断点', { exact: true })).toBeVisible();
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/function-updates/test'));
  await page.getByRole('button', { name: '更新并测试', exact: true }).click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON().revisions).toEqual({ [functionId]: 2 });
  const candidate = (await response.json()).model.id;
  await expect(page.getByRole('button', { name: '应用更新', exact: true })).toBeEnabled();
  expect((await request.get(`/api/models/${a}`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`/api/function-assets/${functionId}`, { headers, data: { points: [[0, 0], [20, 60]] } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: '应用更新', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${candidate}$`));
  const adopted = await request.get(`/api/models/${candidate}`, { headers });
  expect((await adopted.json()).function_dependencies[functionId].revision).toBe(2);
  for (const [id, expected] of [[candidate, 20], [b, 10]] as const) {
    const result = await request.post(`/api/models/${id}/invoke`, { headers, data: { parameters: { horizon: 1 }, options: { mode: 'sync', explain: false } } });
    expect(result.ok(), await result.text()).toBeTruthy();
    expect((await result.json()).objective_value).toBe(expected);
  }
  const formal = await request.post('/api/tasks', { headers, data: { model_code: aCode, parameters: { horizon: 1 }, async_run: false } });
  expect(formal.ok(), await formal.text()).toBeTruthy();
  expect((await formal.json()).resolved_model_id).toBe(candidate);
  await page.screenshot({ path: info.outputPath('function-update-applied.png'), fullPage: true });
});
