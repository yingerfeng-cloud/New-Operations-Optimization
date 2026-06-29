import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
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
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          borderRadius: 12,
          borderRadiusLG: 16,
          borderRadiusSM: 8,
          colorBgLayout: '#eef4fb',
          colorBorder: '#dbe5f2',
          colorText: '#17233d',
          colorTextSecondary: '#64748b',
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Button: {
            borderRadius: 10,
            controlHeight: 36,
            paddingInline: 16,
            primaryShadow: '0 10px 24px rgba(37, 99, 235, 0.24)',
          },
          Card: {
            borderRadiusLG: 16,
            paddingLG: 20,
            boxShadowTertiary: '0 14px 34px rgba(15, 23, 42, 0.06)',
          },
          Table: {
            borderRadius: 14,
            headerBg: '#f1f6fc',
            headerColor: '#334155',
            rowHoverBg: '#f8fbff',
          },
          Drawer: {
            borderRadiusLG: 18,
            paddingLG: 20,
          },
          Modal: {
            borderRadiusLG: 18,
            paddingLG: 20,
          },
          Tabs: {
            itemSelectedColor: '#2563eb',
            inkBarColor: '#2563eb',
          },
          Steps: {
            colorPrimary: '#2563eb',
          },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
