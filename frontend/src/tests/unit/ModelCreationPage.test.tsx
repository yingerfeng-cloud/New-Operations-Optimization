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
const systemApi = vi.hoisted(() => ({
  scenarioItems: [{ code: 'day_ahead_unit_commitment', label: '日前机组组合优化', enabled: true, sort_order: 1 }],
  getSystemConfig: vi.fn(async () => ({ dictionaries: { business_scenarios: systemApi.scenarioItems } })),
}));
vi.mock('../../api/systemConfig', () => ({ getSystemConfig: systemApi.getSystemConfig }));
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
  createModelVersion: vi.fn(async () => ({ id: 'MODEL-VERSION-1', status: 'draft' })),
  updateModel: vi.fn(async (id: string) => ({ id, status: 'draft' })),
  publishModel: vi.fn(async (id: string) => ({ id, status: 'published' })),
  testModel: vi.fn(async (id: string) => ({ id, status: 'tested' })),
}));

vi.mock('../../api/models', () => ({
  getModel: modelApi.getModel,
  createModel: modelApi.createModel,
  createModelVersion: modelApi.createModelVersion,
  updateModel: modelApi.updateModel,
  publishModel: modelApi.publishModel,
  testModel: modelApi.testModel,
}));

beforeEach(() => {
  useModelCreationStore.getState().reset();
  modelApi.createModel.mockClear();
  modelApi.createModelVersion.mockClear();
  modelApi.getModel.mockClear();
  modelApi.updateModel.mockClear();
  modelApi.publishModel.mockClear();
  modelApi.testModel.mockClear();
  templateApi.getTemplateDetail.mockClear();
  systemApi.scenarioItems = [{ code: 'day_ahead_unit_commitment', label: '日前机组组合优化', enabled: true, sort_order: 1 }];
  systemApi.getSystemConfig.mockClear();
});

function renderPage(initialEntries = ['/models/create']) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/models/create" element={<ModelCreationPage />} />
        <Route path="/models/:id/edit" element={<ModelCreationPage />} />
        <Route path="/models/:id" element={<div>模型详情</div>} />
      </Routes>
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
        <Route path="/models/:id" element={<div>模型详情</div>} />
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

test('save test and publish use one asset without creating a second model', async () => {
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '一致性模型', scenario: '测试场景', builder_mode: 'component_based' as const },
      components: [{ component_id: 'power_balance', enabled: true }],
    };
    useModelCreationStore.setState({ step: 4, draft: nextDraft, modelDraft: nextDraft });
  });

  fireEvent.click(getTestRunButton());
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledWith('MODEL-1', expect.any(Object)));
  const publishButton = screen.getByRole('button', { name: /发布模型/ });
  await waitFor(() => expect(publishButton).not.toBeDisabled());
  expect(screen.getAllByRole('button', { name: /发布模型/ })).toHaveLength(1);
  await act(async () => { fireEvent.click(publishButton); });

  await waitFor(() => expect(modelApi.publishModel).toHaveBeenCalledWith('MODEL-1'));
  expect(modelApi.createModel).toHaveBeenCalledTimes(1);
  expect(modelApi.createModelVersion).not.toHaveBeenCalled();
});

test('editing while a test is running keeps the returned snapshot outdated', async () => {
  const pendingTest = deferred<{ id: string; status: string }>();
  modelApi.testModel.mockImplementationOnce(() => pendingTest.promise);
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '测试快照 A', scenario: '测试场景', builder_mode: 'component_based' as const },
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 24 }] },
      components: [{ component_id: 'power_balance', enabled: true }],
      runtime_parameters: { limit: 24 },
    };
    useModelCreationStore.setState({ step: 4, draft: nextDraft, modelDraft: nextDraft });
  });

  fireEvent.click(getTestRunButton());
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledTimes(1));
  act(() => {
    const state = useModelCreationStore.getState();
    state.setDraft({
      ...state.draft,
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 48 }] },
      runtime_parameters: { limit: 48 },
    });
  });
  await act(async () => pendingTest.resolve({ id: 'MODEL-1', status: 'tested' }));

  expect(await screen.findByText('测试状态：已失效')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /发布模型/ })).toBeDisabled();
});

test('the latest test request wins when responses arrive out of order', async () => {
  const testA = deferred<{ id: string; status: string; marker: string }>();
  const testB = deferred<{ id: string; status: string; marker: string }>();
  modelApi.testModel
    .mockImplementationOnce(() => testA.promise)
    .mockImplementationOnce(() => testB.promise);
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '乱序测试', scenario: '测试场景', builder_mode: 'component_based' as const },
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 24 }] },
      components: [{ component_id: 'power_balance', enabled: true }],
      runtime_parameters: { limit: 24 },
    };
    useModelCreationStore.setState({ step: 4, draft: nextDraft, modelDraft: nextDraft });
  });

  fireEvent.click(getTestRunButton());
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledTimes(1));
  act(() => {
    const state = useModelCreationStore.getState();
    state.setDraft({
      ...state.draft,
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 48 }] },
      runtime_parameters: { limit: 48 },
    });
  });
  fireEvent.click(getTestRunButton());
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledTimes(2));

  await act(async () => testB.resolve({ id: 'MODEL-1', status: 'tested', marker: 'B' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /发布模型/ })).not.toBeDisabled());
  await act(async () => testA.resolve({ id: 'MODEL-1', status: 'tested', marker: 'A' }));

  expect(screen.getByRole('button', { name: /发布模型/ })).not.toBeDisabled();
  expect(screen.getByText(/"marker": "B"/)).toBeInTheDocument();
  expect(screen.queryByText(/"marker": "A"/)).not.toBeInTheDocument();
});

test('editing after a successful test invalidates publish without creating another asset', async () => {
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '待失效模型', scenario: '测试场景', builder_mode: 'component_based' as const },
      components: [{ component_id: 'power_balance', enabled: true }],
    };
    useModelCreationStore.setState({ step: 4, draft: nextDraft, modelDraft: nextDraft });
  });
  await act(async () => { fireEvent.click(getTestRunButton()); });
  await waitFor(() => expect(screen.getByRole('button', { name: /发布模型/ })).not.toBeDisabled());

  act(() => {
    const state = useModelCreationStore.getState();
    state.setDraft({ ...state.draft, basic_info: { ...state.draft.basic_info, name: '测试后已修改' } });
  });

  expect(screen.getByRole('button', { name: /发布模型/ })).toBeDisabled();
  expect(screen.getByText('测试状态：已失效')).toBeInTheDocument();
  expect(modelApi.createModel).toHaveBeenCalledTimes(1);
  expect(modelApi.publishModel).not.toHaveBeenCalled();
}, 120000);

test('retesting a changed draft updates and publishes the same asset', async () => {
  renderPage();
  await screen.findByText('新建模型');
  act(() => {
    const state = useModelCreationStore.getState();
    const nextDraft = {
      ...state.draft,
      basic_info: { ...state.draft.basic_info, name: '重新测试模型', scenario: '测试场景', builder_mode: 'component_based' as const },
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 24 }] },
      components: [{ component_id: 'power_balance', enabled: true }],
      runtime_parameters: { limit: 24 },
    };
    useModelCreationStore.setState({ step: 4, draft: nextDraft, modelDraft: nextDraft });
  });
  await act(async () => { fireEvent.click(getTestRunButton()); });
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledTimes(1));

  act(() => {
    const state = useModelCreationStore.getState();
    state.setDraft({
      ...state.draft,
      semantic: { ...state.draft.semantic, parameters: [{ code: 'limit', name: '限制', dimension: [], required: true, default_value: 48 }] },
      runtime_parameters: { limit: 48 },
    });
  });
  await waitFor(() => expect(screen.getByRole('button', { name: /发布模型/ })).toBeDisabled());

  await act(async () => { fireEvent.click(getTestRunButton()); });
  await waitFor(() => expect(modelApi.testModel).toHaveBeenCalledTimes(2));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /发布模型/ })); });
  await waitFor(() => expect(modelApi.publishModel).toHaveBeenCalledWith('MODEL-1'));
  expect(modelApi.createModel).toHaveBeenCalledTimes(1);
  expect(modelApi.updateModel).toHaveBeenCalledWith('MODEL-1', expect.any(Object));
}, 120000);

test('version mode creates its first saved asset through the version endpoint', async () => {
  renderPage(['/models/create?mode=version&source=MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD']);
  await screen.findByText('创建模型新版本');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(modelApi.createModelVersion).toHaveBeenCalledWith('MODEL-POWER-UNIT-COMMITMENT-DAY-AHEAD', expect.any(Object)));
  expect(modelApi.createModel).not.toHaveBeenCalled();
});

test('empty backend scenario dictionary does not fall back to static catalog', async () => {
  systemApi.scenarioItems = [];
  renderPage();
  expect(await screen.findByText('当前没有可用业务场景')).toBeInTheDocument();
  expect(screen.getByTestId('scenario-select')).toHaveClass('ant-select-disabled');
});

test('asset custom scenario remains visible when absent from current dictionary', async () => {
  const base = await modelApi.getModel('MODEL-B');
  modelApi.getModel.mockClear();
  modelApi.getModel.mockResolvedValueOnce({
    ...base,
    scene: '用户自定义场景',
    model_draft: {
      ...base.model_draft,
      basic_info: { ...base.model_draft.basic_info, scenario: '用户自定义场景' },
    },
  });
  renderPage(['/models/MODEL-B/edit']);
  await waitFor(() => expect(useModelCreationStore.getState().workspace.initialized).toBe(true));
  act(() => useModelCreationStore.getState().setStep(0));
  expect(await screen.findByText('用户自定义场景（历史/自定义场景）')).toBeInTheDocument();
  expect(screen.queryByText('业务场景未选择')).not.toBeInTheDocument();
});

test('creation method control changes the actual workspace mode', async () => {
  renderPage();
  await screen.findByText('新建模型');
  fireEvent.click(screen.getByText('从模板创建'));
  expect(await screen.findByText('从模板创建模型')).toBeInTheDocument();
  expect(useModelCreationStore.getState().workspace.mode).toBe('template');
  expect(useModelCreationStore.getState().workspace.templateCode).toBeUndefined();
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
