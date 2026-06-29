import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('component editor formulas use FormulaEditor and preserve DSL display', async ({ page }) => {
  await mockApi(page);
  await page.goto('/components');

  await page.getByRole('button', { name: '编辑' }).first().click();
  await page.getByRole('tab', { name: '约束公式' }).click();
  await expect(page.getByText('统一公式编辑器')).toBeVisible();

  await page.getByRole('button', { name: /电网功率 p_grid/ }).first().click();
  await page.getByRole('button', { name: '>=' }).first().click();
  await page.getByRole('button', { name: /负荷 load/ }).first().click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[time] >= load[time]');
  await page.getByRole('button', { name: '应用公式' }).click();
  await page.getByRole('button', { name: '保存组件' }).click();

  await page.getByRole('tab', { name: '数学定义' }).click();
  await expect(page.getByText(/电网功率/).first()).toBeVisible();
  await expect(page.getByText('原始 DSL').first()).toBeVisible();
  await page.getByText('原始 DSL').first().click();
  await expect(page.getByText(/p_grid/).first()).toBeVisible();
});
