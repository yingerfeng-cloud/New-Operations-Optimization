import { apiClient, unwrap } from './client';
import type { LlmConfig, LlmTestResult, SystemConfig, SystemDictionaries } from '../types/systemConfig';

export const getSystemConfig = () => unwrap<SystemConfig>(apiClient.get('/api/system-config'));
export const updateSystemDictionaries = (dictionaries: SystemDictionaries) => unwrap<SystemDictionaries>(apiClient.put('/api/system-config/dictionaries', dictionaries));
export const resetSystemConfig = () => unwrap<SystemConfig>(apiClient.post('/api/system-config/reset'));

export const getLlmConfig = () => unwrap<LlmConfig>(apiClient.get('/api/llm/config'));
export const updateLlmConfig = (payload: Partial<LlmConfig> & { api_key?: string; clear_api_key?: boolean }) => unwrap<LlmConfig>(apiClient.put('/api/llm/config', payload));
export const testLlmConfig = () => unwrap<LlmTestResult>(apiClient.post('/api/llm/test'));
