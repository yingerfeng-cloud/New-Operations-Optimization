const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('fs');
const { expect } = require('../frontend/node_modules/@playwright/test');
const unmatchedApiRequests = [];
const path = require('path');

const out = path.resolve('artifacts/screenshots');
const base = process.env.SCREENSHOT_BASE_URL || 'http://127.0.0.1:5173';

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
  input_schema: [{ code: 'storage', name: '库容', unit: '百万立方米', type: 'number' }],
  output_schema: { code: 'level', name: '水位', unit: 'm', type: 'number' },
  points: [[0, 0], [100, 20], [200, 45]],
  domain: { x_min: 0, x_max: 200, y_min: 0, y_max: 45, breakpoint_count: 3 },
  solve_strategy: 'convex_combination_lp',
  monotonicity: 'increasing',
  convexity: 'convex',
  referenced_by: [],
};

const functionAsset2d = {
  function_id: 'cascade_hydro_power_surface_v1',
  name: '水电出力二维曲面',
  function_type: 'piecewise_2d',
  validation_status: 'valid',
  status: 'published',
  input_schema: [{ code: 'q_gen', name: '发电流量', unit: 'm3/s', type: 'number' }, { code: 'head', name: '水头', unit: 'm', type: 'number' }],
  output_schema: { code: 'power', name: '出力', unit: 'MW', type: 'number' },
  points: [],
  points_2d: [[100, 10, 22], [100, 20, 44], [200, 10, 46], [200, 20, 92]],
  triangles: [[0, 1, 2], [1, 3, 2]],
  surface_diagnostics: { point_count: 4, triangle_count: 2, triangulation_status: 'provided', degenerate_triangle_count: 0 },
  domain: { x_min: 100, x_max: 200, y_min: 10, y_max: 20, z_min: 22, z_max: 92, point_count: 4 },
  triangulation: { triangle_count: 2, triangulable: true },
  solve_strategy: 'triangulated_milp_exact',
  referenced_by: [{ model_id: 'cascade_hydro_dispatch_v1', model_name: '梯级水电优化调度' }],
};

const cascadeModel = {
  ...model,
  id: 'cascade_hydro_dispatch_v1',
  name: '梯级水电优化调度',
  scene: '水电调度',
  problem_type: 'MILP',
  model_problem_type: 'MILP',
  template_id: 'cascade_hydro_dispatch_v1',
  tags: ['DEMO', 'PWL', 'McCormick'],
};

const nlpModel = {
  ...model,
  id: 'nonlinear_hydro_power_demo',
  name: '非线性水电出力 NLP 演示',
  scene: '水电调度',
  problem_type: 'NLP',
  model_problem_type: 'NLP',
  solver: 'Ipopt',
  template_id: 'nonlinear_hydro_power_demo',
  tags: ['DEMO', 'NLP', 'Ipopt'],
  sample_runtime_parameters: { q: [120, 140], h: [18, 17], initial_values: { p: [20, 22] } },
};

const resultSample = {
  task_id: 'TASK-DEMO-1',
  model_id: 'cascade_hydro_dispatch_v1',
  model_code: 'cascade_hydro_dispatch_v1',
  model_name: '梯级水电优化调度',
  status: 'SUCCESS',
  problem_type: 'MILP',
  solver: 'HiGHS',
  solver_name: 'HiGHS',
  termination_condition: 'optimal',
  objective_value: 12345.67,
  runtime_seconds: 1.42,
  metrics: {
    total_generation_mwh: 3180,
    total_spill_m3: 12,
    load_deviation_mwh: 0,
    terminal_storage_deviation: 1.8,
  },
  variables: {
    p_hydro: [102, 118, 126, 121],
    load: [100, 120, 125, 120],
    storage: [450, 438, 424, 410],
  },
  function_asset_summary: {
    one_d_asset_count: 2,
    two_d_asset_count: 1,
    triangle_count: 2,
    interpolation_count: 4,
    lambda_example: [0.2, 0.3, 0.5],
  },
};

function demoModelDraft() {
  const objective = {
    formula_id: 'demo-objective',
    name: '最大发电收益',
    kind: 'objective',
    objective_direction: 'maximize',
    display_formula: 'max sum(price[t] * p_grid[t])',
    dsl_formula: 'sum(price[t] * p_grid[t] for t in time)',
    tokens: [],
    foreach: [],
    referenced_sets: ['time'],
    referenced_parameters: ['price'],
    referenced_variables: ['p_grid'],
    free_indices: [],
    compile_status: 'ready',
  };
  const constraint = {
    formula_id: 'demo-balance',
    name: '功率平衡',
    kind: 'constraint',
    display_formula: 'p_grid[t] >= load[t]',
    dsl_formula: 'p_grid[t] >= load[t]',
    tokens: [],
    foreach: ['time'],
    referenced_sets: ['time'],
    referenced_parameters: ['load'],
    referenced_variables: ['p_grid'],
    free_indices: ['t'],
    scope: [{ alias: 't', set: 'time' }],
    compile_status: 'ready',
  };
  return {
    basic_info: {
      name: '日前组合调度演示模型',
      model_code: 'unit_commitment_demo',
      scenario: '电力调度',
      builder_mode: 'generic_linear',
      solver: 'HiGHS',
      template_code: 'unit_commitment',
      modeling_skeleton: 'dispatch_optimization',
    },
    semantic: {
      sets: [{ code: 'time', name: '调度时段', values: [1, 2, 3, 4] }],
      parameters: [
        { code: 'load', name: '负荷预测', indices: ['time'], sourceType: 'runtime', required: true, exampleValue: [100, 120, 125, 118] },
        { code: 'price', name: '上网电价', indices: ['time'], sourceType: 'runtime', required: true, exampleValue: [0.42, 0.45, 0.5, 0.48] },
      ],
      variables: [{ code: 'p_grid', name: '上网功率', variableType: 'continuous', indices: ['time'], lowerBound: 0, upperBound: 200 }],
    },
    time_dimension: { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 4, time_set: 'time', editable: false },
    components: [],
    formulas: [objective, constraint],
    runtime_parameters: { horizon: 4, load: [100, 120, 125, 118], price: [0.42, 0.45, 0.5, 0.48] },
    parameter_groups: { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} },
    advanced: {
      generic_spec: {
        variables: [{ name: 'p_grid', indices: ['time'], lower: 0, upper: 200 }],
        constraints: [{ name: '功率平衡', expression: 'p_grid[t] >= load[t]', compile_status: 'ready' }],
        objective: { sense: 'maximize', expression: 'sum(price[t] * p_grid[t] for t in time)' },
      },
    },
  };
}

async function openModelCreateStep(page, step) {
  await page.goto(`${base}/models/create?mode=edit&source=screenshot-draft`);
  await expect(page.getByRole('heading', { name: '模型语义', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.locator('[data-field-code="name"] input')).toHaveValue('日前组合调度演示模型');
  const titles = ['基础信息', '模型语义', '数学展开', '运行参数', '校验发布'];
  for (let current = 0; current < step; current += 1) {
    if (current === 2) {
      await page.getByRole('button', { name: '编译模型（后端权威）' }).click();
      const compiledDialog = page.getByRole('dialog', { name: 'generic_spec 权威编译成功' });
      await expect(compiledDialog).toBeVisible();
      await compiledDialog.getByRole('button', { name: '知道了' }).click();
      await expect(compiledDialog).toBeHidden();
    }
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('heading', { name: titles[current + 1], exact: true })).toBeVisible();
  }
}

function previewFixture(asset, input = {}) {
  const base = { function_id: asset.function_id, function_type: asset.function_type, domain: asset.domain, diagnostics: asset.surface_diagnostics || {}, validation_status: 'valid', validation_errors: [], validation_warnings: [] };
  if (asset.function_type === 'piecewise_1d') {
    const values = (input.inputs || [0, 50, 100, 150, 200]).map(x => {
      const segment = asset.points.slice(1).findIndex(point => x <= point[0]);
      if (x < asset.points[0][0] || segment < 0) throw new Error('曲线预览输入超出定义域');
      const [left, right] = [asset.points[segment], asset.points[segment + 1]];
      return { x, requested_x: x, y: left[1] + (right[1] - left[1]) * (x - left[0]) / (right[0] - left[0]), boundary_clamped: false };
    });
    return { ...base, interpolation: 'linear', values };
  }
  const x = input.x ?? (asset.domain.x_min + asset.domain.x_max) / 2;
  const y = input.y ?? (asset.domain.y_min + asset.domain.y_max) / 2;
  const surface = { ...base, x, y, requested_x: x, requested_y: y, boundary_clamped: false };
  for (const triangle of asset.triangles) {
    const [a, b, c] = triangle.map(index => asset.points_2d[index]);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const first = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const second = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    const lambda = [first, second, 1 - first - second];
    if (lambda.every(value => value >= -1e-9)) return { ...surface, z: lambda.reduce((total, weight, index) => total + weight * asset.points_2d[triangle[index]][2], 0), triangle, lambda, status: 'inside_domain' };
  }
  return { ...surface, status: 'outside_domain', message: '输入点超出二维曲面定义域' };
}

async function installRoutes(page) {
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const request = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
    unmatchedApiRequests.push(request);
    return route.fulfill({ status: 501, json: { code: 'SCREENSHOT_MOCK_MISSING', message: request } });
  });
  await page.route('**/api/system-config', route => route.fulfill({ json: { dictionaries: { business_scenarios: [{ code: 'power_dispatch', label: '电力调度', enabled: true, sort_order: 1 }], component_domains: [], component_categories: [] } } }));
  await page.route(/\/api\/formulas\/(analyze|expand)$/, route => {
    const input = route.request().postDataJSON();
    const objective = input.formula_type === 'objective';
    const supported = objective ? input.formula === 'sum(price[t] * p_grid[t] for t in time)' : input.formula === 'p_grid[t] >= load[t]';
    if (!supported) return route.fulfill({ status: 422, json: { code: 'SCREENSHOT_FORMULA_UNSUPPORTED', formula: input.formula } });
    const scope = input.scope || [];
    const count = input.symbols?.sets?.time?.values?.length || input.model_context?.time_dimension?.default_horizon || 1;
    return route.fulfill({ json: {
      success: true, ast_version: '1.0', compiler_version: '2.0.0', normalized_expression: input.formula,
      expression_class: 'linear', diagnostics: [], references: [{ kind: 'variable', code: 'p_grid', indices: ['t'] }], scope,
      participation: input.participation, status: 'compile_valid', ast: { type: 'expression', source: input.formula },
      estimated_expansion: { constraint_count: objective ? 0 : count, term_count: count, exact: true },
      checks: { syntax: 'passed', symbol_dimension_unit: 'passed', classification: 'linear', compile: 'passed' },
      compiled_fragment: objective
        ? { type: 'objective', direction: input.objective_direction || 'minimize', terms: [{ var: 'p_grid', key: ['t'], aggregate_scope: [{ alias: 't', set: 'time' }], coefficient: { numeric: 1, factors: [{ parameter: 'price', indices: ['t'], power: 1 }] } }] }
        : { type: 'constraint', constraints: [{ source_formula_id: input.formula_id, split_sequence: 1, sense: '>=', scope, terms: [{ var: 'p_grid', key: ['t'], coefficient: { numeric: 1, factors: [] } }], rhs: 0, rhs_terms: [{ numeric: 1, factors: [{ parameter: 'load', indices: ['t'], power: 1 }] }] }] },
    } });
  });
  await page.route('**/api/llm/config', route => route.fulfill({ json: { enabled: false, provider: 'openai', model: 'gpt', api_key_configured: false } }));
  await page.route('**/api/models/screenshot-draft', route => route.fulfill({ json: { ...model, id: 'screenshot-draft', name: '日前组合调度演示模型', status: 'developing', build_mode: 'generic_linear', scenario_id: 'power_dispatch', model_draft: demoModelDraft() } }));
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/templates', route => route.fulfill({ json: [] }));
  await page.route('**/api/templates/*', route => route.fulfill({ json: cascadeModel }));
  await page.route('**/api/models', route => route.request().method() === 'GET' ? route.fulfill({ json: [cascadeModel, nlpModel, model] }) : route.fulfill({ json: model }));
  await page.route('**/api/models/model-1', route => route.fulfill({ json: model }));
  await page.route('**/api/models/cascade_hydro_dispatch', route => route.fulfill({ json: cascadeModel }));
  await page.route('**/api/models/cascade_hydro_dispatch_v1', route => route.fulfill({ json: cascadeModel }));
  await page.route('**/api/models/nonlinear_hydro_power_demo', route => route.fulfill({ json: nlpModel }));
  await page.route('**/api/models/model-1/asset-detail', route => route.fulfill({ json: {
    parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] },
    recent_invocations: [{ invocation_id: 'INV-1', status: 'SUCCESS', duration_seconds: 1.2, created_at: '2026-06-25' }],
  } }));
  await page.route('**/api/models/cascade_hydro_dispatch*/asset-detail', route => route.fulfill({ json: {
    parameter_schema: { parameters: [{ code: 'inflow', name: '来水预测', required: true, example: [120, 130] }] },
    function_assets: [functionAsset, functionAsset2d],
    recent_invocations: [{ invocation_id: 'INV-HYDRO-1', status: 'SUCCESS', duration_seconds: 2.1, created_at: '2026-07-06' }],
  } }));
  await page.route('**/api/models/nonlinear_hydro_power_demo/asset-detail', route => route.fulfill({ json: {
    parameter_schema: { parameters: [{ code: 'q', name: '下泄流量', required: true, example: [120, 140] }] },
    recent_invocations: [{ invocation_id: 'INV-NLP-1', status: 'SUCCESS', duration_seconds: 1.7, created_at: '2026-07-06' }],
  } }));
  await page.route('**/api/models/model-1/schema', route => route.fulfill({ json: { parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] } } }));
  await page.route('**/api/models/*/schema', route => route.fulfill({ json: { parameter_schema: { parameters: [{ code: 'load', name: '负荷预测', required: true, example: [100, 120] }] } } }));
  await page.route('**/api/tasks', route => route.request().method() === 'GET' ? route.fulfill({ json: [{ id: 'TASK-DEMO-1', task_id: 'TASK-DEMO-1', model_id: 'cascade_hydro_dispatch_v1', status: 'SUCCESS', problem_type: 'MILP', solver: 'HiGHS', objective_value: 12345.67 }] }) : route.fulfill({ json: { id: 'TASK-DEBUG-1', task_id: 'TASK-DEBUG-1', status: 'SUCCESS', objective_value: 123.45 } }));
  await page.route('**/api/tasks/*', route => route.fulfill({ json: { id: 'TASK-DEMO-1', task_id: 'TASK-DEMO-1', model_id: 'cascade_hydro_dispatch_v1', status: 'SUCCESS', problem_type: 'MILP', solver: 'HiGHS' } }));
  await page.route('**/api/tasks/*/result', route => route.fulfill({ json: resultSample }));
  await page.route('**/api/results', route => route.fulfill({ json: [resultSample, { ...resultSample, task_id: 'TASK-NLP-1', model_id: 'nonlinear_hydro_power_demo', model_code: 'nonlinear_hydro_power_demo', model_name: '非线性水电出力 NLP 演示', problem_type: 'NLP', solver: 'Ipopt', solver_name: 'Ipopt', termination_condition: 'locallyOptimal', local_optimum_warning: 'NLP 结果不承诺全局最优' }] }));
  await page.route('**/api/components/catalog', route => route.request().method() === 'GET' ? route.fulfill({ json: [component] }) : route.fulfill({ json: component }));
  await page.route('**/api/components/power_balance', route => route.fulfill({ json: component }));
  await page.route('**/api/function-assets', route => route.request().method() === 'GET' ? route.fulfill({ json: [functionAsset2d, functionAsset] }) : route.fulfill({ json: functionAsset }));
  await page.route('**/api/function-assets/*/preview', route => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    const asset = [functionAsset, functionAsset2d].find(item => item.function_id === id);
    if (!asset) return route.fulfill({ status: 404, json: { code: 'FUNCTION_ASSET_NOT_FOUND', function_id: id } });
    return route.fulfill({ json: previewFixture(asset, route.request().postDataJSON() || {}) });
  });
  await page.route('**/api/function-assets/*/validate', route => route.fulfill({ json: { valid: true, errors: [] } }));
  await page.route(/\/api\/agent\/v3\/conversations\/[^/]+\/events\/stream/, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': keepalive\n\n' }));
  await page.route('**/api/tasks/TASK-NLP-1/result', route => route.fulfill({ json: { ...resultSample, task_id: 'TASK-NLP-1', model_id: 'nonlinear_hydro_power_demo', model_name: '非线性水电出力 NLP 演示', problem_type: 'NLP', solver: 'Ipopt', solver_name: 'Ipopt', termination_condition: 'locallyOptimal', local_optimum_warning: 'NLP 结果不代表全局最优' } }));
  await page.route('**/api/agent/status', route => route.fulfill({ json: { platform: { reachable: true, skill_registry_ok: true, skill_count: 1 }, llm: { enabled: true, api_key_configured: true, provider: 'openai', model: 'gpt' } } }));
  await page.route('**/api/agent/agent-skills', route => route.fulfill({ json: [{ name: 'dispatch_agent', display_name: '调度 Agent', enabled: true, required_parameters: ['load'] }] }));
  await page.route('**/api/agent/conversations', route => route.request().method() === 'GET' ? route.fulfill({ json: [{ conversation_id: 'CONV-1', title: '日前调度', last_message: '创建日前调度模型' }] }) : route.fulfill({ json: { conversation_id: 'CONV-2', title: '新会话', status: 'CHAT_IDLE', messages: [] } }));
  await page.route('**/api/agent/conversations/CONV-1', route => route.fulfill({ json: { conversation_id: 'CONV-1', title: '日前调度', messages: [{ role: 'user', text: '创建日前调度模型' }] } }));
}

async function shot(page, name) {
  await page.evaluate(() => {
    document.querySelector('.main')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }).catch(() => undefined);
  await expect(page.locator('.main')).toBeVisible();
  const visibleDialogs = page.getByRole('dialog');
  for (let index = 0; index < await visibleDialogs.count(); index += 1) {
    await expect(visibleDialogs.nth(index)).toBeInViewport({ ratio: 0.8 });
  }
  if (unmatchedApiRequests.length) throw new Error(`截图 API 夹具缺失: ${unmatchedApiRequests.join(', ')}`);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false, animations: 'disabled' });
}

async function captureScreenshots() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error('PAGE_ERROR', error.message));
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) console.error(`PAGE_${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  await installRoutes(page);
  await page.route('**/api/solvers/status', route => route.fulfill({ json: { highs: { available: true, version: '1.14.0' }, ipopt: { available: false, message: 'Ipopt executable not found. NLP solving is unavailable.' } } }));
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await shot(page, '01-dashboard');
  await page.goto(`${base}/runtime`);
  await page.waitForLoadState('networkidle');
  await shot(page, '02-runtime');
  await page.goto(`${base}/models`);
  await page.waitForLoadState('networkidle');
  await shot(page, '03-model-center');
  await page.goto(`${base}/models/cascade_hydro_dispatch`);
  await page.waitForLoadState('networkidle');
  await shot(page, '04-cascade-hydro-detail');
  await page.goto(`${base}/models/cascade_hydro_dispatch_v1`);
  await page.waitForLoadState('networkidle');
  await shot(page, '05-cascade-hydro-v1-detail');
  await page.goto(`${base}/models/nonlinear_hydro_power_demo`);
  await page.waitForLoadState('networkidle');
  await shot(page, '06-nonlinear-hydro-nlp-detail');
  await page.goto(`${base}/functions`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('函数/曲线资产中心', { exact: true })).toBeVisible();
  await shot(page, '07-function-assets');
  for (const [asset, filename] of [[functionAsset, '08-piecewise-1d-detail'], [functionAsset2d, '09-piecewise-2d-detail']]) {
    await page.getByRole('row').filter({ hasText: asset.name }).getByRole('button', { name: '查看', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(asset.name, { exact: true }).first()).toBeVisible();
    await shot(page, filename);
    await dialog.getByRole('button', { name: /关闭|Close/ }).click();
    await expect(dialog).toBeHidden();
  }
  await openModelCreateStep(page, 0);
  await shot(page, '10-model-create-step1');
  await openModelCreateStep(page, 1);
  await shot(page, '11-model-create-step2');
  await openModelCreateStep(page, 2);
  await shot(page, '12-model-create-step3-workbench');
  await page.getByRole('button', { name: /新增约束公式|添加自定义公式/ }).first().click();
  const formulaDialog = page.getByRole('dialog', { name: '公式编辑器' });
  await expect(formulaDialog).toBeVisible();
  await shot(page, '13-step3-formula-builder');
  await formulaDialog.getByRole('button', { name: /取.*消/ }).click();
  await expect(formulaDialog).toBeHidden();
  await openModelCreateStep(page, 3);
  await shot(page, '14-model-create-step4');
  await openModelCreateStep(page, 4);
  await shot(page, '15-model-create-step5');
  await page.goto(`${base}/components`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新建组件' }).click();
  const componentDialog = page.getByRole('dialog');
  await expect(componentDialog).toBeVisible();
  await shot(page, '16-component-editor-drawer');
  await componentDialog.getByRole('button', { name: /关闭|Close/ }).click();
  await expect(componentDialog).toBeHidden();
  await page.goto(`${base}/services`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: '在线调试' }).click();
  await shot(page, '17-model-service-online-debug');
  await page.goto(`${base}/tasks`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: '任务调度中心', exact: true })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'TASK-DEMO-1' }).getByRole('button', { name: '查看', exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: '任务 TASK-DEMO-1' });
  await expect(taskDialog).toBeVisible();
  await shot(page, '18-task-center-detail');
  await taskDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(taskDialog).toBeHidden();
  await page.goto(`${base}/results`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: '结果报告库', exact: true })).toBeVisible();
  for (const [taskId, filename] of [['TASK-DEMO-1', '19-result-center-hydro'], ['TASK-NLP-1', '20-result-center-nlp']]) {
    await page.getByRole('row').filter({ hasText: taskId }).getByRole('button', { name: '查看报告', exact: true }).click();
    const resultDialog = page.getByRole('dialog', { name: `结果报告 ${taskId}` });
    await expect(resultDialog).toBeVisible();
    await shot(page, filename);
    await resultDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(resultDialog).toBeHidden();
  }
  await page.goto(`${base}/agents`);
  await page.waitForLoadState('networkidle');
  await shot(page, '21-agent-workbench');
  console.log(out);
  } finally { await browser.close(); }
}

module.exports = { functionAsset, functionAsset2d, previewFixture, installRoutes };
if (require.main === module) captureScreenshots().catch(error => { console.error(error); process.exitCode = 1; });
