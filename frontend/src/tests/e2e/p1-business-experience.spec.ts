import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('platform business and expert views persist without redirecting the current page', async ({ page }) => {
  await page.goto('/functions');
  await page.getByText('业务视图', { exact: true }).click();
  await expect(page.getByTitle('函数与曲线')).toHaveCount(0);
  await expect(page).toHaveURL(/\/functions/);
  await page.getByText('专家视图', { exact: true }).click();
  await expect(page.getByTitle('函数与曲线')).toBeVisible();
  await page.reload();
  await expect(page.getByTitle('函数与曲线')).toBeVisible();
});

test('dashboard prioritizes tasks, exceptions, recent work, and real solver status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('生产运筹工作台')).toBeVisible();
  await expect(page.getByText('运行中任务')).toBeVisible();
  await expect(page.getByText('最近任务')).toBeVisible();
  await expect(page.getByText('求解能力摘要')).toBeVisible();
});

test('scene/model context opens task wizard and semantic time table', async ({ page }) => {
  const model = { id: 'P1-MODEL', name: '业务调度模型', scene: '日前调度', version: 'v1', status: 'published', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '2026-07-12' };
  const contract = { ui_metadata: { time_dimension: { enabled: true, policy: 'fixed', default_horizon: 2, time_set: 'time', state_time_set: 'time_volume', interval_minutes: 60, label_format: 'HH:mm' } }, input_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, type: 'number', dimension: ['time'], default: [10, 20] }, { code: 'volume', name: '库容状态', required: true, type: 'number', dimension: ['time_volume'], default: [1, 2, 3] }] } };
  await page.route('**/api/models', route => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([model]) }) : route.fallback());
  await page.route('**/api/models/P1-MODEL/schema', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) }));
  await page.route('**/api/models/P1-MODEL/asset-detail', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) }));
  await page.goto('/tasks?create=1&model=P1-MODEL&scene=%E6%97%A5%E5%89%8D%E8%B0%83%E5%BA%A6');
  await expect(page.getByText(/业务调度模型 · v1/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled(); await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('00:00', { exact: true })).toBeVisible(); await expect(page.getByText('01:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /状态序列/ }).click();
  await expect(page.getByText('初始状态', { exact: true })).toBeVisible();
});

test('result tabs are derived from returned data and omit unrelated explanations', async ({ page }) => {
  await page.goto('/results?task=OPT-SUCCESS');
  await expect(page.getByText('结果概览')).toBeVisible();
  await expect(page.getByRole('tab', { name: '变量曲线' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '业务建议' })).toBeVisible();
  await expect(page.getByText('NLP 结果解释')).toHaveCount(0);
});
