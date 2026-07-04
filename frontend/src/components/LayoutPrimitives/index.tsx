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

export function DetailDrawer({ footer, bodyStyle, width, size, ...props }: DrawerProps) {
  const derivedSize = size ?? (width ? 'large' : undefined);
  return (
    <Drawer
      {...props}
      size={derivedSize}
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

export function ProgressStepper({
  current,
  items,
  onChange,
  className = '',
}: {
  current: number;
  items: Array<{ title: ReactNode; description?: ReactNode; status?: 'wait' | 'process' | 'finish' | 'error' }>;
  onChange?: (step: number) => void;
  className?: string;
}) {
  return (
    <div className={`progress-stepper ${className}`.trim()}>
      <Steps
        type="navigation"
        current={current}
        items={items.map(item => ({
          title: item.title,
          content: item.description,
          status: item.status,
        }))}
        onChange={onChange}
      />
    </div>
  );
}

export function StepBody({
  children,
  title,
  description,
  status,
  extra,
  guidance,
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  extra?: ReactNode;
  guidance?: ReactNode;
}) {
  return (
    <section className="step-body">
      {(title || description) && (
        <div className="step-body-head">
          <div>
            <Space size={10} wrap>
              {title && <h3>{title}</h3>}
              {status}
            </Space>
            {description && <p>{description}</p>}
          </div>
          {extra && <div className="step-body-extra">{extra}</div>}
        </div>
      )}
      {guidance && <div className="step-guidance-panel">{guidance}</div>}
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
