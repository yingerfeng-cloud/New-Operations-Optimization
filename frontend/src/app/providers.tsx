import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { porcelainTheme } from './theme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

const isTest = import.meta.env.MODE === 'test';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: isTest ? 0 : 20_000,
      gcTime: isTest ? 0 : 5 * 60_000,
      retry: isTest ? false : 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0, gcTime: isTest ? 0 : 5 * 60_000 },
  },
});
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={porcelainTheme}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
