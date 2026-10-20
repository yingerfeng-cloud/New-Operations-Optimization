import { apiClient, unwrap } from './client';
import type { SolveTask } from '../types/task';
export const replayTask = (id: string) => unwrap<SolveTask>(apiClient.post(`/api/tasks/${id}/replay`));
export const recalculateTask = (id: string, revisions: Record<string, number>, key: string) => unwrap<SolveTask>(apiClient.post(`/api/tasks/${id}/recalculate`, { revisions, idempotency_key: key }));
