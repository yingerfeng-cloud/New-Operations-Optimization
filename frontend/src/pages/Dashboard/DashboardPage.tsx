import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getComponents } from '../../api/components';
import { getTemplates } from '../../api/templates';
import { getTasks } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { EmptyActionState, MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import type { SolveTask } from '../../types/task';

const runningStatuses = ['RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'];
const failedStatuses = ['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'];
const callableStatuses = ['published', 'trial', 'tested', '已发布', '试运行', '已测试'];

function normalizeStatus(task: SolveTask) {
  const status = String(task.status || '').toUpperCase();
  if (Number(task.progress || 0) >= 100 && !failedStatuses.includes(status)) return 'SUCCESS';
  return status;
}

export function DashboardPage() {
  const nav = useNavigate();
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 5000;
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const components = useQuery({ queryKey: ['components'], queryFn: getComponents });
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval });

  const taskRows = tasks.data || [];
  const success = taskRows.filter(task => normalizeStatus(task) === 'SUCCESS').length;
  const running = taskRows.filter(task => runningStatuses.includes(normalizeStatus(task))).length;
  const failed = taskRows.filter(task => failedStatuses.includes(normalizeStatus(task))).length;
  const successRate = taskRows.length ? Math.round((success / taskRows.length) * 100) : 0;
  const publishedModels = (models.data || []).filter(model => callableStatuses.includes(String(model.status))).length;
  const implementedComponents = (components.data || []).filter(component => component.implemented !== false).length;
  const loading = models.isLoading || components.isLoading || templates.isLoading || tasks.isLoading;
  const recentModels = (models.data || []).slice(0, 5);
  const recentTasks = taskRows.slice(0, 8);
  const alerts = [
    ...(models.isError ? ['模型资产接口暂不可用'] : []),
    ...(components.isError ? ['组件库接口暂不可用'] : []),
    ...(tasks.isError ? ['任务接口暂不可用'] : []),
    ...(failed ? [`存在 ${failed} 个失败/无解任务`] : []),
  ];
  const flowEntries = [
    { title: '选择业务场景', desc: '从场景目录进入模板、模型列表和建模入口。', path: '/scenarios' },
    { title: '创建优化模型', desc: '维护语义、公式、组件和运行参数。', path: '/models/create' },
    { title: '发起求解任务', desc: '选择模型并提交运行参数。', path: '/tasks' },
    { title: '查看结果报告', desc: '查看关键指标、变量曲线和业务解释。', path: '/results' },
  ];

  return (
    <>
      <PageHeader
        title="集团级运筹优化底座总览"
        description="围绕业务场景、模型资产、组件库、求解任务和结果报告提供统一建模与运行入口。"
        extra={<Button type="primary" onClick={() => nav('/tasks')}>发起任务</Button>}
      />

      <MetricGrid>
        <MetricCard title="模型资产数" value={loading ? '-' : models.data?.length || 0} description={`可发布/试运行 ${publishedModels} 个`} tone="blue" onClick={() => nav('/models')} />
        <MetricCard title="组件数量" value={loading ? '-' : components.data?.length || 0} description={`已实现 ${implementedComponents} 个`} tone="green" onClick={() => nav('/components')} />
        <MetricCard title="内置模板数" value={loading ? '-' : templates.data?.length || 0} description="支持模板克隆建模" tone="amber" onClick={() => nav('/scenarios')} />
        <MetricCard title="求解任务数" value={loading ? '-' : taskRows.length} description={`运行中 ${running} / 失败 ${failed}`} tone={failed ? 'red' : 'purple'} onClick={() => nav('/tasks')} />
      </MetricGrid>

      <Card title="主流程入口" className="section-gap">
        <div className="dashboard-flow-grid">
          {flowEntries.map(entry => (
            <button className="dash-entry" key={entry.path} onClick={() => nav(entry.path)}>
              <strong>{entry.title}</strong>
              <p>{entry.desc}</p>
              <Tag color="blue">进入</Tag>
            </button>
          ))}
        </div>
      </Card>

      <Row gutter={[16, 16]} className="section-gap">
        <Col xs={24} lg={8}>
          <Card title="求解运行状态">
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              <div className="status-chip-row">
                <Tag color="green">Pyomo 可用</Tag>
                <Tag color="blue">HiGHS / highspy</Tag>
                <Tag color={models.isError || components.isError || tasks.isError ? 'red' : 'green'}>
                  {models.isError || components.isError || tasks.isError ? '后端异常' : '真实 API'}
                </Tag>
              </div>
              <Progress percent={successRate} status={failed ? 'exception' : 'active'} />
              <Row gutter={8}>
                <Col span={8}><MetricCard title="成功" value={success} tone="green" /></Col>
                <Col span={8}><MetricCard title="运行中" value={running} tone="blue" /></Col>
                <Col span={8}><MetricCard title="失败" value={failed} tone={failed ? 'red' : 'neutral'} /></Col>
              </Row>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="最近模型" extra={<Button onClick={() => nav('/models')}>模型资产中心</Button>}>
            {recentModels.length ? recentModels.map(model => (
              <div className="dashboard-task-row" key={model.id}>
                <div className="dashboard-model-info">
                  <Typography.Text strong>{model.name}</Typography.Text>
                  <Typography.Text type="secondary">{model.template_id || model.id}</Typography.Text>
                </div>
                <StatusTag status={model.status} />
              </div>
            )) : <EmptyActionState title="暂无模型资产" description="可以从业务场景或模板开始创建模型。" action={<Button type="primary" onClick={() => nav('/models/create')}>创建优化模型</Button>} />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="异常提醒" extra={<Button onClick={() => nav('/settings')}>系统配置</Button>}>
            {alerts.length ? alerts.map(item => (
              <div className="dashboard-task-row" key={item}>
                <Typography.Text>{item}</Typography.Text>
                <Tag color="orange">待处理</Tag>
              </div>
            )) : <EmptyActionState title="暂无异常提醒" description="后端、组件、模型与任务接口当前未返回阻断问题。" />}
          </Card>
        </Col>
      </Row>

      <Card title="最近求解任务" className="section-gap" extra={<Button onClick={() => nav('/tasks')}>进入任务中心</Button>}>
        {recentTasks.length ? recentTasks.map(task => (
          <div className="dashboard-task-row" key={task.id}>
            <div>
              <Space><span>{task.model || task.model_id || '未命名模型'}</span><Tag>{task.solver || 'HiGHS'}</Tag></Space>
              <Typography.Text type="secondary">{`${task.id} / ${task.scene || '未声明场景'} / ${task.created_at || '-'}`}</Typography.Text>
              <div className="task-progress">
                <Progress percent={Number(task.progress || 0)} size="small" />
              </div>
            </div>
            <Space>
              <StatusTag status={task.status} />
              <Button type="link" onClick={() => nav('/tasks')}>查看</Button>
            </Space>
          </div>
        )) : <EmptyActionState title="暂无真实任务数据" description="在任务调度中心提交求解任务后，这里会展示最近运行状态。" action={<Button type="primary" onClick={() => nav('/tasks')}>发起求解任务</Button>} />}
      </Card>
    </>
  );
}
