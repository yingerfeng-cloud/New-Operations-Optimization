import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Step4RuntimeParams, buildRuntimeParameterRows, validateRuntimeParameters } from '../../features/model-creation/steps/Step4RuntimeParams';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

function makeDraft() {
  const draft = createInitialDraft();
  draft.time_dimension = { schema_version: 1, enabled: true, policy: 'fixed', default_horizon: 24, time_set: 'time', state_time_set: 'time_volume', editable: false };
  draft.semantic.sets = [
    { code: 'time', name: '时间点', type: 'time_period', managed_by: 'time_dimension', values: Array.from({ length: 24 }, (_, index) => index) },
    { code: 'time_volume', name: '状态时点', type: 'state_time', base_set: 'time', managed_by: 'time_dimension', values: Array.from({ length: 25 }, (_, index) => index) },
  ];
  draft.semantic.parameters = [
    { code: 'horizon', name: '调度时段', sourceType: 'system', source_type: 'system' },
    { code: 'time', name: '时间点', indices: ['time'], dimension: ['time'], sourceType: 'system', source_type: 'system' },
    { code: 'time_volume', name: '状态时点', indices: ['time_volume'], dimension: ['time_volume'], sourceType: 'system', source_type: 'system' },
    { code: 'load', name: '负荷预测', unit: 'MW', indices: ['time'], dimension: ['time'], sourceType: 'runtime', source_type: 'runtime', required: true, exampleValue: [100, 120], description: '运行时负荷' },
    { code: 'fuel_cost', name: '燃料成本', unit: '元/MWh', indices: ['unit'], dimension: ['unit'], sourceType: 'static', source_type: 'static', defaultValue: { U1: 10 }, default: { U1: 10 }, required: false },
    { code: 'asset_capacity', name: '装机容量', unit: 'MW', sourceType: 'ledger', source_type: 'ledger', required: false },
    { code: 'solver_timeout', name: '求解超时', unit: 's', sourceType: 'system', source_type: 'system', defaultValue: 60, default: 60, required: false },
    { code: 'deviation_weight', name: '偏差权重', sourceType: 'runtime', source_type: 'runtime', defaultValue: 1, default: 1, required: false },
  ];
  draft.runtime_parameters = { horizon: 24 };
  draft.parameter_groups = { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} };
  return draft;
}

function Harness({ initial = makeDraft() }: { initial?: ModelDraft }) {
  const [draft, setDraft] = useState(initial);
  return <Step4RuntimeParams draft={draft} onChange={setDraft} />;
}

function openRuntimeDebug() {
  fireEvent.click(screen.getByText('高级调试：JSON 导入 / 运行参数结构预览'));
}

test('builds classified runtime parameter rows and missing validation', () => {
  const draft = makeDraft();
  const rows = buildRuntimeParameterRows(draft);
  expect(rows.find(row => row.code === 'load')?.source).toBe('runtime');
  expect(rows.find(row => row.code === 'fuel_cost')?.source).toBe('static');
  expect(rows.find(row => row.code === 'deviation_weight')?.source).toBe('objective_weights');
  expect(validateRuntimeParameters(draft)).toContain('负荷预测 load 缺少必填值');
});

test('renders parameter categories and missing prompts', () => {
  render(<Harness />);
  expect(screen.getByText('缺少必填运行参数')).toBeInTheDocument();
  expect(screen.getByText(/负荷预测 load 缺少必填值/)).toBeInTheDocument();
  expect(screen.getAllByText('运行时输入参数').length).toBeGreaterThan(0);
  expect(screen.getAllByText('模型静态参数').length).toBeGreaterThan(0);
  expect(screen.getAllByText('目标权重参数').length).toBeGreaterThan(0);
  expect(screen.getByText('固定时段')).toBeInTheDocument();
  expect(screen.queryByText('调度时段')).not.toBeInTheDocument();
});

test('imports JSON runtime parameters and updates preview', () => {
  render(<Harness />);
  openRuntimeDebug();
  fireEvent.change(screen.getByLabelText('运行参数 JSON'), { target: { value: JSON.stringify({ horizon: 2, load: [100, 120] }) } });
  fireEvent.click(screen.getByText('导入并校验'));
  expect(screen.queryByText('缺少必填运行参数')).not.toBeInTheDocument();
  expect(screen.getByText(/"load": \[/)).toBeInTheDocument();
});

test('edits table value into runtime schema', () => {
  render(<Harness />);
  openRuntimeDebug();
  const loadInput = screen.getByLabelText('load 当前值');
  fireEvent.change(loadInput, { target: { value: '[90,95]' } });
  fireEvent.blur(loadInput);
  expect(screen.getAllByText(/"load": \[/).length).toBeGreaterThan(0);
});
