import { Alert, Button } from 'antd';
import type { ReactNode } from 'react';
import { ErrorState, SectionLoading } from '../PageStates';

interface QueryStatus { isPending: boolean; isError: boolean; data: unknown; dataUpdatedAt: number; refetch: () => unknown }

export function QueryState({ query, title, children }: { query: QueryStatus; title: string; children: ReactNode }) {
  if (query.data === undefined && query.isPending) return <SectionLoading label={`正在加载${title}…`} />;
  if (query.data === undefined && query.isError) return <ErrorState title={`${title}加载失败`} description="暂时无法读取数据，请检查连接后重试。" retry={() => query.refetch()} />;
  return <>
    {query.isError && <Alert type="warning" showIcon title={`${title}未能更新`} description={`仍显示上次读取的数据。最后更新时间：${query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleString('zh-CN') : '未知'}`} action={<Button onClick={() => query.refetch()}>重试更新</Button>} />}
    {children}
  </>;
}
