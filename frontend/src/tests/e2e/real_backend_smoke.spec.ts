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

async function fillFormulaEditor(page: Page, value: string) {
  const editor = page.getByLabel('公式表达式').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(value);
}

async function compileAndApplyFormula(page: Page, value: string) {
  await fillFormulaEditor(page, value);
  const compileResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/formulas/expand'));
  await page.getByRole('button', { name: '后端编译与展开' }).click();
  const compileResponse = await compileResponsePromise;
  expect(compileResponse.ok(), await compileResponse.text()).toBeTruthy();
  const applyButton = page.getByRole('button', { name: '应用公式' });
  await expect(applyButton).toBeEnabled({ timeout: 30_000 });
  await applyButton.click();
}

test('@real real backend smoke creates generic model draft and runs backend testModel', async ({ page }) => {
  await page.goto('/models/create?mode=new');
  await expect(page.getByText('空白创建模型').first()).toBeVisible();

  const scenarioSelect = page.locator('.ant-form-item').filter({ hasText: '业务场景' }).locator('.ant-select').first();
  await expect(scenarioSelect).toBeVisible();
  await chooseOption(page, scenarioSelect, '日前机组组合优化');
  await page.locator('[data-field-code="name"] input').fill('真实后端 UI Smoke');
  await page.getByText('高级编辑：模型编码', { exact: true }).click();
  await page.locator('[data-field-code="model_code"] input').fill(`real_backend_smoke_${Date.now()}`);

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '模型语义' })).toBeVisible();
  await page.getByRole('button', { name: '新增集合' }).first().click();
  let dialog = page.getByRole('dialog', { name: '新增集合' });
  await fill(dialog.getByLabel('编码'), 'resource');
  await fill(dialog.getByLabel('名称'), '资源集合');
  await dialog.getByRole('button', { name: /保.*存/ }).click();

  await page.getByRole('button', { name: '新增参数' }).click();
  dialog = page.getByRole('dialog', { name: '新增参数' });
  await fill(dialog.getByLabel('编码'), 'load');
  await fill(dialog.getByLabel('名称'), '负荷');
  await dialog.getByRole('button', { name: /保.*存/ }).click();

  await page.getByRole('button', { name: '新增变量' }).click();
  dialog = page.getByRole('dialog', { name: '新增变量' });
  await fill(dialog.getByLabel('编码'), 'p_grid');
  await fill(dialog.getByLabel('名称'), '电网功率');
  await dialog.getByRole('button', { name: /保.*存/ }).click();

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '新增目标函数' }).click();
  await page.getByRole('radio', { name: '最小化' }).check();
  await compileAndApplyFormula(page, 'p_grid');

  await page.getByRole('button', { name: '新增约束公式' }).click();
  await compileAndApplyFormula(page, 'p_grid >= load');
  await page.getByRole('button', { name: '编译模型（后端权威）' }).click();
  await expect(page.getByRole('dialog', { name: 'generic_spec 权威编译成功' })).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();

  await page.getByRole('button', { name: '下一步' }).click();
  const runtimeValue = page.getByLabel(/load 当前值/);
  await runtimeValue.fill('10');
  await runtimeValue.press('Tab');
  await expect(page.getByText('缺失', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('发布前校验全部通过')).toBeVisible();
  const saveResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/models') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存草稿' }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();

  const testResponsePromise = page.waitForResponse(response => /\/api\/models\/[^/]+\/test$/.test(response.url()));
  await page.getByTestId('model-test-run-button').click();
  const testResponse = await testResponsePromise;
  expect(testResponse.ok(), await testResponse.text()).toBeTruthy();
  await expect(page.getByText(/测试运行结果|后端返回错误/)).toBeVisible({ timeout: 30_000 });

});
