import { apiClient, unwrap, platformAuthorization } from './client';
import type {
  AgentAnalyzePayload,
  AgentAnalyzeResponse,
  AgentConversation,
  AgentConversationPayload,
  AgentConversationSummary,
  AgentDefaultsPayload,
  AgentInvokePayload,
  AgentRun,
  AgentRunEvent,
  AgentSkill,
  AgentStatus,
  AgentV3Event,
  AgentV3ApprovalResolution,
  AgentV3Task,
  AgentV3Turn,
  AgentV3TurnResponse,
} from '../types/agent';

export const getAgentStatus = () => unwrap<AgentStatus>(apiClient.get('/api/agent/status'));

export const getPlatformSkills = () => unwrap<AgentSkill[]>(apiClient.get('/api/agent/skills'));

export const getAgentSkills = () => unwrap<AgentSkill[]>(apiClient.get('/api/agent/agent-skills'));

export const getAgentSkill = (name: string) => unwrap<AgentSkill>(apiClient.get(`/api/agent/agent-skills/${encodeURIComponent(name)}`));

export const enableAgentSkill = (name: string) => unwrap<AgentSkill>(apiClient.post(`/api/agent/agent-skills/${encodeURIComponent(name)}/enable`));

export const disableAgentSkill = (name: string) => unwrap<AgentSkill>(apiClient.post(`/api/agent/agent-skills/${encodeURIComponent(name)}/disable`));

export const getAgentSkillParameterExample = (name: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/agent/agent-skills/${encodeURIComponent(name)}/parameter-example`));

export const createAgentConversation = (payload: AgentConversationPayload = {}) => unwrap<AgentConversation>(apiClient.post('/api/agent/conversations', payload));

export const getAgentConversations = () => unwrap<AgentConversationSummary[]>(apiClient.get('/api/agent/conversations'));

export const getAgentConversation = (conversationId: string) => unwrap<AgentConversation>(apiClient.get(`/api/agent/conversations/${encodeURIComponent(conversationId)}`));

export const updateAgentConversation = (conversationId: string, payload: AgentConversationPayload) => unwrap<AgentConversation>(apiClient.patch(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, payload));

export const deleteAgentConversation = (conversationId: string) => unwrap<{ deleted?: boolean; conversation_id?: string; deleted_run_count?: number }>(apiClient.delete(`/api/agent/conversations/${encodeURIComponent(conversationId)}`));

export const analyzeAgentMessage = (payload: AgentAnalyzePayload) => unwrap<AgentAnalyzeResponse>(apiClient.post('/api/agent/analyze', payload));

export const sendAgentMessage = analyzeAgentMessage;

export const createAgentTurn = (conversationId: string, message: string, metadata: Record<string, unknown> = {}, clientTurnId?: string) =>
  unwrap<AgentV3TurnResponse>(apiClient.post(
    `/api/agent/v3/conversations/${encodeURIComponent(conversationId)}/turns`,
    { message, metadata, client_turn_id: clientTurnId },
    { timeout: 180_000, suppressErrorToast: true },
  ));

export const getAgentTurn = (turnId: string) =>
  unwrap<AgentV3Turn>(apiClient.get(`/api/agent/v3/turns/${encodeURIComponent(turnId)}`));

export const retryAgentTurn = (turnId: string) =>
  unwrap<AgentV3TurnResponse>(apiClient.post(
    `/api/agent/v3/turns/${encodeURIComponent(turnId)}/retry`,
    undefined,
    { timeout: 180_000, suppressErrorToast: true },
  ));

export const getAgentConversationEvents = (conversationId: string, after = 0) =>
  unwrap<AgentV3Event[]>(apiClient.get(`/api/agent/v3/conversations/${encodeURIComponent(conversationId)}/events`, { params: { after } }));

export const getAgentTask = (taskId: string) => unwrap<AgentV3Task>(apiClient.get(`/api/agent/v3/tasks/${encodeURIComponent(taskId)}`));

export const cancelAgentTask = (taskId: string) => unwrap<AgentV3Task>(apiClient.post(`/api/agent/v3/tasks/${encodeURIComponent(taskId)}/cancel`));

export const resolveAgentApproval = (approvalId: string, decision: 'approve' | 'reject', comment?: string) =>
  unwrap<AgentV3ApprovalResolution>(apiClient.post(`/api/agent/v3/approvals/${encodeURIComponent(approvalId)}/resolve`, { decision, comment }));

export const agentConversationEventStreamUrl = (conversationId: string, after = 0) => {
  const base = String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/api/agent/v3/conversations/${encodeURIComponent(conversationId)}/events/stream?after=${after}`;
};

export const confirmAgentInvoke = (payload: AgentInvokePayload) => unwrap<AgentAnalyzeResponse>(apiClient.post('/api/agent/confirm-invoke', payload));

export const confirmAgentDefaults = (payload: AgentDefaultsPayload) => unwrap<AgentAnalyzeResponse>(apiClient.post('/api/agent/confirm-defaults', payload));

export const applySampleParameters = (payload: AgentDefaultsPayload) => unwrap<AgentAnalyzeResponse>(apiClient.post('/api/agent/apply-sample-parameters', payload));

export const getAgentRun = (runId: string) => unwrap<AgentRun>(apiClient.get(`/api/agent/runs/${encodeURIComponent(runId)}`));

export const getAgentRunEvents = (runId: string, after = 0) => unwrap<AgentRunEvent[]>(apiClient.get(`/api/agent/runs/${encodeURIComponent(runId)}/events`, { params: { after } }));

export const cancelAgentRun = (runId: string) => unwrap<AgentRun>(apiClient.post(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`));

export const agentRunEventStreamUrl = (runId: string, after = 0) => {
  const base = String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/api/agent/runs/${encodeURIComponent(runId)}/events/stream?after=${after}`;
};

export function subscribeAgentEvents(url: string, eventType: string, onEvent: () => void) {
  const controller = new AbortController();
  let reconnect: number | undefined;
  let cursor = '';
  const connect = async () => {
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { ...platformAuthorization(), ...(cursor ? { 'Last-Event-ID': cursor } : {}) } });
      if (response.status === 401) { window.dispatchEvent(new Event('optiforge:auth-required')); return; }
      if (!response.ok || !response.body) throw new Error('Event stream unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let type = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line.startsWith('id:')) cursor = line.slice(3).trim();
          else if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (!line) { if (type === eventType) onEvent(); type = ''; }
        }
      }
    } catch { /* Ordinary reads continue to recover state while the stream reconnects. */ }
    if (!controller.signal.aborted) reconnect = window.setTimeout(connect, 2000);
  };
  void connect();
  return { close: () => { controller.abort(); if (reconnect !== undefined) window.clearTimeout(reconnect); } };
}
