import axios, { AxiosError } from 'axios';
import { message } from 'antd';

declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressErrorToast?: boolean;
  }
}

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
export const apiClient = axios.create({ baseURL: configuredBase || '', timeout: 30000 });

export function setPlatformApiToken(token: string) {
  sessionStorage.setItem('optiforge-platform-token', token.trim());
}

export function platformAuthorization(): Record<string, string> {
  try { const token = sessionStorage.getItem('optiforge-platform-token'); return token ? { Authorization: `Bearer ${token}` } : {}; }
  catch { return {}; }
}

apiClient.interceptors.request.use(config => {
  const headers = platformAuthorization();
  if (headers.Authorization) config.headers.set('Authorization', headers.Authorization);
  return config;
});

function formatErrorItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const record = item as Record<string, unknown>;
  const parts = [
    record.field ? `字段 ${String(record.field)}` : Array.isArray(record.loc) ? `字段 ${record.loc.join('.')}` : '',
    record.message || record.msg ? String(record.message || record.msg) : '',
    record.error ? `错误 ${String(record.error)}` : '',
    record.expected !== undefined ? `期望 ${JSON.stringify(record.expected)}` : '',
    record.actual !== undefined ? `实际 ${JSON.stringify(record.actual)}` : '',
    record.suggestion || record.fix_hint ? `修复建议 ${String(record.suggestion || record.fix_hint)}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

export function extractErrorText(error: AxiosError<{ detail?: unknown; message?: string }>): string {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    const structure = record.structure_check as Record<string, unknown> | undefined;
    const solver = record.solver_check as Record<string, unknown> | undefined;
    const items = [record.errors, structure?.errors, solver?.errors, solver?.warnings]
      .flatMap(value => Array.isArray(value) ? value : []);
    const lines = [...new Set(items.map(formatErrorItem).filter(Boolean))].slice(0, 5);
    if (record.message || lines.length) return [record.message, ...lines].filter(Boolean).join('；');
  }
  if (Array.isArray(detail)) {
    const lines = detail.map(formatErrorItem).filter(Boolean).slice(0, 3);
    if (lines.length) return lines.join('；');
  }
  return error.response?.data?.message || (!error.response ? '后端服务暂不可用，请确认 FastAPI 已启动后重试' : error.message) || '请求失败';
}

apiClient.interceptors.response.use(
  response => response,
  (error: AxiosError<{ detail?: unknown; message?: string }>) => {
    if (error.response?.status === 401) window.dispatchEvent(new Event('optiforge:auth-required'));
    const method = String(error.config?.method || 'get').toUpperCase();
    const passiveRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (error.config?.suppressErrorToast || passiveRead) {
      return Promise.reject(error);
    }

    const text = extractErrorText(error);
    message.error(text);
    return Promise.reject(error);
  },
);

export const unwrap = async <T>(request: Promise<{ data: T }>): Promise<T> => (await request).data;

export function requestErrorMessage(error: unknown): string {
  return axios.isAxiosError(error) ? extractErrorText(error) : error instanceof Error ? error.message : String(error);
}
