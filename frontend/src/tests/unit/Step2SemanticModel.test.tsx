import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Step2SemanticModel } from '../../features/model-creation/steps/Step2SemanticModel';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

function Step2Harness({ initial }: { initial?: ModelDraft }) {
  const [draft, setDraft] = useState<ModelDraft>(initial || createInitialDraft());
  return <Step2SemanticModel draft={draft} onChange={setDraft} />;
}

test('shows productized time and time_volume rules', () => {
  render(<Step2Harness />);
  expect(screen.getAllByText('time').length).toBeGreaterThan(0);
  expect(screen.getAllByText('time_volume').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/状态时点，长度 horizon \+ 1/).length).toBeGreaterThan(0);
}, 10000);

test('can add structured sets, parameters, and variables into semantic draft', () => {
  render(<Step2Harness />);

  fireEvent.click(screen.getByTestId('add-set'));
  expect(screen.getByDisplayValue('set_3')).toBeInTheDocument();
  expect(screen.getByDisplayValue('业务集合 3')).toBeInTheDocument();

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
  expect(screen.getByText('组件化 Builder 回写')).toBeInTheDocument();
  expect(screen.getByText('储能 SOC 组件')).toBeInTheDocument();
  expect(screen.getAllByText('time_volume').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('dependencies'));
  expect(screen.getByText('storage_power_limit')).toBeInTheDocument();
});
