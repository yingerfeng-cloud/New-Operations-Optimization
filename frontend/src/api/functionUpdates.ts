import { apiClient, unwrap } from './client';
import type { ModelAsset } from '../types/model';
import type { SolveTask } from '../types/task';

export interface FunctionRevisionDiff {
  requires_model_edit: boolean;
  contract_changes: Record<string, { before: unknown; after: unknown }>;
  domain_changed: boolean;
  before_domain: unknown;
  after_domain: unknown;
  before_points: unknown;
  after_points: unknown;
  message: string;
}
export interface FunctionUpdateRow {
  function_id: string;
  name: string;
  binding?: { revision: number; content_hash: string };
  latest_revision: number;
  versions: Array<{ revision: number; content_hash: string; diff?: FunctionRevisionDiff }>;
}
export const getFunctionUpdates = (id: string) => unwrap<{ dependencies: FunctionUpdateRow[] }>(apiClient.get(`/api/models/${id}/function-updates`));
export const testFunctionUpdates = (id: string, revisions: Record<string, number>, key: string) => unwrap<{ model: ModelAsset; task: SolveTask }>(apiClient.post(`/api/models/${id}/function-updates/test`, { revisions, idempotency_key: key }));
export const applyFunctionUpdates = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/function-updates/apply`));
