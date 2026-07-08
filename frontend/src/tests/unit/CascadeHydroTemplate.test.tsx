import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { Step3MathExpansion } from '../../features/model-creation/steps/Step3MathExpansion';
import { Step5ReviewPublish } from '../../features/model-creation/steps/Step5ReviewPublish';
import { ResultCascadeHydroPanel } from '../../features/result-center/ResultPanels';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { applyTemplateToDraft } from '../../features/model-creation/utils/applyTemplateToDraft';
import { renderWithQueryClient } from '../testUtils';
import type { ModelTemplate } from '../../types/template';

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="mock-chart">chart</div> }));

const cascadeTemplate: ModelTemplate = {
  code: 'cascade_hydro_dispatch_v1',
  name: '梯级水电调度 v1',
  version: 'v1.0',
  status: 'published',
  tags: ['power', 'hydro', 'MILP', 'piecewise_1d', 'piecewise_2d'],
  scenario: '日前/日内水电优化调度',
  description: '使用 1D PWL + 2D PWL 函数资产构建 MILP。',
  build_mode: 'template_based',
  problem_type: 'MILP',
  solver: 'HiGHS',
  model_draft: {
    basic_info: {
      name: '梯级水电调度 v1',
      model_code: 'cascade_hydro_dispatch_v1',
      scenario: '日前/日内水电优化调度',
      builder_mode: 'template_based',
      solver: 'HiGHS',
      problem_type: 'MILP',
    },
    semantic: {
      sets: [{ code: 'reservoir', name: '水库/电站集合', values: ['R1', 'R2'] }, { code: 'time', name: '调度时段', values: [0, 1] }],
      parameters: [{ code: 'inflow', name: '天然来水', dimension: ['reservoir', 'time'] }],
      variables: [{ code: 'storage', name: '库容', dimension: ['reservoir', 'time'] }],
    },
    components: [
      { component_id: 'water_balance_component', name: '水量平衡组件', generated_constraints: [{ constraint_id: 'water_balance', name: '水量平衡约束' }] },
      { component_id: 'function_mapping_component', type: 'function_mapping_component', name: '水位库容函数映射', function_asset_id: 'cascade_hydro_level_storage_v1', x: 'storage[r,t]', y: 'level[r,t]', solve_strategy: 'convex_combination_lp' },
      { component_id: 'function_mapping_component', type: 'function_mapping_component', name: '尾水位流量函数映射', function_asset_id: 'cascade_hydro_tailwater_outflow_v1', x: 'outflow[r,t]', y: 'tailwater[r,t]', solve_strategy: 'convex_combination_lp' },
      { component_id: 'function_mapping_2d_component', type: 'function_mapping_2d_component', name: '二维出力曲面函数映射', function_asset_id: 'cascade_hydro_power_surface_v1', x: 'outflow[r,t]', y: 'head[r,t]', z: 'power[r,t]', solve_strategy: 'triangulated_milp_exact', metadata: { triangle_count: 1 } },
      { component_id: 'terminal_storage_constraint', name: '期末库容约束', generated_constraints: [{ constraint_id: 'terminal_storage', name: '期末库容约束' }] },
    ],
    formulas: [],
    constraints: [],
    objective: { sense: 'maximize', terms: [] },
    runtime_parameters: { horizon: 2, time: [0, 1] },
    advanced: {
      component_spec: {
        model_problem_type: 'MILP',
        problem_type_diagnosis: {
          inferred_problem_type: 'MILP',
          recommended_solver: 'HiGHS',
          function_assets_used: [
            { function_asset_id: 'cascade_hydro_level_storage_v1', component: '水位库容函数映射', solve_strategy: 'convex_combination_lp' },
            { function_asset_id: 'cascade_hydro_tailwater_outflow_v1', component: '尾水位流量函数映射', solve_strategy: 'convex_combination_lp' },
            { function_asset_id: 'cascade_hydro_power_surface_v1', component: '二维出力曲面函数映射', solve_strategy: 'triangulated_milp_exact' },
          ],
          linearization_strategy: ['convex_combination_lp', 'triangulated_milp_exact'],
        },
      },
    },
  } as Partial<ModelDraft>,
};

vi.mock('../../api/models', () => ({
  getModels: async () => [],
  getModel: async () => undefined,
  getModelAssetDetail: async () => ({}),
  publishModel: vi.fn(),
  testModel: vi.fn(),
  copyModel: vi.fn(),
  offlineModel: vi.fn(),
}));

vi.mock('../../api/templates', () => ({
  getTemplates: async () => [cascadeTemplate],
  cloneTemplate: vi.fn(async () => ({ id: 'MODEL-CASCADE', name: '梯级水电调度 v1', status: 'developing' })),
}));

vi.mock('../../api/functionAssets', () => ({
  getFunctionAssets: async () => [],
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

function cascadeDraft() {
  return applyTemplateToDraft(createInitialDraft(), cascadeTemplate, '日前/日内水电优化调度');
}

test('梯级水电模板卡片元数据完整', () => {
  expect(cascadeTemplate.name).toBe('梯级水电调度 v1');
  expect(cascadeTemplate.problem_type).toBe('MILP');
  expect(cascadeTemplate.tags).toEqual(expect.arrayContaining(['piecewise_1d', 'piecewise_2d']));
  expect(cascadeTemplate.scenario).toBe('日前/日内水电优化调度');
});

test('模型创建可加载梯级水电模板', () => {
  const draft = cascadeDraft();
  expect(draft.basic_info.model_code).toBe('cascade_hydro_dispatch_v1');
  expect(draft.basic_info.name).toBe('梯级水电调度 v1');
  expect(draft.components.some(component => component.name === '水量平衡组件')).toBe(true);
  expect(draft.components.some(component => component.name === '二维出力曲面函数映射')).toBe(true);
});

test('Step3 展示梯级水电核心组件', () => {
  renderWithQueryClient(<Step3MathExpansion draft={cascadeDraft()} onChange={vi.fn()} />);
  fireEvent.click(screen.getByText('高级调试'));
  expect(screen.getAllByText('水量平衡组件').length).toBeGreaterThan(0);
  expect(screen.getAllByText('水位库容函数映射').length).toBeGreaterThan(0);
  expect(screen.getAllByText('尾水位流量函数映射').length).toBeGreaterThan(0);
  expect(screen.getAllByText('二维出力曲面函数映射').length).toBeGreaterThan(0);
  expect(screen.getAllByText('期末库容约束').length).toBeGreaterThan(0);
});

test('Step5 展示函数资产和 MILP 风险诊断', () => {
  const draft = cascadeDraft();
  draft.runtime_parameters = { horizon: 24, time: Array.from({ length: 24 }, (_, index) => index) };
  renderWithQueryClient(
    <Step5ReviewPublish
      draft={draft}
      validation={{ valid: true, sections: {} }}
      onPublish={vi.fn()}
      onTest={vi.fn()}
    />,
  );
  expect(screen.getByText('发布诊断')).toBeInTheDocument();
  const diagnosisCard = screen.getByText('发布诊断').closest('.ant-card') as HTMLElement;
  expect(within(diagnosisCard).getByText('3')).toBeInTheDocument();
  expect(screen.getByText('二维 PWL 风险诊断')).toBeInTheDocument();
  expect(screen.getByText('cascade_hydro_power_surface_v1')).toBeInTheDocument();
  expect(screen.getByText('MILP 二进制变量风险')).toBeInTheDocument();
});

test('结果中心展示水电结果解释视图', () => {
  renderWithQueryClient(
    <ResultCascadeHydroPanel
      result={{
        status: 'SUCCESS',
        metrics: { total_generation_MWh: 1200, total_spill_million_m3: 0, binary_variable_count: 48 },
        business_output: {
          storage_curve: [{ time: 0, reservoir: 'R1', storage: 120 }],
          outflow_curve: [{ time: 0, reservoir: 'R1', outflow: 100 }],
          power_curve: [{ time: 0, reservoir: 'R1', power: 45 }],
          spill_curve: [{ time: 0, reservoir: 'R1', spill: 0 }],
          water_balance_check: [{ time: 0, reservoir: 'R1', balance_error: 0 }],
          function_asset_interpolation: [{
            time: 0,
            reservoir: 'R1',
            level_storage: { function_asset_id: 'cascade_hydro_level_storage_v1' },
            tailwater_outflow: { function_asset_id: 'cascade_hydro_tailwater_outflow_v1' },
            power_surface: { function_asset_id: 'cascade_hydro_power_surface_v1', selected_triangle: 0, lambda_weights: [1, 0, 0] },
          }],
        },
      }}
    />,
  );
  expect(screen.getByText('库容过程曲线')).toBeInTheDocument();
  expect(screen.getByText('出库流量曲线')).toBeInTheDocument();
  expect(screen.getByText('出力曲线')).toBeInTheDocument();
  expect(screen.getByText('弃水曲线')).toBeInTheDocument();
  expect(screen.getByText('水量平衡校验表')).toBeInTheDocument();
  expect(screen.getByText('函数资产插值解释')).toBeInTheDocument();
  expect(screen.getByText(/cascade_hydro_power_surface_v1/)).toBeInTheDocument();
});
