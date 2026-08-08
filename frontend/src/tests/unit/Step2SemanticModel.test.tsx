import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { mergeSelectedComponentParameters, Step2SemanticModel } from '../../features/model-creation/steps/Step2SemanticModel';
import { createInitialDraft, type ModelDraft } from '../../features/model-creation/stores/modelCreationStore';
import { renderWithQueryClient } from '../testUtils';

const componentApi = vi.hoisted(() => ({
  getComponents: vi.fn(async () => [
    {
      component_id: 'power_balance',
      type: 'power_balance',
      name: '功率平衡组件',
      status: 'published',
      version: '1.0.0',
      domain: '电力优化',
      category: '平衡约束',
      depends_on: ['capacity_bounds'],
    },
    {
      component_id: 'capacity_bounds',
      type: 'capacity_bounds',
      name: '容量边界组件',
      status: 'published',
      version: '1.0.0',
      domain: '通用运筹优化',
      category: '边界约束',
    },
  ]),
}));

test('selected component parameter interfaces become selectable model parameters', () => {
  const parameters = mergeSelectedComponentParameters([], [{
    component_id: 'storage_limit',
    parameters: [{ code: 'capacity', name: '容量', unit: 'MWh', required: true }],
  }]);

  expect(parameters).toEqual([
    expect.objectContaining({ code: 'capacity', name: '容量', unit: 'MWh', sourceType: 'runtime', required: true }),
  ]);
});

vi.mock('../../api/components', () => ({ getComponents: componentApi.getComponents }));

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
  expect(screen.getByText(/缺少依赖 storage_power_limit/)).toBeInTheDocument();
  expect(screen.queryByText(/依赖 time_volume/)).not.toBeInTheDocument();
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

test('selects components from catalog and automatically includes dependencies', async () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';

  renderWithQueryClient(<Step2Harness initial={draft} />);
  fireEvent.click(screen.getByRole('button', { name: /从组件库选择/ }));

  expect(await screen.findByText('功率平衡组件')).toBeInTheDocument();
  const row = screen.getByText('功率平衡组件').closest('tr');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('checkbox'));

  expect(screen.getByText('将自动补齐组件依赖')).toBeInTheDocument();
  expect(screen.getByText('capacity_bounds', { selector: '.ant-alert-description' })).toBeInTheDocument();
  const dependencyRow = screen.getByText('容量边界组件').closest('tr');
  expect(dependencyRow).not.toBeNull();
  expect(within(dependencyRow!).getByRole('checkbox')).toBeChecked();
  expect(within(dependencyRow!).getByRole('checkbox')).toBeDisabled();
  expect(screen.getByText(/已选 2 个/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '应用选择' }));

  await waitFor(() => expect(screen.getByText('2 个组件')).toBeInTheDocument());
  expect(screen.getByText(/组件：功率平衡组件/)).toBeInTheDocument();
  expect(screen.getByText(/组件：容量边界组件/)).toBeInTheDocument();
});

test('cascade removes components that depend on the selected base component', async () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [
    { component_id: 'capacity_bounds', name: '容量边界组件' },
    { component_id: 'power_balance', name: '功率平衡组件', depends_on: ['capacity_bounds'] },
    { component_id: 'independent', name: '独立组件' },
  ];

  render(<Step2Harness initial={draft} />);
  fireEvent.click(screen.getByRole('button', { name: '移除 容量边界组件' }));

  expect(await screen.findByText('同时移除 2 个组件？')).toBeInTheDocument();
  expect(screen.getByText(/被 功率平衡组件 依赖/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '同时移除' }));

  await waitFor(() => expect(screen.getByText('1 个组件')).toBeInTheDocument());
  expect(screen.queryByText(/组件：容量边界组件/)).not.toBeInTheDocument();
  expect(screen.queryByText(/组件：功率平衡组件/)).not.toBeInTheDocument();
  expect(screen.getByText(/组件：独立组件/)).toBeInTheDocument();
});

test('blocks applying a component selection that contains a dependency cycle', async () => {
  componentApi.getComponents.mockResolvedValueOnce([
    {
      component_id: 'cycle_a',
      type: 'cycle_a',
      name: '循环组件 A',
      status: 'published',
      version: '1.0.0',
      domain: '测试',
      category: '循环依赖',
      depends_on: ['cycle_b'],
    },
    {
      component_id: 'cycle_b',
      type: 'cycle_b',
      name: '循环组件 B',
      status: 'published',
      version: '1.0.0',
      domain: '测试',
      category: '循环依赖',
      depends_on: ['cycle_a'],
    },
  ]);
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';

  renderWithQueryClient(<Step2Harness initial={draft} />);
  fireEvent.click(screen.getByRole('button', { name: /从组件库选择/ }));
  const row = (await screen.findByText('循环组件 A')).closest('tr');
  fireEvent.click(within(row!).getByRole('checkbox'));

  expect(await screen.findByText('组件依赖存在循环')).toBeInTheDocument();
  expect(screen.getByText('cycle_a → cycle_b → cycle_a')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用选择' })).toBeDisabled();
});
