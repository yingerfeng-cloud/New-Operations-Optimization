import { act, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';
import { FormulaEditor } from '../../features/formula-editor/FormulaEditor';
import { Step5ReviewPublish } from '../../features/model-creation/steps/Step5ReviewPublish';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';
import { analyzeFormulaText } from '../../features/model-creation/utils/nonlinearDiagnostics';

const symbols = {
  variables: {
    flow: { label: '流量', indices: ['t'] },
    head: { label: '水头', indices: ['t'] },
    power: { label: '出力', indices: ['t'] },
  },
  parameters: { k: { label: '系数' } },
  sets: { time: '时段' },
};

test('state recursion with parameter-scaled flows is not misclassified as bilinear', () => {
  const diagnostics = analyzeFormulaText(
    'state[t+1] == state[t] + eta_in * input[t] * delta_t - output[t] / eta_out * delta_t',
    ['state', 'input', 'output'],
  );
  expect(diagnostics.some(item => item.nonlinear_type === 'bilinear')).toBe(false);
});

function nonlinearDraft(): ModelDraft {
  const draft = createInitialDraft();
  draft.basic_info.name = '非线性诊断测试模型';
  draft.basic_info.scenario = '测试场景';
  draft.time_dimension = { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 1, time_set: 'time', state_time_set: null, editable: false };
  draft.basic_info.builder_mode = 'component_based';
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0], type: 'time_period', dimensionType: 'time_period', managed_by: 'time_dimension' }];
  draft.semantic.variables = [
    { code: 'flow', name: '流量', dimension: ['time'], domain: 'NonNegativeReals', lowerBound: 0, upperBound: 10 },
    { code: 'head', name: '水头', dimension: ['time'], domain: 'NonNegativeReals', lowerBound: 0, upperBound: 20 },
    { code: 'power', name: '出力', dimension: ['time'], domain: 'NonNegativeReals', lowerBound: 0 },
  ];
  draft.formulas = [{
    formula_id: 'bilinear',
    name: '出力关系',
    kind: 'constraint',
    display_formula: 'power[t] == flow[t] * head[t]',
    dsl_formula: 'power[t] == flow[t] * head[t]',
    tokens: [],
    foreach: ['time'],
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: ['time'],
    compile_status: 'ready',
  }];
  draft.runtime_parameters = { horizon: 1, time: [0] };
  return draft;
}

test('Formula Builder 输入双线性公式时给出提示', async () => {
  render(<FormulaEditor symbols={symbols} />);
  const view = EditorView.findFromDOM(screen.getByLabelText('公式表达式'));
  if (!view) throw new Error('CodeMirror editor view not found');
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'power[t] == k * flow[t] * head[t]' } });
  });

  await waitFor(() => expect(screen.getByText('非线性转换建议')).toBeInTheDocument());
  expect(screen.getByText(/检测到双线性项 flow\[t\] \* head\[t\]/)).toBeInTheDocument();
  expect(screen.getByText(/McCormick 松弛/)).toBeInTheDocument();
});

test('Step5 展示非线性诊断并阻断未转换双线性', () => {
  const draft = nonlinearDraft();
  const validation = validateModelDraft(draft);

  render(<Step5ReviewPublish draft={draft} validation={validation} onTest={vi.fn()} />);

  expect(screen.getByText('非线性诊断')).toBeInTheDocument();
  expect(screen.getByText('bilinear')).toBeInTheDocument();
  expect(screen.getByText('存在未转换非线性，已阻断发布')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();
});

test('缺少上下界时阻断发布', () => {
  const draft = nonlinearDraft();
  draft.components = [{
    type: 'mccormick_bilinear_relaxation_component',
    x: 'flow[t]',
    y: 'head[t]',
    w: 'power[t]',
    indices: [{ set: 'time', alias: 't' }],
  }];
  const validation = validateModelDraft(draft);

  render(<Step5ReviewPublish draft={draft} validation={validation} onTest={vi.fn()} />);

  expect(screen.getAllByText(/McCormick 缺少 x\/y 有限上下界/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();
});

test('已转换 McCormick 后允许发布', () => {
  const draft = nonlinearDraft();
  draft.components = [{
    type: 'mccormick_bilinear_relaxation_component',
    x: 'flow[t]',
    y: 'head[t]',
    w: 'power[t]',
    x_lower: 0,
    x_upper: 10,
    y_lower: 0,
    y_upper: 20,
    indices: [{ set: 'time', alias: 't' }],
  }];
  const validation = validateModelDraft(draft);

  render(<Step5ReviewPublish draft={draft} validation={validation} onTest={vi.fn()} />);

  expect(validation.valid).toBe(true);
  expect(screen.getAllByText(/双线性项已配置 McCormick 松弛/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '测试运行' })).not.toBeDisabled();
});
