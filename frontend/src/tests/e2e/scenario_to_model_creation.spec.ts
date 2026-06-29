import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('scenario library opens model creation with selected cascade hydro context', async ({ page }) => {
  await mockApi(page);
  await page.goto('/scenarios');

  const card = page.getByTestId('scenario-card-cascade_hydro_day_ahead');
  await expect(card).toBeVisible();
  await page.getByTestId('scenario-enter-cascade_hydro_day_ahead').click();

  await expect(page).toHaveURL(/\/models\/create\?scenarioId=cascade_hydro_day_ahead&modelId=cascade_hydro_dispatch_lp/);
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.getByTestId('model-select')).toContainText('梯级水电日前调度模型');
  await expect(page.getByText('组件化 / 梯级水电调度')).toBeVisible();
  await expect(page.getByText('MILP / 机组组合')).toHaveCount(0);
});
