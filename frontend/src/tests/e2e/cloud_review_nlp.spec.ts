import { expect, test, type Page } from '@playwright/test';
declare const process: { env: Record<string, string | undefined> };
const origin = process.env.OPTIFORGE_NLP_URL || 'http://127.0.0.1:18031';
const parameters = { k: 2, flow_min: 1, flow_max: 5, head_min: 1, head_max: 10, power_max: 25 };

async function settings(page: Page, time = '20', flow = 2.5) {
  const heading = page.getByText('求解运行设置', { exact: true });
  if (!(await page.getByLabel('求解时限（秒）').isVisible())) await heading.click();
  await page.getByLabel('求解时限（秒）').fill(time);
  await page.getByLabel('最大迭代', { exact: true }).fill('500');
  await page.getByLabel('NLP 容差', { exact: true }).fill('0.0000001');
  await page.getByLabel('变量初值（JSON）').fill(JSON.stringify({ flow, head: 5 }));
  await page.getByLabel('最大迭代', { exact: true }).click();
}

test('cloud review: NLP clone runs with UI settings, publishes and calls the actual Ipopt service', async ({ page, request }, info) => {
  await page.goto(`${origin}/models/create?mode=clone&source=MODEL-POWER-NONLINEAR-HYDRO-POWER-DEMO`);
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await page.locator('[data-field-code="name"] input').fill(`合成 NLP UI 验收 ${Date.now()}`);
  await page.getByRole('button', { name: /4 运行参数/ }).click();
  await page.getByText('高级调试：JSON 导入 / 运行参数结构预览', { exact: true }).click();
  await page.getByLabel('运行参数 JSON', { exact: true }).fill(JSON.stringify(parameters));
  await page.getByRole('button', { name: '导入并校验', exact: true }).click();
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  await settings(page);
  const risk = page.getByRole('checkbox');
  if (await risk.count()) await risk.first().check();
  const submitted = page.waitForResponse(response => response.url().endsWith('/test-jobs') && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const accepted = await submitted;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const task = await accepted.json();
  expect(accepted.request().postDataJSON().solver_config.initial_values).toEqual({ flow: 2.5, head: 5 });
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${task.model_id}$`));
  const published = await (await request.get(`${origin}/api/models/${task.model_id}`)).json();
  expect(published.solver).toBe('Ipopt');
  expect(published.model_problem_type).toBe('NLP');
  const original = await (await request.get(`${origin}/api/tasks/${task.id}/result`)).json();
  expect(original.objective_value).toBeCloseTo(75, 3);
  await page.goto(`${origin}/model-services`);
  const service = page.locator('.service-list-item').filter({ hasText: task.model_id });
  await service.click();
  await page.getByRole('tab', { name: '在线调试', exact: true }).click();
  await page.getByLabel('运行参数 JSON', { exact: true }).fill(JSON.stringify(parameters));
  await settings(page);
  const posted = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '发起测试调用', exact: true }).click();
  const response = await posted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const called = await response.json();
  await expect.poll(async () => (await (await request.get(`${origin}/api/tasks/${called.id}`)).json()).status, { timeout: 60_000 }).toBe('SUCCESS');
  const result = await (await request.get(`${origin}/api/tasks/${called.id}/result`)).json();
  expect(result.solver_name).toBe('Ipopt');
  expect(result.objective_value).toBeCloseTo(75, 3);
  for (let t = 0; t < 3; t += 1) {
    const q = result.variable_values.flow[`flow[${t}]`], h = result.variable_values.head[`head[${t}]`], p = result.variable_values.power[`power[${t}]`];
    expect(Math.abs(p - 2 * q * h)).toBeLessThan(.001);
    expect(p).toBeLessThanOrEqual(25.001);
  }
  async function callThroughUI(input: Record<string, number>, time: string, status: string) {
    await page.getByRole('button', { name: '新建测试调用', exact: true }).click();
    await page.getByLabel('运行参数 JSON', { exact: true }).fill(JSON.stringify(input));
    await settings(page, time);
    const posted = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '发起测试调用', exact: true }).click();
    const response = await posted; expect(response.ok(), await response.text()).toBeTruthy();
    const task = await response.json();
    await expect.poll(async () => (await (await request.get(`${origin}/api/tasks/${task.id}`)).json()).status, { timeout: 60_000 }).toBe(status);
    return task.id;
  }
  const zeroId = await callThroughUI({ ...parameters, k: 0 }, '20', 'SUCCESS');
  const zero = await (await request.get(`${origin}/api/tasks/${zeroId}/result`)).json();
  expect(zero.objective_value).toBeCloseTo(0, 6); expect(zero.solver_name).toBe('HiGHS');
  const timeoutId = await callThroughUI(parameters, '0.001', 'TIMEOUT');
  const recoveredId = await callThroughUI(parameters, '20', 'SUCCESS');
  expect((await (await request.get(`${origin}/api/tasks/${recoveredId}/result`)).json()).objective_value).toBeCloseTo(75, 3);
  expect(recoveredId).not.toBe(timeoutId);
  await info.attach('synthetic-NLP-UI-known-answer', { body: JSON.stringify({ model_id: task.model_id, editor_task: task.id, service_task: called.id, objective: result.objective_value, solver: result.solver_name }), contentType: 'application/json' });
});
