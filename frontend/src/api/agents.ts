import { apiClient, unwrap } from './client';
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
} from '../types/agent';

export const getAgentStatus = () => unwrap<AgentStatus>(apiClient.get('/api/agent/status'));

export const getPlatformSkills = () => unwrap<AgentSkill[]>(apiClient.get('/api/agent/skills'));

export const getAgentSkills = () => unwrap<AgentSkill[]>(apiClient.get('/api/agent/agent-skills'));

export const getAgentSkill = (name: string) => unwrap<AgentSkill>(apiClient.get(`/api/agent/agent-skills/${encodeURIComponent(name)}`));

export const getAgentSkillParameterExample = (name: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/agent/agent-skills/${encodeURIComponent(name)}/parameter-example`));

export const createAgentConversation = (payload: AgentConversationPayload = {}) => unwrap<AgentConversation>(apiClient.post('/api/agent/conversations', payload));

export const getAgentConversations = () => unwrap<AgentConversationSummary[]>(apiClient.get('/api/agent/conversations'));

export const getAgentConversation = (conversationId: string) => unwrap<AgentConversation>(apiClient.get(`/api/agent/conversations/${encodeURIComponent(conversationId)}`));

export const updateAgentConversation = (conversationId: string, payload: AgentConversationPayload) => unwrap<AgentConversation>(apiClient.patch(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, payload));

export const deleteAgentConversation = (conversationId: string) => unwrap<{ ok?: boolean }>(apiClient.delete(`/api/agent/conversations/${encodeURIComponent(conversationId)}`));

export const analyzeAgentMessage = (payload: AgentAnalyzePayload) => unwrap<AgentAnalyzeResponse>(apiClient.post('/api/agent/analyze', payload));

export const sendAgentMessage = analyzeAgentMessage;

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
