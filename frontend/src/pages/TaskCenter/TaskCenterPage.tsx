import { MoreOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Dropdown, Space, Tabs, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelTask, createTask, getTask, getTasks, retryTask } from '../../api/tasks';
import { getModels } from '../../api/models';
import { getResult } from '../../api/results';
import { DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { TaskCreateWizard } from '../../features/task-create/TaskCreateWizard';
import { TaskExplanationPanel, TaskInputPanel, TaskLogsPanel, TaskOverviewPanel, TaskResultPanel, TaskTimelinePanel, isRetryableStatus, isRunningStatus } from '../../features/task-center/TaskPanels';
import type { SolveTask } from '../../types/task';
import { validateRuntimeTimeDimension, type RuntimeField, type TimeDimensionConfig } from '../../features/time-dimension';

export function validateTimeSeriesFields(fields: RuntimeField[], parameters: Record<string, unknown>, timeDimension?: Partial<TimeDimensionConfig>, horizon?: number) {
  if (!timeDimension) return '';
  const config: TimeDimensionConfig = { enabled: false, policy: 'not_applicable', time_set: 'time', state_time_set: null, editable: false, allowed_horizons: [], interval_minutes_by_horizon: {}, delta_t_by_horizon: {}, ...timeDimension };
  if (config.policy === 'runtime_variable' && config.allowed_horizons.length && (!horizon || !config.allowed_horizons.includes(horizon))) return `当前模型仅支持 ${config.allowed_horizons.join('、')} 点切换，请选择有效的调度时段。`;
  return validateRuntimeTimeDimension(config, fields, parameters, horizon)[0] || '';
}

const normalizedStatus = (status?: string) => String(status || '').toUpperCase();
export const isPollingTaskStatus = (status?: string) => ['PENDING', 'QUEUED', 'RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'].includes(normalizedStatus(status));
export function defaultTaskTab(status?: string, hasExplanation = true) {
  const value = normalizedStatus(status);
  if (isPollingTaskStatus(value)) return 'timeline';
  if (value === 'SUCCESS') return 'result';
  if (['FAILED', 'INFEASIBLE', 'TIMEOUT'].includes(value)) return hasExplanation ? 'explain' : 'logs';
  return 'overview';
}

export function TaskCenterPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [activeTab, setActiveTab] = useState('overview');
  const tabInitializedFor = useRef('');
  const previousStatus = useRef('');
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 5000;
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval });
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const detail = useQuery({ queryKey: ['task', viewId], queryFn: () => getTask(viewId!), enabled: !!viewId, refetchInterval: query => viewId && isPollingTaskStatus((query.state.data as SolveTask | undefined)?.status) ? 5000 : false });
  const result = useQuery({ queryKey: ['result', viewId], queryFn: () => getResult(viewId!), enabled: !!viewId && normalizedStatus(detail.data?.status) === 'SUCCESS' });
  useEffect(() => { const task = new URLSearchParams(window.location.search).get('task'); if (task) setViewId(task); }, []);
  const refresh = (taskId?: string) => { qc.invalidateQueries({ queryKey: ['tasks'] }); if (taskId) { qc.invalidateQueries({ queryKey: ['task', taskId] }); qc.invalidateQueries({ queryKey: ['result', taskId] }); } };
  const openDetail = (id: string) => { tabInitializedFor.current = ''; previousStatus.current = ''; setActiveTab('overview'); setViewId(id); };
  const create = useMutation({ mutationFn: createTask, onSuccess: task => { message.success('求解任务已提交'); setCreateOpen(false); refresh(task.id); openDetail(task.id); } });
  const cancel = useMutation({ mutationFn: cancelTask, onSuccess: task => { message.success('任务已取消'); refresh(task.id); } });
  const retry = useMutation({ mutationFn: retryTask, onSuccess: task => { message.success('任务已重试'); refresh(task.id); openDetail(task.id); } });
  const rows = tasks.data || [];
  const running = rows.filter(task => isRunningStatus(task.status)).length;
  const success = rows.filter(task => normalizedStatus(task.status) === 'SUCCESS').length;
  const failed = rows.filter(task => ['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(normalizedStatus(task.status))).length;
  const current = detail.data;
  useEffect(() => {
    if (!viewId) { tabInitializedFor.current = ''; previousStatus.current = ''; setActiveTab('overview'); return; }
    if (!current) return;
    const status = normalizedStatus(current.status);
    const firstLoad = tabInitializedFor.current !== viewId;
    const enteredTerminal = isPollingTaskStatus(previousStatus.current) && !isPollingTaskStatus(status);
    if (firstLoad || enteredTerminal) setActiveTab(defaultTaskTab(status, true));
    tabInitializedFor.current = viewId;
    previousStatus.current = status;
  }, [current, viewId]);
  const closeDetail = () => { setViewId(undefined); tabInitializedFor.current = ''; previousStatus.current = ''; };

  return <>
    <PageHeader title="任务调度中心" description="创建、监控、取消和重试优化任务；成功后直接进入结果分析。" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>创建任务</Button>} />
    <MetricGrid><MetricCard title="任务总数" value={rows.length} description="真实任务队列" tone="blue" /><MetricCard title="运行中" value={running} description="校验 / 建模 / 求解" tone="amber" /><MetricCard title="成功" value={success} description="可查看结果" tone="green" /><MetricCard title="异常" value={failed} description={failed ? '需要处理' : '暂无异常'} tone={failed ? 'red' : 'neutral'} /></MetricGrid>
    <Card className="content-card section-gap" title="求解任务列表"><DataTable<SolveTask> dataSource={rows} loading={tasks.isLoading} columns={[
      { title: '任务编号', dataIndex: 'id' }, { title: '模型', dataIndex: 'model' }, { title: '状态', dataIndex: 'status', render: (status: string) => <StatusTag status={status} /> }, { title: '进度', dataIndex: 'progress', render: (progress: number) => `${progress || 0}%` }, { title: '创建时间', dataIndex: 'created_at' }, { title: '求解器', dataIndex: 'solver' }, { title: '目标值', dataIndex: 'cost' },
      { title: '操作', fixed: 'right' as const, render: (_: unknown, task: SolveTask) => <Space className="task-actions"><Button type="link" onClick={() => openDetail(task.id)}>查看</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'cancel', label: '取消任务', danger: true, disabled: !isRunningStatus(task.status) }, { key: 'retry', label: '重试任务', disabled: !isRetryableStatus(task.status) }, { key: 'result', label: '查看结果', disabled: normalizedStatus(task.status) !== 'SUCCESS' }], onClick: ({ key }) => { if (key === 'cancel') cancel.mutate(task.id); if (key === 'retry') retry.mutate(task.id); if (key === 'result') openDetail(task.id); } }}><Button type="link" icon={<MoreOutlined />} aria-label={`任务 ${task.id} 更多操作`}>更多</Button></Dropdown></Space> },
    ]} /></Card>
    <TaskCreateWizard open={createOpen} models={models.data || []} submitting={create.isPending} onClose={() => setCreateOpen(false)} onSubmit={payload => create.mutateAsync(payload)} />
    <Drawer size="large" open={!!viewId} destroyOnHidden onClose={closeDetail} title={`任务 ${viewId || ''}`} footer={<Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={closeDetail}>关闭</Button>{current && <Button danger disabled={!isRunningStatus(current.status)} title={!isRunningStatus(current.status) ? '仅运行中的任务可取消' : undefined} onClick={() => cancel.mutate(current.id)}>取消任务</Button>}{current && isRetryableStatus(current.status) && <Button type="primary" onClick={() => retry.mutate(current.id)}>重试任务</Button>}</Space>}>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[{ key: 'overview', label: '任务概览', children: <TaskOverviewPanel task={current} /> }, { key: 'timeline', label: '求解过程', children: <TaskTimelinePanel task={current} /> }, { key: 'input', label: '输入参数', children: <TaskInputPanel task={current} /> }, { key: 'logs', label: '技术日志', children: <TaskLogsPanel task={current} /> }, { key: 'result', label: '优化结果', children: <TaskResultPanel result={result.data} /> }, { key: 'explain', label: '业务解释', children: <TaskExplanationPanel result={result.data} /> }]} />
    </Drawer>
  </>;
}
