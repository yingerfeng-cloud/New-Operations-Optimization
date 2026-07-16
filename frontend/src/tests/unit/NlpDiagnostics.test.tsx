import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Step5ReviewPublish } from '../../features/model-creation/steps/Step5ReviewPublish';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';

function nlpDraft(problemType = 'NLP'): ModelDraft {
  const draft = createInitialDraft();
  draft.basic_info.name = 'NLP 测试模型';
  draft.basic_info.scenario = '测试场景';
  draft.time_dimension = { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 1, time_set: 'time', state_time_set: null, editable: false };
  draft.basic_info.solver = 'Ipopt';
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0], type: 'time_period', dimensionType: 'time_period', managed_by: 'time_dimension' }];
  draft.semantic.variables = [{ code: 'p', name: '出力', dimension: ['time'], domain: 'NonNegativeReals' }];
  draft.semantic.parameters = [{ code: 'load', name: '负荷', dimension: ['time'], sourceType: 'runtime', source_type: 'runtime', required: true }];
  draft.runtime_parameters = { horizon: 1, time: [0], load: [100] };
  draft.formulas = [{
    formula_id: 'obj',
    name: '目标',
    kind: 'objective',
    display_formula: 'p[t]',
    dsl_formula: 'p[t]',
    tokens: [],
    foreach: [],
    referenced_sets: [],
    referenced_parameters: [],
    referenced_variables: [],
    free_indices: [],
    compile_status: 'ready',
  }];
  draft.advanced.generic_spec = {
    sets: { time: [0] },
    parameters: { load: [100] },
    variables: [{ name: 'p', indices: ['time'], domain: 'NonNegativeReals' }],
    constraints: [],
    objective: { terms: [{ var: 'p', key: ['time'], foreach: ['time'] }] },
  };
  draft.advanced.component_spec = {
    model_problem_type: problemType,
    problem_type_diagnosis: {
      inferred_problem_type: problemType,
      recommended_solver: problemType === 'NLP' ? 'Ipopt' : undefined,
    },
  };
  return draft;
}

const ipoptAvailable = {
  highs: { available: true, version: '1.7.0' },
  ipopt: { available: true, path: '/usr/local/bin/ipopt', version: 'Ipopt 3.14' },
};

const ipoptUnavailable = {
  highs: { available: true, version: '1.7.0' },
  ipopt: { available: false, path: null, version: null, message: 'Ipopt executable not found. NLP solving is unavailable.' },
};

test('Ipopt 可用时 NLP 可发布但必须确认风险', () => {
  const draft = nlpDraft();
  const onTest = vi.fn();
  render(<Step5ReviewPublish draft={draft} validation={validateModelDraft(draft)} onTest={onTest} solverStatus={ipoptAvailable} />);

  expect(screen.getByText('当前模型被识别为 NLP，将使用 Ipopt 求解。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();

  fireEvent.click(screen.getByLabelText('我理解 NLP 局部最优风险'));

  expect(screen.getByRole('button', { name: '测试运行' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '测试运行' }));
  expect(onTest).toHaveBeenCalledTimes(1);
});

test('Ipopt 不可用时 NLP 阻断发布', () => {
  const draft = nlpDraft();
  render(<Step5ReviewPublish draft={draft} validation={validateModelDraft(draft)} onTest={vi.fn()} solverStatus={ipoptUnavailable} />);

  expect(screen.getByText('NLP 发布被阻断')).toBeInTheDocument();
  expect(screen.getByText(/Ipopt executable not found/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();
});

test('MINLP_RESERVED 阻断发布', () => {
  const draft = nlpDraft('MINLP_RESERVED');
  render(<Step5ReviewPublish draft={draft} validation={validateModelDraft(draft)} onTest={vi.fn()} solverStatus={ipoptAvailable} />);

  expect(screen.getByText('MINLP_RESERVED 发布被阻断')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();
});
