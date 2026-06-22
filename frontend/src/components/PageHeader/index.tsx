import { Space, Typography } from 'antd'; import type { ReactNode } from 'react';
export function PageHeader({title,description,extra}:{title:string;description?:string;extra?:ReactNode}){return <div className="page-header"><div><Typography.Title level={3}>{title}</Typography.Title>{description&&<Typography.Text type="secondary">{description}</Typography.Text>}</div><Space>{extra}</Space></div>}
