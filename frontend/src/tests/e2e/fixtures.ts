import type { Page } from '@playwright/test';

const componentSample = {
  component_id: 'power_balance',
  name: '功率平衡',
  display_name: '功率平衡',
  status: 'published',
  enabled: true,
  implemented: true,
  version: '1.0',
  required_sets: [{ code: 'time', name: '时段', dimension: ['time'] }],
  parameters: [{ code: 'load', name: '负荷', dimension: ['time'], unit: 'MW' }],
  variables: [{ code: 'p_grid', name: '电网功率', dimension: ['time'], unit: 'MW' }],
  generated_constraints: [{ constraint_id: 'balance', name: '负荷平衡', formula: 'p_grid[t] >= load[t]', display_formula: '电网功率[t] ≥ 负荷[t]' }],
  generated_objective_terms: [{ term_id: 'cost', name: '运行成本', formula: 'p_grid[t]', display_formula: '电网功率[t]' }],
  parameter_bindings: [{ component_parameter: 'load', model_parameter: 'load', status: 'bound' }],
  depends_on: [],
};

const resultSample = {
  task_id: 'OPT-SUCCESS',
  status: 'SUCCESS',
  objective_value: 123.45,
  metrics: { objective_value: 123.45, total_cost: 123.45, gap: '0.00%' },
  variables: { p_grid: [10, 12, 14], soc: [5, 6, 7] },
  constraints: { balance: 'passed' },
  business_output: { dispatch_series: [{ time: 1, p_grid: 10 }, { time: 2, p_grid: 12 }] },
  business_explanation: { summary: '结果显示负荷平衡约束满足。' },
};

export async function mockApi(page: Page) {
  let componentState = { ...componentSample };
  let savedModel: Record<string, unknown> = {
    id: 'MODEL-DRAFT-1',
    name: '浏览器验收模型',
    scene: '日前机组组合优化',
    version: 'v1',
    status: 'draft',
    solver: 'HiGHS',
    problem_type: 'LP',
    model_problem_type: 'LP',
    build_mode: 'generic_linear',
    updated_at: '2026-06-24',
  };
  let taskState = {
    id: 'OPT-SUCCESS',
    model_id: 'MODEL-DRAFT-1',
    model: '浏览器验收模型',
    scene: 'power optimization',
    solver: 'HiGHS',
    status: 'SUCCESS',
    progress: 100,
    cost: 123.45,
    created_at: '2026-06-24 10:00:00',
    started_at: '2026-06-24 10:01:00',
    finished_at: '2026-06-24 10:02:00',
    recent_logs: ['VALIDATING 参数校验通过', 'SOLVING HiGHS 求解完成'],
    trace: { model_code: 'browser_acceptance', horizon: 24 },
  };
  await page.route('http://127.0.0.1:5178/api/**', async route => {
    const url = route.request().url();
    const method = route.request().method();
    let body: unknown = [];
    if (url.endsWith('/api/health')) body = { ok: true };
    else if (url.includes('/api/templates/')) {
      const code = decodeURIComponent(url.split('/api/templates/')[1].split('?')[0]);
      const isHydro = code === 'cascade_hydro_dispatch';
      body = {
        code,
        name: isHydro ? '梯级水电日前调度模板' : '经济调度',
        scenario: isHydro ? '梯级水电日前调度' : '经济负荷分配',
        build_mode: isHydro ? 'component_based' : 'generic_linear',
        model_draft: {
          semantic: {
            sets: [{ code: 'time', name: '时段' }],
            parameters: [{ code: 'load', name: '负荷' }],
            variables: [{ code: 'p', name: '出力', variableType: 'continuous' }],
          },
          components: isHydro ? [{ component_id: 'hydro_reservoir_balance', enabled: true }] : [],
          formulas: [{ formula_id: 'balance', name: '平衡约束', kind: 'constraint', display_formula: 'p=load', dsl_formula: 'p=load', tokens: [], foreach: [], referenced_sets: [], referenced_parameters: [], referenced_variables: [], free_indices: [], compile_status: 'ready' }],
          runtime_parameters: { horizon: 24 },
        },
      };
    }
    else if (url.endsWith('/api/templates')) body = [{ code: 'economic_dispatch', name: '经济调度', scenario: 'economic_dispatch' }];
    else if (url.endsWith('/api/models') && method === 'GET') body = [
      { id: 'm1', name: '示例模型', scene: 'power', version: 'v1', status: 'developing', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '2026-06-22' },
      { id: 'm2', name: '梯级水电模型', scene: '梯级水电日前调度', version: 'v1', status: 'published', solver: 'HiGHS', problem_type: 'LP', build_mode: 'component_based', template_id: 'cascade_hydro_dispatch', updated_at: '2026-06-22' },
      savedModel,
    ];
    else if (url.endsWith('/api/models') && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      savedModel = { ...savedModel, ...payload, id: 'MODEL-DRAFT-1', status: 'draft', updated_at: '2026-06-24' };
      body = savedModel;
    } else if (url.endsWith('/api/models/MODEL-DRAFT-1') && method === 'GET') {
      body = savedModel;
    } else if (url.endsWith('/api/models/MODEL-DRAFT-1') && method === 'PUT') {
      const payload = JSON.parse(route.request().postData() || '{}');
      savedModel = { ...savedModel, ...payload, id: 'MODEL-DRAFT-1', updated_at: '2026-06-24' };
      body = savedModel;
    } else if (url.endsWith('/api/models/MODEL-DRAFT-1/publish')) {
      savedModel = { ...savedModel, status: 'published' };
      body = savedModel;
    } else if (url.endsWith('/api/models/MODEL-DRAFT-1/test')) {
      savedModel = {
        ...savedModel,
        status: 'tested',
        dry_run_result: { structure_check: { status: 'passed' }, solver_check: { status: 'passed' } },
      };
      body = savedModel;
    }
    else if (url.endsWith('/api/components/catalog')) body = [componentState];
    else if (url.endsWith('/api/components/power_balance') && method === 'GET') body = componentState;
    else if (url.endsWith('/api/components/power_balance') && method === 'PUT') {
      const payload = JSON.parse(route.request().postData() || '{}');
      componentState = { ...componentState, ...payload, component_id: 'power_balance' };
      body = componentState;
    } else if (url.includes('/api/components/power_balance/')) body = componentState;
    else if (url.endsWith('/api/tasks') && method === 'GET') body = [taskState];
    else if (url.endsWith('/api/tasks') && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      taskState = { ...taskState, ...payload, id: 'OPT-BROWSER-1', status: 'SUCCESS', progress: 100 };
      body = taskState;
    } else if (url.includes('/api/tasks/OPT-BROWSER-1/result')) body = { ...resultSample, task_id: 'OPT-BROWSER-1' };
    else if (url.includes('/api/tasks/OPT-SUCCESS/result')) body = resultSample;
    else if (url.includes('/api/tasks/OPT-BROWSER-1')) body = taskState;
    else if (url.endsWith('/api/results')) body = [resultSample, { ...resultSample, task_id: 'OPT-BROWSER-1' }];
    else if (url.includes('/api/results/OPT-BROWSER-1')) body = { ...resultSample, task_id: 'OPT-BROWSER-1' };
    else if (url.includes('/api/results/OPT-SUCCESS')) body = resultSample;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
