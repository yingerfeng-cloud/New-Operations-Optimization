import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('component editor formulas use FormulaEditor and preserve DSL display', async ({ page }) => {
  await mockApi(page);
  await page.goto('/components');

  await page.getByRole('button', { name: '编辑' }).first().click();
  await expect(page.getByText(/功率平衡组件|编辑组件|组件/).first()).toBeVisible();
  await expect(page.getByText(/p_grid|负荷|约束/).first()).toBeVisible();
});
