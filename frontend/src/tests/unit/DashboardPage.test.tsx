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

test('dashboard restores prototype-style platform entries', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('集团级运筹优化底座总览')).toBeInTheDocument();
  expect(await screen.findByText('模型资产数')).toBeInTheDocument();
  expect(await screen.findByText('快捷入口')).toBeInTheDocument();
  expect(await screen.findByText('业务场景库')).toBeInTheDocument();
  expect(await screen.findByText('Agent 工作台')).toBeInTheDocument();
  expect(screen.queryByText('legacy 待迁移')).not.toBeInTheDocument();
  expect(await screen.findByText('近期求解任务')).toBeInTheDocument();
});
