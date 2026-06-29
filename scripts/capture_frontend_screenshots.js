const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const out = path.resolve('artifacts/frontend-refactor-screenshots');
fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:5173';

const model = {
  id: 'model-1',
  name: '日前机组组合调度',
  status: 'published',
  build_mode: 'component_based',
  problem_type: 'MILP',
  model_problem_type: 'MILP',
  scene: '电力调度',
  version: '1.0.0',
  solver: 'HiGHS',
  template_id: 'unit_commitment',
  parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] },
  input_contract: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] },
  semantic_spec: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] },
};

const component = {
  component_id: 'power_balance',
  name: '功率平衡组件',
  display_name: '功率平衡组件',
  category: '电力',
  domain: '调度',
  status: 'published',
  enabled: true,
  implemented: true,
  version: '1.0.0',
  required_sets: [{ code: 'time', name: '时段' }],
  parameters: [{ code: 'load', name: '负荷', dimension: ['time'] }],
  variables: [{ code: 'p_grid', name: '上网功率', dimension: ['time'] }],
  generated_constraints: [{ constraint_id: 'balance', name: '功率平衡', formula: 'p_grid[t] >= load[t]', display_formula: 'p_grid[t] >= load[t]', compile_status: 'ready' }],
  generated_objective_terms: [{ term_id: 'cost', name: '成本', formula: 'sum(cost[t] for t in time)', compile_status: 'ready' }],
  parameter_bindings: [{ component_parameter: 'load', model_parameter: 'load', status: 'bound' }],
  depends_on: [],
};

const functionAsset = {
  function_id: 'curve_storage_level',
  name: '库容水位曲线',
  function_type: 'piecewise_1d',
  validation_status: 'valid',
  status: 'draft',
  points: [[0, 0], [100, 20], [200, 45]],
  domain: { x_min: 0, x_max: 200, y_min: 0, y_max: 45, breakpoint_count: 3 },
  solve_strategy: 'convex_combination_lp',
  monotonicity: 'increasing',
  convexity: 'convex',
  referenced_by: [],
};

async function installRoutes(page) {
  await page.route('**/api/templates', route => route.fulfill({ json: [] }));
  await page.route('**/api/models', route => route.request().method() === 'GET' ? route.fulfill({ json: [model] }) : route.fulfill({ json: model }));
  await page.route('**/api/models/model-1', route => route.fulfill({ json: model }));
  await page.route('**/api/models/model-1/asset-detail', route => route.fulfill({ json: {
    parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] },
    recent_invocations: [{ invocation_id: 'INV-1', status: 'SUCCESS', duration_seconds: 1.2, created_at: '2026-06-25' }],
  } }));
  await page.route('**/api/models/model-1/schema', route => route.fulfill({ json: { parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] } } }));
  await page.route('**/api/tasks', route => route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fulfill({ json: { id: 'TASK-DEBUG-1', status: 'SUCCESS', objective_value: 123.45 } }));
  await page.route('**/api/components/catalog', route => route.request().method() === 'GET' ? route.fulfill({ json: [component] }) : route.fulfill({ json: component }));
  await page.route('**/api/components/power_balance', route => route.fulfill({ json: component }));
  await page.route('**/api/function-assets', route => route.request().method() === 'GET' ? route.fulfill({ json: [functionAsset] }) : route.fulfill({ json: functionAsset }));
  await page.route('**/api/agent/status', route => route.fulfill({ json: { platform: { reachable: true, skill_registry_ok: true, skill_count: 1 }, llm: { enabled: true, api_key_configured: true, provider: 'openai', model: 'gpt' } } }));
  await page.route('**/api/agent/agent-skills', route => route.fulfill({ json: [{ name: 'dispatch_agent', display_name: '调度 Agent', enabled: true, required_parameters: ['load'] }] }));
  await page.route('**/api/agent/conversations', route => route.request().method() === 'GET' ? route.fulfill({ json: [{ conversation_id: 'CONV-1', title: '日前调度', last_message: '创建日前调度模型' }] }) : route.fulfill({ json: { conversation_id: 'CONV-2', title: '新会话', status: 'CHAT_IDLE', messages: [] } }));
  await page.route('**/api/agent/conversations/CONV-1', route => route.fulfill({ json: { conversation_id: 'CONV-1', title: '日前调度', messages: [{ role: 'user', text: '创建日前调度模型' }] } }));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
}

async function shot(page, name) {
  await page.evaluate(() => {
    document.querySelector('.main')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }).catch(() => undefined);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/models/create`);
  await page.waitForLoadState('networkidle');
  await shot(page, '01-model-create-step1');
  await page.getByRole('button', { name: /模型语义/ }).click();
  await shot(page, '02-model-create-step2');
  await page.getByRole('button', { name: /数学展开/ }).click();
  await shot(page, '03-model-create-step3-workbench');
  await page.getByRole('button', { name: /新增约束公式|添加自定义公式/ }).first().click();
  await shot(page, '04-step3-formula-builder');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /运行参数/ }).click();
  await shot(page, '05-model-create-step4');
  await page.getByRole('button', { name: /校验发布/ }).click();
  await shot(page, '06-model-create-step5');
  await page.goto(`${base}/components`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新建组件' }).click();
  await shot(page, '07-component-editor-drawer');
  await page.goto(`${base}/functions`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新建曲线' }).click();
  await shot(page, '08-function-asset-manual-breakpoints');
  await page.goto(`${base}/agents`);
  await page.waitForLoadState('networkidle');
  await shot(page, '09-agent-three-column-workbench');
  await page.goto(`${base}/services`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: '在线调试' }).click();
  await shot(page, '10-model-service-online-debug');
  await page.goto(`${base}/models`);
  await page.waitForLoadState('networkidle');
  await shot(page, '11-model-asset-center');
  await page.goto(`${base}/components`);
  await page.waitForLoadState('networkidle');
  await shot(page, '12-component-library-management');
  await browser.close();
  console.log(out);
})();
