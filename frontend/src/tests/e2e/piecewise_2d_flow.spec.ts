import { expect, test, type Page } from '@playwright/test';

const surfaceAsset = {
  function_id: 'hydro_power_surface_001',
  name: '水电出力曲面',
  function_type: 'piecewise_2d',
  input_schema: [{ name: 'flow', unit: 'm3/s' }, { name: 'head', unit: 'm' }],
  output_schema: { name: 'power', unit: 'MW' },
  points: [],
  points_2d: [[0, 0, 1], [10, 0, 21], [0, 10, 31], [10, 10, 51]],
  triangles: [[0, 1, 2], [1, 3, 2]],
  surface_mode: 'triangulated',
  solve_strategy: 'triangulated_milp_exact',
  status: 'draft',
  validation_status: 'valid',
  validation_errors: [],
  validation_warnings: [],
  domain: { x_min: 0, x_max: 10, y_min: 0, y_max: 10, z_min: 1, z_max: 51, point_count: 4 },
  surface_diagnostics: {
    point_count: 4,
    triangle_count: 2,
    is_regular_grid: true,
    triangulation_status: 'auto_grid_triangulated',
    degenerate_triangle_count: 0,
    recommended_solve_strategy: 'triangulated_milp_exact',
  },
};

function draftForPiecewise2d() {
  return {
    basic_info: {
      name: '二维 PWL 验收模型',
      model_code: 'pwl_2d_acceptance',
      scenario: '水电调度',
      builder_mode: 'component_based',
      solver: 'HiGHS',
      modeling_skeleton: 'dispatch_optimization',
    },
    semantic: {
      sets: [{ code: 'time', name: '调度时段', values: [0] }],
      parameters: [],
      variables: [],
    },
    components: [],
    formulas: [],
    runtime_parameters: { horizon: 1, time: [0] },
    parameter_groups: { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} },
    advanced: {},
  };
}

async function mockPiecewise2dApi(page: Page) {
  const assets = [surfaceAsset];
  let savedModel: Record<string, unknown> = {};
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
    }
    let body: unknown = {};

    if (path === '/api/function-assets' && method === 'GET') {
      body = assets;
    } else if (path === '/api/function-assets' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const next = { ...surfaceAsset, ...payload, validation_status: 'valid' };
      assets.splice(0, assets.length, next);
      body = next;
    } else if (path.endsWith('/validate')) {
      body = { valid: true, validation_status: 'valid', errors: [], warnings: [], domain: surfaceAsset.domain, diagnostics: surfaceAsset.surface_diagnostics };
    } else if (path.endsWith('/preview')) {
      body = { function_id: surfaceAsset.function_id, x: 5, y: 5, z: 26, triangle: [0, 1, 2], lambda: [0, 0.5, 0.5], status: 'inside_domain', domain: surfaceAsset.domain, diagnostics: surfaceAsset.surface_diagnostics };
    } else if (path === '/api/templates') {
      body = [];
    } else if (path === '/api/models' && method === 'GET') {
      body = [];
    } else if (path === '/api/models' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      savedModel = { id: 'MODEL-PWL-2D', status: 'draft', ...payload };
      body = savedModel;
    } else if (path === '/api/models/MODEL-PWL-2D/test') {
      body = { task_id: 'TASK-PWL-2D', status: 'SUCCESS', model_id: 'MODEL-PWL-2D' };
    } else if (path === '/api/models/MODEL-PWL-2D/publish') {
      body = { ...savedModel, id: 'MODEL-PWL-2D', status: 'published' };
    } else if (path === '/api/tasks' && method === 'POST') {
      body = { task_id: 'TASK-PWL-2D', status: 'SUCCESS' };
    } else if (path === '/api/tasks' && method === 'GET') {
      body = [{ task_id: 'TASK-PWL-2D', status: 'SUCCESS' }];
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function seedModelDraft(page: Page, step = 1) {
  const draft = draftForPiecewise2d();
  await page.addInitScript(([modelDraft, modelStep]) => {
    localStorage.setItem('copt-model-creation-draft', JSON.stringify({
      state: {
        draft: modelDraft,
        modelDraft,
        step: modelStep,
        selectedScenarioId: 'piecewise_2d_acceptance',
        selectedModelId: 'blank',
        builderMode: 'component_based',
        loadedTemplate: null,
        validationResult: null,
      },
      version: 0,
    }));
  }, [draft, step]);
}

async function addVariable(page: Page, code: string, name: string) {
  await page.getByTestId('add-variable').click();
  await page.locator('#code').fill(code);
  await page.locator('#name').fill(name);
  await page.locator('#dimensionText').fill('time');
  await page.locator('.ant-drawer .ant-btn-primary').last().click();
  await expect(page.getByText(code).first()).toBeVisible();
}

test('piecewise 2D asset can be mapped, diagnosed in Step5, and test-run returns task status', async ({ page }) => {
  test.setTimeout(120_000);
  await mockPiecewise2dApi(page);

  await page.goto('/functions');
  await expect(page.getByRole('heading', { name: '函数/曲线资产中心' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: '新建二维曲面' }).click();
  await page.locator('#name').fill('水电出力曲面');
  await expect(page.locator('input[value="51"]').first()).toBeVisible();
  await page.locator('.ant-drawer button[type="submit"]').click();
  await expect(page.getByText('水电出力曲面').first()).toBeVisible();

  await seedModelDraft(page, 1);
  await page.goto('/models/create');
  await page.locator('.ant-tabs-tab').nth(2).click();
  await addVariable(page, 'flow', '流量');
  await addVariable(page, 'head', '水头');
  await addVariable(page, 'power', '出力');

  await page.locator('.ant-steps-item').nth(2).click();
  await page.getByRole('button', { name: '添加函数映射' }).click();
  await expect(page.getByLabel('输出表达式 z')).toHaveValue('power[t]');
  await page.locator('.ant-modal button[type="submit"]').click();
  await expect(page.getByText('二维函数映射').first()).toBeVisible();

  await page.locator('.ant-steps-item').nth(4).click();
  await expect(page.getByText('二维 PWL 风险诊断')).toBeVisible();
  await expect(page.getByText('MILP 二进制变量风险')).toBeVisible();
  await page.getByTestId('model-test-run-button').click();
  await expect(page.getByText('TASK-PWL-2D')).toBeVisible();
  await expect(page.getByText('SUCCESS', { exact: true }).first()).toBeVisible();
});
