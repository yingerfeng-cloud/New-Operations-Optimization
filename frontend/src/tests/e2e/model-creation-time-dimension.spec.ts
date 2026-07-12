import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('model time-dimension contract flows from creation to task horizon selector', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create');

  await page.getByRole('button', { name: /模型语义/ }).click();
  await expect(page.getByText('时间维度配置')).toBeVisible();
  await page.getByRole('switch', { name: '是否启用时间维度' }).click();
  await page.getByText('候选时段切换', { exact: true }).click();
  await expect(page.locator('.ant-table-tbody tr')).toHaveCount(3);
  await expect(page.locator('.ant-table-tbody input[value="24"]')).toBeVisible();
  await expect(page.locator('.ant-table-tbody input[value="48"]')).toBeVisible();
  await expect(page.locator('.ant-table-tbody input[value="96"]')).toBeVisible();

  const saveRequestPromise = page.waitForRequest(request => request.url().endsWith('/api/models') && request.method() === 'POST');
  await page.getByRole('button', { name: '保存草稿' }).first().click();
  const saveRequest = await saveRequestPromise;
  const savePayload = saveRequest.postDataJSON();
  expect(savePayload.ui_metadata.time_dimension).toMatchObject({ policy: 'runtime_variable', default_horizon: 96, allowed_horizons: [24, 48, 96] });
  expect(savePayload.model_draft.time_dimension).toEqual(savePayload.ui_metadata.time_dimension);
  expect(savePayload.component_spec.ui_metadata.time_dimension).toEqual(savePayload.ui_metadata.time_dimension);

  await page.reload();
  await page.getByRole('button', { name: /模型语义/ }).click();
  await expect(page.getByText('候选时段切换', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-table-tbody tr')).toHaveCount(3);

  // Task payload and all four runtime horizon policies are covered by
  // TaskCreateContracts.test.ts against the extracted shared contract module.
});
