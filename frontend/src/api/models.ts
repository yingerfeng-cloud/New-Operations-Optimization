import { apiClient, unwrap } from './client'; import type { ModelAsset, ModelPayload } from '../types/model';
import { waitForTask } from './taskTracking';
import { readModelTest, writeModelTest, getModelTestTask } from './modelTestTracking';
import type { SolveTask } from '../types/task';
export const getModels = () => unwrap<ModelAsset[]>(apiClient.get('/api/models'));
export const getModel = (id: string, signal?: AbortSignal) => unwrap<ModelAsset>(apiClient.get(`/api/models/${id}`, { signal }));
export const createModel = (payload: ModelPayload) => unwrap<ModelAsset>(apiClient.post('/api/models', payload));
export const createModelVersion = (id: string, payload: ModelPayload) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/versions`, payload));
export const updateModel = (id: string, payload: ModelPayload) => unwrap<ModelAsset>(apiClient.put(`/api/models/${id}`, payload));
export const publishModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/publish`));
export async function testModel(id: string, params: Record<string, unknown>): Promise<ModelAsset> {
  const source = await getModel(id);
  const fingerprint = JSON.stringify({ parameters: params, content_hash: source.content_hash });
  const stored = readModelTest(id);
  const previous = stored?.finished ? undefined : stored;
  let pending = previous?.fingerprint === fingerprint ? previous : undefined;
  if (!pending && previous) {
    let previousParams: unknown;
    try { const value = JSON.parse(previous.fingerprint); previousParams = value.parameters ?? value; } catch { /* Invalid local record is not test evidence. */ }
    const knownId = previous.taskId || String(source.test_task_id || '');
    if (knownId && JSON.stringify(previousParams) === JSON.stringify(params)) {
      const known = await getModelTestTask(knownId);
      const context = known.trace?.model_test as Record<string, unknown> | undefined;
      if (context?.submission_key === previous.key && [context.source_content_hash, context.tested_content_hash].includes(source.content_hash)) {
        pending = { ...previous, taskId: knownId };
      }
    }
  }
  pending ||= { fingerprint, key: crypto.randomUUID(), taskId: undefined as string | undefined };
  writeModelTest(id, pending);
  if (!pending.taskId) {
    const task = await unwrap<SolveTask>(apiClient.post(`/api/models/${id}/test-jobs`, { parameters: params, idempotency_key: pending.key }));
    pending.taskId = task.id;
    writeModelTest(id, pending);
  }
  const task = await waitForTask(pending.taskId);
  writeModelTest(id, { ...pending, finished: true });
  if (task.status !== 'SUCCESS') throw new Error(task.error || `模型测试未通过：${task.status}，可在任务中心查看 ${task.id}`);
  const tested = await getModel(id);
  if (!['trial', 'published', 'offline'].includes(tested.status) || tested.tested_model_id !== id || tested.tested_content_hash !== tested.content_hash) throw new Error('模型在测试后已发生修改，请测试当前版本。');
  return tested;
}
export const invokeModel = (id: string, params: Record<string, unknown>) => unwrap(apiClient.post('/api/tasks', { model_id: id, runtime_parameters: params, parameters: params }));
export const copyModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/copy`));
export const offlineModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/offline`));
export const returnModelToDraft = (id: string, expectedContentHash?: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/return-to-draft`, { expected_content_hash: expectedContentHash }));
export const deleteModel = (id: string) => unwrap<{ status: string }>(apiClient.delete(`/api/models/${id}`));
export const getModelSchema = (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/models/${id}/schema`));
export const getModelAssetDetail = (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/models/${id}/asset-detail`));
