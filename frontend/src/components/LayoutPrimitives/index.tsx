import { Button, Card, Drawer, Space, Steps } from 'antd';
import type { ButtonProps, CardProps, DrawerProps } from 'antd';
import type { ReactNode } from 'react';

export function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page-shell ${className}`.trim()}>{children}</div>;
}

export function SectionCard(props: CardProps) {
  return <Card {...props} className={`section-card ${props.className || ''}`.trim()} />;
}

export function DataTableCard(props: CardProps) {
  return <Card {...props} className={`data-table-card ${props.className || ''}`.trim()} />;
}

export function ActionFooter({
  left,
  children,
  className = '',
}: {
  left?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`action-footer ${className}`.trim()}>
      <div className="action-footer-left">{left}</div>
      <Space wrap>{children}</Space>
    </div>
  );
}

export function DetailDrawer({ footer, bodyStyle, ...props }: DrawerProps) {
  return (
    <Drawer
      {...props}
      bodyStyle={bodyStyle}
      footer={footer ? <div className="detail-drawer-footer">{footer}</div> : undefined}
    />
  );
}

export function ModelCreationLayout({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`model-creation-layout ${className}`.trim()}>{children}</div>;
}

export function StepNavigator({
  current,
  items,
  onChange,
}: {
  current: number;
  items: Array<{ title: ReactNode; description?: ReactNode }>;
  onChange?: (step: number) => void;
}) {
  return (
    <aside className="step-navigator" aria-label="模型创建步骤">
      <Steps
        orientation="vertical"
        current={current}
        items={items.map(item => ({ title: item.title, content: item.description }))}
        onChange={onChange}
      />
    </aside>
  );
}

export function StepBody({ children, title, description }: { children: ReactNode; title?: ReactNode; description?: ReactNode }) {
  return (
    <section className="step-body">
      {(title || description) && (
        <div className="step-body-head">
          {title && <h3>{title}</h3>}
          {description && <p>{description}</p>}
        </div>
      )}
      <div className="step-body-content">{children}</div>
    </section>
  );
}

export function ConfirmableAction(props: ButtonProps) {
  return <Button {...props} />;
}

export function RiskAlert({ children }: { children: ReactNode }) {
  return <div className="risk-alert">{children}</div>;
}
