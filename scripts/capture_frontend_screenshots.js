const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const out = path.resolve('artifacts/screenshots');
fs.mkdirSync(out, { recursive: true });
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
  points: [[10, 100, 22], [20, 100, 44], [10, 200, 46], [20, 200, 92]],
  domain: { x_min: 10, x_max: 20, y_min: 100, y_max: 200, z_min: 22, z_max: 92, point_count: 4 },
  triangulation: { triangle_count: 2, triangulable: true },
  solve_strategy: 'triangulated_lambda_lp',
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
    free_indices: ['time'],
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
  const draft = demoModelDraft();
  await page.goto(`${base}/`);
  await page.evaluate(({ persistedDraft, persistedStep }) => {
    localStorage.setItem('copt-model-creation-draft', JSON.stringify({
      state: {
        draft: persistedDraft,
        modelDraft: persistedDraft,
        step: persistedStep,
        selectedScenarioId: 'power_dispatch',
        selectedModelId: 'unit_commitment',
        builderMode: persistedDraft.basic_info.builder_mode,
        loadedTemplate: null,
        validationResult: null,
      },
      version: 0,
    }));
  }, { persistedDraft: draft, persistedStep: step });
  await page.goto(`${base}/models/create`);
  await page.waitForLoadState('networkidle');
}

async function installRoutes(page) {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {} }));
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
  await page.route('**/api/function-assets/*/preview', route => route.fulfill({ json: { x: 15, y: 150, z: 60, triangle: [0, 1, 2], lambda: [0.2, 0.3, 0.5], extrapolated: false } }));
  await page.route('**/api/function-assets/*/validate', route => route.fulfill({ json: { valid: true, errors: [] } }));
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
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
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
  await shot(page, '07-function-assets');
  await shot(page, '08-piecewise-1d-detail');
  await shot(page, '09-piecewise-2d-detail');
  await openModelCreateStep(page, 0);
  await shot(page, '10-model-create-step1');
  await openModelCreateStep(page, 1);
  await shot(page, '11-model-create-step2');
  await openModelCreateStep(page, 2);
  await shot(page, '12-model-create-step3-workbench');
  await page.getByRole('button', { name: /新增约束公式|添加自定义公式/ }).first().click();
  await shot(page, '13-step3-formula-builder');
  await page.keyboard.press('Escape');
  await openModelCreateStep(page, 3);
  await shot(page, '14-model-create-step4');
  await openModelCreateStep(page, 4);
  await shot(page, '15-model-create-step5');
  await page.goto(`${base}/components`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '新建组件' }).click();
  await shot(page, '16-component-editor-drawer');
  await page.goto(`${base}/services`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: '在线调试' }).click();
  await shot(page, '17-model-service-online-debug');
  await page.goto(`${base}/tasks`);
  await page.waitForLoadState('networkidle');
  await shot(page, '18-task-center-detail');
  await page.goto(`${base}/results`);
  await page.waitForLoadState('networkidle');
  await shot(page, '19-result-center-hydro');
  await shot(page, '20-result-center-nlp');
  await page.goto(`${base}/agents`);
  await page.waitForLoadState('networkidle');
  await shot(page, '21-agent-workbench');
  await browser.close();
  console.log(out);
})();
