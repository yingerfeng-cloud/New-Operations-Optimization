import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('formula management supports search copy disable ordering diff and bulk authoritative compile', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create?mode=template&template=economic_dispatch');
  await expect(page.getByText('从模板创建模型').first()).toBeVisible();
  await page.getByRole('button', { name: /数学展开/ }).click();
  await expect(page.getByText('公式管理工作台')).toBeVisible();

  await page.getByLabel('搜索公式').fill('load');
  await expect(page.getByText('平衡约束').first()).toBeVisible();
  await page.getByRole('button', { name: /复\s*制/ }).click();
  await expect(page.getByText('平衡约束（副本）').first()).toBeVisible();

  await page.getByRole('button', { name: /停\s*用/ }).first().click();
  await expect(page.getByText('disabled').first()).toBeVisible();
  await page.getByRole('button', { name: /下\s*移/ }).first().click();
  await page.getByRole('button', { name: /差\s*异/ }).first().click();
  await expect(page.getByRole('dialog', { name: '公式版本差异' })).toBeVisible();
  await page.getByRole('dialog', { name: '公式版本差异' }).getByRole('button', { name: /关\s*闭/ }).click();

  const compileResponse = page.waitForResponse(response => response.url().endsWith('/api/formulas/expand'));
  await page.getByRole('button', { name: /批量权威编译/ }).click();
  expect((await compileResponse).ok()).toBeTruthy();
  await expect(page.getByText('compile_valid').first()).toBeVisible();
  await expect(page.getByText('依赖分析')).toBeVisible();
});
