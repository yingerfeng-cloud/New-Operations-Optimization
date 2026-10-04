import { Alert } from 'antd';
import type { ReactNode } from 'react';

export function ParameterNotice({
  title,
  description,
  type = 'info',
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  type?: 'info' | 'warning';
  className?: string;
}) {
  return <Alert className={`parameter-notice${className ? ` ${className}` : ''}`} showIcon type={type} title={title} description={description} />;
}
