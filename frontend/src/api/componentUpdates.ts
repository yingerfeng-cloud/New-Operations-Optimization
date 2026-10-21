import { apiClient, unwrap } from './client';
import type { ModelAsset } from '../types/model';
import type { SolveTask } from '../types/task';

export interface ComponentUpdateRow {
  component_id: string; name: string;
  binding: { revision: number; version: string; content_hash: string };
  versions: Array<{ component_id: string; revision: number; version: string; content_hash: string;
    diff: { requires_model_edit: boolean; message: string; contract_changes: Record<string, unknown>;
      before_constraints: unknown; after_constraints: unknown; before_objectives: unknown; after_objectives: unknown } }>;
}
export const getComponentUpdates = (id: string) => unwrap<{ dependencies: ComponentUpdateRow[] }>(apiClient.get(`/api/models/${id}/component-updates`));
export const testComponentUpdates = (id: string, selections: Record<string, string>, key: string) => unwrap<{ model: ModelAsset; task: SolveTask }>(apiClient.post(`/api/models/${id}/component-updates/test`, { selections, idempotency_key: key }));
export const applyComponentUpdates = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/component-updates/apply`));
