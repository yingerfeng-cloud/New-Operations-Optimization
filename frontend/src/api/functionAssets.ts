import { apiClient, unwrap } from './client';
import type { FunctionAsset, FunctionAssetPreview, FunctionAssetValidation } from '../types/functionAsset';

export const getFunctionAssets = () => unwrap<FunctionAsset[]>(apiClient.get('/api/function-assets'));
export const getFunctionAsset = (id: string) => unwrap<FunctionAsset>(apiClient.get(`/api/function-assets/${id}`));
export const createFunctionAsset = (payload: Partial<FunctionAsset>) => unwrap<FunctionAsset>(apiClient.post('/api/function-assets', payload));
export const importFunctionAssetCsv = (payload: Record<string, unknown>) => unwrap<FunctionAsset>(apiClient.post('/api/function-assets/import-csv', payload));
export const updateFunctionAsset = (id: string, payload: Partial<FunctionAsset>) => unwrap<FunctionAsset>(apiClient.put(`/api/function-assets/${id}`, payload));
export const validateFunctionAsset = (id: string, payload?: Partial<FunctionAsset>) => unwrap<FunctionAssetValidation>(apiClient.post(`/api/function-assets/${id}/validate`, payload || {}));
export const previewFunctionAsset = (id: string, payload?: Record<string, unknown>) => unwrap<FunctionAssetPreview>(apiClient.post(`/api/function-assets/${id}/preview`, payload || {}));
