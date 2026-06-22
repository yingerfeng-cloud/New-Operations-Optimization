import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';

test('component management exposes lifecycle actions', async ({ page }) => {
  await mockApi(page);
  await page.goto('/components');
  await expect(page.getByText('功率平衡')).toBeVisible();
  await expect(page.getByRole('button', { name: '校验', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发布', exact: true })).toBeVisible();
});
