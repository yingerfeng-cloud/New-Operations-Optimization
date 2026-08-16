import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { AgentExceptionActivity, AgentRunInspector, AgentWorkflowActivity } from '../../features/agent-workbench/AgentRunPanels';
import type { AgentAnalyzeResponse, AgentRun, AgentV3Event, AgentV3Task, AgentV3Turn } from '../../types/agent';

const tasks: AgentV3Task[] = [
  {
    task_id: 'TASK-A', conversation_id: 'CONV-1', turn_id: 'TURN-A', title: '日前机组组合',
    tool_name: 'optimization_create_or_continue', status: 'CANCELLED', completion_reason: 'WORKFLOW_SWITCHED',
    optimization_run_id: 'RUN-A', created_at: '2026-08-13 11:00:00', updated_at: '2026-08-13 13:00:00',
    result: { agent_skill_name: 'unit_commitment_day_ahead' },
  },
  {
    task_id: 'TASK-B', conversation_id: 'CONV-1', turn_id: 'TURN-B', title: '中长期合约分解与现货暴露控制模型',
    tool_name: 'optimization_create_or_continue', status: 'WAITING_INPUT', optimization_run_id: 'RUN-B',
    created_at: '2026-08-13 13:00:00', updated_at: '2026-08-13 14:00:05',
    result: { agent_skill_name: 'contract_spot_exposure_v1' },
  },
];

const turns: AgentV3Turn[] = [
  {
    turn_id: 'TURN-A', conversation_id: 'CONV-1', status: 'SUCCEEDED', input: '制定明日机组组合计划',
    task_ids: ['TASK-A'], started_at: '2026-08-13 11:00:00', completed_at: '2026-08-13 11:00:12', duration_ms: 12_000,
  },
  {
    turn_id: 'TURN-B', conversation_id: 'CONV-1', status: 'SUCCEEDED', input: '切换为中长期合约模型',
    task_ids: ['TASK-B'], started_at: '2026-08-13 13:00:00', completed_at: '2026-08-13 13:00:08', duration_ms: 8_000,
  },
  {
    turn_id: 'TURN-B-RECENT', conversation_id: 'CONV-1', status: 'SUCCEEDED', input: '补充优化时段数为 24',
    task_ids: ['TASK-B'], started_at: '2026-08-13 14:00:00', completed_at: '2026-08-13 14:00:05', duration_ms: 5_000,
  },
  {
    turn_id: 'TURN-CHAT', conversation_id: 'CONV-1', status: 'SUCCEEDED', input: '负荷预测需要几个点',
    task_ids: [], attempt_count: 3, duration_ms: 5_000, completed_at: '2026-08-13 14:10:00',
  },
  {
    turn_id: 'TURN-NORMAL', conversation_id: 'CONV-1', status: 'SUCCEEDED', input: '普通问答',
    task_ids: [], duration_ms: 1_000, completed_at: '2026-08-13 14:20:00',
  },
  {
    turn_id: 'TURN-FAILED', conversation_id: 'CONV-1', status: 'FAILED', input: '连接失败的问答',
    task_ids: [], retryable: true, error: { message: '模型连接超时' }, completed_at: '2026-08-13 14:30:00',
  },
];

const invocation = (id: string, status: string, created: string, updated: string) => ({
  invocation_id: id, tool_name: 'optimization_create_or_continue', status, created_at: created, updated_at: updated,
});

const events: AgentV3Event[] = [
  {
    event_id: 'EVT-A-SUPERSEDED', sequence: 1, type: 'task.superseded', conversation_id: 'CONV-1',
    turn_id: 'TURN-B', task_id: 'TASK-A', created_at: '2026-08-13 13:00:01', payload: { reason: 'workflow_switched' },
  },
  {
    event_id: 'EVT-B-START', sequence: 2, type: 'tool.started', conversation_id: 'CONV-1',
    turn_id: 'TURN-B', task_id: 'TASK-B', created_at: '2026-08-13 13:00:02',
    payload: { invocation: invocation('TOOL-B', 'RUNNING', '2026-08-13 13:00:02', '2026-08-13 13:00:02') },
  },
  {
    event_id: 'EVT-B-TASK', sequence: 3, type: 'task.updated', conversation_id: 'CONV-1',
    turn_id: 'TURN-B', task_id: 'TASK-B', created_at: '2026-08-13 13:00:06', payload: { task: { status: 'WAITING_INPUT' } },
  },
  {
    event_id: 'EVT-B-DONE', sequence: 4, type: 'tool.completed', conversation_id: 'CONV-1',
    turn_id: 'TURN-B', task_id: 'TASK-B', created_at: '2026-08-13 13:00:06',
    payload: { invocation: invocation('TOOL-B', 'SUCCEEDED', '2026-08-13 13:00:02', '2026-08-13 13:00:06') },
  },
  {
    event_id: 'EVT-B2-START', sequence: 5, type: 'tool.started', conversation_id: 'CONV-1',
    turn_id: 'TURN-B-RECENT', task_id: 'TASK-B', created_at: '2026-08-13 14:00:01',
    payload: { invocation: invocation('TOOL-B2', 'RUNNING', '2026-08-13 14:00:01', '2026-08-13 14:00:01') },
  },
  {
    event_id: 'EVT-B2-DONE', sequence: 6, type: 'tool.completed', conversation_id: 'CONV-1',
    turn_id: 'TURN-B-RECENT', task_id: 'TASK-B', created_at: '2026-08-13 14:00:04',
    payload: { invocation: invocation('TOOL-B2', 'SUCCEEDED', '2026-08-13 14:00:01', '2026-08-13 14:00:04') },
  },
];

const runs: AgentRun[] = [
  {
    run_id: 'RUN-A', conversation_id: 'CONV-1', title: '日前机组组合', status: 'CANCELLED',
    model_id: 'MODEL-UC', missing_required: [{ key: 'load' }],
  },
  {
    run_id: 'RUN-B', conversation_id: 'CONV-1', title: '中长期合约分解与现货暴露控制模型', status: 'PARAMETER_REVIEW',
    model_id: 'MODEL-CONTRACT', parameter_draft: { horizon: 24 }, parameter_sources: { horizon: '用户输入' },
    missing_required: [{ key: 'time', name: '交易时段' }, { key: 'load', name: '负荷预测', unit: 'MWh' }],
  },
];

const activeResponse: AgentAnalyzeResponse = {
  conversation_id: 'CONV-1', workflow_state: 'PARAM_COLLECTING', parameter_draft: { horizon: 24 },
  parameter_sources: { horizon: '用户输入' }, missing_required: runs[1].missing_required,
};

test('groups workflow turns, puts the latest invocation first and folds older calls', () => {
  render(<AgentWorkflowActivity tasks={tasks} turns={turns} events={events} runs={runs} currentTaskId="TASK-B" />);

  const workflows = screen.getByRole('region', { name: '工作流活动' });
  expect(within(workflows).getByText('2 个工作流')).toBeInTheDocument();
  expect(within(workflows).getByText('已切换')).toBeInTheDocument();
  expect(within(workflows).getByText('补充优化时段数为 24')).toBeInTheDocument();
  expect(within(workflows).queryByText('切换为中长期合约模型')).not.toBeInTheDocument();
  expect(within(workflows).queryByText('MODEL-CONTRACT')).not.toBeInTheDocument();

  fireEvent.click(within(workflows).getByRole('button', { name: '查看历史调用（1）' }));
  const triggers = within(workflows).getAllByRole('article');
  expect(triggers[0]).toHaveTextContent('补充优化时段数为 24');
  expect(triggers[1]).toHaveTextContent('切换为中长期合约模型');
  expect(within(workflows).getAllByText('工具执行 · optimization_create_or_continue').length).toBeGreaterThan(0);
});

test('only shows failed, interrupted or retried non-workflow turns', () => {
  const onRetry = vi.fn();
  render(<AgentExceptionActivity turns={turns} events={events} onRetry={onRetry} />);

  const exceptions = screen.getByRole('region', { name: '异常与重试' });
  expect(within(exceptions).getByText('连接失败的问答')).toBeInTheDocument();
  expect(within(exceptions).getByText('模型连接超时')).toBeInTheDocument();
  expect(within(exceptions).getByText('负荷预测需要几个点')).toBeInTheDocument();
  expect(within(exceptions).getByText('重试后完成')).toBeInTheDocument();
  expect(within(exceptions).queryByText('普通问答')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '其他对话' })).not.toBeInTheDocument();
  fireEvent.click(within(exceptions).getByRole('button', { name: '重试本轮' }));
  expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ turn_id: 'TURN-FAILED' }));
});

test('merges current workflow facts and collapsible parameter details without exposing machine ids', () => {
  const onStartParameterInput = vi.fn();
  const onBatchParameterInput = vi.fn();
  const { container, rerender } = render(
    <AgentRunInspector run={runs[1]} task={tasks[1]} response={activeResponse} turns={turns} events={events} onStartParameterInput={onStartParameterInput} onBatchParameterInput={onBatchParameterInput} />,
  );

  expect(screen.getByText('当前工作流')).toBeInTheDocument();
  expect(screen.getByRole('generic', { name: '当前工作流摘要' })).toHaveTextContent('调用 2 次');
  expect(screen.getByRole('generic', { name: '当前工作流摘要' })).toHaveTextContent('参数 1/3');
  expect(container.querySelector('.agent-run-summary')).not.toBeInTheDocument();
  expect(screen.queryByText('MODEL-CONTRACT')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('参数与校验'));
  expect(screen.getByText('缺失参数')).toBeInTheDocument();
  expect(screen.getByText('交易时段 · time')).toBeInTheDocument();
  expect(screen.getByText('负荷预测 · load（MWh）')).toBeInTheDocument();
  expect(screen.getByText('已填写参数')).toBeInTheDocument();
  expect(screen.getByText('用户输入', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '填写下一个参数' }));
  expect(onStartParameterInput).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '批量补充参数' }));
  expect(onBatchParameterInput).toHaveBeenCalledTimes(1);

  rerender(<AgentRunInspector run={runs[1]} task={tasks[1]} response={activeResponse} turns={turns} events={events} expert />);
  expect(screen.getByText('MODEL-CONTRACT')).toBeInTheDocument();
});

test('hides an empty parameter draft and reports a checked workflow compactly', () => {
  render(<AgentRunInspector run={{ ...runs[1], parameter_draft: {}, missing_required: [] }} response={{ parameter_draft: {}, missing_required: [] }} />);

  expect(screen.getByText('参数已检查')).toBeInTheDocument();
  expect(screen.queryByText('参数与校验')).not.toBeInTheDocument();
  expect(screen.queryByText('参数草稿')).not.toBeInTheDocument();
  expect(screen.queryByText('运行记录')).not.toBeInTheDocument();
});

test('does not claim parameters are checked while a workflow is still routing', () => {
  render(<AgentRunInspector run={{ run_id: 'RUN-ROUTING', conversation_id: 'CONV-1', title: '待路由工作流', status: 'ROUTING' }} />);

  expect(screen.getByText('参数待检查')).toBeInTheDocument();
  expect(screen.queryByText('参数与校验')).not.toBeInTheDocument();
});
