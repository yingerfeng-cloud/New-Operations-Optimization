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

  await page.goto('/tasks');
  await page.getByRole('button', { name: '创建任务' }).click();
  await page.getByLabel('选择模型').click();
  await page.getByText('日前机组组合优化模型', { exact: true }).last().click();
  const horizon = page.getByLabel('调度时段');
  await expect(horizon).toBeVisible();
  await horizon.click();
  await page.getByText('48点 / 半小时级', { exact: true }).click();

  const taskRequestPromise = page.waitForRequest(request => request.url().endsWith('/api/tasks') && request.method() === 'POST');
  await page.getByRole('button', { name: '提交求解并打开详情' }).click();
  const taskPayload = (await taskRequestPromise).postDataJSON();
  expect(taskPayload.horizon).toBe(48);
  expect(taskPayload.runtime_parameters.horizon).toBe(48);
});
