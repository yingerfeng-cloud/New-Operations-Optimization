import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Step2SemanticModel } from '../../features/model-creation/steps/Step2SemanticModel';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

function Step2Harness({ initial }: { initial?: ModelDraft }) {
  const [draft, setDraft] = useState<ModelDraft>(initial || createInitialDraft());
  return <Step2SemanticModel draft={draft} onChange={setDraft} />;
}

test('shows non-time default and time-dimension configuration entry', () => {
  render(<Step2Harness />);
  expect(screen.getByText('时间维度配置')).toBeInTheDocument();
  expect(screen.getByText('非时序模型')).toBeInTheDocument();
  expect(screen.queryByText('time_volume')).not.toBeInTheDocument();
}, 10000);

test('can add structured sets, parameters, and variables into semantic draft', () => {
  render(<Step2Harness />);

  fireEvent.click(screen.getByText('高级明细'));
  fireEvent.click(screen.getByTestId('add-set'));
  expect(screen.getByDisplayValue('set_1')).toBeInTheDocument();
  expect(screen.getByDisplayValue('业务集合 1')).toBeInTheDocument();

  fireEvent.click(screen.getByText('参数 0'));
  fireEvent.click(screen.getByTestId('add-parameter'));
  expect(screen.getByDisplayValue('param_1')).toBeInTheDocument();
  expect(screen.getByDisplayValue('业务参数 1')).toBeInTheDocument();

  fireEvent.click(screen.getByText('变量 0'));
  fireEvent.click(screen.getByTestId('add-variable'));
  expect(screen.getByDisplayValue('var_1')).toBeInTheDocument();
  expect(screen.getByDisplayValue('决策变量 1')).toBeInTheDocument();
});

test('validates duplicate semantic codes', () => {
  const draft = createInitialDraft();
  draft.semantic.parameters = [
    { code: 'load', name: '负荷', indices: ['time'], dimension: ['time'], sourceType: 'runtime', source_type: 'runtime' },
    { code: 'load', name: '负荷副本', indices: ['time'], dimension: ['time'], sourceType: 'runtime', source_type: 'runtime' },
  ];

  render(<Step2Harness initial={draft} />);
  expect(screen.getByText('编码唯一性校验失败')).toBeInTheDocument();
  expect(screen.getByText(/参数编码重复：load/)).toBeInTheDocument();
});

test('opens safely when a historical semantic row has no code', () => {
  const draft = createInitialDraft();
  draft.semantic.parameters = [
    { name: 'legacy parameter', sourceType: 'runtime' } as ModelDraft['semantic']['parameters'][number],
  ];

  expect(() => render(<Step2Harness initial={draft} />)).not.toThrow();
  expect(screen.getByText('legacy parameter')).toBeInTheDocument();
});

test('opens semantic item editor from overview card', () => {
  const draft = createInitialDraft();
  draft.semantic.sets = [{ code: 'unit', name: '机组集合', values: ['U1'] }];
  render(<Step2Harness initial={draft} />);

  fireEvent.click(screen.getByRole('button', { name: '编辑 机组集合' }));

  expect(screen.getByText('编辑集合')).toBeInTheDocument();
  expect(screen.getByDisplayValue('unit')).toBeInTheDocument();
});

test('renders component builder writeback without raw JSON block', () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{
    component_id: 'storage_soc',
    name: '储能 SOC 组件',
    required_sets: [{ code: 'time_volume', name: '状态时点', dimension: ['time_volume'] }],
    parameters: [{ code: 'soc_initial', name: '初始 SOC', unit: 'MWh', source_system: 'runtime' }],
    variables: [{ code: 'soc', name: '储能电量', dimension: ['storage', 'time_volume'] }],
    dependencies: ['storage_power_limit'],
    parameter_bindings: [{ component_parameter: 'soc_initial', model_parameter: 'soc0', status: 'bound' }],
  }];

  render(<Step2Harness initial={draft} />);
  expect(screen.getByText('组件生成内容预览')).toBeInTheDocument();
  fireEvent.click(screen.getByText('组件生成内容预览'));
  expect(screen.getByText('储能 SOC 组件')).toBeInTheDocument();
  expect(screen.getAllByText('time_volume').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('组件依赖'));
  expect(screen.getByText('storage_power_limit')).toBeInTheDocument();
});

test('opens parameter binding drawer from missing component dependency', () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{
    component_id: 'startup_logic',
    name: '启停逻辑组件',
    parameters: [{ code: 'startup_cost', name: '启动成本', unit: '元/次', required: true }],
  }];

  render(<Step2Harness initial={draft} />);

  expect(screen.getByText('组件与依赖')).toBeInTheDocument();
  expect(screen.getByText('startup_cost')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /绑定/ }).at(-1)!);

  expect(screen.getByText('编辑参数绑定')).toBeInTheDocument();
  expect(screen.getByText('启停逻辑组件 / startup_cost')).toBeInTheDocument();
  expect(screen.getByText('仍缺少 startup_cost 的必填映射')).toBeInTheDocument();
});
