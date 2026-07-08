import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('model creation workbench shows progress and publish step', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create');

  await expect(page.locator('.model-progress-card')).toBeVisible();
  await expect(page.getByText('五步建模流程', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /校验发布/ })).toBeVisible();
});
