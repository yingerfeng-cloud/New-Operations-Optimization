import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ComponentLibraryPage } from '../../pages/ComponentLibrary/ComponentLibraryPage';
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
  status: 'published',
  enabled: true,
  implemented: true,
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

  fireEvent.click(screen.getByRole('button', { name: '查看' }));

  await waitFor(() => expect(screen.getByText('业务口径')).toBeInTheDocument());
  expect(screen.getAllByText('组件编码').length).toBeGreaterThan(0);
  expect(screen.getAllByText('storage_soc').length).toBeGreaterThan(0);
  expect(screen.getByText('储能状态递推与边界约束')).toBeInTheDocument();
}, 30000);

test('renders component schema, math, binding and dependency panels', () => {
  render(<ComponentBusinessView component={componentSample} />);
  expect(screen.getByText('required_sets')).toBeInTheDocument();
  expect(screen.getByText('soc_initial')).toBeInTheDocument();
  expect(screen.getByText('SOC')).toBeInTheDocument();

  render(<ComponentMathDefinition component={componentSample} />);
  expect(screen.getByText('SOC 递推')).toBeInTheDocument();
  expect(screen.getByText('sum(cost[t])')).toBeInTheDocument();

  render(<ParameterBindingPanel component={componentSample} />);
  expect(screen.getByText('soc0')).toBeInTheDocument();
  expect(screen.getByText('bound')).toBeInTheDocument();

  render(<ComponentDependencyPanel component={componentSample} available={['storage_soc', 'power_balance']} />);
  expect(screen.getAllByText('missing_component').length).toBeGreaterThan(0);
  expect(screen.getByText('缺失')).toBeInTheDocument();
}, 30000);
