import { apiClient, unwrap } from './client';
import type { SolveTask } from '../types/task';

export interface PendingModelTest { fingerprint: string; key: string; taskId?: string; finished?: boolean }
const key = (id: string) => `optiforge-model-test:${id}`;
export function readModelTest(id: string): PendingModelTest | undefined {
  try { return JSON.parse(localStorage.getItem(key(id)) || sessionStorage.getItem(key(id)) || 'null') || undefined; } catch { return undefined; }
}
export function writeModelTest(id: string, value?: PendingModelTest) {
  for (const storage of [localStorage, sessionStorage]) {
    try { if (value) storage.setItem(key(id), JSON.stringify(value)); else storage.removeItem(key(id)); } catch { /* Server test_task_id remains authoritative. */ }
  }
  window.dispatchEvent(new Event('optiforge:model-test'));
}
export const getModelTestTask = (id: string) => unwrap<SolveTask>(apiClient.get(`/api/tasks/${id}`));
