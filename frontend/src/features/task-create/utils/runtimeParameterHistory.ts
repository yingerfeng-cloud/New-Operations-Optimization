import type { RuntimeField, TimeDimensionConfig } from '../../time-dimension';
import { isRuntimeValueEmpty, managedTimeFields, objectValue } from '../../time-dimension';
import type { SolveTask } from '../../../types/task';

export type HistoryApplyMode = 'overwrite' | 'fill-empty';

export function isCompatibleHistoricalTask(task: SolveTask, modelId: string, family?: string) {
  const status = String(task.status || '').toUpperCase();
  const completed = ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE'].includes(status);
  const taskModel = String(task.model_id || task.resolved_model_id || '');
  const taskFamily = String(task.model_family || task.resolved_model_code || '');
  return completed && (taskModel === modelId || Boolean(family && taskFamily === family));
}

export function extractHistoricalParameters(task: SolveTask) {
  const trace = objectValue(task.trace);
  const request = objectValue(trace.request || task.request || task.input || task.payload);
  return { ...objectValue(request.parameters), ...objectValue(request.runtime_parameters), ...objectValue(task.parameters), ...objectValue(task.runtime_parameters) };
}

export function mergeHistoricalParameters(args: {
  current: Record<string, unknown>;
  incoming: Record<string, unknown>;
  fields: RuntimeField[];
  config: TimeDimensionConfig;
  mode: HistoryApplyMode;
}) {
  const allowed = new Set(args.fields.map(field => field.code));
  const system = managedTimeFields(args.config);
  const unknown: string[] = [];
  const ignoredSystem: string[] = [];
  const applied: string[] = [];
  const next = { ...args.current };
  Object.entries(args.incoming).forEach(([code, value]) => {
    if (system.has(code)) return void ignoredSystem.push(code);
    if (!allowed.has(code)) return void unknown.push(code);
    if (args.mode === 'overwrite' || isRuntimeValueEmpty(next[code])) { next[code] = value; applied.push(code); }
  });
  return { parameters: next, applied, unknown, ignoredSystem };
}
