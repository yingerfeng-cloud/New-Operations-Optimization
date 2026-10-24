import { InfoCircleOutlined, RightOutlined } from '@ant-design/icons';
import type { CSSProperties, ReactNode } from 'react';

interface ContextNoteProps {
  title: ReactNode;
  description?: ReactNode;
  /** Only optional background explanations should be collapsed. */
  collapsible?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Quiet, non-live guidance. Use Alert for errors, risks and blocking states. */
export function ContextNote({ title, description, collapsible = false, className = '', style }: ContextNoteProps) {
  const classes = `context-note ${className}`.trim();
  const icon = <InfoCircleOutlined className="context-note-icon" aria-hidden="true" />;

  if (collapsible && description) {
    return (
      <details className={`${classes} context-note-disclosure`} style={style}>
        <summary className="context-note-summary">
          {icon}
          <span className="context-note-title">{title}</span>
          <span className="context-note-toggle" aria-hidden="true">
            <span className="context-note-expand">展开说明</span>
            <span className="context-note-collapse">收起说明</span>
            <RightOutlined />
          </span>
        </summary>
        <div className="context-note-details">{description}</div>
      </details>
    );
  }

  return (
    <div className={classes} style={style}>
      {icon}
      <div className="context-note-content">
        <span className="context-note-title">{title}</span>
        {description && <div className="context-note-description">{description}</div>}
      </div>
    </div>
  );
}
