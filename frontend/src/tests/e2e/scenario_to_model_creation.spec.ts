import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('scenario library opens a new version of the published model with complete content', async ({ page }) => {
  await mockApi(page);
  await page.goto('/scenarios');

  const card = page.getByTestId('scenario-card-cascade_hydro_day_ahead');
  await expect(card).toBeVisible();
  await card.locator('.scenario-model-action button').click();

  await expect(page).toHaveURL(/\/models\/create\?mode=version&source=m2$/);
  await expect(page.getByRole('heading', { name: '创建新版本并修改' })).toBeVisible();
  await page.getByRole('button', { name: /1 基础信息/ }).click();
  await expect(page.locator('[data-field-code="name"] input')).toHaveValue('梯级水电模型');
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.getByTestId('builder-mode-select')).toContainText('组件化 Builder');
  await page.getByRole('button', { name: /模型语义/ }).click();
  await expect(page.getByText('hydro_reservoir_balance').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑 负荷', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑 出力', exact: true })).toBeVisible();
});

test('scenario library can create a blank model with the selected scenario', async ({ page }) => {
  await mockApi(page);
  await page.goto('/scenarios');
  const card = page.getByTestId('scenario-card-cascade_hydro_day_ahead');
  await card.getByRole('button', { name: '创建空白模型' }).click();
  await expect(page).toHaveURL(/\/models\/create\?mode=new&scenario=cascade_hydro_day_ahead$/);
  await expect(page.getByRole('heading', { name: '新建模型' })).toBeVisible();
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.locator('[data-field-code="name"] input')).toHaveValue('');
});

test('explicit backend template mode still loads the complete template', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create?mode=template&template=cascade_hydro_dispatch');
  await expect(page.getByRole('heading', { name: '从模板创建模型' })).toBeVisible();
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.getByTestId('builder-mode-select')).toContainText('组件化 Builder');
  await page.getByRole('button', { name: /模型语义/ }).click();
  await expect(page.getByText('hydro_reservoir_balance').first()).toBeVisible();
});
