import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { TaskCenterPage } from '../../pages/TaskCenter/TaskCenterPage';
import type { SolveResult } from '../../types/result';
import type { SolveTask } from '../../types/task';
import { renderWithQueryClient } from '../testUtils';

const testState = vi.hoisted(() => {
  const successTask: SolveTask = {
    id: 'OPT-SUCCESS',
    model_id: 'model_001',
    resolved_model_id: 'model_001',
    resolved_model_code: 'day_ahead_dispatch',
    scene: 'power_dispatch',
    model: '日前调度模型',
    solver: 'HiGHS',
    status: 'SUCCESS',
    progress: 100,
    gap: '0.00%',
    cost: 123.45,
    risk: 'low',
    created_at: '2026-06-23 10:00:00',
    started_at: '2026-06-23 10:01:00',
    finished_at: '2026-06-23 10:02:00',
    duration_seconds: 60,
    retry_count: 0,
    recent_logs: ['VALIDATING 参数校验通过', 'SOLVING HiGHS 求解完成'],
    trace: { model_code: 'day_ahead_dispatch', horizon: 24 },
  };
  const failedTask: SolveTask = {
    ...successTask,
    id: 'OPT-FAILED',
    status: 'FAILED',
    progress: 100,
    error: 'generic_spec.variables is required',
  };
  const result: SolveResult = {
    task_id: 'OPT-SUCCESS',
    status: 'SUCCESS',
    objective_value: 123.45,
    metrics: { objective_value: 123.45, total_cost: 123.45, gap: '0.00%' },
    variables: { p_grid: [10, 12, 14] },
    business_explanation: { summary: '日前调度求解完成。' },
  };
  return {
    successTask,
    failedTask,
    result,
    createTask: vi.fn(async () => successTask),
    cancelTask: vi.fn(async (id: string) => ({ ...successTask, id, status: 'CANCELLED' })),
    retryTask: vi.fn(async (id: string) => ({ ...failedTask, id, status: 'PENDING' })),
  };
});

vi.mock('../../api/tasks', () => ({
  getTasks: async () => [testState.successTask, testState.failedTask],
  getTask: async (id: string) => id === 'OPT-FAILED' ? testState.failedTask : testState.successTask,
  createTask: testState.createTask,
  cancelTask: testState.cancelTask,
  retryTask: testState.retryTask,
}));

vi.mock('../../api/models', () => ({
  getModels: async () => [{ id: 'model_001', name: '日前调度模型' }],
  getModelSchema: async () => ({ parameter_schema: { parameters: [{ code: 'load', name: '负荷', required: true, default: [10, 12, 14] }] } }),
  getModelAssetDetail: async () => ({ parameter_schema: { parameters: [{ code: 'load', name: '负荷', required: true, default: [10, 12, 14] }] } }),
}));

vi.mock('../../api/results', () => ({
  getResult: async () => testState.result,
}));

function renderPage() {
  return renderWithQueryClient(<TaskCenterPage />);
}

test('renders task center metrics and structured task detail', async () => {
  renderPage();
  expect(screen.getByText('任务调度中心')).toBeInTheDocument();
  expect(await screen.findByText('OPT-SUCCESS')).toBeInTheDocument();
  expect(screen.getByText('失败/无解')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: '查看' })[0]);

  await waitFor(() => expect(screen.getByText('任务进度')).toBeInTheDocument());
  fireEvent.click(screen.getByText('输入参数'));
  expect(screen.getByText('day_ahead_dispatch')).toBeInTheDocument();
  fireEvent.click(screen.getByText('求解日志'));
  expect(screen.getByText('SOLVING HiGHS 求解完成')).toBeInTheDocument();
  fireEvent.click(screen.getByText('结果解释'));
  await waitFor(() => expect(screen.getByText('日前调度求解完成。')).toBeInTheDocument());
}, 20000);

test('retries failed task from list', async () => {
  renderPage();
  expect(await screen.findByText('OPT-FAILED')).toBeInTheDocument();
  const failedRow = screen.getByText('OPT-FAILED').closest('tr')!;
  fireEvent.click(within(failedRow).getByRole('button', { name: /更多/ }));
  fireEvent.click(await screen.findByText('重试任务'));
  await waitFor(() => expect(testState.retryTask.mock.calls[0]?.[0]).toBe('OPT-FAILED'));
}, 30000);
