import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, mode = 'clone', source = 'MODEL-POWER-ECONOMIC-DISPATCH') {
  await page.goto(`/models/create?mode=${mode}&source=${source}`);
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await page.locator('[data-field-code="name"] input').fill(`合成版本验收 ${Date.now()}`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/models\/MODEL-[^/]+\/edit$/);
  return new URL(page.url()).pathname.split('/')[2];
}

async function testAndPublish(page: Page, id: string) {
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  const submitted = page.waitForResponse(response => response.url().endsWith(`/api/models/${id}/test-jobs`) && response.request().method() === 'POST');
  await page.getByTestId('model-test-run-button').click();
  const accepted = await submitted;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const task = await accepted.json();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发布模型', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/models/${id}$`));
  return task;
}

test('cloud review: builtin derived version and v0.2 keep identity through UI test and publish', async ({ page, request }, info) => {
  const builtinDerived = await prepare(page, 'version');
  await testAndPublish(page, builtinDerived);
  const derived = await (await request.get(`/api/models/${builtinDerived}`)).json();
  expect(derived.ui_metadata.managed_default_template).not.toBe(true);
  const clone = await prepare(page);
  await testAndPublish(page, clone);
  expect((await (await request.get(`/api/models/${clone}`)).json()).version).toBe('v0.1');
  const next = await prepare(page, 'version', clone);
  expect((await (await request.get(`/api/models/${next}`)).json()).version).toBe('v0.2');
  const task = await testAndPublish(page, next);
  const published = await (await request.get(`/api/models/${next}`)).json();
  expect(published.version).toBe('v0.2');
  const result = await (await request.get(`/api/tasks/${task.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(160300, 6);
  await info.attach('synthetic-version-identities', { body: JSON.stringify({ builtinDerived, clone, next, version: published.version }), contentType: 'application/json' });
});

test('cloud review: editor recovers a genuinely lost test response with the same task and attempt', async ({ page, request }, info) => {
  const id = await prepare(page);
  let captured: Record<string, any> | undefined;
  let posts = 0;
  await page.route(`**/api/models/${id}/test-jobs`, async route => {
    posts += 1;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    captured = await response.json();
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: /5 校验发布/ }).click();
  await page.getByTestId('model-test-run-button').click();
  await expect.poll(() => captured?.id).toBeTruthy();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${captured!.id}`)).json()).status).toBe('SUCCESS');
  const before = await (await request.get(`/api/tasks/${captured!.id}`)).json();
  await page.reload();
  await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
  const after = await (await request.get(`/api/tasks/${captured!.id}`)).json();
  expect(posts).toBe(1);
  expect(after.id).toBe(before.id);
  expect(after.attempt_id).toBe(before.attempt_id);
  expect((await (await request.get(`/api/tasks/${after.id}/result`)).json()).objective_value).toBeCloseTo(160300, 6);
  await info.attach('lost-response-recovery', { body: JSON.stringify({ model_id: id, task_id: after.id, attempt_id: after.attempt_id, posts }), contentType: 'application/json' });
});

test('cloud review: stale second editor keeps its input and cannot overwrite the first name', async ({ page, context, request }) => {
  const id = await prepare(page);
  const second = await context.newPage();
  await second.goto(`/models/${id}/edit`);
  await second.getByRole('button', { name: /1 基础信息/ }).click();
  await expect(second.locator('[data-field-code="name"] input')).toBeVisible();
  const name = `A 已保存 ${Date.now()}`;
  await page.locator('[data-field-code="name"] input').fill(name);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/models/${id}`)).json()).name).toBe(name);
  await second.locator('[data-field-code="name"] input').fill('B 保留的陈旧输入');
  const failed = second.waitForResponse(response => response.url().endsWith(`/api/models/${id}`) && response.request().method() === 'PUT');
  await second.getByRole('button', { name: '保存草稿', exact: true }).click();
  expect((await failed).status()).toBe(409);
  await expect(second.locator('[data-field-code="name"] input')).toHaveValue('B 保留的陈旧输入');
  expect((await (await request.get(`/api/models/${id}`)).json()).name).toBe(name);
});
