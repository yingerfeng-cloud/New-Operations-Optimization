import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('scenario library opens explicit backend template mode with complete content', async ({ page }) => {
  await mockApi(page);
  await page.goto('/scenarios');

  const card = page.getByTestId('scenario-card-cascade_hydro_day_ahead');
  await expect(card).toBeVisible();
  await page.getByTestId('scenario-enter-cascade_hydro_day_ahead').click();

  await expect(page).toHaveURL(/\/models\/create\?mode=template&template=cascade_hydro_dispatch/);
  await expect(page.getByText('从模板创建模型', { exact: true })).toBeVisible();
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.getByTestId('builder-mode-select')).toContainText('组件化 Builder');
  await page.getByRole('button', { name: /模型语义/ }).click();
  await expect(page.getByText('hydro_reservoir_balance').first()).toBeVisible();
});
