import { apiClient, unwrap } from './client';
export const getAgentSkills = () => unwrap<Record<string, unknown>[]>(apiClient.get('/api/agent-skills'));
export const sendAgentMessage = (payload: Record<string, unknown>) => unwrap(apiClient.post('/api/agent/chat', payload));
