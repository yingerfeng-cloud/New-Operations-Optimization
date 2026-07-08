import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('P4 NLP Ipopt demo route exposes boundary language', async ({ page }) => {
  await mockApi(page);
  await page.route('http://127.0.0.1:5178/api/solvers/status', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ highs: { available: true }, ipopt: { available: true, path: '/usr/bin/ipopt', version: 'Ipopt 3.x' } }) });
  });

  await page.goto('/');
  await expect(page.getByText('非线性水电出力 NLP 演示')).toBeVisible();
  await expect(page.getByText(/结果不承诺全局最优/).first()).toBeVisible();
  await page.getByRole('button', { name: '查看模型' }).nth(1).click();
  await expect(page).toHaveURL(/\/models\/nonlinear_hydro_power_demo/);
  await page.goto('/runtime');
  await expect(page.getByRole('heading', { name: '求解运行环境' })).toBeVisible();
});
