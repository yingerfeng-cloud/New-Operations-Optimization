import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, vi } from 'vitest';
import { renderWithQueryClient } from '../testUtils';

let ModelServicesPage: typeof import('../../pages/ModelServices/ModelServicesPage')['ModelServicesPage'];

const state = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({
    id: 'TASK-NLP',
    status: 'SUCCESS',
    solver: 'Ipopt',
    result: { problem_type: 'NLP', solver: 'Ipopt', termination_condition: 'locallyOptimal', local_optimum_warning: true },
  })),
}));

vi.mock('../../api/models', () => ({
  getModels: async () => [{
    id: 'nonlinear_hydro_power_demo',
    template_id: 'nonlinear_hydro_power_demo',
    name: '非线性水电出力 NLP 演示模型',
    scene: 'nlp',
    version: 'v1',
    status: 'published',
    solver: 'Ipopt',
    problem_type: 'NLP',
    build_mode: 'domain_builder',
    updated_at: '2026-07-06',
  }],
  getModelAssetDetail: async () => ({ sample_runtime_parameters: { horizon: 3, time: [0, 1, 2], k: 0.9, flow_min: 10, flow_max: 100, head_min: 20, head_max: 80, power_max: 5000 } }),
}));
vi.mock('../../api/tasks', () => ({ createTask: state.createTask }));

beforeAll(async () => {
  vi.resetModules();
  ({ ModelServicesPage } = await import('../../pages/ModelServices/ModelServicesPage'));
});

test('model services shows NLP sample and enriched debug response', async () => {
  renderWithQueryClient(<MemoryRouter><ModelServicesPage /></MemoryRouter>);
  expect((await screen.findAllByText('非线性水电出力 NLP 演示模型')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: '在线调试' }));
  const debugPanel = screen.getByRole('tabpanel');
  const textarea = within(debugPanel).getByLabelText('运行参数 JSON') as HTMLTextAreaElement;
  await waitFor(() => expect(textarea.value).toContain('flow_min'));
  fireEvent.click(within(debugPanel).getByRole('button', { name: '发起测试调用' }));
  await waitFor(() => expect(state.createTask).toHaveBeenCalled());
  expect(await screen.findByText('调试返回')).toBeInTheDocument();
  expect(document.body.textContent).toContain('local_optimum_warning');
});
