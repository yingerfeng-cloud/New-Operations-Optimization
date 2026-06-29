import axios, { AxiosError } from 'axios';
import { message } from 'antd';

declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressErrorToast?: boolean;
  }
}

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
export const apiClient = axios.create({ baseURL: configuredBase || '', timeout: 30000 });

apiClient.interceptors.response.use(
  response => response,
  (error: AxiosError<{ detail?: unknown; message?: string }>) => {
    const method = String(error.config?.method || 'get').toUpperCase();
    const passiveRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (error.config?.suppressErrorToast || passiveRead) {
      return Promise.reject(error);
    }

    const detail = error.response?.data?.detail;
    const text = typeof detail === 'string'
      ? detail
      : error.response?.data?.message || (!error.response ? '后端服务暂不可用，请确认 FastAPI 已启动后重试' : error.message) || '请求失败';
    message.error(text);
    return Promise.reject(error);
  },
);

export const unwrap = async <T>(request: Promise<{ data: T }>): Promise<T> => (await request).data;
