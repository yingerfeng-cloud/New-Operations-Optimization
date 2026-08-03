import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('component builder can be selected', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create?scenarioId=cascade_hydro_day_ahead&modelId=cascade_hydro_dispatch_lp');

  const builderMode = page.getByTestId('builder-mode-select');
  await expect(builderMode).toContainText('Builder');
  await expect(page.locator('[data-section-key="mode"]')).toBeVisible();
});
