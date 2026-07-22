import { Button, Drawer, Empty, Tag } from 'antd';
import type { RuntimeFieldIssue } from '../utils/runtimeParameterGroups';

export function RuntimeValidationDrawer({ open, issues, onClose, onNavigate }: { open: boolean; issues: RuntimeFieldIssue[]; onClose: () => void; onNavigate: (issue: RuntimeFieldIssue) => void }) {
  return <Drawer className="runtime-validation-drawer" title={`参数问题（${issues.length}）`} open={open} onClose={onClose} size={440}>
    {!issues.length ? <Empty description="当前没有参数问题" /> : <div className="runtime-validation-list">{issues.map((issue, index) => <article key={`${issue.code}-${index}`}>
      <div><strong>{issue.name}</strong><code>{issue.code}</code><Tag>{issue.groupLabel}</Tag></div>
      <p className="runtime-issue-message">{issue.message}</p><p>{issue.fixHint}</p>
      <Button type="link" onClick={() => onNavigate(issue)}>前往处理</Button>
    </article>)}</div>}
  </Drawer>;
}
