import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { Step5ReviewPublish } from '../../features/model-creation/steps/Step5ReviewPublish';
import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

function validDraft(): ModelDraft {
  const draft = createInitialDraft();
  draft.basic_info.name = '发布测试模型';
  draft.basic_info.scenario = '测试场景';
  draft.time_dimension = { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 1, time_set: 'time', state_time_set: null, editable: false };
  draft.semantic.sets = [{ code: 'time', name: '时段', values: [0], type: 'time_period', dimensionType: 'time_period', managed_by: 'time_dimension' }];
  draft.semantic.variables = [{ code: 'p', name: '出力', dimension: ['time'], domain: 'NonNegativeReals' }];
  draft.semantic.parameters = [{ code: 'load', name: '负荷', dimension: ['time'], sourceType: 'runtime', source_type: 'runtime', required: true }];
  draft.runtime_parameters = { horizon: 1, time: [0], load: [100] };
  draft.formulas = [{
    formula_id: 'obj',
    name: '目标',
    kind: 'objective',
    objective_direction: 'minimize',
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
    formula_compiler: 'backend_authoritative_v2',
    sets: { time: [0] },
    parameters: { load: [100] },
    variables: [{ name: 'p', indices: ['time'], domain: 'NonNegativeReals' }],
    constraints: [],
    objective: { terms: [{ var: 'p', key: ['time'], foreach: ['time'] }] },
  };
  return draft;
}

test('disables publish and test actions when validation has blockers', () => {
  const draft = createInitialDraft();
  const validation = validateModelDraft(draft);
  render(<Step5ReviewPublish draft={draft} validation={validation} onTest={vi.fn()} />);
  expect(screen.getByText('存在阻断项，不能发布')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试运行' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '发布模型' })).not.toBeInTheDocument();
});

test('runs test callback and renders dry-run result summary', async () => {
  const draft = validDraft();
  const onTest = vi.fn().mockResolvedValue({
    id: 'MODEL-1',
    status: 'tested',
    dry_run_result: {
      structure_check: { status: 'passed' },
      solver_check: { status: 'passed', objective_value: 12 },
    },
  });
  render(<Step5ReviewPublish draft={draft} validation={validateModelDraft(draft)} onTest={onTest} />);

  fireEvent.click(screen.getByText('测试运行'));

  await waitFor(() => expect(onTest).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('测试运行结果')).toBeInTheDocument();
  expect(screen.getByText('tested')).toBeInTheDocument();
  expect(screen.getAllByText('passed').length).toBeGreaterThan(0);
});

test('renders 2D PWL MILP risk diagnostics', () => {
  const draft = validDraft();
  draft.components = [{
    type: 'function_mapping_2d_component',
    function_asset_id: 'hydro_power_surface_001',
    x: 'flow[t]',
    y: 'head[t]',
    z: 'power[t]',
    indices: [{ set: 'time', alias: 't' }],
    solve_strategy: 'triangulated_milp_exact',
    metadata: { triangle_count: 120 },
  }];
  draft.runtime_parameters = { horizon: 24, time: Array.from({ length: 24 }, (_, index) => index), load: [100] };

  render(<Step5ReviewPublish draft={draft} validation={validateModelDraft(draft)} onTest={vi.fn()} />);

  expect(screen.getByText('二维 PWL 风险诊断')).toBeInTheDocument();
  expect(screen.getByText('hydro_power_surface_001')).toBeInTheDocument();
  expect(screen.getByText('2880')).toBeInTheDocument();
  expect(screen.getByText('MILP 二进制变量风险')).toBeInTheDocument();
});
