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

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

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

test('compact recent entries retain task details and prefilled task creation', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <DashboardPage /><Location />
    </MemoryRouter>,
  );

  const task = await screen.findByRole('button', { name: /模型一.*T-1/ });
  expect(within(task).getByText('HiGHS')).toBeInTheDocument();
  fireEvent.click(task);
  expect(screen.getByTestId('location')).toHaveTextContent('/tasks?task=T-1');

  fireEvent.click(screen.getByRole('button', { name: /模型一.*发起任务/ }));
  expect(screen.getByTestId('location')).toHaveTextContent('/tasks?create=1&model=m1&scene=');

  fireEvent.click(screen.getByRole('button', { name: '全部模型' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/models');
});

test('trend window updates the chart while the compact help keeps the date policy available', async () => {
  renderWithQueryClient(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByText('任务总量')).toBeInTheDocument();
  expect(screen.getByText('成功平均耗时')).toBeInTheDocument();
  const windows = screen.getByRole('group', { name: '任务运行态势统计窗口' });
  for (const days of [14, 30, 7]) {
    const button = within(windows).getByRole('button', { name: `近 ${days} 天` });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: `近 ${days} 天任务量与成功率趋势` })).toBeInTheDocument();
  }
  fireEvent.focus(screen.getByRole('button', { name: '任务趋势统计说明' }));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('无任务日期不计算成功率，折线保留断点。');
});
