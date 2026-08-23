import type { TimeDimensionConfig } from '../../time-dimension';
import { stripSystemTimeParameters } from '../../time-dimension';

export interface TaskDraft { model_id: string; scene?: string; solver: string; horizon?: number; parameters: Record<string, unknown> }

export function buildTaskPayload(draft: TaskDraft, config: TimeDimensionConfig) {
  const parameters = stripSystemTimeParameters(draft.parameters, config);
  const payload: Record<string, unknown> = {
    model_id: draft.model_id,
    model: draft.model_id,
    solver: draft.solver,
    runtime_parameters: { ...parameters },
    parameters: { ...parameters },
    async_run: true,
  };
  if (draft.scene) payload.scene = draft.scene;
  if (config.policy === 'runtime_variable' && draft.horizon != null) {
    (payload.runtime_parameters as Record<string, unknown>).horizon = draft.horizon;
    (payload.parameters as Record<string, unknown>).horizon = draft.horizon;
    payload.horizon = draft.horizon;
  }
  return payload;
}
