import { Alert, Button, Empty, Result, Skeleton, Spin } from 'antd';
import type { ReactNode } from 'react';

type Action = { label: string; onClick: () => void };

export function PageLoading({ label = '正在加载页面…' }: { label?: string }) {
  return <main className="page-state page-state-full" aria-busy="true" aria-live="polite"><Spin size="large" /><strong>{label}</strong><Skeleton active paragraph={{ rows: 4 }} /></main>;
}

export function SectionLoading({ label = '正在加载…' }: { label?: string }) {
  return <div className="page-state page-state-section" aria-busy="true" aria-live="polite"><Spin /><span>{label}</span></div>;
}

export function EmptyState({ title = '暂无数据', description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div className="page-state page-state-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={title} />{description && <p>{description}</p>}{action}</div>;
}

export function SearchEmptyState({ query }: { query?: string }) {
  return <EmptyState title={query ? `没有找到“${query}”` : '暂无搜索结果'} description={query ? '请调整关键词或清除筛选条件。' : '输入关键词搜索模型、场景、任务和平台资产。'} />;
}

export function ErrorState({ title = '加载失败', description, retry, actions = [] }: { title?: string; description?: ReactNode; retry?: () => void; actions?: Action[] }) {
  const all = retry ? [{ label: '重新加载', onClick: retry }, ...actions] : actions;
  return <Result className="page-state-error" status="error" title={title} subTitle={description} extra={all.map((item, index) => <Button key={item.label} type={index === 0 ? 'primary' : 'default'} onClick={item.onClick}>{item.label}</Button>)} />;
}

export function ConfigurationMissingState({ title = '配置尚未完成', description, action }: { title?: string; description?: ReactNode; action?: ReactNode }) {
  return <Result className="page-state-error" status="warning" title={title} subTitle={description} extra={action} />;
}

export function TaskProcessingState({ status, description }: { status: string; description?: ReactNode }) {
  return <Alert className="task-processing-state" showIcon type="info" title={`任务正在${status}`} description={description || '状态会自动刷新，完成后即可查看结果。'} aria-live="polite" />;
}
