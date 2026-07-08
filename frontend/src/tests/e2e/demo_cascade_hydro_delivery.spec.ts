import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('P4 cascade hydro demo route exposes delivery entry points', async ({ page }) => {
  await mockApi(page);
  await page.route('http://127.0.0.1:5178/api/solvers/status', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ highs: { available: true }, ipopt: { available: false, message: 'Ipopt executable not found' } }) });
  });

  await page.goto('/');
  await expect(page.getByText('平台能力矩阵')).toBeVisible();
  await expect(page.getByText('梯级水电优化调度')).toBeVisible();
  await page.getByRole('button', { name: '查看模型' }).first().click();
  await expect(page).toHaveURL(/\/models\/cascade_hydro_dispatch_v1/);
  await expect(page.getByRole('heading', { name: '模型资产中心' })).toBeVisible();

  await page.goto('/services');
  await expect(page.getByText('模型服务治理与在线调用')).toBeVisible();
  await page.goto('/results');
  await expect(page.getByRole('heading', { name: '结果报告库' })).toBeVisible();
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Agent 工作台' })).toBeVisible();
});
