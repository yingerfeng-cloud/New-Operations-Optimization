import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { message } from 'antd';
import { vi } from 'vitest';
import { AgentWorkbenchPage } from '../../pages/AgentWorkbench/AgentWorkbenchPage';
import type { AgentAnalyzeResponse, AgentConversation, AgentConversationSummary, AgentRun, AgentSkill, AgentStatus } from '../../types/agent';
import { renderWithQueryClient } from '../testUtils';

const testState = vi.hoisted(() => {
  const status: AgentStatus = {
    platform: { reachable: true, health_ok: true, skill_registry_ok: true, skill_count: 2 },
    llm: { enabled: true, api_key_configured: true, provider: 'openai', model: 'gpt-agent', operational_state: 'healthy', ready: true },
  };
  const skills: AgentSkill[] = [
    { name: 'dispatch_agent', display_name: '调度 Agent', enabled: true, required_parameters: ['load'] },
    { name: 'diagnosis_agent', display_name: '诊断 Agent', enabled: true },
  ];
  const activeRun: AgentRun = {
    run_id: 'RUN-HISTORY',
    conversation_id: 'CONV-1',
    title: '日前调度运行',
    status: 'PARAMETER_REVIEW',
    workflow_state: 'PARAM_COLLECTING',
    agent_skill_name: 'dispatch_agent',
    api_skill_name: 'run_day_ahead_dispatch',
    missing_required: ['forecast'],
    parameter_draft: { horizon: 24 },
    events: [{ event_id: 'EVT-1', sequence: 1, type: 'run.created', title: '已创建优化运行' }],
  };
  const conversations: AgentConversationSummary[] = [
    { conversation_id: 'CONV-1', title: '日前调度', status: 'CHAT_IDLE', last_message: '创建日前调度模型', active_run_id: activeRun.run_id, active_run_status: activeRun.status },
  ];
  const conversation: AgentConversation = {
    conversation_id: 'CONV-1',
    title: '日前调度',
    status: 'CHAT_IDLE',
    messages: [{ role: 'user', text: '创建日前调度模型' }],
    active_run: activeRun,
    runs: [activeRun],
    agent_tasks: [{
      task_id: 'TASK-HISTORY',
      conversation_id: 'CONV-1',
      turn_id: 'TURN-HISTORY',
      title: '日前调度任务',
      tool_name: 'optimization_create_or_continue',
      status: 'WAITING_INPUT',
      result: {
        conversation_id: 'CONV-1',
        workflow_state: 'PARAM_COLLECTING',
        status: 'PARAM_COLLECTING',
        agent_skill_name: 'dispatch_agent',
        resolved_skill_name: 'run_day_ahead_dispatch',
        route_confidence: 0.91,
        selection_reason: '业务场景和时间范围与日前调度相符',
        candidate_skills: [
          { agent_skill_name: 'dispatch_agent', platform_skill_name: 'run_day_ahead_dispatch', display_name: '调度 Agent', final_score: 0.91, reason: '日前计划匹配' },
          { agent_skill_name: 'diagnosis_agent', platform_skill_name: 'run_diagnosis', display_name: '诊断 Agent', final_score: 0.42, reason: '包含分析诉求' },
        ],
        run: activeRun,
        missing_required: ['forecast'],
        parameter_draft: { horizon: 24 },
      },
    }],
    turns: [{
      turn_id: 'TURN-HISTORY',
      conversation_id: 'CONV-1',
      status: 'SUCCEEDED',
      input: '创建日前调度模型',
      duration_ms: 1200,
    }],
    events: [],
  };
  const analyzeResponse: AgentAnalyzeResponse = {
    conversation_id: 'CONV-2',
    response_type: 'parameter_draft',
    intent: 'build_and_run_model',
    workflow_state: 'READY_TO_INVOKE',
    status: 'READY_TO_INVOKE',
    agent_message: '参数已抽取，等待确认调用',
    agent_skill_name: 'dispatch_agent',
    resolved_skill_name: 'solve_optimization_model',
    route_confidence: 0.91,
    selection_reason: '业务场景和时间范围与日前调度相符',
    candidate_skills: [
      { agent_skill_name: 'dispatch_agent', platform_skill_name: 'solve_optimization_model', display_name: '调度 Agent', final_score: 0.91, reason: '日前计划匹配' },
      { agent_skill_name: 'diagnosis_agent', platform_skill_name: 'run_diagnosis', display_name: '诊断 Agent', final_score: 0.42, reason: '包含分析诉求' },
    ],
    parameter_draft: { load: [10, 12, 14], horizon: 24 },
    missing_required: ['price'],
    requires_default_confirmation: true,
    ready_to_invoke: true,
  };
  const invokeResponse: AgentAnalyzeResponse = {
    ...analyzeResponse,
    workflow_state: 'RESULT_READY',
    status: 'RESULT_READY',
    invocation_id: 'INV-1',
    objective_value: 123.45,
    result: { objective_value: 123.45 },
    agent_message: '模型调用完成',
  };
  const defaultApproval = {
    approval_id: 'APR-DEFAULT',
    conversation_id: 'CONV-2',
    turn_id: 'TURN-1',
    task_id: 'TASK-1',
    status: 'PENDING' as const,
    prompt: '确认默认值',
    payload: { action: 'confirm_defaults' },
  };
  const invokeApproval = {
    ...defaultApproval,
    approval_id: 'APR-INVOKE',
    prompt: '确认执行',
    payload: { action: 'confirm_invoke' },
  };
  const turnResponse = {
    conversation_id: 'CONV-2',
    turn_id: 'TURN-1',
    message: { role: 'assistant', text: '参数已抽取，等待确认调用', message_id: 'MSG-2' },
    tasks: [{
      task_id: 'TASK-1',
      conversation_id: 'CONV-2',
      turn_id: 'TURN-1',
      title: '优化任务',
      tool_name: 'optimization_create_or_continue',
      status: 'APPROVAL_REQUIRED' as const,
      result: analyzeResponse,
    }],
    approvals: [defaultApproval],
    event_cursor: 7,
    turn: {
      turn_id: 'TURN-1',
      conversation_id: 'CONV-2',
      status: 'SUCCEEDED' as const,
      input: '请创建日前调度模型',
    },
    conversation: {
      ...conversation,
      conversation_id: 'CONV-2',
      messages: [
        ...(conversation.messages || []),
        { role: 'user', text: '请创建日前调度模型' },
        { role: 'assistant', text: '参数已抽取，等待确认调用' },
      ],
      agent_tasks: [{
        task_id: 'TASK-1',
        conversation_id: 'CONV-2',
        turn_id: 'TURN-1',
        title: '优化任务',
        tool_name: 'optimization_create_or_continue',
        status: 'APPROVAL_REQUIRED' as const,
        result: analyzeResponse,
      }],
      pending_approvals: [defaultApproval],
      turns: [{
        turn_id: 'TURN-1',
        conversation_id: 'CONV-2',
        status: 'SUCCEEDED' as const,
        input: '请创建日前调度模型',
      }],
      events: [],
    },
  };
  return {
    status,
    skills,
    conversations,
    conversation,
    analyzeResponse,
    invokeResponse,
    turnResponse,
    getAgentStatus: vi.fn(async () => status),
    getAgentSkills: vi.fn(async () => skills),
    getAgentConversations: vi.fn(async () => conversations),
    getAgentConversation: vi.fn(async (conversationId: string) => conversationId === 'CONV-2' ? turnResponse.conversation : conversation),
    createAgentConversation: vi.fn(async () => conversation),
    createAgentTurn: vi.fn(async () => turnResponse),
    retryAgentTurn: vi.fn(async () => turnResponse),
    resolveAgentApproval: vi.fn(async (approvalId: string) => approvalId === 'APR-DEFAULT' ? {
      approval: { ...defaultApproval, status: 'APPROVED' as const },
      task: {
        ...turnResponse.tasks[0],
        status: 'APPROVAL_REQUIRED' as const,
        result: { ...analyzeResponse, requires_default_confirmation: false, ready_to_invoke: true },
      },
      result: { ...analyzeResponse, requires_default_confirmation: false, ready_to_invoke: true },
      next_approval: invokeApproval,
    } : {
      approval: { ...invokeApproval, status: 'APPROVED' as const },
      task: { ...turnResponse.tasks[0], status: 'SUCCEEDED' as const, result: invokeResponse },
      result: invokeResponse,
      next_approval: null,
    }),
    cancelAgentTask: vi.fn(),
    deleteAgentConversation: vi.fn(async () => ({ deleted: true, conversation_id: 'CONV-1', deleted_run_count: 1 })),
    applySampleParameters: vi.fn(async () => ({ ...analyzeResponse, parameter_draft: { load: [1, 2, 3] } })),
  };
});

vi.mock('../../api/agents', () => ({
  getAgentStatus: testState.getAgentStatus,
  getAgentSkills: testState.getAgentSkills,
  getAgentConversations: testState.getAgentConversations,
  getAgentConversation: testState.getAgentConversation,
  createAgentConversation: testState.createAgentConversation,
  createAgentTurn: testState.createAgentTurn,
  retryAgentTurn: testState.retryAgentTurn,
  agentConversationEventStreamUrl: vi.fn(() => '/events'),
  agentRunEventStreamUrl: vi.fn(() => '/run-events'),
  resolveAgentApproval: testState.resolveAgentApproval,
  cancelAgentTask: testState.cancelAgentTask,
  deleteAgentConversation: testState.deleteAgentConversation,
  applySampleParameters: testState.applySampleParameters,
}));

function renderPage() {
  return renderWithQueryClient(<AgentWorkbenchPage />);
}

test('loads agent status, skills and sends a V3 Agent turn', async () => {
  renderPage();
  expect(screen.getByText('Agent 工作台')).toBeInTheDocument();
  expect(await screen.findByText('智能体可用')).toBeInTheDocument();
  expect(screen.getByText('默认自动识别 Skill')).toBeInTheDocument();
  expect(screen.getByText('可以直接聊天、分析问题，或让 Agent 调用运筹优化 Skill 完成复杂任务。')).toHaveClass('agent-empty-prompts-copy');
  expect(screen.getByText('帮我梳理今天的工作').parentElement).toHaveClass('agent-empty-prompts-actions');

  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '请创建日前调度模型' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));

  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalledTimes(1));
  expect(testState.createAgentTurn).toHaveBeenCalledWith('CONV-1', '请创建日前调度模型', {}, expect.any(String));
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  expect(screen.getAllByText('build_and_run_model').length).toBeGreaterThan(0);
  expect(screen.getAllByText('缺失必填参数').length).toBeGreaterThan(0);
  expect(screen.getAllByText('price').length).toBeGreaterThan(0);
});

test('shows the auto-selected optimization model inline and submits a safe switch turn', async () => {
  renderPage();

  const decision = await screen.findByRole('region', { name: '优化模型选择' });
  expect(within(decision).getByText('已自动选择优化模型')).toBeInTheDocument();
  expect(within(decision).getAllByText('匹配度 91%').length).toBeGreaterThan(0);
  expect(within(decision).getAllByText('调度 Agent').length).toBeGreaterThan(0);
  fireEvent.click(within(decision).getByRole('button', { name: '补充参数' }));
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('forecast：');
  await waitFor(() => expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveFocus());

  fireEvent.click(within(decision).getByText('查看或更换模型'));
  fireEvent.click(within(decision).getByRole('button', { name: '选择模型 诊断 Agent' }));

  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalledWith(
    'CONV-1',
    '切换为“诊断 Agent”',
    { preferred_skill: 'diagnosis_agent' },
    expect.any(String),
  ));
});

test('requires an inline model choice when routing needs clarification', async () => {
  const ambiguousConversation: AgentConversation = {
    ...testState.conversation,
    agent_tasks: [{
      ...(testState.conversation.agent_tasks || [])[0],
      result: {
        conversation_id: 'CONV-1',
        workflow_state: 'CLARIFICATION',
        status: 'CLARIFICATION',
        needs_clarification: true,
        clarification_question: '请选择要执行的业务场景。',
        route_confidence: 0.68,
        candidate_skills: [
          { agent_skill_name: 'dispatch_agent', platform_skill_name: 'run_day_ahead_dispatch', display_name: '调度 Agent', final_score: 0.68 },
          { agent_skill_name: 'diagnosis_agent', platform_skill_name: 'run_diagnosis', display_name: '诊断 Agent', final_score: 0.64 },
        ],
      },
    }],
  };
  testState.getAgentConversation.mockImplementationOnce(async () => ambiguousConversation);
  renderPage();

  const decision = await screen.findByRole('region', { name: '优化模型选择' });
  expect(within(decision).getByText('需要确认优化场景')).toBeInTheDocument();
  expect(within(decision).getByText('请选择要执行的业务场景。')).toBeInTheDocument();
  fireEvent.click(within(decision).getByRole('button', { name: '选择模型 调度 Agent' }));

  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalledWith(
    'CONV-1',
    '使用“调度 Agent”继续当前任务',
    { preferred_skill: 'dispatch_agent' },
    expect.any(String),
  ));
});

test('shows Agent thinking in the conversation instead of a sending spinner on the button', async () => {
  let resolveTurn!: (value: typeof testState.turnResponse) => void;
  testState.createAgentTurn.mockImplementationOnce(() => new Promise(resolve => {
    resolveTurn = resolve;
  }));
  renderPage();

  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '请分析这个问题' } });
  const sendButton = screen.getByRole('button', { name: '发送' });
  fireEvent.click(sendButton);

  expect(await screen.findByRole('status', { name: 'Agent 正在思考' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('');
  expect(sendButton).toBeDisabled();
  expect(sendButton).not.toHaveClass('ant-btn-loading');
  expect(sendButton).toHaveAccessibleName('发送');

  await act(async () => resolveTurn(testState.turnResponse));
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Agent 正在思考' })).not.toBeInTheDocument());
});

test('keeps a server-recorded failed turn out of the composer without adding another toast', async () => {
  const errorToast = vi.spyOn(message, 'error');
  let rejectTurn!: (reason: unknown) => void;
  testState.createAgentTurn.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectTurn = reject;
  }));
  renderPage();

  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '会超时的消息' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByRole('status', { name: 'Agent 正在思考' })).toBeInTheDocument();
  await act(async () => rejectTurn({ response: { status: 504 } }));
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Agent 正在思考' })).not.toBeInTheDocument());
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('');
  expect(screen.getAllByText('会超时的消息')).toHaveLength(1);
  expect(errorToast).not.toHaveBeenCalled();
  errorToast.mockRestore();
});

test('renders a durable failed Turn, prioritizes it over stale task state, and retries the same Turn', async () => {
  const failedConversation: AgentConversation = {
    ...testState.conversation,
    status: 'CHAT_ERROR',
    messages: [{ role: 'user', text: '创建调度任务', turn_id: 'TURN-FAILED', message_id: 'MSG-FAILED-USER' }],
    turns: [{
      turn_id: 'TURN-FAILED',
      conversation_id: 'CONV-1',
      status: 'FAILED',
      input: '创建调度任务',
      retryable: true,
      duration_ms: 14_000,
      error: {
        code: 'LLM_TRANSPORT_ERROR',
        message: 'Agent 与模型服务的连接中断，本轮未能完成。请稍后重试。',
        protocol: 'responses_tools',
      },
    }],
  };
  testState.getAgentConversation.mockImplementationOnce(async () => failedConversation);
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('本轮未完成');
  expect(screen.getByRole('alert')).toHaveTextContent('Agent 与模型服务的连接中断');
  await waitFor(() => expect(document.querySelector('.agent-run-status-chip')).toHaveTextContent('本轮失败'));

  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重试本轮' }));
  await waitFor(() => expect(testState.retryAgentTurn).toHaveBeenCalledWith('TURN-FAILED'));
});

test('resolves the V3 approval chain without calling legacy confirmation APIs', async () => {
  renderPage();
  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '补齐参数并调用' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));

  fireEvent.click(screen.getByRole('button', { name: '确认默认值' }));
  await waitFor(() => expect(testState.resolveAgentApproval).toHaveBeenCalledWith('APR-DEFAULT', 'approve'));

  fireEvent.click(screen.getByRole('button', { name: '提交优化任务' }));
  await waitFor(() => expect(testState.resolveAgentApproval).toHaveBeenCalledWith('APR-INVOKE', 'approve'));
  expect(await screen.findByText('模型调用完成')).toBeInTheDocument();
  expect(screen.getAllByText('INV-1').length).toBeGreaterThan(0);
});

test('clears expert Skill before returning to business mode', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  fireEvent.click(screen.getByRole('button', { name: '专家视图' }));
  fireEvent.mouseDown(screen.getByLabelText('指定 Skill'));
  fireEvent.click((await screen.findAllByText('调度 Agent')).at(-1)!);
  expect(screen.getByText(/已指定 Skill/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回业务视图' }));
  expect(screen.getByText('默认自动识别 Skill')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '自动识别需求' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalled());
  const calls = testState.createAgentTurn.mock.calls as unknown as Array<[string, string, Record<string, unknown>, string]>;
  expect(calls.at(-1)![2]).toEqual({});
});

test('switching history restores the selected conversation run', async () => {
  renderPage();
  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '生成计划' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '打开会话 日前调度' }));
  expect(screen.queryByText('参数已抽取，等待确认调用')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  expect(await screen.findByText('日前调度运行')).toBeInTheDocument();
  expect(screen.getAllByText('forecast').length).toBeGreaterThan(0);
  expect(screen.getAllByText('检查参数').length).toBeGreaterThan(0);
});

test('uses the durable task lifecycle instead of a stale run snapshot', async () => {
  const staleRunConversation: AgentConversation = {
    ...testState.conversation,
    agent_tasks: (testState.conversation.agent_tasks || []).map(task => ({ ...task, status: 'CANCELLED' as const })),
  };
  testState.getAgentConversation.mockImplementationOnce(async () => staleRunConversation);

  renderPage();

  await waitFor(() => expect(document.querySelector('.agent-run-status-chip')).toHaveTextContent('已取消'));
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  const dialog = screen.getByRole('dialog', { name: /活动/ });
  expect(within(dialog).getByText('已取消')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument();
});

test('toggling the inspector keeps the conversation controls available', async () => {
  renderPage();
  expect(screen.getByRole('button', { name: '查看运行详情' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭运行检查器' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  expect(screen.getByRole('button', { name: '关闭运行检查器' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭运行检查器' }));
  expect(screen.getByRole('button', { name: '查看运行详情' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭活动面板' }));
  expect(screen.queryByRole('button', { name: '关闭运行检查器' })).not.toBeInTheDocument();
});

test('activity inspector behaves as a keyboard-accessible dialog', () => {
  renderPage();
  const trigger = screen.getByRole('button', { name: '查看运行详情' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: /活动/ });
  expect(screen.getByRole('button', { name: '关闭运行检查器' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: /活动/ })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('mobile session drawer exposes create, switch, and manage actions', async () => {
  renderPage();
  await screen.findByRole('button', { name: '打开会话 日前调度' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: '打开会话列表' }));
  const drawer = await screen.findByRole('dialog', { name: '会话' });
  expect(within(drawer).getByRole('button', { name: '新建' })).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: '打开会话 日前调度' })).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: '管理会话 日前调度' })).toBeInTheDocument();
});

test('deleting a history conversation requires confirmation and calls the delete API', async () => {
  renderPage();
  await screen.findByRole('button', { name: '管理会话 日前调度' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: '管理会话 日前调度' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除会话' }));
  expect(screen.getByRole('dialog', { name: '删除会话？' })).toBeInTheDocument();
  expect(screen.getByText(/确定删除.*日前调度/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '删除会话' }));
  await waitFor(() => expect(testState.deleteAgentConversation).toHaveBeenCalledWith('CONV-1'));
});
