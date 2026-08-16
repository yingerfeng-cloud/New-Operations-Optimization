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
  expect(screen.getByRole('generic', { name: '当前工作流摘要' })).toHaveTextContent('参数 2/3');
  expect(screen.queryByText('build_and_run_model')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('参数与校验'));
  expect(screen.getByText('缺失参数')).toBeInTheDocument();
  expect(screen.getAllByText('price').length).toBeGreaterThan(0);
});

test('shows the auto-selected optimization model inline and submits a safe switch turn', async () => {
  renderPage();

  const decision = await screen.findByRole('region', { name: '优化模型选择' });
  expect(within(decision).getByText('已自动选择优化模型')).toBeInTheDocument();
  expect(within(decision).getAllByText('匹配度 91%').length).toBeGreaterThan(0);
  expect(within(decision).getAllByText('调度 Agent').length).toBeGreaterThan(0);
  fireEvent.click(within(decision).getByRole('button', { name: '批量补充参数' }));
  const batchDialog = screen.getByRole('dialog', { name: '批量补充参数（1 项待补充）' });
  expect(within(batchDialog).getByRole('textbox', { name: '填写参数 forecast' })).toBeInTheDocument();
  fireEvent.click(within(batchDialog).getByRole('button', { name: /取\s*消/ }));

  fireEvent.click(within(decision).getByText('查看或更换模型'));
  fireEvent.click(within(decision).getByRole('button', { name: '选择模型 诊断 Agent' }));

  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalledWith(
    'CONV-1',
    '切换为“诊断 Agent”',
    { preferred_skill: 'diagnosis_agent' },
    expect.any(String),
  ));
});

test('offers guided or batch parameter entry without sending before review', async () => {
  renderPage();

  await screen.findByRole('region', { name: '优化模型选择' });
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  const inspector = screen.getByRole('dialog', { name: /活动/ });
  fireEvent.click(within(inspector).getByText('参数与校验'));
  fireEvent.click(within(inspector).getByRole('button', { name: '填写下一个参数' }));
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('forecast：');

  fireEvent.click(within(inspector).getByRole('button', { name: '批量补充参数' }));
  let batchDialog = screen.getByRole('dialog', { name: '批量补充参数（1 项待补充）' });
  fireEvent.change(within(batchDialog).getByRole('textbox', { name: '填写参数 forecast' }), { target: { value: '96, 102, 108' } });
  fireEvent.click(within(batchDialog).getByRole('button', { name: /取\s*消/ }));
  expect(screen.queryByRole('dialog', { name: /批量补充参数/ })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('forecast：');

  fireEvent.click(within(inspector).getByRole('button', { name: '批量补充参数' }));
  batchDialog = screen.getByRole('dialog', { name: '批量补充参数（1 项待补充）' });
  fireEvent.click(within(batchDialog).getByRole('button', { name: '写入对话' }));
  expect(within(batchDialog).getByRole('alert')).toHaveTextContent('请至少填写一个参数');
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('forecast：');

  fireEvent.change(within(batchDialog).getByRole('textbox', { name: '填写参数 forecast' }), { target: { value: '96, 102, 108' } });
  fireEvent.click(within(batchDialog).getByRole('button', { name: '写入对话' }));
  expect(screen.queryByRole('dialog', { name: /批量补充参数/ })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveValue('请为当前工作流补充以下参数：\n- forecast：96, 102, 108');
  expect(testState.createAgentTurn).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByPlaceholderText('给 Agent 发消息')).toHaveFocus());
});

test('writes only completed fields when batch filling part of a long parameter list', async () => {
  const missingRequired = [
    { name: '优化时段数', key: 'horizon', unit: 'period' },
    { name: '交易时段', key: 'time' },
    { name: '负荷预测', key: 'load_forecast', unit: 'MWh' },
  ];
  const multiRun: AgentRun = {
    ...testState.conversation.active_run!,
    missing_required: missingRequired,
  };
  const multiParameterConversation: AgentConversation = {
    ...testState.conversation,
    active_run: multiRun,
    runs: [multiRun],
    agent_tasks: (testState.conversation.agent_tasks || []).map(task => ({
      ...task,
      result: {
        ...(task.result || {}),
        run: multiRun,
        missing_required: missingRequired,
      },
    })),
  };
  testState.getAgentConversation.mockImplementationOnce(async () => multiParameterConversation);
  renderPage();

  await screen.findByRole('region', { name: '优化模型选择' });
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  const inspector = screen.getByRole('dialog', { name: /活动/ });
  fireEvent.click(within(inspector).getByText('参数与校验'));
  fireEvent.click(within(inspector).getByRole('button', { name: '批量补充参数' }));
  const batchDialog = screen.getByRole('dialog', { name: '批量补充参数（3 项待补充）' });
  expect(within(batchDialog).getByText('优化时段数 · horizon（period）')).toBeInTheDocument();
  expect(within(batchDialog).getByText('负荷预测 · load_forecast（MWh）')).toBeInTheDocument();
  fireEvent.change(within(batchDialog).getByRole('textbox', { name: '填写参数 优化时段数' }), { target: { value: '24' } });
  fireEvent.change(within(batchDialog).getByRole('textbox', { name: '填写参数 负荷预测' }), { target: { value: '[96, 102, 108]' } });
  fireEvent.click(within(batchDialog).getByRole('button', { name: '写入对话' }));

  const composer = screen.getByPlaceholderText('给 Agent 发消息');
  expect(composer).toHaveValue('请为当前工作流补充以下参数：\n- 优化时段数（period）：24\n- 负荷预测（MWh）：[96, 102, 108]');
  expect(composer).not.toHaveValue(expect.stringContaining('交易时段'));
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

test('keeps existing messages readable while the conversation refreshes in the background', async () => {
  const { queryClient } = renderPage();
  expect(await screen.findByText('创建日前调度模型')).toBeInTheDocument();

  let resolveRefresh!: (value: AgentConversation) => void;
  testState.getAgentConversation.mockImplementationOnce(() => new Promise(resolve => {
    resolveRefresh = resolve;
  }));
  await act(async () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-conversation', 'CONV-1'] });
  });

  await waitFor(() => expect(queryClient.getQueryState(['agent-conversation', 'CONV-1'])?.fetchStatus).toBe('fetching'));
  expect(document.querySelector('.agent-message-list .ant-spin-container')).not.toHaveClass('ant-spin-blur');
  expect(screen.getByText('创建日前调度模型')).toBeVisible();

  await act(async () => resolveRefresh(testState.conversation));
  await waitFor(() => expect(queryClient.getQueryState(['agent-conversation', 'CONV-1'])?.fetchStatus).toBe('idle'));
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
  await screen.findByRole('region', { name: '优化模型选择' });
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  fireEvent.click(screen.getByRole('button', { name: '诊断信息' }));
  fireEvent.click(screen.getByRole('tab', { name: /路由与参数/ }));
  fireEvent.mouseDown(screen.getByLabelText('指定 Skill'));
  fireEvent.click((await screen.findAllByText('调度 Agent')).at(-1)!);
  expect(screen.getByText(/已指定 Skill/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '收起诊断' }));
  expect(screen.getByText('默认自动识别 Skill')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('给 Agent 发消息'), { target: { value: '自动识别需求' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(testState.createAgentTurn).toHaveBeenCalled());
  const calls = testState.createAgentTurn.mock.calls as unknown as Array<[string, string, Record<string, unknown>, string]>;
  expect(calls.at(-1)![2]).toEqual({});
});

test('replaces duplicated expert panels with compact task diagnostics', async () => {
  renderPage();
  await screen.findByRole('region', { name: '优化模型选择' });
  fireEvent.click(screen.getByRole('button', { name: '查看运行详情' }));
  const dialog = screen.getByRole('dialog', { name: /活动/ });
  fireEvent.click(within(dialog).getByRole('button', { name: '诊断信息' }));

  const diagnostics = within(dialog).getByRole('region', { name: 'Agent 诊断信息' });
  expect(within(diagnostics).getByRole('tab', { name: '执行诊断' })).toHaveAttribute('aria-selected', 'true');
  expect(within(diagnostics).getByRole('region', { name: '运行标识' })).toHaveTextContent('RUN-HISTORY');
  expect(within(dialog).queryByRole('region', { name: '工作流活动' })).not.toBeInTheDocument();
  expect(within(dialog).queryByText('参数草稿')).not.toBeInTheDocument();
  expect(within(dialog).queryByText(/user：制定明日机组组合计划/)).not.toBeInTheDocument();

  fireEvent.click(within(diagnostics).getByRole('tab', { name: /路由与参数/ }));
  expect(within(diagnostics).getByRole('region', { name: '下一轮指定 Skill' })).toBeInTheDocument();
  expect(within(diagnostics).getByRole('region', { name: '路由结果' })).toHaveTextContent('dispatch_agent');
  expect(within(diagnostics).getByRole('region', { name: '参数诊断' })).toHaveTextContent('缺失参数（1）');
  expect(within(diagnostics).getByRole('region', { name: '候选 Skill' })).toHaveTextContent('仅展示 Top 3');

  fireEvent.click(within(diagnostics).getByRole('tab', { name: '原始数据' }));
  expect(within(diagnostics).getByText('任务上下文')).toBeInTheDocument();
  expect(within(diagnostics).getByText('事件载荷（0）')).toBeInTheDocument();
  expect(within(diagnostics).getByText('运行环境')).toBeInTheDocument();
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
  expect(within(dialog).getAllByText('已取消').length).toBeGreaterThan(0);
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
