import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('browser acceptance covers scenario, model, component, task and result entry points', async ({ page }) => {
  await mockApi(page);

  await page.goto('/scenarios');
  const scenarioCard = page.getByTestId('scenario-card-cascade_hydro_day_ahead');
  await expect(scenarioCard).toBeVisible();
  await scenarioCard.locator('.scenario-model-action button').click();
  await expect(page).toHaveURL(/\/models\/create/);
  await expect(page.getByText('从模板创建模型').first()).toBeVisible();

  await page.goto('/models');
  await expect(page.getByRole('heading', { name: '模型资产中心' })).toBeVisible();

  await page.goto('/components');
  await expect(page.getByText('功率平衡')).toBeVisible();

  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '任务调度中心' })).toBeVisible();

  await page.goto('/results');
  await expect(page.getByRole('heading', { name: '结果报告库' })).toBeVisible();
});
