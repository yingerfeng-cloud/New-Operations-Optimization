import { apiClient, unwrap } from './client'; import type { SolveTask } from '../types/task';
export const getTasks = () => unwrap<SolveTask[]>(apiClient.get('/api/tasks'));
export const getTask = (id: string) => unwrap<SolveTask>(apiClient.get(`/api/tasks/${id}`));
export const createTask = (payload: Record<string, unknown>) => unwrap<SolveTask>(apiClient.post('/api/tasks', payload));
export const cancelTask = (id: string) => unwrap<SolveTask>(apiClient.post(`/api/tasks/${id}/cancel`));
export const retryTask = (id: string) => unwrap<SolveTask>(apiClient.post(`/api/tasks/${id}/retry`));
