import axios, { AxiosError } from 'axios';
import { message } from 'antd';

declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressErrorToast?: boolean;
  }
}

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
export const apiClient = axios.create({ baseURL: configuredBase || '', timeout: 30000 });

function formatErrorItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const record = item as Record<string, unknown>;
  if (record.message) return String(record.message);
  const parts = [
    record.field ? `字段 ${String(record.field)}` : '',
    record.error ? `错误 ${String(record.error)}` : '',
    record.expected !== undefined ? `期望 ${JSON.stringify(record.expected)}` : '',
    record.actual !== undefined ? `实际 ${JSON.stringify(record.actual)}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

function extractErrorText(error: AxiosError<{ detail?: unknown; message?: string }>): string {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    if (record.message) return String(record.message);
    if (Array.isArray(record.errors)) {
      const lines = record.errors.map(formatErrorItem).filter(Boolean).slice(0, 3);
      if (lines.length) return lines.join('；');
    }
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
