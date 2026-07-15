import {test,expect} from '@playwright/test';import {mockApi} from './fixtures';test('new mode starts blank and offers backend templates',async({page})=>{await mockApi(page);await page.goto('/models/create?mode=new');await expect(page.getByText('新建模型').first()).toBeVisible();await expect(page.getByText('模型模板')).toBeVisible();await expect(page.getByText('业务场景未选择').first()).toBeVisible();await expect(page.getByRole('button',{name:/校验发布/})).toBeVisible()});

test('dirty workspace confirms template switch and cancel preserves the draft', async ({ page }) => {
  await mockApi(page);
  await page.goto('/models/create?mode=new');
  const nameInput = page.locator('.ant-form-item').filter({ hasText: '模型名称' }).locator('input');
  await nameInput.fill('不得丢失的草稿');

  const templateSelect = page.getByRole('combobox').first();
  await templateSelect.click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
  const confirmModal = page.getByRole('dialog', { name: '确认切换模型来源？' });
  await expect(confirmModal).toBeVisible();
  await confirmModal.getByRole('button', { name: /取\s*消/ }).click();
  await expect(nameInput).toHaveValue('不得丢失的草稿');
  await expect(page).toHaveURL(/mode=new/);

  await templateSelect.click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
  await page.getByRole('dialog', { name: '确认切换模型来源？' }).getByRole('button', { name: '继续切换' }).click();
  await expect(page).toHaveURL(/mode=template&template=economic_dispatch/);
  await expect(page.getByText('从模板创建模型').first()).toBeVisible();
  await expect(page.locator('.ant-form-item').filter({ hasText: '模型名称' }).locator('input')).toHaveValue('经济调度');
});
