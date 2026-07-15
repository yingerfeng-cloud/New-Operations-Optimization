import { Alert, Button, Card, Col, Empty, Row, Space, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getTasks } from '../../api/tasks';
import { getSolverStatus } from '../../api/solvers';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SectionLoading } from '../../components/PageStates';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { isTaskFailed, isTaskRunning, normalizeTaskStatus } from '../../features/task-center/taskStatus';
import type { SolveTask } from '../../types/task';

const callable = new Set(['PUBLISHED', 'TRIAL', 'TESTED', 'ACTIVE', 'ONLINE', 'READY']);
const timestamp = (task: SolveTask) => Date.parse(String(task.created_at || '')) || 0;
const failureReason = (task: SolveTask) => typeof task.error === 'string' ? task.error : String((task.error as Record<string, unknown> | undefined)?.message || task.risk || '-');

export function DashboardPage() {
  const nav = useNavigate();
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 5000;
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval });
  const solvers = useQuery({ queryKey: ['solver-status'], queryFn: getSolverStatus, refetchInterval: false });
  const rows = [...(tasks.data || [])].sort((a, b) => timestamp(b) - timestamp(a));
  const running = rows.filter(task => isTaskRunning(task.status));
  const failed = rows.filter(task => isTaskFailed(task.status));
  const success = rows.filter(task => normalizeTaskStatus(task.status) === 'SUCCESS');
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const recentSevenDays = rows.filter(task => timestamp(task) >= sevenDaysAgo);
  const recentSuccess = recentSevenDays.filter(task => normalizeTaskStatus(task.status) === 'SUCCESS').length;
  const successRate = recentSevenDays.length ? `${Math.round(recentSuccess / recentSevenDays.length * 100)}%` : '-';
  const published = (models.data || []).filter(model => callable.has(String(model.status || '').toUpperCase())).length;

  if (models.isLoading && tasks.isLoading) return <SectionLoading label="正在加载生产运行概况…" />;
  if (models.isError && tasks.isError) return <ErrorState title="工作台数据加载失败" description="当前无法获取模型和任务数据。" retry={() => { void models.refetch(); void tasks.refetch(); }} />;

  return <>
    <PageHeader title="生产运筹工作台" description="从业务场景和运行任务出发，优先处理运行中与异常任务。" extra={<Space><Button onClick={() => nav('/scenarios')}>从业务场景开始</Button><Button type="primary" onClick={() => nav('/tasks?create=1')}>发起优化任务</Button></Space>} />
    {failed.length > 0 && <Alert type="error" showIcon title={`${failed.length} 个任务需要处理`} description="请优先检查输入数据、时间维度、模型约束和求解环境。" action={<Button danger onClick={() => nav('/tasks')}>查看异常任务</Button>} />}
    <MetricGrid>
      <MetricCard title="运行中任务" value={tasks.isLoading ? '-' : running.length} description="排队、校验、建模与求解" tone="amber" onClick={() => nav('/tasks')} />
      <MetricCard title="失败 / 无解" value={tasks.isLoading ? '-' : failed.length} description="待诊断和处理" tone={failed.length ? 'red' : 'neutral'} onClick={() => nav('/tasks')} />
      <MetricCard title="已发布模型" value={models.isLoading ? '-' : published} description="可用于发起任务" tone="blue" onClick={() => nav('/models')} />
      <MetricCard title="近 7 天任务" value={tasks.isLoading ? '-' : recentSevenDays.length} description={`成功率 ${successRate}`} tone="green" onClick={() => nav('/results')} />
    </MetricGrid>
    <Row gutter={[16, 16]} className="section-gap">
      <Col xs={24} xl={15}><Card title="最近任务" extra={<Button type="link" onClick={() => nav('/tasks')}>全部任务</Button>}>
        {rows.length ? <Table size="small" pagination={false} rowKey="id" dataSource={rows.slice(0, 7)} onRow={task => ({ onClick: () => nav(`/tasks?task=${task.id}`) })} columns={[
          { title: '模型', dataIndex: 'model' }, { title: '业务场景', dataIndex: 'scene' }, { title: '状态', dataIndex: 'status', render: value => <StatusTag status={String(value)} /> },
          { title: '开始时间', dataIndex: 'started_at', render: (value, task) => String(value || task.created_at || '-') },
          { title: '运行耗时', dataIndex: 'duration_seconds', render: value => value == null ? '-' : `${value}s` },
          { title: '主要结果 / 失败原因', render: (_value, task) => isTaskFailed(task.status) ? failureReason(task) : task.cost == null ? '-' : `目标值 ${task.cost}` },
        ]} /> : <Empty description="暂无任务数据" />}
      </Card></Col>
      <Col xs={24} xl={9}><Card title="最近使用模型">
        {(models.data || []).length ? (models.data || []).slice(0, 5).map(model => <button type="button" className="dash-entry" key={model.id} onClick={() => nav(`/tasks?create=1&model=${encodeURIComponent(model.id)}&scene=${encodeURIComponent(model.scene || '')}`)}><strong>{model.name}</strong><p>{model.scene || '未标注场景'} · {model.version || '当前版本'}</p><Tag>发起任务</Tag></button>) : <Empty description="暂无可用模型" />}
      </Card></Col>
    </Row>
    <Card title="求解能力摘要" className="section-gap" extra={<Button type="link" onClick={() => nav('/runtime')}>查看完整求解环境</Button>}>
      <Space wrap><Tag color={solvers.data?.highs?.available ? 'green' : 'orange'}>HiGHS：{solvers.data?.highs?.available ? '可用' : '未就绪'}</Tag><Tag color={solvers.data?.ipopt?.available ? 'green' : 'orange'}>Ipopt：{solvers.data?.ipopt?.available ? '可用' : '未配置'}</Tag><Tag>LP</Tag><Tag>MILP</Tag><Tag>PWL</Tag><Tag>McCormick</Tag><Tag>连续 NLP</Tag></Space>
    </Card>
  </>;
}
