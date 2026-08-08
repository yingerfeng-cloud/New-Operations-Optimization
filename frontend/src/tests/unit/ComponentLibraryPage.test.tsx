import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ComponentLibraryPage } from '../../pages/ComponentLibrary/ComponentLibraryPage';
import { ComponentEditor, formulaFromRow, normalizeComponentForEditor } from '../../features/component-library/ComponentEditor';
import { ComponentBusinessView, ComponentMathDefinition } from '../../features/component-library/ComponentSchemaTables';
import { ComponentDependencyPanel } from '../../features/component-library/ComponentDependencyPanel';
import { ParameterBindingPanel } from '../../features/component-library/ParameterBindingPanel';
import type { ComponentDef } from '../../types/component';
import { renderWithQueryClient } from '../testUtils';

const componentSample: ComponentDef = {
  component_id: 'storage_soc',
  name: '储能 SOC',
  display_name: '储能 SOC 约束',
  category: 'storage',
  domain: 'power',
  status: 'draft',
  version: '1.0.0',
  description: '储能状态递推与边界约束',
  required_sets: [{ code: 'time', name: '时段', dimension: ['t'], required: true }],
  parameters: [{ code: 'soc_initial', name: '初始 SOC', unit: 'MWh', required: true, source_system: 'runtime', sample_value: 12 }],
  variables: [{ code: 'soc', name: 'SOC', unit: 'MWh', dimension: ['time'] }],
  generated_constraints: [{ constraint_id: 'soc_balance', name: 'SOC 递推', formula: 'soc[t] == soc[t-1] + charge[t]' }],
  generated_objective_terms: [{ term_id: 'storage_cost', name: '储能成本', formula: 'sum(cost[t])' }],
  parameter_bindings: [{ component_parameter: 'soc_initial', model_parameter: 'soc0', status: 'bound' }],
  depends_on: ['power_balance', 'missing_component'],
};

vi.mock('../../api/components', () => ({
  getComponents: async () => [componentSample],
  getComponent: async () => componentSample,
  createComponent: vi.fn(async payload => payload),
  updateComponent: vi.fn(async (_id, payload) => payload),
  validateComponent: vi.fn(async () => ({ valid: true, errors: [] })),
  publishComponent: vi.fn(async () => componentSample),
  offlineComponent: vi.fn(async () => componentSample),
  copyComponentVersion: vi.fn(async () => componentSample),
}));

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ComponentLibraryPage />
    </MemoryRouter>,
  );
}

test('renders component library list and structured detail drawer', async () => {
  renderPage();
  expect(screen.getByText('组件库管理')).toBeInTheDocument();
  expect(await screen.findByText('储能 SOC 约束')).toBeInTheDocument();
  expect(screen.queryByText('装配启用')).not.toBeInTheDocument();
  expect(screen.queryByText('后端实现')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '查看' }));

  await waitFor(() => expect(screen.getByText('业务口径')).toBeInTheDocument());
  expect(screen.getAllByText('组件编码').length).toBeGreaterThan(0);
  expect(screen.getAllByText('storage_soc').length).toBeGreaterThan(0);
  expect(screen.getByText('储能状态递推与边界约束')).toBeInTheDocument();
}, 30000);

test('direct edit waits for detail and hydrates every formula section', async () => {
  renderPage();
  await screen.findByText('储能 SOC 约束');

  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  await screen.findByText('组件编辑器');
  fireEvent.click(await screen.findByRole('button', { name: '约束公式' }));
  expect(await screen.findByText('SOC 递推')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '目标项' }));
  expect(await screen.findByText('储能成本')).toBeInTheDocument();
}, 60000);

test('legacy formula fields are normalized for editing and synchronized on save', async () => {
  const onSave = vi.fn();
  const legacyComponent: ComponentDef = {
    ...componentSample,
    component_id: 'historical_component',
    depends_on: [],
    generated_constraints: [],
    generated_objective_terms: [],
    constraints: [{ constraint_id: 'historical_limit', name: '旧版出力上限', expression: 'soc[t] <= soc_max[t]' }],
    objective_terms: [{ term_id: 'historical_cost', name: '旧版成本', expression: 'sum(cost[t] for t in time)' }],
  };
  const normalized = normalizeComponentForEditor(legacyComponent);
  expect(normalized?.generated_constraints).toHaveLength(1);
  expect(normalized?.generated_objective_terms).toHaveLength(1);
  expect(normalized?.parameter_bindings).toBeUndefined();

  const { container } = render(<ComponentEditor component={legacyComponent} availableComponents={[legacyComponent]} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: '约束公式' }));
  expect(await screen.findByText('旧版出力上限')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '目标项' }));
  expect(await screen.findByText('旧版成本')).toBeInTheDocument();
  expect(screen.getByText('sum(cost[t] for t in time)')).toBeInTheDocument();

  fireEvent.submit(container.querySelector('#component-editor-form')!);
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const payload = onSave.mock.calls[0][0];
  expect(payload.constraints).toEqual(payload.generated_constraints);
  expect(payload.objective_terms).toEqual(payload.generated_objective_terms);
  expect(payload.parameter_bindings).toBeUndefined();
  expect(payload.status).toBeUndefined();
  expect(payload.enabled).toBeUndefined();
  expect(payload.implemented).toBeUndefined();
});

test('editor removes retired asset flags from legacy component data', () => {
  const legacyComponent = { ...componentSample, enabled: false, implemented: false } as ComponentDef;
  const normalized = normalizeComponentForEditor(legacyComponent);

  expect(normalized).not.toHaveProperty('enabled');
  expect(normalized).not.toHaveProperty('implemented');
});

test('objective rows retain direction, weight, priority and participation metadata', () => {
  const formula = formulaFromRow({
    term_id: 'revenue',
    name: '收益',
    expression: 'sum(revenue[t] for t in time)',
    objective_direction: 'maximize',
    weight: 2,
    priority: 3,
    solve_participation: 'preview_only',
  }, 'objective');

  expect(formula).toMatchObject({
    formula_id: 'revenue',
    dsl_formula: 'sum(revenue[t] for t in time)',
    objective_direction: 'maximize',
    weight: 2,
    priority: 3,
    solve_participation: 'preview_only',
  });
});

test('fills historical blank formula names with an explainable component label', () => {
  const normalized = normalizeComponentForEditor({
    ...componentSample,
    generated_constraints: [{ constraint_id: 'balance_eq', expression: 'soc[t] == 1' }],
  });

  expect(normalized?.generated_constraints).toEqual([
    expect.objectContaining({ constraint_id: 'balance_eq', name: '储能 SOC 约束' }),
  ]);
});

test('confirming deletion removes the selected formula from the component draft', async () => {
  const user = userEvent.setup();
  render(<ComponentEditor component={componentSample} availableComponents={[componentSample]} onSave={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '约束公式' }));
  const formulaRow = (await screen.findByText('SOC 递推')).closest('tr');
  expect(formulaRow).not.toBeNull();
  await user.click(within(formulaRow!).getByRole('button', { name: '编辑' }));

  const formulaDialog = await screen.findByRole('dialog', { name: '公式编辑器' });
  const deleteButton = within(formulaDialog).getByRole('button', { name: '删除公式' });
  expect(deleteButton).toBeEnabled();
  await user.click(deleteButton);
  const confirmTitle = await screen.findByText('确认删除这条公式？');
  const confirmDialog = confirmTitle.closest<HTMLDivElement>('.ant-modal');
  expect(confirmDialog).not.toBeNull();
  await user.click(within(confirmDialog!).getByRole('button', { name: '删除公式' }));

  await waitFor(() => expect(screen.queryByRole('dialog', { name: '公式编辑器' })).not.toBeInTheDocument());
  expect(screen.queryByText('SOC 递推', { exact: true })).not.toBeInTheDocument();
});

test('renders component schema, math, parameter interface and dependency panels', () => {
  render(<ComponentBusinessView component={componentSample} />);
  expect(screen.getByText('required_sets')).toBeInTheDocument();
  expect(screen.getByText('soc_initial')).toBeInTheDocument();
  expect(screen.getByText('SOC')).toBeInTheDocument();

  render(<ComponentMathDefinition component={componentSample} />);
  expect(screen.getByText('SOC 递推')).toBeInTheDocument();
  expect(screen.getByText('sum(cost[t])')).toBeInTheDocument();

  render(<ParameterBindingPanel component={componentSample} />);
  expect(screen.getByText('这里定义组件需要哪些参数')).toBeInTheDocument();
  expect(screen.queryByText('soc0')).not.toBeInTheDocument();
  expect(screen.queryByText('bound')).not.toBeInTheDocument();

  render(<ComponentDependencyPanel
    component={componentSample}
    available={[
      componentSample,
      { component_id: 'power_balance', name: '功率平衡', status: 'published', version: '1' },
    ]}
  />);
  expect(screen.getAllByText('missing_component').length).toBeGreaterThan(0);
  expect(screen.getByText('异常')).toBeInTheDocument();
}, 30000);

test('new component opens a system-owned draft lifecycle editor', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('储能 SOC 约束');

  await user.click(screen.getByRole('button', { name: '新建组件' }));

  expect(await screen.findByText('组件编辑器')).toBeInTheDocument();
  expect(screen.getByText('由系统维护')).toBeInTheDocument();
  expect(screen.getAllByText('草稿').length).toBeGreaterThan(1);
  expect(screen.queryByText('装配启用')).not.toBeInTheDocument();
  expect(screen.queryByText('后端实现')).not.toBeInTheDocument();
}, 30000);

test('keeps model-specific parameter binding out of the component editor', async () => {
  render(<ComponentEditor component={componentSample} availableComponents={[componentSample]} onSave={vi.fn()} />);

  expect(screen.queryByRole('button', { name: '参数绑定' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '参数接口' }));

  expect(await screen.findByText('参数接口 #1')).toBeInTheDocument();
  expect(screen.getByDisplayValue('soc_initial')).toBeInTheDocument();
});
