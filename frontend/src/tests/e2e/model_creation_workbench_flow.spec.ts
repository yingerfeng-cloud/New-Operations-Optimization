import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

const workbenchDraft = {
  basic_info: {
    name: '电力调度模型',
    model_code: 'power_dispatch_workbench',
    scenario: '电力调度',
    builder_mode: 'component_based',
    solver: 'HiGHS',
    modeling_skeleton: 'dispatch_optimization',
  },
  semantic: {
    sets: [{ code: 'time', name: '时段', values: [0, 1, 2] }],
    parameters: [{ code: 'startup_cost', name: '启动成本', unit: '元/次', indices: ['time'], required: true, sourceType: 'runtime' }],
    variables: [{ code: 'u', name: '启停状态', variableType: 'binary', indices: ['time'], domain: 'Binary' }],
  },
  components: [{
    component_id: 'startup_logic',
    name: '启停逻辑组件',
    enabled: true,
    parameters: [{ code: 'startup_cost', name: '启动成本', unit: '元/次', required: true, dimension: ['time'] }],
    generated_constraints: [{ constraint_id: 'startup_logic', name: '启停逻辑', formula: 'u[t] >= 0' }],
  }],
  formulas: [],
  runtime_parameters: { horizon: 3, startup_cost: [100, 100, 100] },
  parameter_groups: { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} },
  advanced: {},
};

const persistedDraftState = {
  draft: workbenchDraft,
  modelDraft: workbenchDraft,
  step: 0,
  selectedScenarioId: 'unit_commitment_day_ahead',
  selectedModelId: 'unit_commitment_day_ahead',
  builderMode: 'component_based',
  loadedTemplate: null,
  validationResult: null,
  currentDraftModelId: undefined,
};

test('model creation workbench progress and binding drawer flow', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(state => {
    window.localStorage.setItem('copt-model-creation-draft', JSON.stringify({ state, version: 0 }));
  }, persistedDraftState);

  await page.goto('/models/create');

  await expect(page.locator('.model-progress-card')).toBeVisible();
  await expect(page.locator('.model-build-summary')).toBeVisible();
  await expect(page.locator('.step-navigator')).toHaveCount(0);
  await expect(page.getByText('五步建模流程', { exact: true })).toBeVisible();

  await page.getByText('2 模型语义', { exact: true }).click();
  await expect(page.locator('.semantic-workbench')).toBeVisible();
  await expect(page.getByText('语义结构概览')).toBeVisible();
  await expect(page.getByText('组件与依赖')).toBeVisible();
  await expect(page.getByText('startup_cost')).toHaveCount(2);

  await page.getByRole('button', { name: /绑定/ }).last().click();
  await expect(page.getByText('编辑参数绑定')).toBeVisible();
  await expect(page.getByText('启停逻辑组件 / startup_cost')).toBeVisible();
  await expect(page.getByText(/startup_cost.*必填映射/)).toBeVisible();
  await page.getByPlaceholder('例如 startup_cost').fill('startup_cost');
  await page.getByRole('button', { name: '保存并校验' }).click();
  await expect(page.getByText('编辑参数绑定')).toBeHidden();

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByText(/当前步骤：校验发布/)).toBeVisible();
  await expect(page.getByText('发布前校验全部通过')).toBeVisible();
});
