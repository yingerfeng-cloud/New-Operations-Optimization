import { Alert, Button, Card, Select, Space, Table, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { applyFunctionUpdates, getFunctionUpdates, testFunctionUpdates } from '../../api/functionUpdates';
import type { FunctionUpdateRow } from '../../api/functionUpdates';
import { getModel } from '../../api/models';
import { getTask } from '../../api/tasks';
import { getResult } from '../../api/results';
import { terminalTask } from '../../api/taskTracking';
import { QueryState } from '../../components/QueryState';
import type { ModelAsset } from '../../types/model';
import { UpdateComparisonPanel } from './UpdateComparisonPanel';
import { assetToWorkspaceDraft } from '../model-creation/utils/workspaceMode';
import { normalizeModelDraft } from '../model-creation/utils/normalizeModelDraft';
import { editWorkspaceKey, writeWorkspaceRecovery } from '../model-creation/utils/workspaceRecovery';

interface PendingUpdate { key: string; revisions: Record<string, number>; candidateId?: string; taskId?: string }
const storageKey = (id: string) => `optiforge-function-update:${id}`;
function readPending(id: string): PendingUpdate | undefined {
  try { return JSON.parse(localStorage.getItem(storageKey(id)) || 'null') || undefined; } catch { return undefined; }
}
function savePending(id: string, value?: PendingUpdate) {
  try { if (value) localStorage.setItem(storageKey(id), JSON.stringify(value)); else localStorage.removeItem(storageKey(id)); } catch { /* Server candidate remains in the model list. */ }
}

export function FunctionUpdatesPanel({ model, onApplied }: { model: ModelAsset; onApplied?: (model: ModelAsset) => void }) {
  const nav = useNavigate();
  const [pending, setPending] = useState(() => readPending(model.id));
  const [revisions, setRevisions] = useState<Record<string, number>>(pending?.revisions || {});
  const updates = useQuery({ queryKey: ['function-updates', model.id], queryFn: () => getFunctionUpdates(model.id) });
  useEffect(() => { const value = readPending(model.id); setPending(value); setRevisions(value?.revisions || {}); }, [model.id]);
  const remember = (value?: PendingUpdate) => { savePending(model.id, value); setPending(value); };
  const task = useQuery({ queryKey: ['task', pending?.taskId], queryFn: () => getTask(pending!.taskId!), enabled: !!pending?.taskId,
    refetchInterval: query => terminalTask(query.state.data?.status) ? false : 1200 });
  const candidate = useQuery({ queryKey: ['function-update-candidate', pending?.candidateId, task.data?.status], queryFn: () => getModel(pending!.candidateId!), enabled: !!pending?.candidateId });
  const result = useQuery({ queryKey: ['result', pending?.taskId], queryFn: () => getResult(pending!.taskId!), enabled: task.data?.status === 'SUCCESS' });
  const test = useMutation({ mutationFn: async () => {
    const context = pending || { key: crypto.randomUUID(), revisions };
    remember(context); // Uncertain submissions and refresh reuse the same identity.
    const response = await testFunctionUpdates(model.id, context.revisions, context.key);
    remember({ ...context, candidateId: response.model.id, taskId: response.task.id });
    const draft = normalizeModelDraft(assetToWorkspaceDraft(response.model, 'edit'));
    const snapshot = JSON.stringify(draft);
    writeWorkspaceRecovery({ schema_version: 1, updatedAt: new Date().toISOString(), draft, step: 4,
      workspace: { mode: 'edit', sourceModelId: response.model.id, currentAssetId: response.model.id, sessionId: editWorkspaceKey(response.model.id), initialized: true, dirty: false },
      currentDraftModelId: response.model.id, lastSavedSnapshot: snapshot, lastSavedContentHash: response.model.content_hash,
      testSnapshot: { modelId: response.model.id, snapshot, contentHash: response.model.content_hash } });
  } });
  const apply = useMutation({ mutationFn: () => applyFunctionUpdates(pending!.candidateId!), onSuccess: published => {
    remember(undefined); setRevisions({}); message.success('新模型版本已发布，正式服务已切换'); onApplied?.(published);
  } });
  const tested = candidate.data;
  const canApply = task.data?.status === 'SUCCESS' && tested?.tested_model_id === tested?.id && tested?.tested_content_hash === tested?.content_hash && tested?.status === 'trial';
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon title="按模型版本绑定函数修订" description="只替换选中的依赖；未选择的函数保留原修订。测试通过后应用更新，平台发布新模型版本并切换正式入口。固定模型 ID 和既有固定 Skill 保留原绑定。" />
    <QueryState query={updates} title="函数依赖">
      <Table<FunctionUpdateRow> rowKey="function_id" size="small" pagination={false} dataSource={updates.data?.dependencies || []} columns={[
        { title: '函数', render: (_, row) => <Button type="link" onClick={() => nav('/functions')}>{row.name} ({row.function_id})</Button> },
        { title: '使用修订', render: (_, row) => row.binding ? `r${row.binding.revision}` : '未固定，需迁移' },
        { title: '可用修订', render: (_, row) => <Select aria-label={`${row.function_id} 目标修订`} style={{ width: 220 }} allowClear placeholder={`最新 r${row.latest_revision}；保留当前`} disabled={!!pending}
          value={revisions[row.function_id]} onChange={value => setRevisions(current => { const next = { ...current }; if (value) next[row.function_id] = value; else delete next[row.function_id]; return next; })}
          options={row.versions.filter(item => item.revision !== row.binding?.revision).map(item => ({ value: item.revision, label: `r${item.revision}${item.diff?.requires_model_edit ? '（需完整模型编辑）' : ''}`, disabled: item.diff?.requires_model_edit }))} /> },
        { title: '已用 hash', render: (_, row) => <Typography.Text code>{row.binding?.content_hash?.slice(0, 12) || '未知'}</Typography.Text> },
      ]} expandable={{ expandedRowRender: row => {
        const revision = row.versions.find(item => item.revision === revisions[row.function_id]) || row.versions.at(-1);
        const diff = revision?.diff;
        return diff ? <div><Typography.Paragraph>{diff.message}</Typography.Paragraph><Table size="small" pagination={false} rowKey="field" dataSource={[
          { field: '修订', before: row.binding?.revision, after: revision?.revision },
          { field: '断点', before: diff.before_points, after: diff.after_points },
          { field: '定义域 / 范围', before: diff.before_domain, after: diff.after_domain },
          ...Object.entries(diff.contract_changes).map(([field, values]) => ({ field, ...values })),
        ]} columns={[{ title: '内容', dataIndex: 'field' }, { title: '当前绑定', dataIndex: 'before', render: value => JSON.stringify(value) }, { title: '目标修订', dataIndex: 'after', render: value => JSON.stringify(value) }]} /></div> : <span>历史内容未知，请先迁移。</span>;
      } }} />
    </QueryState>
    <Space wrap>
      <Button type="primary" disabled={!Object.keys(revisions).length || !!pending?.taskId} loading={test.isPending} onClick={() => test.mutate()}>{pending ? '恢复更新并测试' : '更新并测试'}</Button>
      {pending && <Button disabled={test.isPending} onClick={() => { remember(undefined); setRevisions({}); }}>保留原版，结束本次更新</Button>}
      <Button onClick={() => nav(`/models/create?mode=version&source=${encodeURIComponent(model.id)}`)}>完整模型编辑</Button>
    </Space>
    {test.isError && <Alert type="error" showIcon title="提交或连接暂未确认，可使用同一标识恢复" />}
    {pending?.taskId && <QueryState query={task} title="候选版本测试"><Card size="small" title={`测试任务 ${pending.taskId}`}>
      <Typography.Paragraph>状态：{task.data?.status} · 进度：{task.data?.progress || 0}% · 候选版本：{pending.candidateId}</Typography.Paragraph>
      {task.data?.error && <Alert type="error" title={task.data.error} />}
      {task.data?.status === 'SUCCESS' && pending.candidateId && <UpdateComparisonPanel candidateId={pending.candidateId} contentHash={tested?.content_hash} />}
      {result.data && <details><summary>物理量、变量及目标分项</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.data, null, 2)}</pre></details>}
      <Button type="primary" disabled={!canApply} loading={apply.isPending} onClick={() => apply.mutate()}>应用更新</Button>
      {pending.candidateId && <Button onClick={() => nav(`/models/${encodeURIComponent(pending.candidateId!)}/edit`)}>在工作台查看候选</Button>}
      {candidate.error && <Alert type="warning" title="候选测试证据暂未更新" action={<Button onClick={() => void candidate.refetch()}>恢复证据</Button>} />}
      {apply.isError && <Alert type="error" title="应用失败，请检查当前版本和测试证据后重试" />}
    </Card></QueryState>}
  </Space>;
}
