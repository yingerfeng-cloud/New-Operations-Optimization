import { act, screen } from '@testing-library/react';
import { fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ModelCreationPage } from '../../features/model-creation/ModelCreationPage';
import { useModelCreationStore } from '../../features/model-creation/stores/modelCreationStore';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../api/templates', () => ({ getTemplates: async () => [], getTemplateDetail: vi.fn() }));
const modelApi = vi.hoisted(() => ({
  getModel: vi.fn(async () => ({
    id: 'MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD',
    name: '日前机组组合优化 Unit Commitment',
    scene: '日前机组组合优化',
    version: 'v1',
    status: 'published',
    solver: 'HiGHS',
    problem_type: 'MILP',
    model_problem_type: 'MILP',
    build_mode: 'template_based',
    updated_at: '2026-07-07',
    template_id: 'unit_commitment_day_ahead',
    semantic_spec: {
      sets: [{ code: 'unit', name: '机组' }, { code: 'time', name: '时段' }],
      parameters: [{ code: 'load_forecast', name: '负荷预测', dimension: ['time'] }],
      variables: [{ code: 'unit_output', name: '机组出力', dimension: ['unit', 'time'] }],
    },
    model_draft: {
      basic_info: {
        name: '日前机组组合优化 Unit Commitment',
        model_code: 'unit_commitment_day_ahead',
        scenario: '日前机组组合优化',
        builder_mode: 'template_based',
        solver: 'HiGHS',
      },
      semantic: {
        sets: [{ code: 'unit', name: '机组' }, { code: 'time', name: '时段' }],
        parameters: [{ code: 'load_forecast', name: '负荷预测', dimension: ['time'] }],
        variables: [{ code: 'unit_output', name: '机组出力', dimension: ['unit', 'time'] }],
      },
      constraints: [{ constraint_id: 'power_balance', name: '功率平衡', expression: 'sum(unit_output[unit,time]) >= load_forecast[time]' }],
      objective: { sense: 'minimize', terms: [{ term_id: 'total_cost_min', name: '总成本最小', expression: 'sum(fuel_cost[unit]*unit_output[unit,time])' }] },
      components: [],
      formulas: [],
      runtime_parameters: { horizon: 24 },
      parameter_groups: {},
      advanced: {},
    },
  })),
  createModel: vi.fn(async () => ({ id: 'MODEL-1', status: 'draft' })),
  updateModel: vi.fn(async (id: string) => ({ id, status: 'draft' })),
  publishModel: vi.fn(async (id: string) => ({ id, status: 'published' })),
  testModel: vi.fn(async (id: string) => ({ id, status: 'tested' })),
}));

vi.mock('../../api/models', () => ({
  getModel: modelApi.getModel,
  createModel: modelApi.createModel,
  updateModel: modelApi.updateModel,
  publishModel: modelApi.publishModel,
  testModel: modelApi.testModel,
}));

beforeEach(() => {
  useModelCreationStore.getState().reset();
  modelApi.createModel.mockClear();
  modelApi.getModel.mockClear();
  modelApi.updateModel.mockClear();
  modelApi.publishModel.mockClear();
  modelApi.testModel.mockClear();
});

function renderPage(initialEntries = ['/models/create']) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={initialEntries}>
      <ModelCreationPage />
    </MemoryRouter>,
  );
}

function getTestRunButton() {
  return screen.getByTestId('model-test-run-button');
}

function clickTestRun() {
  fireEvent.click(getTestRunButton());
}

test('renders five-step model creation', () => {
  renderPage();
  expect(screen.getByText('模型创建')).toBeInTheDocument();
  expect(screen.getByText('校验发布')).toBeInTheDocument();
});

test('defaults Step1 to unit commitment scenario and model summary', () => {
  renderPage();
  expect(screen.getAllByText('日前机组组合优化').length).toBeGreaterThan(0);
  expect(screen.getByText('日前机组组合优化模型')).toBeInTheDocument();
  expect(screen.getByText('MILP / 机组组合')).toBeInTheDocument();
  expect(screen.queryByText('待系统诊断')).not.toBeInTheDocument();
});

test('scenario selection refreshes current model summary without stale content', () => {
  renderPage();
  act(() => {
    useModelCreationStore.getState().selectCatalogModel('cascade_hydro_day_ahead');
  });

  expect(screen.getByText('梯级水电日前调度模型')).toBeInTheDocument();
  expect(screen.getByText('组件化 / 梯级水电调度')).toBeInTheDocument();
  expect(screen.queryByText('MILP / 机组组合')).not.toBeInTheDocument();
  expect(screen.queryByText('日前机组组合优化模型')).not.toBeInTheDocument();
});

test('test run saves draft before invoking backend test', async () => {
  act(() => {
    const state = useModelCreationStore.getState();
    useModelCreationStore.setState({
      step: 4,
      draft: {
        ...state.draft,
        basic_info: { ...state.draft.basic_info, builder_mode: 'component_based' },
        components: [{ component_id: 'power_balance', enabled: true }],
      },
    });
  });
  renderPage(['/models/create?testStep=review']);

  await act(async () => {
    clickTestRun();
  });
  await waitFor(() => expect(modelApi.createModel).toHaveBeenCalledTimes(1));
  expect(modelApi.testModel).toHaveBeenCalledWith('MODEL-1', expect.any(Object));
  expect(modelApi.createModel).toHaveBeenCalledTimes(1);
  expect(modelApi.updateModel).not.toHaveBeenCalled();
});

test('editing published unit commitment opens as a new draft source', async () => {
  renderPage(['/models/create?source=MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD']);

  await waitFor(() => expect(useModelCreationStore.getState().draft.basic_info.model_code).toBe('unit_commitment_day_ahead'));
  expect(useModelCreationStore.getState().draft.basic_info.name).toContain('日前机组组合优化');
  expect(useModelCreationStore.getState().currentDraftModelId).toBeUndefined();
});
