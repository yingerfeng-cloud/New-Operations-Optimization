import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('model creation workbench shows progress and publish step', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create');

  await expect(page.locator('.model-progress-card')).toBeVisible();
  await expect(page.getByText('五步建模流程', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /校验发布/ })).toBeVisible();
  await page.getByRole('button', { name: '模型检查' }).click();
  await expect(page.getByRole('heading', { name: '模型摘要' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '发布条件' })).toBeVisible();
  await page.getByRole('dialog', { name: '模型检查' }).getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('navigation', { name: '步骤内章节导航' })).toBeVisible();
});
