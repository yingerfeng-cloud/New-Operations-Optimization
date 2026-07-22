import type { ReactNode } from 'react';

export function ModelSection({ sectionKey, title, description, status, extra, children }: { sectionKey: string; title: string; description?: string; status?: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return <section id={`model-section-${sectionKey}`} data-section-key={sectionKey} className="model-section"><header><div><h3>{title}</h3>{description && <p>{description}</p>}</div><div>{status}{extra}</div></header><div className="model-section-body">{children}</div></section>;
}
