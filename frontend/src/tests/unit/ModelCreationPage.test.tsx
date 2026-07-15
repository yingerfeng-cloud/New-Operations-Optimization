import { act, screen } from '@testing-library/react';
import { fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import { ModelCreationPage } from '../../features/model-creation/ModelCreationPage';
import { useModelCreationStore } from '../../features/model-creation/stores/modelCreationStore';
import type { ModelTemplate } from '../../types/template';
import { renderWithQueryClient } from '../testUtils';

const templateApi = vi.hoisted(() => ({
  getTemplateDetail: vi.fn<(code: string) => Promise<ModelTemplate>>(async (code: string) => ({
    code,
    name: code === 'template_b' ? '模板 B' : '模板 A',
    scenario: '日前机组组合优化',
    build_mode: 'component_based',
    model_draft: {
      semantic: { sets: [{ code: 'time' }], parameters: [{ code: 'load' }], variables: [{ code: 'p', variableType: 'continuous' }] },
      components: [{ component_id: `${code}_component` }],
      formulas: [{ formula_id: `${code}_formula`, name: '平衡', kind: 'constraint', display_formula: 'p=load', dsl_formula: 'p=load', tokens: [], foreach: [], referenced_sets: [], referenced_parameters: [], referenced_variables: [], free_indices: [], compile_status: 'ready' }],
      runtime_parameters: { horizon: 24 },
    },
  })),
}));
vi.mock('../../api/templates', () => ({ getTemplates: async () => [], getTemplateDetail: templateApi.getTemplateDetail }));
const modelApi = vi.hoisted(() => ({
  getModel: vi.fn(async (id = 'MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD') => ({
    id,
    name: id === 'MODEL-B' ? '模型 B' : '日前机组组合优化 Unit Commitment',
    scene: '日前机组组合优化',
    version: 'v1',
    status: id === 'MODEL-B' ? 'draft' : 'published',
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
        name: id === 'MODEL-B' ? '模型 B' : '日前机组组合优化 Unit Commitment',
        model_code: id === 'MODEL-B' ? 'model_b' : 'unit_commitment_day_ahead',
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
  templateApi.getTemplateDetail.mockClear();
});

function renderPage(initialEntries = ['/models/create']) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={initialEntries}>
      <ModelCreationPage />
    </MemoryRouter>,
  );
}

function RaceHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/models/create?mode=template&template=template_b')}>切换到 B</button>
      <button onClick={() => navigate('/models/MODEL-B/edit')}>编辑模型 B</button>
      <Routes>
        <Route path="/models/create" element={<ModelCreationPage />} />
        <Route path="/models/:id/edit" element={<ModelCreationPage />} />
      </Routes>
    </>
  );
}

function getTestRunButton() {
  return screen.getByTestId('model-test-run-button');
}

function clickTestRun() {
  fireEvent.click(getTestRunButton());
}

test('renders five-step model creation', async () => {
  renderPage();
  expect(await screen.findByText('新建模型')).toBeInTheDocument();
  expect(screen.getByText('校验发布')).toBeInTheDocument();
});

test('new mode does not inherit a catalog scenario or model', async () => {
  renderPage();
  await screen.findByText('新建模型');
  expect(useModelCreationStore.getState().draft.basic_info.scenario).toBe('');
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('');
  expect(useModelCreationStore.getState().draft.semantic.sets).toEqual([]);
  expect(screen.getAllByText('未选择').length).toBeGreaterThan(0);
});

test('editing draft A then entering new mode replaces A with a blank draft', async () => {
  useModelCreationStore.getState().setDraft({
    ...useModelCreationStore.getState().draft,
    basic_info: { ...useModelCreationStore.getState().draft.basic_info, name: '模型 A', scenario: '旧场景' },
    components: [{ component_id: 'old' }],
  });
  renderPage();
  await screen.findByText('新建模型');
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('');
  expect(useModelCreationStore.getState().draft.basic_info.scenario).toBe('');
  expect(useModelCreationStore.getState().draft.components).toEqual([]);
});

test('test run saves draft before invoking backend test', async () => {
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '测试模型', scenario: '测试场景', builder_mode: 'component_based' as const },
      components: [{ component_id: 'power_balance', enabled: true }],
    };
    useModelCreationStore.setState({
      step: 4,
      draft: nextDraft,
      modelDraft: nextDraft,
    });
  });

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
  expect(useModelCreationStore.getState().workspace.mode).toBe('version');
  expect(useModelCreationStore.getState().draft.basic_info.name).toContain('日前机组组合优化');
  expect(useModelCreationStore.getState().currentDraftModelId).toBeUndefined();
});

test('template mode loads complete backend template content', async () => {
  renderPage(['/models/create?mode=template&template=template_a']);
  expect(await screen.findByText('从模板创建模型')).toBeInTheDocument();
  const state = useModelCreationStore.getState();
  expect(state.workspace).toEqual(expect.objectContaining({ mode: 'template', templateCode: 'template_a' }));
  expect(state.draft.semantic.sets).toEqual([expect.objectContaining({ code: 'time' })]);
  expect(state.draft.semantic.parameters).toEqual([expect.objectContaining({ code: 'load' })]);
  expect(state.draft.semantic.variables).toEqual([expect.objectContaining({ code: 'p' })]);
  expect(state.draft.components).toEqual([expect.objectContaining({ component_id: 'template_a_component' })]);
  expect(state.draft.formulas).toHaveLength(1);
  expect(state.draft.runtime_parameters).toEqual(expect.objectContaining({ horizon: 24 }));
});

test('late template A response cannot overwrite newer template B', async () => {
  let resolveA!: (value: Awaited<ReturnType<typeof templateApi.getTemplateDetail>>) => void;
  const templateA = new Promise<Awaited<ReturnType<typeof templateApi.getTemplateDetail>>>(resolve => { resolveA = resolve; });
  templateApi.getTemplateDetail
    .mockImplementationOnce(() => templateA)
    .mockImplementationOnce(async code => ({
      code,
      name: '模板 B',
      scenario: '日前机组组合优化',
      build_mode: 'component_based',
      model_draft: { semantic: { sets: [{ code: 'b_set' }], parameters: [], variables: [] }, components: [{ component_id: 'b_component' }], formulas: [], runtime_parameters: { source: 'B' } },
    }));

  renderWithQueryClient(
    <MemoryRouter initialEntries={['/models/create?mode=template&template=template_a']}>
      <RaceHarness />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('切换到 B'));
  await screen.findByText('从模板创建模型');
  expect(useModelCreationStore.getState().draft.runtime_parameters).toEqual({ source: 'B' });

  resolveA({
    code: 'template_a',
    name: '模板 A',
    scenario: '日前机组组合优化',
    build_mode: 'generic_linear',
    model_draft: { semantic: { sets: [{ code: 'a_set' }], parameters: [], variables: [] }, components: [], formulas: [], runtime_parameters: { source: 'A' } },
  });
  await waitFor(() => expect(templateApi.getTemplateDetail).toHaveBeenCalledTimes(2));
  expect(useModelCreationStore.getState().workspace.templateCode).toBe('template_b');
  expect(useModelCreationStore.getState().draft.runtime_parameters).toEqual({ source: 'B' });
});

test('editing model A then routing to model B clears A and loads B', async () => {
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/models/create?mode=version&source=MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD']}>
      <RaceHarness />
    </MemoryRouter>,
  );
  await screen.findByText('创建模型新版本');
  expect(useModelCreationStore.getState().draft.basic_info.name).toContain('日前机组组合优化');

  fireEvent.click(screen.getByText('编辑模型 B'));
  await screen.findByText('编辑模型草稿');
  expect(useModelCreationStore.getState().workspace).toEqual(expect.objectContaining({ mode: 'edit', sourceModelId: 'MODEL-B', currentAssetId: 'MODEL-B' }));
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('模型 B');
  expect(useModelCreationStore.getState().draft.basic_info.name).not.toContain('日前机组组合优化');
});

test('asset load failure blocks the workspace and never displays the previous draft', async () => {
  const state = useModelCreationStore.getState();
  state.setDraft({ ...state.draft, basic_info: { ...state.draft.basic_info, name: '不应显示的旧模型', scenario: '旧场景' } });
  modelApi.getModel.mockRejectedValueOnce(new Error('asset unavailable'));

  renderPage(['/models/create?mode=edit&source=MODEL-MISSING']);
  expect(await screen.findByText('目标模型加载失败')).toBeInTheDocument();
  expect(screen.queryByText('不应显示的旧模型')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '返回模型资产' })).toBeInTheDocument();
});
