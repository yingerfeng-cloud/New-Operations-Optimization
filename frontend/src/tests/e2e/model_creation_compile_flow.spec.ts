import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('model creation exposes semantic, formula and publish workflow', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create');

  await expect(page.getByText('新建模型').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /模型语义/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /数学展开/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /运行参数/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /校验发布/ })).toBeVisible();
});
