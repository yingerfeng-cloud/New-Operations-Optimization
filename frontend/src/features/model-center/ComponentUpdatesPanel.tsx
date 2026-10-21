import { Alert, Button, Card, Select, Space, Table, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { applyComponentUpdates, getComponentUpdates, testComponentUpdates } from '../../api/componentUpdates';
import type { ComponentUpdateRow } from '../../api/componentUpdates';
import { getModel } from '../../api/models';
import { getTask } from '../../api/tasks';
import { terminalTask } from '../../api/taskTracking';
import { QueryState } from '../../components/QueryState';
import type { ModelAsset } from '../../types/model';
import { UpdateComparisonPanel } from './UpdateComparisonPanel';

interface Pending { key: string; selections: Record<string, string>; candidateId?: string; taskId?: string }
const storageKey = (id: string) => `optiforge-component-update:${id}`;
function read(id: string): Pending | undefined {
  try { return JSON.parse(localStorage.getItem(storageKey(id)) || 'null') || undefined; } catch { return undefined; }
}

export function ComponentUpdatesPanel({ model, onApplied }: { model: ModelAsset; onApplied?: (model: ModelAsset) => void }) {
  const nav = useNavigate();
  const [pending, setPending] = useState(() => read(model.id));
  const [selections, setSelections] = useState<Record<string, string>>(pending?.selections || {});
  useEffect(() => { const value = read(model.id); setPending(value); setSelections(value?.selections || {}); }, [model.id]);
  const remember = (value?: Pending) => {
    try { if (value) localStorage.setItem(storageKey(model.id), JSON.stringify(value)); else localStorage.removeItem(storageKey(model.id)); } catch { /* Server candidate remains available. */ }
    setPending(value);
  };
  const updates = useQuery({ queryKey: ['component-updates', model.id], queryFn: () => getComponentUpdates(model.id) });
  const task = useQuery({ queryKey: ['task', pending?.taskId], queryFn: () => getTask(pending!.taskId!), enabled: !!pending?.taskId,
    refetchInterval: query => terminalTask(query.state.data?.status) ? false : 1000 });
  const candidate = useQuery({ queryKey: ['component-update-candidate', pending?.candidateId, task.data?.status], queryFn: () => getModel(pending!.candidateId!), enabled: !!pending?.candidateId });
  const test = useMutation({ mutationFn: async () => {
    const context = pending || { key: crypto.randomUUID(), selections };
    remember(context);
    const response = await testComponentUpdates(model.id, context.selections, context.key);
    remember({ ...context, candidateId: response.model.id, taskId: response.task.id });
  } });
  const apply = useMutation({ mutationFn: () => applyComponentUpdates(pending!.candidateId!), onSuccess: published => {
    remember(undefined); setSelections({}); message.success('新模型版本已发布，正式服务已切换'); onApplied?.(published);
  } });
  const tested = candidate.data;
  const canApply = task.data?.status === 'SUCCESS' && tested?.id === pending?.candidateId && tested?.tested_model_id === tested?.id
    && tested?.tested_content_hash === tested?.content_hash && tested?.status === 'trial';
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon title="按模型版本固定组件及完整依赖" description="只更新明确选择的组件；未选择的组件、函数修订和参数绑定保持原样。普通停用不改变合法旧绑定；安全撤销会明确阻止执行。测试后更换依赖必须重测。" />
    <QueryState query={updates} title="组件依赖">
      <Table<ComponentUpdateRow> rowKey="component_id" size="small" pagination={false} dataSource={updates.data?.dependencies || []} columns={[
        { title: '组件', render: (_, row) => `${row.name} (${row.component_id})` },
        { title: '当前修订', render: (_, row) => `r${row.binding.revision} · ${row.binding.version}` },
        { title: '目标修订', render: (_, row) => <Select aria-label={`${row.component_id} 组件目标修订`} style={{ width: 250 }} allowClear placeholder="保留当前修订" disabled={!!pending}
          value={selections[row.component_id]} onChange={value => setSelections(current => { const next = { ...current }; if (value) next[row.component_id] = value; else delete next[row.component_id]; return next; })}
          options={row.versions.filter(item => item.component_id !== row.component_id).map(item => ({ value: item.component_id, label: `r${item.revision} · ${item.version}${item.diff.requires_model_edit ? '（需完整编辑）' : ''}`, disabled: item.diff.requires_model_edit }))} /> },
        { title: '固定 hash', render: (_, row) => <Typography.Text code>{row.binding.content_hash.slice(0, 12)}</Typography.Text> },
      ]} expandable={{ expandedRowRender: row => {
        const target = row.versions.find(item => item.component_id === selections[row.component_id]);
        return target ? <><Typography.Paragraph>{target.diff.message}</Typography.Paragraph><Table pagination={false} size="small" rowKey="field" dataSource={[
          { field: '约束', before: target.diff.before_constraints, after: target.diff.after_constraints },
          { field: '目标项', before: target.diff.before_objectives, after: target.diff.after_objectives },
          { field: '接口变化', before: {}, after: target.diff.contract_changes },
        ]} columns={[{ title: '内容', dataIndex: 'field' }, { title: '当前绑定', dataIndex: 'before', render: value => JSON.stringify(value) }, { title: '目标修订', dataIndex: 'after', render: value => JSON.stringify(value) }]} /></> : <span>请选择要比较的目标修订。</span>;
      } }} />
    </QueryState>
    <Space wrap>
      <Button type="primary" disabled={!Object.keys(selections).length || !!pending?.taskId} loading={test.isPending} onClick={() => test.mutate()}>{pending ? '恢复组件更新并测试' : '更新组件并测试'}</Button>
      {pending && <Button disabled={test.isPending} onClick={() => { remember(undefined); setSelections({}); }}>保留原版，结束本次组件更新</Button>}
    </Space>
    {test.isError && <Alert type="error" title="组件更新提交尚未确认，可使用同一标识恢复" />}
    {pending?.taskId && <QueryState query={task} title="组件候选测试"><Card size="small" title={`组件测试任务 ${pending.taskId}`}>
      <Typography.Paragraph>状态：{task.data?.status} · 候选版本：{pending.candidateId}</Typography.Paragraph>
      {task.data?.error && <Alert type="error" title={task.data.error} />}
      {task.data?.status === 'SUCCESS' && pending.candidateId && <UpdateComparisonPanel candidateId={pending.candidateId} contentHash={tested?.content_hash} />}
      <Button type="primary" disabled={!canApply} loading={apply.isPending} onClick={() => apply.mutate()}>应用组件更新</Button>
      <Button onClick={() => void candidate.refetch()}>刷新组件测试证据</Button>
      <Button onClick={() => nav(`/models/${encodeURIComponent(pending.candidateId!)}/edit`)}>在工作台查看组件候选</Button>
      {apply.isError && <Alert type="error" title="组件更新未应用，请检查正式版本及测试证据" />}
    </Card></QueryState>}
  </Space>;
}
