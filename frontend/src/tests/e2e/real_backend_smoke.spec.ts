import { expect, test, type Locator, type Page } from '@playwright/test';

async function fill(locator: Locator, value: string) {
  await locator.fill(value);
}

async function chooseOption(page: Page, select: Locator, name: string | RegExp) {
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  const option = dropdown.locator('.ant-select-item-option').filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  await option.click();
}

test('real backend smoke creates generic model draft and runs backend testModel', async ({ page }) => {
  await page.goto('/scenarios');
  await expect(page.getByTestId('scenario-card-day_ahead_unit_commitment')).toBeVisible();
  await page.getByTestId('scenario-enter-day_ahead_unit_commitment').click();
  await expect(page).toHaveURL(/\/models\/create/);

  await expect(page.getByTestId('scenario-select')).toContainText('日前机组组合优化');
  await chooseOption(page, page.getByTestId('scenario-select'), '日前机组组合优化');

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('tab', { name: /参数/ }).click();
  await page.getByTestId('add-parameter').click();
  await fill(page.getByTestId('parameter-code-0'), 'load');
  await fill(page.getByTestId('parameter-name-0'), '负荷');
  await fill(page.getByTestId('parameter-dimension-0'), 'time');

  await page.getByRole('tab', { name: /变量/ }).click();
  await page.getByTestId('add-variable').click();
  await fill(page.getByTestId('variable-code-0'), 'p_grid');
  await fill(page.getByTestId('variable-name-0'), '电网功率');
  await fill(page.getByTestId('variable-dimension-0'), 'time');

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '新增目标函数' }).click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[time]');
  await page.getByRole('button', { name: '应用公式' }).click();

  await page.getByRole('button', { name: '新增约束公式' }).click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[time] >= load[time]');
  await page.getByRole('button', { name: '应用公式' }).click();
  await page.getByRole('button', { name: '编译 generic_spec' }).click();
  await expect(page.getByText('已生成')).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('运行参数 JSON').fill(JSON.stringify({ horizon: 3, load: [10, 12, 14] }, null, 2));
  await page.getByRole('button', { name: '导入并校验' }).click();
  await expect(page.getByText('已填写').first()).toBeVisible();

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('发布前校验全部通过')).toBeVisible();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();

  await page.getByTestId('model-test-run-button').click();
  await expect(page.getByText(/测试运行结果|后端返回错误/)).toBeVisible({ timeout: 30_000 });
});
