import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { TaskExplanationPanel, TaskInputPanel } from '../../features/task-center/TaskPanels';
import type { SolveTask } from '../../types/task';

const task = (overrides: Partial<SolveTask> = {}): SolveTask => ({ id: 'T1', model_id: 'M1', model: '调度模型', scene: '日前调度', solver: 'HiGHS', status: 'SUCCESS', progress: 100, cost: 10, created_at: '2026-07-12', ...overrides });

test('task input panel shows submitted business data and contract summary', () => {
  render(<TaskInputPanel task={task({ horizon: 24, interval_minutes: 60, runtime_parameters: { load: [10, 20], reserve: 5 }, data_source: '上传数据' })} />);
  expect(screen.getByText('调度模型')).toBeInTheDocument(); expect(screen.getByText('日前调度')).toBeInTheDocument();
  expect(screen.getByText('horizon')).toBeInTheDocument(); expect(screen.getByText('业务参数')).toBeInTheDocument(); expect(screen.getByText('load')).toBeInTheDocument();
});

test('failed diagnosis includes causes, risk notes, and executable actions', () => {
  render(<TaskExplanationPanel task={task({ status: 'INFEASIBLE', diagnostics: { category: '不可行问题', cause: '供需不平衡' }, risk_notes: ['负荷超限'] })} />);
  expect(screen.getByText('诊断详情')).toBeInTheDocument(); expect(screen.getByRole('link', { name: '修改参数重新提交' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '检查求解环境' })).toBeInTheDocument();
});
