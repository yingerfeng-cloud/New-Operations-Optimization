import { Button, Progress } from 'antd';

export function RuntimeDataSummaryBar({
  modelName, timeLabel, horizon, intervalMinutes, requiredDone, requiredTotal, errorCount, modifiedCount, onIssues,
}: {
  modelName: string; timeLabel: string; horizon?: number; intervalMinutes?: number; requiredDone: number; requiredTotal: number;
  errorCount: number; modifiedCount: number; onIssues: () => void;
}) {
  const percent = requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 100;
  return <section className="runtime-data-summary" aria-label="运行数据摘要">
    <div className="runtime-data-summary-main"><strong>{modelName || '未选择模型'}</strong><span>{timeLabel}</span></div>
    <div className="runtime-summary-metric"><span>当前 horizon</span><strong>{horizon ?? '—'}{horizon ? ' 点' : ''}</strong></div>
    <div className="runtime-summary-metric"><span>时间粒度</span><strong>{intervalMinutes ? `${intervalMinutes} 分钟` : '—'}</strong></div>
    <div className="runtime-summary-progress"><span>必填 {requiredDone}/{requiredTotal}</span><Progress percent={percent} size="small" showInfo={false} /></div>
    <Button type="text" danger={errorCount > 0} onClick={onIssues}>问题 {errorCount}</Button>
    <div className="runtime-summary-metric"><span>已修改</span><strong>{modifiedCount}</strong></div>
  </section>;
}
