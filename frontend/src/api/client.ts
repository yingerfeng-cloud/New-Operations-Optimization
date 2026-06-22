import axios, { AxiosError } from 'axios';
import { message } from 'antd';

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
export const apiClient = axios.create({ baseURL: configuredBase || '', timeout: 30000 });

apiClient.interceptors.response.use(
  response => response,
  (error: AxiosError<{ detail?: unknown; message?: string }>) => {
    const detail = error.response?.data?.detail;
    const text = typeof detail === 'string' ? detail : error.response?.data?.message || error.message || '请求失败';
    message.error(text);
    return Promise.reject(error);
  },
);

export const unwrap = async <T>(request: Promise<{ data: T }>): Promise<T> => (await request).data;
