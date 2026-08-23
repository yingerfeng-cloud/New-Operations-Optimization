import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SolverProgressPanel, TaskExplanationPanel, TaskInputPanel, TaskResultPanel, TaskTimelinePanel } from '../../features/task-center/TaskPanels';
import type { SolveTask } from '../../types/task';

const task = (overrides: Partial<SolveTask> = {}): SolveTask => ({ id: 'T1', model_id: 'M1', model: '调度模型', scene: '日前调度', solver: 'HiGHS', status: 'SUCCESS', progress: 100, cost: 10, created_at: '2026-07-12', ...overrides });

test('task input panel shows submitted business data and contract summary', () => {
  render(<TaskInputPanel task={task({ horizon: 24, interval_minutes: 60, runtime_parameters: { load: [10, 20], reserve: 5 }, data_source: '上传数据' })} />);
  expect(screen.getByText('调度模型')).toBeInTheDocument(); expect(screen.getByText('日前调度')).toBeInTheDocument();
  expect(screen.getByText('horizon')).toBeInTheDocument(); expect(screen.getByText('业务参数')).toBeInTheDocument(); expect(screen.getByText('load')).toBeInTheDocument();
});

test('failed diagnosis includes causes, risk notes, and executable actions', () => {
  render(<TaskExplanationPanel task={task({ status: 'INFEASIBLE', diagnostics: { category: '不可行问题', cause: '供需不平衡' }, risk_notes: ['负荷超限'] })} />);
  expect(screen.getByText('结构化解释')).toBeInTheDocument(); expect(screen.getByRole('link', { name: '修改参数重新提交' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '检查求解环境' })).toBeInTheDocument();
});

test('task result metrics use Chinese labels without exposing technical field names', () => {
  render(<TaskResultPanel result={{ metrics: {
    objective_value: 4147343.06,
    total_contract_cost: 3112063.2,
    total_spot_expected_cost: 909218.75,
    total_risk_penalty: 126061.11,
    total_expected_cost: 4147343.06,
    contract_total_gap: 0,
    risk: 'medium',
  } }} />);

  expect(screen.getByText('目标函数值')).toBeInTheDocument();
  expect(screen.getByText('合约总成本')).toBeInTheDocument();
  expect(screen.getByText('现货预期成本')).toBeInTheDocument();
  expect(screen.getByText('风险惩罚成本')).toBeInTheDocument();
  expect(screen.getByText('预期总成本')).toBeInTheDocument();
  expect(screen.getByText('中风险')).toBeInTheDocument();
  expect(screen.queryByText('objective_value')).not.toBeInTheDocument();
  expect(screen.queryByText('total_contract_cost')).not.toBeInTheDocument();
});

test('solve timeline shows the timestamp and duration for every recorded stage', () => {
  render(<TaskTimelinePanel task={task({
    started_at: '2026-07-12 10:00:02',
    finished_at: '2026-07-12 10:00:08',
    trace: {
      stage_timings: {
        PENDING: { started_at: '2026-07-12 10:00:00', finished_at: '2026-07-12 10:00:02', duration_seconds: 2 },
        VALIDATING: { started_at: '2026-07-12 10:00:02', finished_at: '2026-07-12 10:00:03', duration_seconds: 0.25 },
        BUILDING_MODEL: { started_at: '2026-07-12 10:00:03', finished_at: '2026-07-12 10:00:04', duration_seconds: 1 },
        SOLVING: { started_at: '2026-07-12 10:00:04', finished_at: '2026-07-12 10:00:07', duration_seconds: 3.5 },
        FORMATTING_RESULT: { started_at: '2026-07-12 10:00:07', finished_at: '2026-07-12 10:00:08', duration_seconds: 0.1 },
      },
    },
  })} />);
  expect(screen.getByText('开始：2026-07-12 10:00:04 · 完成：2026-07-12 10:00:07 · 耗时：3.5 s')).toBeInTheDocument();
  expect(screen.getByText('完成：2026-07-12 10:00:08')).toBeInTheDocument();
});

test('solver progress panel renders real convergence metrics and replay action', () => {
  render(<SolverProgressPanel task={task({
    trace: {
      solver_progress: {
        status: 'COMPLETED',
        supported: true,
        message: '已记录 HiGHS 返回的真实最优解搜索轨迹。',
        latest: { elapsed_seconds: 1.2, incumbent_objective: 89, best_bound: 88.5, gap: 0.025, node_count: 12 },
        points: [
          { elapsed_seconds: 0.1, incumbent_objective: 120, best_bound: 80, gap: 0.5, node_count: 0 },
          { elapsed_seconds: 1.2, incumbent_objective: 89, best_bound: 88.5, gap: 0.025, node_count: 12 },
        ],
        events: [
          { kind: 'first_feasible', label: '找到首个可行解', elapsed_seconds: 0.1, value: 120 },
          { kind: 'optimality_proven', label: '求解器已证明当前解最优', elapsed_seconds: 1.2, value: 89 },
        ],
      },
    },
  })} />);
  expect(screen.getByText('2.5%')).toBeInTheDocument();
  expect(screen.getByText('找到首个可行解')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重放搜索过程' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '最好可行解、理论最优界和最优间隙的真实求解收敛曲线' })).toBeInTheDocument();
});

test('completed historical task explains why search trace is unavailable', () => {
  render(<SolverProgressPanel task={task({ status: 'SUCCESS', trace: {} })} />);
  expect(screen.getByText('该历史任务没有搜索轨迹')).toBeInTheDocument();
  expect(screen.getAllByText(/真实历史轨迹无法补录/).length).toBeGreaterThan(0);
});

test('LP task renders actual HiGHS iteration activity instead of MIP gap placeholders', () => {
  render(<SolverProgressPanel task={task({
    trace: {
      solver_progress: {
        status: 'COMPLETED',
        supported: true,
        search_mode: 'LP_ITERATION',
        problem_type: 'LP',
        message: '已记录 HiGHS 返回的真实 LP 算法迭代轨迹。',
        latest: { elapsed_seconds: 0.04, incumbent_objective: -268736.1, iteration_count: 18, algorithm: '单纯形' },
        points: [
          { elapsed_seconds: 0.01, iteration_count: 1, algorithm: '单纯形' },
          { elapsed_seconds: 0.04, iteration_count: 18, algorithm: '单纯形' },
        ],
      },
    },
  })} />);
  expect(screen.getByText('累计迭代次数')).toBeInTheDocument();
  expect(screen.getByText('单纯形')).toBeInTheDocument();
  expect(screen.getByText('LP / QP')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'HiGHS 真实算法累计迭代次数曲线' })).toBeInTheDocument();
});
