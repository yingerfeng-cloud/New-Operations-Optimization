import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './fixtures';

const baseModel = { scene: '测试场景', version: 'v1', status: 'published', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '2026-07-12' };
const models = [
  { ...baseModel, id: 'derived', name: '数据推导模型' },
  { ...baseModel, id: 'free', name: '自由周期模型' },
  { ...baseModel, id: 'three', name: '三维参数模型' },
  { ...baseModel, id: 'grouped', name: '运行数据工作台模型' },
  { ...baseModel, id: 'broken', name: '契约重试模型' },
];
const contracts: Record<string, Record<string, unknown>> = {
  derived: { ui_metadata: { time_dimension: { enabled: true, policy: 'data_derived', time_set: 'time', state_time_set: null, derive_from: 'load_forecast' } }, input_schema: { parameters: [{ code: 'load_forecast', name: '负荷预测', required: false, dimension: ['time'] }] } },
  free: { ui_metadata: { time_dimension: { enabled: true, policy: 'runtime_variable', time_set: 'time', state_time_set: null, default_horizon: 24, min_horizon: 12, max_horizon: 96, horizon_step: 12 } }, input_schema: { parameters: [] } },
  three: { ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable', time_set: 'time', state_time_set: null } }, input_schema: { parameters: [{ code: 'unit_output', name: '机组出力', required: true, dimension: ['station', 'unit', 'time'] }] } },
  grouped: {
    ui_metadata: {
      time_dimension: { enabled: true, policy: 'fixed', default_horizon: 2, time_set: 'time', state_time_set: null, interval_minutes: 60 },
      runtime_parameter_groups: [
        { key: 'basic', label: '基础参数', order: 10, parameter_codes: ['reserve'] },
        { key: 'forecast', label: '预测数据', order: 20, parameter_codes: ['load_forecast'] },
        { key: 'matrix', label: '矩阵数据', order: 30, parameter_codes: ['unit_limit'] },
      ],
    },
    sets: [{ code: 'plant', values: ['P1', 'P2'] }, { code: 'time', values: ['T1', 'T2'] }],
    input_schema: { parameters: [
      { code: 'reserve', name: '备用率', required: true, type: 'number', default: 0.1 },
      { code: 'load_forecast', name: '负荷预测', required: true, dimension: ['time'] },
      { code: 'unit_limit', name: '机组限值', required: true, dimension: ['plant', 'time'] },
    ] },
  },
  broken: { ui_metadata: { time_dimension: { enabled: false, policy: 'not_applicable', time_set: 'time', state_time_set: null } }, input_schema: { parameters: [] } },
};

async function setup(page: Page, brokenInitially = false) {
  await mockApi(page);
  let failuresRemaining = brokenInitially ? 2 : 0;
  await page.route('**/api/models', route => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(models) }) : route.fallback());
  await page.route('**/api/models/*/schema', route => {
    const id = route.request().url().split('/').at(-2)!;
    if (id === 'broken' && failuresRemaining > 0) { failuresRemaining -= 1; return route.fulfill({ status: 500, body: 'failed' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contracts[id]) });
  });
  await page.route('**/api/models/*/asset-detail', route => {
    const id = route.request().url().split('/').at(-2)!;
    if (id === 'broken' && failuresRemaining > 0) { failuresRemaining -= 1; return route.fulfill({ status: 500, body: 'failed' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contracts[id]) });
  });
}

async function selectModel(page: Page, name: string) {
  await page.goto('/tasks');
  await page.getByRole('button', { name: '创建任务' }).click();
  const modelSelect = page.getByLabel('选择模型');
  await modelSelect.click();
  await modelSelect.fill(name);
  await modelSelect.press('Enter');
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
  await page.getByRole('button', { name: '下一步' }).click();
}

test('data-derived blocks empty source then accepts valid sequence', async ({ page }) => {
  await setup(page);
  await selectModel(page, '数据推导模型');
  await expect(page.getByText(/无法从参数 load_forecast 推导调度时段/)).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '时间序列' })).toBeVisible();
  await page.getByRole('button', { name: '批量粘贴' }).click();
  await page.getByLabel('负荷预测批量输入').fill('10\n12\n14');
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText(/已从 load_forecast 推导 3 点/)).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('参数检查通过，可以提交求解')).toBeVisible();
});

test('free horizon enforces step contract', async ({ page }) => {
  await setup(page);
  await selectModel(page, '自由周期模型');
  const horizon = page.getByLabel('调度周期');
  await horizon.fill('25');
  await expect(page.getByText(/步长为 12/)).toBeVisible();
  await horizon.fill('24');
  await expect(page.getByText(/步长为 12/)).toHaveCount(0);
});

test('three-dimensional editor preserves nested payload', async ({ page }) => {
  await setup(page);
  await selectModel(page, '三维参数模型');
  const editor = page.getByLabel('机组出力高级结构化编辑');
  await expect(editor).toBeVisible();
  await editor.fill('[[[1,2],[3,4]]]');
  await page.getByRole('button', { name: '下一步' }).click();
  const request = page.waitForRequest(item => item.url().endsWith('/api/tasks') && item.method() === 'POST');
  await page.getByRole('button', { name: '提交求解并打开详情' }).click();
  expect((await request).postDataJSON().runtime_parameters.unit_output).toEqual([[[1, 2], [3, 4]]]);
});

test('contract failure blocks and retry recovers', async ({ page }) => {
  await setup(page, true);
  await page.goto('/tasks');
  await page.getByRole('button', { name: '创建任务' }).click();
  await page.getByLabel('选择模型').fill('契约重试模型');
  await page.getByLabel('选择模型').press('Enter');
  await expect(page.getByText('模型运行参数契约加载失败')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await page.getByRole('button', { name: '重新加载契约' }).click();
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
});

test('runtime workspace groups fields, navigates issues and edits a matrix in focus mode', async ({ page }) => {
  await setup(page);
  await selectModel(page, '运行数据工作台模型');
  await expect(page.getByRole('button', { name: /基础参数/ })).toBeVisible();
  await page.getByRole('button', { name: /预测数据/ }).click();
  await expect(page.getByRole('heading', { name: '预测数据' })).toBeVisible();
  await page.getByRole('button', { name: /问题/ }).click();
  await expect(page.getByText('参数问题（2）')).toBeVisible();
  await page.getByRole('button', { name: '前往处理' }).first().click();
  await expect(page.getByText('必填值为空').first()).toBeVisible();

  await page.getByRole('button', { name: /矩阵数据/ }).click();
  await page.getByRole('button', { name: '聚焦编辑' }).click();
  await expect(page.getByText('机组限值 · 聚焦矩阵编辑')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '../docs/visual-acceptance/ui-special-iteration/task-fullscreen-matrix-1440.png' });
  await page.getByRole('button', { name: '粘贴矩形数据' }).click();
  await page.getByLabel('机组限值批量输入').fill('1\t2\n3\t4');
  await page.getByRole('button', { name: '确认导入' }).click();
  await page.getByRole('button', { name: '保存并返回' }).click();
  await expect(page.getByText('机组限值 · 聚焦矩阵编辑')).toHaveCount(0);
});

test('runtime workspace reuses compatible historical parameters without overwriting system time fields', async ({ page }) => {
  await setup(page);
  await page.route('**/api/tasks', route => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'H1', model_id: 'grouped', model: '运行数据工作台模型', scene: '测试场景', solver: 'HiGHS', status: 'SUCCESS', progress: 100, cost: 0, created_at: '2026-07-15', finished_at: '2026-07-15', horizon: 2 }]) }) : route.fallback());
  await page.route('**/api/tasks/H1', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'H1', model_id: 'grouped', model: '运行数据工作台模型', scene: '测试场景', solver: 'HiGHS', status: 'SUCCESS', progress: 100, cost: 0, created_at: '2026-07-15', finished_at: '2026-07-15', horizon: 2, runtime_parameters: { horizon: 99, load_forecast: [10, 12], unit_limit: [[1, 2], [3, 4]] } }) }));
  await selectModel(page, '运行数据工作台模型');
  await page.getByRole('button', { name: '从历史任务载入' }).click();
  await expect(page.getByRole('dialog', { name: '从历史任务载入运行参数' }).getByRole('cell', { name: 'H1' }).first()).toBeVisible();
  await page.locator('.ant-table-row .ant-radio-input').click();
  await expect(page.getByText('可读取参数')).toBeVisible();
  await page.getByRole('button', { name: '确认载入' }).click();
  await expect(page.getByRole('button', { name: /问题 0/ })).toBeVisible();
  await expect(page.getByText('当前 horizon').locator('..')).toContainText('2 点');
});

test('closing task wizard clears previous model', async ({ page }) => {
  await setup(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: '创建任务' }).click();
  await page.getByLabel('选择模型').fill('自由周期模型');
  await page.getByLabel('选择模型').press('Enter');
  await page.getByRole('button', { name: /取.*消/ }).click();
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByLabel('选择模型')).toHaveText('');
});

test('running task opens solve process, reaches result, and stops polling', async ({ page }) => {
  await mockApi(page);
  let detailRequests = 0;
  await page.route('**/api/tasks/LIVE', route => {
    detailRequests += 1;
    const done = detailRequests >= 2;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'LIVE', model: '轮询模型', scene: '调度', solver: 'HiGHS', status: done ? 'SUCCESS' : 'RUNNING',
      progress: done ? 100 : 50, created_at: '2026-07-12 10:00:00', recent_logs: ['solving'],
    }) });
  });
  await page.route('**/api/results/LIVE', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: 'LIVE', status: 'SUCCESS', metrics: {}, variables: {} }) }));
  await page.goto('/tasks?task=LIVE');
  await expect(page.locator('.ant-tabs-tab-active')).toContainText('求解过程');
  await expect(page.locator('.ant-tabs-tab-active')).toContainText('优化结果', { timeout: 12_000 });
  const requestsAtTerminal = detailRequests;
  await page.waitForTimeout(5_500);
  expect(detailRequests).toBe(requestsAtTerminal);
});

test('business Agent request does not carry expert Skill', async ({ page }) => {
  await mockApi(page);
  let analyzePayload: Record<string, unknown> = {};
  await page.route('**/api/agent/**', async route => {
    const url = route.request().url();
    let body: unknown = [];
    if (url.endsWith('/status')) body = { platform: { reachable: true }, llm: { enabled: true } };
    else if (url.endsWith('/agent-skills')) body = [{ name: 'dispatch_agent', display_name: '调度 Agent', enabled: true }];
    else if (url.endsWith('/conversations')) body = [];
    else if (url.endsWith('/analyze')) { analyzePayload = route.request().postDataJSON(); body = { conversation_id: 'C1', status: 'CHAT_IDLE', agent_message: '已识别' }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/agents');
  await page.getByRole('button', { name: '专家视图' }).click();
  await page.getByLabel('指定 Skill').click();
  await page.getByLabel('指定 Skill').press('ArrowDown');
  await page.getByLabel('指定 Skill').press('Enter');
  await page.getByRole('button', { name: '返回业务视图' }).click();
  await page.getByPlaceholder('描述优化目标、时间范围和可用数据').fill('生成调度计划');
  await page.getByRole('button', { name: '发送需求' }).click();
  await expect.poll(() => analyzePayload.message).toBe('生成调度计划');
  expect(analyzePayload).not.toHaveProperty('agent_skill_name');
  expect(analyzePayload).not.toHaveProperty('skill_name');
});
