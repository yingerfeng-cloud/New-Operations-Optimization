import { getTask } from './tasks';
import type { SolveTask } from '../types/task';

export const terminalTask = (status?: string) => ['SUCCESS', 'FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED', 'INTERRUPTED'].includes(String(status || '').toUpperCase());

export function readSession<T>(key: string): T | undefined {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') || undefined; } catch { return undefined; }
}

export function writeSession(key: string, value: unknown) {
  try { if (value === undefined) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Tracking also remains available in the task center. */ }
}

export async function waitForTask(id: string): Promise<SolveTask> {
  for (;;) {
    const task = await getTask(id);
    if (terminalTask(task.status)) return task;
    await new Promise(resolve => window.setTimeout(resolve, 1200));
  }
}
