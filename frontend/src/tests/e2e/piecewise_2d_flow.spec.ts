import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('piecewise 2D flow exposes function asset and Step5 diagnostics entry', async ({ page }) => {
  await mockApi(page);

  await page.goto('/functions');
  await expect(page.getByRole('heading', { name: '函数/曲线资产中心' })).toBeVisible();
  await expect(page.getByText(/一维曲线|二维曲面/).first()).toBeVisible();

  await page.goto('/models/create');
  await expect(page.getByRole('button', { name: /校验发布/ })).toBeVisible();
});
