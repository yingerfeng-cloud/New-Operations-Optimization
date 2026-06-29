import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockApi } from './fixtures';

async function fill(locator: Locator, value: string) {
  await locator.fill(value);
}

async function chooseOption(page: Page, select: Locator, name: string | RegExp) {
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  const option = typeof name === 'string'
    ? dropdown.locator('.ant-select-item-option').filter({ hasText: name }).first()
    : dropdown.locator('.ant-select-item-option').filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  try {
    await option.click();
  } catch {
    await option.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    });
  }
}

test('browser acceptance covers scenario, model creation, component, task and result flows', async ({ page }) => {
  await mockApi(page);

  await page.goto('/scenarios');
  await expect(page.getByTestId('scenario-card-cascade_hydro_day_ahead')).toBeVisible();
  await page.getByTestId('scenario-enter-cascade_hydro_day_ahead').click();
  await expect(page).toHaveURL(/\/models\/create/);
  await expect(page.getByTestId('scenario-select')).toContainText('梯级水电日前调度');
  await expect(page.getByTestId('model-select')).toContainText('梯级水电日前调度模型');
  await expect(page.getByText('组件化 / 梯级水电调度')).toBeVisible();
  await expect(page.getByText('MILP / 机组组合')).toHaveCount(0);

  await chooseOption(page, page.getByTestId('scenario-select'), '日前机组组合优化');
  await expect(page.getByText('日前机组组合优化模型')).toBeVisible();
  await expect(page.getByText('MILP / 机组组合')).toBeVisible();
  await expect(page.getByText('梯级水电日前调度模型')).toHaveCount(0);

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('tab', { name: /集合/ }).click();
  await page.getByTestId('add-set').click();
  await expect(page.getByRole('tab', { name: /集合 3/ })).toBeVisible();

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
  await expect(page.getByText('统一公式编辑器')).toBeVisible();
  await page.getByRole('button', { name: /电网功率 p_grid/ }).first().click();
  await page.getByRole('button', { name: 'sum 聚合块' }).first().click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[time]');
  await page.getByRole('button', { name: '应用公式' }).click();

  await page.getByRole('button', { name: '新增约束公式' }).click();
  await page.getByRole('button', { name: /电网功率 p_grid/ }).first().click();
  await page.getByRole('button', { name: '>=' }).first().click();
  await page.getByRole('button', { name: /负荷 load/ }).first().click();
  await page.getByRole('tab', { name: '原始 DSL 视图' }).click();
  await page.getByLabel('公式表达式').fill('p_grid[time] >= load[time]');
  await page.getByRole('button', { name: '应用公式' }).click();
  await page.getByRole('button', { name: '编译 generic_spec' }).click();
  await expect(page.getByText('已生成')).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('运行参数 JSON').fill(JSON.stringify({ horizon: 24, load: [10, 12, 14] }, null, 2));
  await page.getByRole('button', { name: '导入并校验' }).click();
  await expect(page.getByText('已填写').first()).toBeVisible();

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('发布前校验全部通过')).toBeVisible();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await page.getByTestId('model-test-run-button').click();
  await expect(page.getByText('测试运行结果')).toBeVisible();
  await page.getByRole('button', { name: '发布模型' }).last().click();
  await expect(page).toHaveURL(/\/models\/MODEL-DRAFT-1/);

  await page.goto('/components');
  await page.getByRole('button', { name: '编辑' }).first().click();
  await page.getByRole('tab', { name: '约束公式' }).click();
  await expect(page.getByText('统一公式编辑器')).toBeVisible();
  await expect(page.getByRole('button', { name: /电网功率 p_grid/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '保存组件' }).click();

  await page.goto('/tasks');
  await page.getByRole('button', { name: '创建任务' }).click();
  await chooseOption(page, page.getByLabel('选择模型'), /浏览器验收模型|示例模型/);
  await page.getByRole('button', { name: '提交求解并打开详情' }).click();
  await expect(page.locator('.ant-table').getByRole('cell', { name: 'OPT-BROWSER-1' }).first()).toBeVisible();

  await page.goto('/results');
  await expect(page.getByRole('heading', { name: '结果报告库' })).toBeVisible();
  await page.getByRole('button', { name: '查看报告' }).first().click();
  await expect(page.getByRole('tab', { name: '图表展示' })).toBeVisible();
  await expect(page.getByText('最优目标值').first()).toBeVisible();
});
