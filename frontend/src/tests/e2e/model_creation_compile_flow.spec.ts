import { expect, test, type Locator } from '@playwright/test';
import { mockApi } from './fixtures';

async function fillInput(locator: Locator, value: string) {
  await locator.fill(value);
}

test('model creation adds semantic objects, formulas and compiles generic spec', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create');

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('tab', { name: /参数/ }).click();
  await page.getByTestId('add-parameter').click();
  await fillInput(page.getByTestId('parameter-code-0'), 'load');
  await fillInput(page.getByTestId('parameter-name-0'), '负荷');
  await fillInput(page.getByTestId('parameter-dimension-0'), 'time');

  await page.getByRole('tab', { name: /变量/ }).click();
  await page.getByTestId('add-variable').click();
  await fillInput(page.getByTestId('variable-code-0'), 'p_grid');
  await fillInput(page.getByTestId('variable-name-0'), '电网功率');
  await fillInput(page.getByTestId('variable-dimension-0'), 'time');

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '新增目标函数' }).click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[t]');
  await page.getByRole('button', { name: '应用公式' }).click();

  await page.getByRole('button', { name: '新增约束公式' }).click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[t] >= load[t]');
  await page.getByRole('button', { name: '应用公式' }).click();

  await page.getByRole('button', { name: '编译 generic_spec' }).click();
  await expect(page.getByText('已生成')).toBeVisible();
});
