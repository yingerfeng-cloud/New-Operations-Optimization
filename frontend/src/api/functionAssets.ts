import { apiClient, unwrap } from './client';
import type { FunctionAsset, FunctionAssetPreview, FunctionAssetValidation } from '../types/functionAsset';

export const getFunctionAssets = () => unwrap<FunctionAsset[]>(apiClient.get('/api/function-assets'));
export const getFunctionAsset = (id: string) => unwrap<FunctionAsset>(apiClient.get(`/api/function-assets/${id}`));
export const createFunctionAsset = (payload: Partial<FunctionAsset>) => unwrap<FunctionAsset>(apiClient.post('/api/function-assets', payload, { suppressErrorToast: true }));
export const importFunctionAssetCsv = (payload: Record<string, unknown>) => unwrap<FunctionAsset>(apiClient.post('/api/function-assets/import-csv', payload, { suppressErrorToast: true }));
export const updateFunctionAsset = (id: string, payload: Partial<FunctionAsset>) => unwrap<FunctionAsset>(apiClient.put(`/api/function-assets/${id}`, payload, { suppressErrorToast: true }));
export const validateFunctionAsset = (id: string, payload?: Partial<FunctionAsset>) => unwrap<FunctionAssetValidation>(apiClient.post(`/api/function-assets/${id}/validate`, payload || {}));
export const previewFunctionAsset = (id: string, payload?: Record<string, unknown>) => unwrap<FunctionAssetPreview>(apiClient.post(`/api/function-assets/${id}/preview`, payload || {}));

export const checkFunctionAssetApiReady = async () => {
  try {
    const health = await unwrap<Record<string, any>>(apiClient.get('/api/health', { suppressErrorToast: true }));
    const supports = health?.api_versions?.function_assets?.supports;
    return Array.isArray(supports) && supports.includes('POST create') && supports.includes('POST import-csv') && supports.includes('piecewise_2d');
  } catch {
    return false;
  }
};
