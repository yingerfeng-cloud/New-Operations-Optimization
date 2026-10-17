import { expect, test, type Page } from '@playwright/test';

const headers = { Authorization: 'Bearer synthetic-review-token' };

async function enter(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('dialog', { name: '请输入平台访问令牌' })).toBeVisible();
  await page.getByLabel('平台访问令牌', { exact: true }).fill('synthetic-review-token');
  await page.getByRole('button', { name: '连接平台', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '请输入平台访问令牌' })).not.toBeVisible();
}

test('@real review real browser protects a draft, retains it after save failure, then tests and publishes', async ({ page, request }, info) => {
  await enter(page, '/models/create?mode=clone&source=MODEL-POWER-ECONOMIC-DISPATCH');
  const name = `评审浏览器模型 ${Date.now()}`;
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  const nameInput = page.locator('[data-field-code="name"] input');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('navigation', { name: '平台功能' }).getByRole('button', { name: /求解任务/ }).click();
  await expect(page.getByRole('dialog', { name: '当前草稿尚未保存' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(nameInput).toHaveValue(name);

  await page.route('**/api/models', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"review unavailable"}' }) : route.continue());
  await page.getByRole('navigation', { name: '平台功能' }).getByRole('button', { name: /求解任务/ }).click();
  await page.getByRole('button', { name: '保存并离开', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('保存失败', { exact: true })).toBeVisible();
  await expect(nameInput).toHaveValue(name);
  await page.unroute('**/api/models');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();

  await page.getByRole('button', { name: '模型检查', exact: true }).click();
  await page.getByRole('dialog', { name: '模型检查', exact: true }).getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: /校验发布/ }).click();
  await expect(page.getByTestId('model-test-run-button')).toBeEnabled();
  const testedRequest = page.waitForResponse(response => response.url().includes('/test-jobs') && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const accepted = await testedRequest;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled({ timeout: 30_000 });
  const publishedRequest = page.waitForResponse(response => /\/api\/models\/[^/]+\/publish$/.test(response.url()));
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  const published = await publishedRequest;
  expect(published.ok(), await published.text()).toBeTruthy();
  const asset = await published.json();
  expect(asset.status).toBe('published');
  const stored = await request.get(`/api/models/${asset.id}`, { headers });
  expect((await stored.json()).name).toBe(name);
  await expect(page).toHaveURL(new RegExp(`/models/${asset.id}$`));
  await expect(page.getByRole('dialog', { name: new RegExp(name) })).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator(`tr[data-row-key="${asset.id}"]`)).toBeVisible();
  await expect(page.getByText('review unavailable', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('published-model.png'), fullPage: true });
});

test('@real review real browser follows a 35-second real-solver task across refresh and network recovery without duplicating it', async ({ page, request }, info) => {
  const code = `review_slow_${Date.now()}`;
  const name = `评审长任务 ${code}`;
  const created = await request.post('/api/models', { headers, data: {
    name, scene: '经济负荷分配', problem_type: 'LP',
    semantic_spec: { model_code: code, sets: [{ code: 'site', values: ['A'] }], parameters: [], variables: [{ code: 'dispatch', dimension: ['site'], domain: 'NonNegativeReals' }] },
    generic_spec: { sense: 'minimize', sets: { site: ['A'] }, parameters: {}, variables: [{ name: 'dispatch', indices: ['site'], lb: 7, ub: 7 }], objective: { sense: 'minimize', terms: [{ var: 'dispatch', key: ['site'], foreach: ['site'], coef: 1 }] } },
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const model = await created.json();
  const tested = await request.post(`/api/models/${model.id}/test`, { headers, data: { parameters: { review: 1 } } });
  expect(tested.ok(), await tested.text()).toBeTruthy();
  const published = await request.post(`/api/models/${model.id}/publish`, { headers });
  expect(published.ok(), await published.text()).toBeTruthy();
  await enter(page, '/services');
  await page.locator('.service-list-item').filter({ hasText: name }).click();
  await page.getByRole('tab', { name: '在线调试' }).click();
  const editor = page.getByLabel('运行参数 JSON');
  // Ant Design's exiting spinner can remain in the accessible name.
  const invoke = page.getByRole('button').filter({ hasText: /^发起测试调用$/ });
  await editor.fill('{bad json');
  await expect(invoke).not.toHaveClass(/ant-btn-loading/);
  await invoke.click();
  await expect(page.getByText(/运行参数 JSON 格式错误/).last()).toBeVisible();
  await editor.fill('{}');
  let submissions = 0;
  page.on('request', call => { if (call.method() === 'POST' && call.url().endsWith('/api/tasks')) submissions += 1; });
  const submission = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
  const started = Date.now();
  await expect(invoke).not.toHaveClass(/ant-btn-loading/);
  await invoke.click();
  const accepted = await submission;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  expect(accepted.request().postDataJSON().async_run).toBe(true);
  const task = await accepted.json();
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(page.getByText(new RegExp(`任务编号：${task.id}`))).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复任务', exact: true })).toBeDisabled();
  await page.reload();
  await page.locator('.service-list-item').filter({ hasText: name }).click();
  await page.getByRole('tab', { name: '在线调试' }).click();
  await expect(page.getByText(new RegExp(`任务编号：${task.id}`))).toBeVisible();
  await expect(page.getByText(new RegExp(`任务编号：${task.id}.*SOLVING`))).toBeVisible();
  await page.route(`**/api/tasks/${task.id}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"review network interruption"}' }));
  await expect(page.getByText('调试任务未能更新')).toBeVisible();
  await page.unroute(`**/api/tasks/${task.id}`);
  await page.getByRole('button', { name: '重试更新', exact: true }).click();
  await expect(page.getByText('调试任务未能更新')).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('long-task-tracking.png'), fullPage: true });
  await expect(page.getByText(new RegExp(`任务编号：${task.id}.*SUCCESS`))).toBeVisible({ timeout: 60_000 });
  expect(Date.now() - started).toBeGreaterThan(30_000);
  expect(submissions).toBe(1);
  const result = await request.get(`/api/tasks/${task.id}/result`, { headers });
  expect((await result.json()).objective_value).toBe(7);
  await page.getByRole('button', { name: '跳转结果中心', exact: true }).click();
  await expect(page.getByRole('dialog', { name: `结果报告 ${task.id}` })).toBeInViewport({ ratio: 0.99 });
  await page.screenshot({ path: info.outputPath('result-recovered.png'), fullPage: true });
});
