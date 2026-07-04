import { Button, Card, Drawer, Empty, Space } from 'antd';
import type { DrawerProps } from 'antd';
import type { ReactNode } from 'react';

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

export function MetricGrid({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return <div className={`metric-grid metric-grid-${columns}`}>{children}</div>;
}

export function MetricCard({
  title,
  value,
  description,
  tone = 'blue',
  onClick,
}: {
  title: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="metric-card-title">{title}</span>
      <strong className="metric-card-value">{value}</strong>
      {description && <span className="metric-card-desc">{description}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`metric-card-v2 metric-card-${tone}`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={`metric-card-v2 metric-card-${tone}`}>{body}</div>;
}

export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="filter-bar">
      <Space wrap size={10}>{children}</Space>
      {onReset && <Button onClick={onReset}>重置</Button>}
    </div>
  );
}

export function EmptyActionState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-action-state">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={title} />
      {description && <p>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

export function DetailDrawerLayout({
  title,
  subtitle,
  status,
  children,
  footer,
  ...props
}: DrawerProps & {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <Drawer
      {...props}
      size={props.size || 'large'}
      title={(
        <div className="detail-drawer-title">
          <div>
            <strong>{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          {status}
        </div>
      )}
      footer={footer ? <div className="detail-drawer-footer">{footer}</div> : undefined}
    >
      <div className="detail-drawer-layout">{children}</div>
    </Drawer>
  );
}

export function WorkCard({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={`work-card ${className}`.trim()} title={title} extra={extra}>{children}</Card>;
}
