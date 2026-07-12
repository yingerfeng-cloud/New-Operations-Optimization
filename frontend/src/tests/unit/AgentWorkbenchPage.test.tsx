import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AgentWorkbenchPage } from '../../pages/AgentWorkbench/AgentWorkbenchPage';
import type { AgentAnalyzeResponse, AgentConversation, AgentConversationSummary, AgentSkill, AgentStatus } from '../../types/agent';
import { renderWithQueryClient } from '../testUtils';

const testState = vi.hoisted(() => {
  const status: AgentStatus = {
    platform: { reachable: true, health_ok: true, skill_registry_ok: true, skill_count: 2 },
    llm: { enabled: true, api_key_configured: true, provider: 'openai', model: 'gpt-agent' },
  };
  const skills: AgentSkill[] = [
    { name: 'dispatch_agent', display_name: '调度 Agent', enabled: true, required_parameters: ['load'] },
    { name: 'diagnosis_agent', display_name: '诊断 Agent', enabled: true },
  ];
  const conversations: AgentConversationSummary[] = [
    { conversation_id: 'CONV-1', title: '日前调度', status: 'CHAT_IDLE', last_message: '创建日前调度模型' },
  ];
  const conversation: AgentConversation = {
    conversation_id: 'CONV-1',
    title: '日前调度',
    status: 'CHAT_IDLE',
    messages: [{ role: 'user', text: '创建日前调度模型' }],
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
  return {
    status,
    skills,
    conversations,
    conversation,
    analyzeResponse,
    invokeResponse,
    getAgentStatus: vi.fn(async () => status),
    getAgentSkills: vi.fn(async () => skills),
    getAgentConversations: vi.fn(async () => conversations),
    getAgentConversation: vi.fn(async () => conversation),
    createAgentConversation: vi.fn(async () => conversation),
    analyzeAgentMessage: vi.fn(async () => analyzeResponse),
    confirmAgentDefaults: vi.fn(async () => ({ ...analyzeResponse, requires_default_confirmation: false })),
    confirmAgentInvoke: vi.fn(async () => invokeResponse),
    applySampleParameters: vi.fn(async () => ({ ...analyzeResponse, parameter_draft: { load: [1, 2, 3] } })),
  };
});

vi.mock('../../api/agents', () => ({
  getAgentStatus: testState.getAgentStatus,
  getAgentSkills: testState.getAgentSkills,
  getAgentConversations: testState.getAgentConversations,
  getAgentConversation: testState.getAgentConversation,
  createAgentConversation: testState.createAgentConversation,
  analyzeAgentMessage: testState.analyzeAgentMessage,
  confirmAgentDefaults: testState.confirmAgentDefaults,
  confirmAgentInvoke: testState.confirmAgentInvoke,
  applySampleParameters: testState.applySampleParameters,
}));

function renderPage() {
  return renderWithQueryClient(<AgentWorkbenchPage />);
}

test('loads agent status, skills and sends analyze request', async () => {
  renderPage();
  expect(screen.getByText('Agent 工作台')).toBeInTheDocument();
  expect(await screen.findByText('服务可用')).toBeInTheDocument();
  expect(screen.getByText('默认自动识别 Skill')).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('描述优化目标、时间范围和可用数据'), { target: { value: '请创建日前调度模型' } });
  fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

  await waitFor(() => expect(testState.analyzeAgentMessage).toHaveBeenCalledTimes(1));
  const analyzeCalls = testState.analyzeAgentMessage.mock.calls as unknown as Array<[Record<string, unknown>]>;
  expect(analyzeCalls[0][0]).toMatchObject({ message: '请创建日前调度模型' });
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('build_and_run_model').length).toBeGreaterThan(0);
  expect(screen.getAllByText('缺失必填参数').length).toBeGreaterThan(0);
  expect(screen.getAllByText('price').length).toBeGreaterThan(0);
});

test('confirms defaults and invokes agent conversation', async () => {
  renderPage();
  fireEvent.change(screen.getByPlaceholderText('描述优化目标、时间范围和可用数据'), { target: { value: '补齐参数并调用' } });
  fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: '确认默认值' }));
  await waitFor(() => expect(testState.confirmAgentDefaults).toHaveBeenCalledWith({ conversation_id: 'CONV-2', agent_skill_name: undefined }));

  fireEvent.click(screen.getByRole('button', { name: '提交优化任务' }));
  await waitFor(() => expect(testState.confirmAgentInvoke).toHaveBeenCalledWith({ conversation_id: 'CONV-2' }));
  expect(await screen.findByText('模型调用完成')).toBeInTheDocument();
  expect(screen.getByText('INV-1')).toBeInTheDocument();
});

test('clears expert Skill before returning to business mode', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '专家视图' }));
  fireEvent.mouseDown(screen.getByLabelText('指定 Skill'));
  fireEvent.click((await screen.findAllByText('调度 Agent')).at(-1)!);
  expect(screen.getByText(/已指定 Skill/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回业务视图' }));
  expect(screen.getByText('默认自动识别 Skill')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('描述优化目标、时间范围和可用数据'), { target: { value: '自动识别需求' } });
  fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
  await waitFor(() => expect(testState.analyzeAgentMessage).toHaveBeenCalled());
  const calls = testState.analyzeAgentMessage.mock.calls as unknown as Array<[Record<string, unknown>]>;
  const payload = calls.at(-1)![0];
  expect(payload).not.toHaveProperty('agent_skill_name');
  expect(payload).not.toHaveProperty('skill_name');
});

test('switching history clears previous execution progress', async () => {
  renderPage();
  fireEvent.change(screen.getByPlaceholderText('描述优化目标、时间范围和可用数据'), { target: { value: '生成计划' } });
  fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
  expect((await screen.findAllByText('参数已抽取，等待确认调用')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /日前调度/ }));
  expect(screen.queryByText('参数已抽取，等待确认调用')).not.toBeInTheDocument();
  expect(screen.getByText('尚未检查')).toBeInTheDocument();
});
