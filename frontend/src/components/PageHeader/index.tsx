import { Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  extra,
  tags,
  status,
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
  tags?: ReactNode;
  status?: ReactNode;
}) {
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
