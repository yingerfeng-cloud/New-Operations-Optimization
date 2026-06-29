import { Button, Card, Col, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getComponents } from '../../api/components';
import { getTemplates } from '../../api/templates';
import { getTasks } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { navEntries } from '../../app/navigation';
import type { SolveTask } from '../../types/task';

const runningStatuses = ['RUNNING', 'VALIDATING', 'BUILDING_MODEL', 'SOLVING', 'FORMATTING_RESULT'];
const failedStatuses = ['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'];

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

  const rows = tasks.data || [];
  const success = rows.filter(task => normalizeStatus(task) === 'SUCCESS').length;
  const running = rows.filter(task => runningStatuses.includes(normalizeStatus(task))).length;
  const failed = rows.filter(task => failedStatuses.includes(normalizeStatus(task))).length;
  const successRate = rows.length ? Math.round((success / rows.length) * 100) : 0;
  const publishedModels = (models.data || []).filter(model => ['published', 'trial', 'tested', '已发布', '试运行', '已测试'].includes(String(model.status))).length;
  const implementedComponents = (components.data || []).filter(component => component.implemented !== false).length;

  const loading = models.isLoading || components.isLoading || templates.isLoading || tasks.isLoading;

  return (
    <>
      <PageHeader
        title="集团级运筹优化底座总览"
        description="围绕业务场景、模型资产、组件库、求解任务和结果报告提供统一建模与运行入口。"
        extra={<Button type="primary" onClick={() => nav('/tasks')}>发起任务</Button>}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card metric-blue" loading={loading} onClick={() => nav('/models')}>
            <Statistic title="模型资产数" value={models.data?.length || 0} />
            <Typography.Text type="secondary">已发布/试运行 {publishedModels} 个</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card metric-green" loading={loading} onClick={() => nav('/components')}>
            <Statistic title="组件数量" value={components.data?.length || 0} />
            <Typography.Text type="secondary">已实现 {implementedComponents} 个</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card metric-amber" loading={loading} onClick={() => nav('/models')}>
            <Statistic title="内置模板数" value={templates.data?.length || 0} />
            <Typography.Text type="secondary">支持模板克隆建模</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="metric-card metric-red" loading={loading} onClick={() => nav('/tasks')}>
            <Statistic title="求解任务数" value={rows.length} />
            <Typography.Text type="secondary">运行中 {running} / 失败 {failed}</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card title="快捷入口" className="section-gap">
        <Row gutter={[16, 16]}>
          {navEntries.filter(entry => entry.key !== '/settings').map(entry => (
            <Col xs={24} sm={12} lg={6} key={entry.key}>
              <button className="dash-entry" onClick={() => nav(entry.key)}>
                <span className="dash-entry-icon">{entry.icon}</span>
                <strong>{entry.label}</strong>
                <p>{entry.description}</p>
              </button>
            </Col>
          ))}
        </Row>
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
                <Col span={8}><Statistic title="成功" value={success} /></Col>
                <Col span={8}><Statistic title="运行中" value={running} /></Col>
                <Col span={8}><Statistic title="失败" value={failed} /></Col>
              </Row>
              <Button block onClick={() => nav('/settings')}>查看系统配置</Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="近期求解任务" extra={<Button onClick={() => nav('/tasks')}>进入任务中心</Button>}>
            {rows.slice(0, 8).length ? rows.slice(0, 8).map(task => (
              <div className="dashboard-task-row" key={task.id}>
                <div>
                  <Space><span>{task.model || task.model_id || '未命名模型'}</span><Tag>{task.solver || 'HiGHS'}</Tag></Space>
                  <Typography.Text type="secondary">{`${task.id} · ${task.scene || '未声明场景'} · ${task.created_at || '-'}`}</Typography.Text>
                  <div className="task-progress">
                    <Progress percent={Number(task.progress || 0)} size="small" />
                  </div>
                </div>
                <Space>
                  <StatusTag status={task.status} />
                  <Button type="link" onClick={() => nav('/tasks')}>查看</Button>
                </Space>
              </div>
            )) : <Typography.Text type="secondary">暂无真实任务数据，请在任务调度中心提交求解任务。</Typography.Text>}
          </Card>
        </Col>
      </Row>
    </>
  );
}
