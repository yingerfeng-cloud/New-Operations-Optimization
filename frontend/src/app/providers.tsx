import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 }, mutations: { retry: 0 } } });
export function AppProviders({ children }: PropsWithChildren) { return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}><AntApp><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></AntApp></ConfigProvider>; }
