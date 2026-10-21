import { expect, test, type APIRequestContext } from '@playwright/test';

async function post(request: APIRequestContext, url: string, data?: unknown) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('iteration: selective component update survives lost response, refresh and newer revision', async ({ page, request }) => {
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
});
