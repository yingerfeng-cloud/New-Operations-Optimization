import { apiClient, unwrap } from './client'; import type { ModelAsset, ModelPayload } from '../types/model';
export const getModels = () => unwrap<ModelAsset[]>(apiClient.get('/api/models'));
export const getModel = (id: string) => unwrap<ModelAsset>(apiClient.get(`/api/models/${id}`));
export const createModel = (payload: ModelPayload) => unwrap<ModelAsset>(apiClient.post('/api/models', payload));
export const updateModel = (id: string, payload: ModelPayload) => unwrap<ModelAsset>(apiClient.put(`/api/models/${id}`, payload));
export const publishModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/publish`));
export const testModel = (id: string, params: Record<string, unknown>) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/test`, params));
export const invokeModel = (id: string, params: Record<string, unknown>) => unwrap(apiClient.post('/api/tasks', { model_id: id, runtime_parameters: params, parameters: params }));
export const copyModel = (id: string) => unwrap<ModelAsset>(apiClient.post(`/api/models/${id}/copy`));
