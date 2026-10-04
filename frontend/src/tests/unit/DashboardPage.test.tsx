import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { DashboardPage } from '../../pages/Dashboard/DashboardPage';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../api/models', () => ({
  getModels: async () => [{ id: 'm1', name: '模型一', status: 'published' }],
}));

vi.mock('../../api/components', () => ({
  getComponents: async () => [{ component_id: 'power_balance', name: '功率平衡', status: 'published' }],
}));

vi.mock('../../api/templates', () => ({
  getTemplates: async () => [{ code: 'unit_commitment_day_ahead', name: '日前机组组合' }],
}));

vi.mock('../../api/tasks', () => ({
  getTasks: async () => [{ id: 'T-1', model: '模型一', scene: '日前调度', solver: 'HiGHS', status: 'SUCCESS', progress: 100, created_at: new Date().toISOString(), duration_seconds: 0 }],
}));

vi.mock('../../api/solvers', () => ({
  getSolverStatus: async () => ({
    highs: { available: true, version: '1.0' },
    ipopt: { available: true, path: '/usr/bin/ipopt', version: 'Ipopt 3.x' },
    status: 'OK',
  }),
}));

vi.mock('../../api/systemConfig', () => ({
  getSystemConfig: async () => ({ dictionaries: { business_scenarios: [] } }),
}));

function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }

test('dashboard renders React platform entries', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <DashboardPage /><Location />
    </MemoryRouter>,
  );

  expect(await screen.findByText('生产运筹工作台')).toBeInTheDocument();
  expect(screen.getByText(/让复杂约束，生成最优决策。/)).toBeInTheDocument();
  expect(screen.getByText('运行中任务')).toBeInTheDocument();
  expect(screen.getByText('失败 / 无解')).toBeInTheDocument();
  expect(screen.getByText('已发布模型')).toBeInTheDocument();
  const metric = screen.getByRole('button', { name: /近 7 天任务/ });
  expect(within(metric).getByText('近 7 天任务')).toBeInTheDocument();
  expect(screen.getByText('任务运行态势')).toBeInTheDocument();
  fireEvent.click(metric);
  expect(screen.getByTestId('location')).toHaveTextContent('/results');
  expect(screen.getByText('最近任务')).toBeInTheDocument();
  expect((await screen.findAllByText('< 1 ms')).length).toBeGreaterThan(0);
  expect(screen.getByText('求解能力摘要')).toBeInTheDocument();
});
