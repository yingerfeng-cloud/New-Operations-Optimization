import { Popover, Space, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageHeaderSlots } from './slots';

export interface PageHeaderProps {
  title: string;
  description?: string;
  extra?: ReactNode;
  tags?: ReactNode;
  status?: ReactNode;
  integrated?: boolean;
  shortTitle?: string;
}

export function PageHeader(props: PageHeaderProps) {
  const slots = usePageHeaderSlots();
  const [helpOpen, setHelpOpen] = useState(false);
  const title = props.shortTitle || slots?.pageLabel || props.title;
  if (props.integrated !== false && slots?.titleTarget) return <>
    {createPortal(
    <div className="integrated-page-title">
      <h1>{title}</h1>
      {props.description && <Popover title={`${title}说明`} content={<p className="integrated-page-help-copy">{props.description}</p>} trigger="click" placement="bottomLeft" arrow={false} open={helpOpen} onOpenChange={setHelpOpen}>
        <button type="button" className="integrated-page-help" aria-label={`${title}使用说明`} aria-expanded={helpOpen} onKeyDown={event => { if (event.key === 'Escape') setHelpOpen(false); }}><InfoCircleOutlined aria-hidden="true" /></button>
      </Popover>}
    </div>, slots.titleTarget,
    )}
    {(props.extra || props.status || props.tags) && <div className="page-context-toolbar">
      <div className="page-context-status">{props.status}{typeof props.tags === 'string' ? <Tag color="blue">{props.tags}</Tag> : props.tags}</div>
      {props.extra && <div className="page-hero-actions">{props.extra}</div>}
    </div>}
  </>;
  return <DefaultPageHeader {...props} />;
}

export function DefaultPageHeader({
  title,
  description,
  extra,
  tags,
  status,
}: PageHeaderProps) {
  return (
    <section className="page-hero">
      <div className="page-hero-main">
        <Space size={10} wrap>
          <Typography.Title level={3}>{title}</Typography.Title>
          {status}
          {typeof tags === 'string' ? <Tag color="blue">{tags}</Tag> : tags}
        </Space>
        {description && <Typography.Paragraph className="page-hero-desc">{description}</Typography.Paragraph>}
      </div>
      {extra && <div className="page-hero-actions">{extra}</div>}
    </section>
  );
}
