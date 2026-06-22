import { apiClient, unwrap } from './client';
import type { ModelAsset } from '../types/model';
import type { ModelTemplate } from '../types/template';
export const getTemplates = () => unwrap<ModelTemplate[]>(apiClient.get('/api/templates'));
export const getTemplateDetail = (code: string) => unwrap<ModelTemplate>(apiClient.get(`/api/templates/${code}`));
export const cloneTemplate = (code: string) => unwrap<ModelAsset>(apiClient.post(`/api/templates/${code}/clone`));
