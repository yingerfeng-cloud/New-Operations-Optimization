import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { DashboardPage } from '../../pages/Dashboard/DashboardPage';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../api/models', () => ({
  getModels: async () => [{ id: 'm1', name: '模型一', status: 'published' }],
}));

vi.mock('../../api/components', () => ({
  getComponents: async () => [{ component_id: 'power_balance', name: '功率平衡', implemented: true }],
}));

vi.mock('../../api/templates', () => ({
  getTemplates: async () => [{ code: 'unit_commitment_day_ahead', name: '日前机组组合' }],
}));

vi.mock('../../api/tasks', () => ({
  getTasks: async () => [{ id: 'T-1', model: '模型一', scene: '日前调度', solver: 'HiGHS', status: 'SUCCESS', progress: 100, created_at: '2026-06-23' }],
}));

vi.mock('../../api/solvers', () => ({
  getSolverStatus: async () => ({
    highs: { available: true, version: '1.0' },
    ipopt: { available: true, path: '/usr/bin/ipopt', version: 'Ipopt 3.x' },
    status: 'OK',
  }),
}));

test('dashboard renders React platform entries', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('生产运筹工作台')).toBeInTheDocument();
  expect(screen.getByText('运行中任务')).toBeInTheDocument();
  expect(screen.getByText('失败 / 无解')).toBeInTheDocument();
  expect(screen.getByText('已发布模型')).toBeInTheDocument();
  expect(screen.getByText('近 7 天任务')).toBeInTheDocument();
  expect(screen.getByText('最近任务')).toBeInTheDocument();
  expect(screen.getByText('求解能力摘要')).toBeInTheDocument();
});
