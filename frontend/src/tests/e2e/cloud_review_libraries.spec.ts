import { expect, test } from '@playwright/test';

test('cloud review: published component rename keeps unvisited formulas and repeated copies have distinct IDs', async ({ page, request }) => {
  const catalog = await (await request.get('/api/components/catalog')).json();
  const source = catalog.find((row: Record<string, any>) => row.status === 'published' && (row.generated_constraints || []).length === 3)
    || catalog.find((row: Record<string, any>) => row.status === 'published' && (row.generated_constraints || []).length > 1);
  expect(source).toBeTruthy();
  const original = source.generated_constraints.map((row: Record<string, any>) => row.expression);
  const copies: string[] = [];
  for (const visitSections of [false, true]) {
    await page.goto(`/components/${source.component_id}`);
    await page.getByRole('button', { name: '复制为新草稿', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '组件编辑器', exact: true });
    await editor.getByLabel('展示名称', { exact: true }).fill(`合成组件改名 ${Date.now()}`);
    if (visitSections) {
      for (const title of ['集合配置', '参数接口', '变量配置', '约束公式', '目标项', '依赖关系', '基础信息']) await editor.getByRole('button', { name: title, exact: true }).click();
    }
    const saved = page.waitForResponse(response => /\/api\/components\/[^/]+$/.test(response.url()) && response.request().method() === 'PUT');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBeTruthy();
    const copy = await response.json();
    copies.push(copy.component_id);
    expect(copy.generated_constraints.map((row: Record<string, any>) => row.expression)).toEqual(original);
    const published = page.waitForResponse(response => response.url().endsWith('/publish') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '发布组件', exact: true }).click();
    const release = await published;
    expect(release.ok(), await release.text()).toBeTruthy();
    await page.goto(`/components/${copy.component_id}`);
    const reopened = await (await request.get(`/api/components/${copy.component_id}`)).json();
    expect(reopened.generated_constraints.map((row: Record<string, any>) => row.expression)).toEqual(original);
  }
  expect(new Set(copies).size).toBe(2);
  expect((await (await request.get(`/api/components/${source.component_id}`)).json()).generated_constraints.map((row: Record<string, any>) => row.expression)).toEqual(original);
});

test('cloud review: curve conflict preserves the stale edit and requires an explicit new baseline', async ({ page, context, request }) => {
  const id = `cloud_curve_${Date.now()}`;
  expect((await request.post('/api/function-assets', { data: { function_id: id, name: id, points: [[0, 0], [10, 10]], solve_strategy: 'segment_binary', status: 'published' } })).ok()).toBeTruthy();
  const second = await context.newPage();
  for (const editorPage of [page, second]) {
    await editorPage.goto('/functions');
    const row = editorPage.getByRole('row').filter({ hasText: id });
    await row.getByRole('button', { name: /^编\s*辑$/ }).click();
    await editorPage.getByText('高级 JSON 调试', { exact: true }).click();
  }
  const a = page.getByRole('dialog', { name: '编辑函数资产', exact: true });
  await a.getByLabel('点 JSON', { exact: true }).fill('[[0,0],[10,20]]');
  await a.getByLabel('资产名称', { exact: true }).click();
  await a.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(a).not.toBeVisible();
  const b = second.getByRole('dialog', { name: '编辑函数资产', exact: true });
  await b.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(second.getByText('保存冲突：函数库已更新到 r2', { exact: true })).toBeVisible();
  expect(JSON.parse(await b.getByLabel('点 JSON', { exact: true }).inputValue())).toEqual([[0, 0], [10, 10]]);
  expect((await (await request.get(`/api/function-assets/${id}`)).json()).points).toEqual([[0, 0], [10, 20]]);
  await b.getByText('比较本机编辑与最新修订', { exact: true }).click();
  await b.getByRole('button', { name: '保留当前编辑，采用最新保存基线', exact: true }).click();
  await b.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(b).not.toBeVisible();
  const current = await (await request.get(`/api/function-assets/${id}`)).json();
  expect(current.revision).toBe(3);
  expect(current.points).toEqual([[0, 0], [10, 10]]);
  expect((await (await request.get(`/api/function-assets/${id}/versions/2`)).json()).points).toEqual([[0, 0], [10, 20]]);
});

test('cloud review: Skill example fill includes all required business series', async ({ page }) => {
  await page.goto('/skills');
  const row = page.getByRole('row').filter({ hasText: 'run_unit_commitment_day_ahead' });
  await row.getByRole('button', { name: /测试/ }).click();
  const dialog = page.getByRole('dialog', { name: /在线测试：run_unit_commitment_day_ahead/ });
  await dialog.getByRole('button', { name: '填充示例参数', exact: true }).click();
  const input = JSON.parse(await dialog.locator('textarea').inputValue());
  expect(input.load_forecast).toEqual([120, 180, 210, 160]);
  expect(input.renewable_forecast).toEqual([20, 30, 40, 20]);
  expect(input.delta_t).toBeUndefined(); // Platform derives the selected contract's duration.
});
