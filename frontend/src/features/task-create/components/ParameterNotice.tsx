import { Alert } from 'antd';
import type { ReactNode } from 'react';
import { ContextNote } from '../../../components/ContextNote';

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
  const classes = `parameter-notice${className ? ` ${className}` : ''}`;
  if (type === 'info') return <ContextNote className={classes} title={title} description={description} />;
  return <Alert className={classes} showIcon type={type} title={title} description={description} />;
}
