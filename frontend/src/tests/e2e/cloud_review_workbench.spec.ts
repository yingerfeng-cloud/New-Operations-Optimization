/// <reference types="node" />
import { expect, test, type Page } from '@playwright/test';

async function addSemantic(page: Page, kind: '集合' | '参数' | '变量', code: string, dimension = '', value?: unknown) {
  await page.getByRole('button', { name: `新增${kind}`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `新增${kind}`, exact: true });
  await drawer.getByLabel('编码', { exact: true }).fill(code);
  await drawer.getByLabel('名称', { exact: true }).fill(code);
  if (kind === '集合') await drawer.getByLabel('集合成员（JSON 数组）').fill(JSON.stringify(value));
  if (kind === '参数') {
    await drawer.getByLabel('维度', { exact: true }).fill(dimension);
    await drawer.getByLabel('默认值', { exact: true }).fill(JSON.stringify(value));
  }
  if (kind === '变量') await drawer.getByLabel('维度/索引').fill(dimension);
  await drawer.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(drawer).not.toBeVisible();
}

async function formula(page: Page, name: string, expression: string, objective = false) {
  await page.getByRole('button', { name: objective ? '新增目标函数' : '新增约束公式', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '公式编辑器', exact: true });
  await editor.getByLabel('公式名称', { exact: true }).fill(name);
  if (objective) await editor.getByLabel('最小化', { exact: true }).check();
  const code = editor.locator('.cm-content');
  await code.fill(expression);
  await editor.getByRole('button', { name: '后端编译与展开', exact: true }).click();
  await expect(editor.getByRole('button', { name: '应用公式', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '应用公式', exact: true }).click();
  await expect(editor).not.toBeVisible();
}

test('cloud review: blank two-dimensional transportation is authored, saved, tested and published through UI', async ({ page, request }, info) => {
  await page.goto('/models/create');
  await page.getByLabel('当前场景', { exact: true }).click();
  await page.locator('.ant-select-item-option-content').first().click();
  await page.locator('[data-field-code="name"] input').fill(`合成运输验收 ${Date.now()}`);
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await addSemantic(page, '集合', 'origin', '', ['A', 'B']);
  await addSemantic(page, '集合', 'destination', '', ['X', 'Y']);
  await addSemantic(page, '参数', 'supply', 'origin', { A: 2, B: 1 });
  await addSemantic(page, '参数', 'demand', 'destination', { X: 1, Y: 2 });
  await addSemantic(page, '参数', 'cost', 'origin,destination', { A: { X: 1, Y: 5 }, B: { X: 4, Y: 1 } });
  await addSemantic(page, '变量', 'shipment', 'origin,destination');
  await page.getByRole('button', { name: /3 数学展开/ }).click();
  for (const [name, expression] of [
    ['supply_A', 'shipment["A","X"] + shipment["A","Y"] == supply["A"]'],
    ['supply_B', 'shipment["B","X"] + shipment["B","Y"] == supply["B"]'],
    ['demand_X', 'shipment["A","X"] + shipment["B","X"] == demand["X"]'],
    ['demand_Y', 'shipment["A","Y"] + shipment["B","Y"] == demand["Y"]'],
  ]) await formula(page, name, expression);
  await formula(page, 'transport_cost', 'sum(cost[i,j] * shipment[i,j] for i in origin for j in destination)', true);
  await page.getByRole('button', { name: '编译模型（后端权威）', exact: true }).click();
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/MODEL-[^/]+\/edit$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  await page.reload();
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const submission = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const accepted = await submission;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const task = await accepted.json();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
  const resultResponse = await request.get(`/api/tasks/${task.id}/result`);
  expect(resultResponse.ok(), await resultResponse.text()).toBeTruthy();
  const result = await resultResponse.json();
  expect(result.objective_value).toBeCloseTo(7, 6);
  const values = result.variable_values.shipment;
  expect(values['A,X']).toBeCloseTo(1, 6);
  expect(values['A,Y']).toBeCloseTo(1, 6);
  expect(values['B,X']).toBeCloseTo(0, 6);
  expect(values['B,Y']).toBeCloseTo(1, 6);
  // Feasible primal has cost 7. Dual u=(0,-4), v=(1,5) has
  // value 2*0 + 1*(-4) + 1*1 + 2*5 = 7, proving optimality.
  expect(2 * 0 + (-4) + 1 + 2 * 5).toBe(7);
  await info.attach('synthetic-known-answer', { body: JSON.stringify({ model_id: id, task_id: task.id, objective: result.objective_value, variables: values, dual: { u: [0, -4], v: [1, 5], value: 7 } }), contentType: 'application/json' });
});

test('cloud review: explicit generic clone executes its new twelve-variable model and retains renamed set members', async ({ page, request }, info) => {
  await page.goto('/models/create?mode=clone&source=MODEL-POWER-ECONOMIC-DISPATCH');
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await page.locator('[data-field-code="name"] input').fill(`合成 generic 独立答案 ${Date.now()}`);
  await page.getByLabel('建模模式', { exact: true }).click();
  await page.locator('.ant-select-item-option-content').getByText('通用线性 Builder', { exact: true }).click();
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await page.getByText('固定时段', { exact: true }).click();
  await page.getByRole('button', { name: '编辑 机组集合', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑集合', exact: true });
  expect(JSON.parse(await drawer.getByLabel('集合成员（JSON 数组）').inputValue())).toEqual(['U1', 'U2', 'U3']);
  await drawer.getByLabel('名称', { exact: true }).fill('改名后仍保留三台机组');
  await drawer.getByRole('button', { name: /^保\s*存$/ }).click();
  await page.getByRole('button', { name: /3 数学展开/ }).click();
  while (await page.getByRole('button', { name: /^停\s*用$/ }).count()) await page.getByRole('button', { name: /^停\s*用$/ }).first().click();
  await formula(page, 'unit_minimum', 'unit_output[unit,time] >= 1');
  await formula(page, 'new_generic_sum', 'sum(unit_output[u,t] for u in unit for t in time)', true);
  await page.getByRole('button', { name: '编译模型（后端权威）', exact: true }).click();
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/MODEL-[^/]+\/edit$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  await page.reload();
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const submitted = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
  const model = await (await request.get(`/api/models/${id}`)).json();
  expect(model.semantic_spec.sets.find((row: Record<string, any>) => row.code === 'unit').values).toEqual(['U1', 'U2', 'U3']);
  const result = await (await request.get(`/api/tasks/${task.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(12, 6);
  expect(Object.values(result.variable_values.unit_output)).toHaveLength(12);
  for (const value of Object.values(result.variable_values.unit_output)) expect(value).toBeCloseTo(1, 6);
  await info.attach('generic-known-answer', { body: JSON.stringify({ model_id: id, task_id: task.id, objective: 12, source: '3 units × 4 time steps, each >= 1' }), contentType: 'application/json' });
});

test('cloud review: McCormick component expressions and bounds are configured and retained through the normal UI', async ({ page, request }) => {
  const code = `synthetic_mccormick_ui_${Date.now()}`;
  const variables = ['flow', 'head', 'product'].map(name => ({ name, indices: ['time'], lower_bound: 0, upper_bound: 1 }));
  const spec = { model_code: code, build_mode: 'component_based', sets: [{ code: 'time', values: [0] }], variables, components: [],
    objective: { sense: 'minimize', terms: [{ term_id: 'min_product', expression: 'sum(product[t] for t in time)', weight: 1, supported_by_backend: true, solve_participation: 'solve_active' }] } };
  // Existing bounded business model is the fixture; the component and all its
  // expressions/bounds below must be added through UI, never by an API patch.
  const created = await request.post('/api/models', { data: { name: code, scene: 'synthetic', build_mode: 'component_based', problem_type: 'LP',
    parameters: { horizon: 1 }, component_spec: spec,
    semantic_spec: { ...spec, parameters: [], variables: variables.map(row => ({ code: row.name, dimension: row.indices, lower_bound: 0, upper_bound: 1 })) } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).id;
  await page.goto(`/models/${id}/edit`);
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await page.getByRole('button', { name: /从组件库选择/ }).click();
  const picker = page.getByRole('dialog', { name: '从组件库选择', exact: true });
  await picker.getByPlaceholder('搜索组件名称、编码、领域或分类').fill('mccormick');
  await picker.getByRole('row').filter({ hasText: 'mccormick_bilinear_relaxation_component' }).getByRole('checkbox').check();
  await picker.getByRole('button', { name: '应用选择', exact: true }).click();
  for (const [axis, expression] of [['x', 'flow[t]'], ['y', 'head[t]'], ['w', 'product[t]']]) await page.getByLabel(`McCormick ${axis} 表达式`, { exact: true }).fill(expression);
  await page.getByLabel('McCormick 索引集合', { exact: true }).fill('time');
  await page.getByRole('button', { name: '使用变量边界', exact: true }).click();
  await expect(page.getByLabel('McCormick x_lower', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('McCormick y_upper', { exact: true })).toHaveValue('1');
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const saveResponse = await saved; expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();
  await expect(page.getByText(/待自动保存|保存中/)).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await expect(page.getByLabel('McCormick w 表达式', { exact: true })).toHaveValue('product[t]');
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  for (const risk of await page.getByRole('checkbox').all()) await risk.check();
  const submitted = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
  const result = await (await request.get(`/api/tasks/${task.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(0, 6);
  const v = result.variable_values;
  const x = Object.values(v.flow)[0] as number, y = Object.values(v.head)[0] as number, w = Object.values(v.product)[0] as number;
  // Four independently stated convex-envelope inequalities over [0,1]^2.
  expect(w).toBeGreaterThanOrEqual(-1e-6); expect(w).toBeGreaterThanOrEqual(x + y - 1 - 1e-6);
  expect(w).toBeLessThanOrEqual(x + 1e-6); expect(w).toBeLessThanOrEqual(y + 1e-6);
});

test('cloud review: invalid numeric CSV is blocked in the wizard and corrected input reaches the solver', async ({ page, request }) => {
  const models = await (await request.get('/api/models')).json();
  const published = models.find((model: Record<string, any>) => model.model_family_id === 'builtin:economic_dispatch' && model.is_active_version && model.status === 'published');
  expect(published).toBeTruthy();
  await page.goto(`/tasks?create=1&model=${published.id}`);
  const wizard = page.getByRole('dialog', { name: '创建求解任务', exact: true });
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await wizard.getByRole('button', { name: /^时间序列/ }).click();
  const field = page.locator('#runtime-field-load_forecast');
  await field.locator('input[type="file"]').setInputFiles({ name: 'synthetic-invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('160\nnot-a-number\n175\n150') });
  await expect(field).toContainText('load_forecast[1]');
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(field).toBeVisible();
  await expect(wizard.getByRole('button', { name: '提交求解并打开详情', exact: true })).not.toBeVisible();
  await field.locator('input[type="file"]').setInputFiles({ name: 'synthetic-corrected.csv', mimeType: 'text/csv', buffer: Buffer.from('160\n190\n175\n150') });
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  const submitted = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
  await wizard.getByRole('button', { name: '提交求解并打开详情', exact: true }).click();
  const response = await submitted; expect(response.ok(), await response.text()).toBeTruthy();
  const task = await response.json();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('SUCCESS');
  const result = await (await request.get(`/api/tasks/${task.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(160300, 6);
  await page.goto(`/tasks?task=${task.id}`);
  await page.getByRole('tab', { name: '输入参数', exact: true }).click();
  await expect(page.getByText('load_forecast', { exact: true }).first()).toBeVisible();
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).runtime_parameters.load_forecast).toEqual([160, 190, 175, 150]);
});

test('cloud review: unbounded generic model retains its solver diagnosis and a finite bound repairs the model', async ({ page, request }, info) => {
  await page.goto('/models/create');
  await page.getByLabel('当前场景', { exact: true }).click();
  await page.locator('.ant-select-item-option-content').first().click();
  await page.locator('[data-field-code="name"] input').fill(`合成无界诊断 ${Date.now()}`);
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await addSemantic(page, '集合', 'product', '', ['P']);
  await addSemantic(page, '变量', 'production', 'product');
  await page.getByRole('button', { name: /3 数学展开/ }).click();
  await formula(page, 'nonnegative', 'production[product] >= 0');
  await formula(page, 'negative_production', '-sum(production[p] for p in product)', true);
  await page.getByRole('button', { name: '编译模型（后端权威）', exact: true }).click();
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/MODEL-[^/]+\/edit$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const failedSubmission = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const accepted = await failedSubmission; expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const failed = await accepted.json();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${failed.id}`)).json()).status).toBe('FAILED');
  const diagnosis = await (await request.get(`/api/tasks/${failed.id}/result`)).json();
  expect(diagnosis.termination_condition.toLowerCase()).toContain('unbounded');
  expect(diagnosis.business_explanation.summary).toContain('无界');
  expect(diagnosis.business_explanation.summary).not.toContain('构建失败');
  expect(diagnosis.variable_values || {}).toEqual({});
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /2 模型语义/ }).click();
  await page.getByRole('button', { name: '编辑 production', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑变量', exact: true });
  await editor.getByLabel('上界', { exact: true }).fill('10');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  await page.getByRole('button', { name: /3 数学展开/ }).click();
  await page.getByRole('button', { name: '编译模型（后端权威）', exact: true }).click();
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const repairedSubmission = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const repairedResponse = await repairedSubmission; expect(repairedResponse.ok(), await repairedResponse.text()).toBeTruthy();
  const repaired = await repairedResponse.json();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  const result = await (await request.get(`/api/tasks/${repaired.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(-10, 6);
  expect(Object.values(result.variable_values.production)[0]).toBeCloseTo(10, 6);
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
  await info.attach('unbounded-then-bounded', { body: JSON.stringify({ model_id: id, unbounded_task: failed.id, repaired_task: repaired.id, optimum: -10 }), contentType: 'application/json' });
});
