import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import {
  ModelComponentPanel,
  ModelGenericPanel,
  ModelGovernancePanel,
  ModelHistoryPanel,
  ModelRuntimePanel,
  ModelSemanticPanel,
} from '../../features/model-center/ModelAssetPanels';
import { ModelCenterPage } from '../../pages/ModelCenter/ModelCenterPage';
import type { ModelAsset } from '../../types/model';
import { renderWithQueryClient } from '../testUtils';

const testState = vi.hoisted(() => {
  const modelSample: ModelAsset = {
    id: 'model_001',
    template_id: 'day_ahead_dispatch',
    name: '日前调度模型',
    scene: 'power_dispatch',
    version: 'v1.0',
    status: 'published',
    solver: 'HiGHS',
    problem_type: 'LP',
    model_problem_type: 'LP',
    build_mode: 'generic_linear',
    updated_at: '2026-06-23 12:00:00',
    published_at: '2026-06-23 12:10:00',
    tested_at: '2026-06-23 12:20:00',
    semantic_spec: {
      sets: [{ code: 'time', name: '时段' }],
      parameters: [{ code: 'load', name: '负荷', dimension: ['time'], unit: 'MW' }],
      variables: [{ code: 'p_grid', name: '电网功率', dimension: ['time'], unit: 'MW' }],
    },
    generic_spec: {
      sets: { time: [1, 2] },
      variables: [{ name: 'p_grid', indices: ['time'], lb: 0 }],
      constraints: [{ name: '负荷平衡', formula: 'p_grid[t] == load[t]' }],
      objective: { sense: 'min', terms: [{ name: '购电成本', formula: 'price[t] * p_grid[t]', coef_param: 'price' }] },
    },
    component_spec: {
      components: [{ component_id: 'power_balance', version: '1.0.0', enabled: true }],
    },
    parameter_schema: {
      parameters: [{ code: 'load', name: '负荷', dimension: ['time'], required: true, default_value: [10, 12] }],
      parameter_bindings: [{ component_parameter: 'load', model_parameter: 'load', status: 'bound' }],
    },
    parameters: { load: [10, 12] },
    validation_warnings: [{ field: 'solver', message: '测试用例未覆盖极端负荷' }],
    dry_run_result: {
      structure_check: { status: 'passed', errors: [] },
      solver_check: { status: 'passed', warnings: [] },
    },
  };
  return {
    routeId: 'model_001' as string | undefined,
    modelSample,
    assetDetail: {
      basic_info: modelSample,
      semantic_spec: modelSample.semantic_spec,
      generic_spec: modelSample.generic_spec,
      component_spec: modelSample.component_spec,
      parameter_schema: modelSample.parameter_schema,
      parameters: modelSample.parameters,
      publish_info: {
        status: 'published',
        published_at: modelSample.published_at,
        tested_at: modelSample.tested_at,
        dry_run_status: 'passed',
        dry_run_result: modelSample.dry_run_result,
      },
      skill_info: { skill_name: 'run_day_ahead_dispatch', model_version: 'v1.0' },
      version_info: {
        version: 'v1.0',
        parameter_schema_version: '1.0.0',
        objective_version: '1.0.0',
        component_versions: [{ component_id: 'power_balance', version: '1.0.0' }],
      },
      recent_invocations: [{ created_at: '2026-06-23 12:30:00', caller: 'api', status: 'success', objective_value: 120 }],
      recent_tasks: [{ task_id: 'task_001', status: 'completed', duration_seconds: 2 }],
    },
    publishModel: vi.fn(async (id: string) => ({ ...modelSample, id, status: 'published' })),
    testModel: vi.fn(async (id: string) => ({ ...modelSample, id, status: 'tested' })),
    copyModel: vi.fn(async (id: string) => ({ ...modelSample, id: `${id}_copy`, name: '日前调度模型 副本' })),
    offlineModel: vi.fn(async (id: string) => ({ ...modelSample, id, status: 'offline' })),
    getModel: vi.fn(async (id: string) => ({ ...modelSample, id, name: id === 'model_002' ? '模型 B' : modelSample.name })),
    getModelAssetDetail: vi.fn(async (id: string): Promise<any> => ({ ...modelSample, id })),
  };
});

vi.mock('../../api/models', () => ({
  getModels: async () => [testState.modelSample],
  getModel: testState.getModel,
  getModelAssetDetail: testState.getModelAssetDetail,
  publishModel: testState.publishModel,
  testModel: testState.testModel,
  copyModel: testState.copyModel,
  offlineModel: testState.offlineModel,
}));

vi.mock('../../api/templates', () => ({
  getTemplates: async () => [{ code: 'day_ahead_dispatch', name: '日前调度模板', scenario: 'power_dispatch' }],
  cloneTemplate: vi.fn(async () => testState.modelSample),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate, useParams: () => ({ id: testState.routeId }) };
});

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ModelCenterPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  testState.routeId = 'model_001';
  testState.getModel.mockClear();
  testState.getModelAssetDetail.mockClear();
  testState.getModelAssetDetail.mockImplementation(async (id: string) => ({
    ...testState.assetDetail,
    basic_info: { ...testState.modelSample, id },
  }));
});

test('renders model center metrics and basic asset detail', async () => {
  renderPage();
  expect(screen.getByText('模型资产中心')).toBeInTheDocument();
  expect((await screen.findAllByText('日前调度模型')).length).toBeGreaterThan(0);
  expect(screen.getByText('可调用模型')).toBeInTheDocument();
  expect(screen.getByText(/组件化\s*0\s*\/\s*通用线性\s*1/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '查看' }));

  await waitFor(() => expect(screen.getByText('模型服务接口')).toBeInTheDocument());
  expect(screen.getByText('run_day_ahead_dispatch')).toBeInTheDocument();
}, 30000);

test('renders semantic and generic model panels', () => {
  cleanup();
  render(<ModelSemanticPanel model={testState.modelSample} detail={testState.assetDetail} />);
  expect(screen.getByText('负荷')).toBeInTheDocument();
  expect(screen.getByText('电网功率')).toBeInTheDocument();

  cleanup();
  render(<ModelGenericPanel model={testState.modelSample} detail={testState.assetDetail} />);
  expect(screen.getByText('负荷平衡')).toBeInTheDocument();
  expect(screen.getByText('购电成本')).toBeInTheDocument();
}, 30000);

test('renders template-based unit commitment math from asset detail fallbacks', () => {
  cleanup();
  render(
    <ModelGenericPanel
      model={{
        ...testState.modelSample,
        id: 'MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD',
        name: '日前机组组合优化 Unit Commitment',
        template_id: 'unit_commitment_day_ahead',
        build_mode: 'template_based',
        problem_type: 'MILP',
        model_problem_type: 'MILP',
        generic_spec: {},
      }}
      detail={{
        constraints: [
          { constraint_id: 'power_balance', name: '功率平衡', expression: 'sum(unit_output[unit,time]) >= load_forecast[time]' },
          { constraint_id: 'reserve_margin', name: '备用约束', expression: 'sum(unit_max_output[unit]*unit_on[unit,time]) >= load_forecast[time]*(1+reserve_ratio)' },
        ],
        objective: {
          sense: 'minimize',
          terms: [{ term_id: 'total_cost_min', name: '总成本最小', expression: 'sum(fuel_cost[unit]*unit_output[unit,time])' }],
        },
      }}
    />,
  );
  expect(screen.getByText('功率平衡')).toBeInTheDocument();
  expect(screen.getByText('备用约束')).toBeInTheDocument();
  expect(screen.getByText('总成本最小')).toBeInTheDocument();
}, 30000);

test('renders component and runtime model panels', () => {
  cleanup();
  render(<ModelComponentPanel model={testState.modelSample} detail={testState.assetDetail} />);
  expect(screen.getByText('power_balance')).toBeInTheDocument();

  cleanup();
  render(<ModelRuntimePanel model={testState.modelSample} detail={testState.assetDetail} />);
  expect(screen.getByText('默认运行参数')).toBeInTheDocument();
}, 30000);

test('renders governance and history model panels', () => {
  cleanup();
  render(<ModelGovernancePanel model={testState.modelSample} detail={testState.assetDetail} />);
  expect(screen.getByText('结构 dry-run')).toBeInTheDocument();

  cleanup();
  render(<ModelHistoryPanel detail={testState.assetDetail} />);
  expect(screen.getByText('task_001')).toBeInTheDocument();
}, 30000);

test('runs model asset operations from list', async () => {
  testState.routeId = undefined;
  renderPage();
  expect((await screen.findAllByText('日前调度模型')).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: /更多/ }));
  fireEvent.click((await screen.findAllByText('测试运行')).at(-1) as HTMLElement);
  await waitFor(() => expect(testState.testModel).toHaveBeenCalledWith('model_001', { parameters: { load: [10, 12] } }));

  fireEvent.click(screen.getByRole('button', { name: /更多/ }));
  fireEvent.click((await screen.findAllByText('下线模型')).at(-1) as HTMLElement);
  await waitFor(() => expect(testState.offlineModel.mock.calls[0]?.[0]).toBe('model_001'));

  fireEvent.click(screen.getByRole('button', { name: /更多/ }));
  fireEvent.click((await screen.findAllByText('复制模型')).at(-1) as HTMLElement);
  expect(navigate).toHaveBeenCalledWith('/models/create?mode=clone&source=model_001');
}, 30000);

test('model detail follows route id changes and close returns to models', async () => {
  const view = renderPage();
  await waitFor(() => expect(testState.getModel).toHaveBeenCalledWith('model_001'));
  testState.routeId = 'model_002';
  view.rerender(<MemoryRouter><ModelCenterPage /></MemoryRouter>);
  await waitFor(() => expect(testState.getModel).toHaveBeenCalledWith('model_002'));
  expect(await screen.findByText('模型 B')).toBeInTheDocument();
  fireEvent.click(document.querySelector('.ant-drawer-close') as HTMLButtonElement);
  expect(navigate).toHaveBeenCalledWith('/models');
}, 30000);
