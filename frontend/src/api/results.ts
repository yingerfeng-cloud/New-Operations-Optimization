import { apiClient, unwrap } from './client'; import type { SolveResult } from '../types/result';
export const getResults = () => unwrap<SolveResult[]>(apiClient.get('/api/results'));
export const getResult = (id: string) => unwrap<SolveResult>(apiClient.get(`/api/tasks/${id}/result`));
