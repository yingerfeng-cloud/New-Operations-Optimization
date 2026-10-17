import { apiClient, unwrap } from './client'; import type { ModelAsset, ModelPayload } from '../types/model';
import { readSession, writeSession, waitForTask } from './taskTracking';
import type { SolveTask } from '../types/task';
export const getModels = () => unwrap<ModelAsset[]>(apiClient.get('/api/models'));
export const getModel = (id: string, signal?: AbortSignal) => unwrap<ModelAsset>(apiClient.get(`/api/models/${id}`, { signal }));
export const createModel = (payload: ModelPayload) => unwrap<ModelAsset>(apiClient.post('/api/models', payload));
export const createModelVersion = (id: string, payload: ModelPayload) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/versions`, payload));
export const updateModel = (id: string, payload: ModelPayload) => unwrap<ModelAsset>(apiClient.put(`/api/models/${id}`, payload));
export const publishModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/publish`));
export async function testModel(id: string, params: Record<string, unknown>): Promise<ModelAsset> {
  const storageKey = `optiforge-model-test:${id}`;
  const fingerprint = JSON.stringify(params);
  const previous = readSession<{ fingerprint: string; key: string; taskId?: string }>(storageKey);
  const pending = previous?.fingerprint === fingerprint ? previous : { fingerprint, key: crypto.randomUUID(), taskId: undefined as string | undefined };
  writeSession(storageKey, pending);
  if (!pending.taskId) {
    const task = await unwrap<SolveTask>(apiClient.post(`/api/models/${id}/test-jobs`, { parameters: params, idempotency_key: pending.key }));
    pending.taskId = task.id;
    writeSession(storageKey, pending);
  }
  const task = await waitForTask(pending.taskId);
  writeSession(storageKey, undefined);
  if (task.status !== 'SUCCESS') throw new Error(task.error || `模型测试未通过：${task.status}，可在任务中心查看 ${task.id}`);
  const tested = await getModel(id);
  if (!['trial', 'published', 'offline'].includes(tested.status)) throw new Error('模型在测试后已发生修改，请测试当前版本。');
  return tested;
}
export const invokeModel = (id: string, params: Record<string, unknown>) => unwrap(apiClient.post('/api/tasks', { model_id: id, runtime_parameters: params, parameters: params }));
export const copyModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/copy`));
export const offlineModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/offline`));
export const returnModelToDraft = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/return-to-draft`));
export const deleteModel = (id: string) => unwrap<{ status: string }>(apiClient.delete(`/api/models/${id}`));
export const getModelSchema = (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/models/${id}/schema`));
export const getModelAssetDetail = (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/api/models/${id}/asset-detail`));
