import type { SolveResult } from '../../types/result';
import type { SolveTask } from '../../types/task';

export const TASK_RUNNING_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'] as const;
export const TASK_FAILED_STATUSES = ['FAILED', 'INFEASIBLE', 'TIMEOUT'] as const;
export const TASK_TERMINAL_STATUSES = ['SUCCESS', ...TASK_FAILED_STATUSES, 'CANCELLED'] as const;

export const normalizeTaskStatus = (status?: string) => String(status || '').toUpperCase();
export const isTaskRunning = (status?: string) => TASK_RUNNING_STATUSES.includes(normalizeTaskStatus(status) as typeof TASK_RUNNING_STATUSES[number]);
export const isTaskFailed = (status?: string) => TASK_FAILED_STATUSES.includes(normalizeTaskStatus(status) as typeof TASK_FAILED_STATUSES[number]);
export const isTaskTerminal = (status?: string) => TASK_TERMINAL_STATUSES.includes(normalizeTaskStatus(status) as typeof TASK_TERMINAL_STATUSES[number]);
export const isTaskCancellable = isTaskRunning;
export const shouldPollTask = isTaskRunning;
export const isTaskRetryable = (status?: string) => [...TASK_FAILED_STATUSES, 'CANCELLED'].includes(normalizeTaskStatus(status) as 'FAILED');

const nonEmpty = (value: unknown) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0) && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value as object).length > 0);

export function hasTaskBusinessExplanation(task?: SolveTask, result?: SolveResult) {
  if (nonEmpty(result?.business_explanation) || nonEmpty(result?.explanation)) return true;
  if (!task) return false;
  const error = task.error;
  return [task.explanation, task.business_explanation, task.structured_diagnostic, task.diagnostics, task.warnings, task.risk_notes,
    task.precheck_errors, task.infeasibility_diagnosis, task.solver_diagnostic,
    error && typeof error === 'object' ? (error as Record<string, unknown>).message : undefined].some(nonEmpty);
}

export function resolveTaskDetailDefaultTab(task?: SolveTask, result?: SolveResult) {
  const status = normalizeTaskStatus(task?.status);
  if (isTaskRunning(status)) return 'timeline';
  if (status === 'SUCCESS') return result ? 'result' : 'overview';
  if (isTaskFailed(status)) return hasTaskBusinessExplanation(task, result) ? 'explain' : 'logs';
  return 'overview';
}
