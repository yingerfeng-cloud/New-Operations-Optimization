import { Button, Card, Col, Empty, Row, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getTasks } from '../../api/tasks';
import { getSolverStatus } from '../../api/solvers';
import { getSystemConfig } from '../../api/systemConfig';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, SectionLoading } from '../../components/PageStates';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { LazyEChart } from '../../components/LazyEChart';
import { isTaskFailed, isTaskRunning, normalizeTaskStatus } from '../../features/task-center/taskStatus';
import { modelBelongsToScenario, scenariosFromDictionary } from '../../features/model-creation/data/scenarioCatalog';
import type { ModelAsset } from '../../types/model';
import type { ScenarioCatalogItem } from '../../types/scenario';
import type { SolveTask } from '../../types/task';
import { formatDurationSeconds } from '../../utils/formatDuration';

const callable = new Set(['PUBLISHED', 'TRIAL', 'TESTED', 'ACTIVE', 'ONLINE', 'READY']);
const timestamp = (task: SolveTask) => Date.parse(String(task.created_at || '')) || 0;
const failureReason = (task: SolveTask) => typeof task.error === 'string' ? task.error : String((task.error as Record<string, unknown> | undefined)?.message || task.risk || '-');

function dateKey(value: unknown) {
  const parsed = new Date(String(value || '').replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function shortTime(value: unknown) {
  const parsed = new Date(String(value || '').replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function taskScenarioName(task: SolveTask, models: ModelAsset[], scenarios: ScenarioCatalogItem[]) {
  const linkedModel = models.find(model => [task.model_id, task.resolved_model_id].includes(model.id));
  const matched = scenarios.find(scenario =>
    (linkedModel && modelBelongsToScenario(linkedModel, scenario))
    || modelBelongsToScenario(task as unknown as Record<string, unknown>, scenario),
  );
  return matched?.name || '未关联场景';
}

export function DashboardPage() {
  const nav = useNavigate();
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 5000;
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval });
  const solvers = useQuery({ queryKey: ['solver-status'], queryFn: getSolverStatus, refetchInterval: false });
  const config = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const businessScenarios = scenariosFromDictionary(config.data?.dictionaries?.business_scenarios);
  const rows = [...(tasks.data || [])].sort((a, b) => timestamp(b) - timestamp(a));
  const running = rows.filter(task => isTaskRunning(task.status));
  const failed = rows.filter(task => isTaskFailed(task.status));
  const success = rows.filter(task => normalizeTaskStatus(task.status) === 'SUCCESS');
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const recentSevenDays = rows.filter(task => timestamp(task) >= sevenDaysAgo);
  const recentSuccess = recentSevenDays.filter(task => normalizeTaskStatus(task.status) === 'SUCCESS').length;
  const successRate = recentSevenDays.length ? `${Math.round(recentSuccess / recentSevenDays.length * 100)}%` : '-';
  const published = (models.data || []).filter(model => callable.has(String(model.status || '').toUpperCase())).length;
  const trendDays = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { key: dateKey(date.toISOString()), label: `${date.getMonth() + 1}/${date.getDate()}` };
  });
  const trend = trendDays.map(day => {
    const dayTasks = rows.filter(task => dateKey(task.created_at) === day.key);
    const daySuccess = dayTasks.filter(task => normalizeTaskStatus(task.status) === 'SUCCESS').length;
    const dayFailed = dayTasks.filter(task => isTaskFailed(task.status)).length;
    return { ...day, success: daySuccess, failed: dayFailed, other: Math.max(0, dayTasks.length - daySuccess - dayFailed), total: dayTasks.length, successRate: dayTasks.length ? Math.round(daySuccess / dayTasks.length * 100) : null };
  });
  const scenarioCounts = rows.reduce<Record<string, number>>((counts, task) => {
    const label = taskScenarioName(task, models.data || [], businessScenarios);
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
  const scenarioData = Object.entries(scenarioCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  const scenarioTotal = scenarioData.reduce((sum, item) => sum + item.value, 0);
  const scenarioPalette = ['#2b6ed2', '#27a889', '#7b72dc', '#e6a23c', '#3ba7c9', '#8595aa'];
  const peakDay = trend.reduce((peak, day) => day.total > peak.total ? day : peak, trend[0]);
  const completedDurations = rows.map(task => Number(task.duration_seconds)).filter(value => Number.isFinite(value) && value >= 0);
  const averageDuration = completedDurations.length ? completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length : undefined;
  const trendOption = {
    color: ['#21a179', '#ef6a61', '#7397c7', '#2b6ed2'],
    grid: { top: 42, right: 46, bottom: 34, left: 38 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(11, 31, 56, .94)', borderWidth: 0, textStyle: { color: '#fff' } },
    legend: { top: 4, right: 8, itemWidth: 10, itemHeight: 7, textStyle: { color: '#65758b', fontSize: 11 } },
    xAxis: { type: 'category', data: trend.map(day => day.label), axisLine: { lineStyle: { color: '#dce5f0' } }, axisTick: { show: false }, axisLabel: { color: '#7a8ba1' } },
    yAxis: [
      { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef3f8' } }, axisLabel: { color: '#7a8ba1' } },
      { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: '#7a8ba1' }, splitLine: { show: false } },
    ],
    series: [
      { name: '成功', type: 'bar', stack: 'tasks', barMaxWidth: 22, data: trend.map(day => day.success), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { name: '异常', type: 'bar', stack: 'tasks', barMaxWidth: 22, data: trend.map(day => day.failed), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { name: '处理中', type: 'bar', stack: 'tasks', barMaxWidth: 22, data: trend.map(day => day.other), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { name: '成功率', type: 'line', yAxisIndex: 1, smooth: true, connectNulls: false, symbolSize: 7, data: trend.map(day => day.successRate), lineStyle: { width: 3 }, areaStyle: { opacity: .06 } },
    ],
  };
  const scenarioOption = {
    color: scenarioPalette,
    title: { text: String(scenarioTotal), subtext: '任务总数', left: 'center', top: '36%', textAlign: 'center', textStyle: { color: '#173d65', fontSize: 27, fontWeight: 750 }, subtextStyle: { color: '#8492a6', fontSize: 11, lineHeight: 18 } },
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 个任务 · {d}%' },
    series: [{ type: 'pie', radius: ['50%', '76%'], center: ['50%', '52%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 }, label: { show: true, position: 'inside', formatter: '{c}', color: '#fff', fontSize: 12, fontWeight: 700 }, labelLine: { show: false }, emphasis: { scaleSize: 6 }, data: scenarioData }],
  };

  if (models.isLoading && tasks.isLoading) return <SectionLoading label="正在加载生产运行概况…" />;
  if (models.isError && tasks.isError) return <ErrorState title="工作台数据加载失败" description="当前无法获取模型和任务数据。" retry={() => { void models.refetch(); void tasks.refetch(); }} />;

  return <>
    <PageHeader title="生产运筹工作台" description="从业务场景和运行任务出发，优先处理运行中与异常任务。" extra={<Space><Button onClick={() => nav('/scenarios')}>从业务场景开始</Button><Button type="primary" onClick={() => nav('/tasks?create=1')}>发起优化任务</Button></Space>} />
    <MetricGrid>
      <MetricCard title="运行中任务" value={tasks.isLoading ? '-' : running.length} description="排队、校验、建模与求解" tone="amber" onClick={() => nav('/tasks')} />
      <MetricCard title="失败 / 无解" value={tasks.isLoading ? '-' : failed.length} description="待诊断和处理" tone={failed.length ? 'red' : 'neutral'} onClick={() => nav('/tasks')} />
      <MetricCard title="已发布模型" value={models.isLoading ? '-' : published} description="可用于发起任务" tone="blue" onClick={() => nav('/models')} />
      <MetricCard title="近 7 天任务" value={tasks.isLoading ? '-' : recentSevenDays.length} description={`成功率 ${successRate}`} tone="green" onClick={() => nav('/results')} />
    </MetricGrid>
    <Row gutter={[16, 16]} className="section-gap dashboard-operations-grid">
      <Col xs={24} xl={16} className="dashboard-analytics-column">
        <Card className="dashboard-chart-card dashboard-trend-card" title="任务运行态势" extra={<Tag color="blue">近 7 天</Tag>}>
          <div className="dashboard-chart-summary">
            <span><small>周期任务</small><strong>{recentSevenDays.length}</strong></span>
            <span><small>峰值日期</small><strong>{peakDay?.total ? `${peakDay.label} · ${peakDay.total}` : '-'}</strong></span>
            <span><small>平均耗时</small><strong>{formatDurationSeconds(averageDuration)}</strong></span>
          </div>
          <LazyEChart style={{ height: 278, minHeight: 278 }} option={trendOption} />
        </Card>
        <Card className="dashboard-chart-card dashboard-scene-card" title="业务场景结构" extra={<span className="dashboard-card-hint">按业务场景库统计</span>}>
          {scenarioData.length ? <div className="dashboard-scene-layout">
            <LazyEChart style={{ height: 230, minHeight: 230 }} option={scenarioOption} />
            <div className="dashboard-scene-ranking">
              <div className="dashboard-scene-ranking-head"><span>业务场景</span><span>任务 / 占比</span></div>
              {scenarioData.map((item, index) => {
                const percentage = scenarioTotal ? Math.round(item.value / scenarioTotal * 100) : 0;
                return <div className="dashboard-scene-rank" key={item.name}>
                  <div><span style={{ background: scenarioPalette[index] }} /><strong>{item.name}</strong><b>{item.value} <small>{percentage}%</small></b></div>
                  <div className="dashboard-scene-progress"><i style={{ width: `${percentage}%`, background: scenarioPalette[index] }} /></div>
                </div>;
              })}
            </div>
          </div> : <Empty description="暂无业务场景数据" />}
        </Card>
      </Col>
      <Col xs={24} xl={8} className="dashboard-activity-rail">
        <Card className="dashboard-rail-card" title="最近任务" extra={<Button type="link" size="small" onClick={() => nav('/tasks')}>全部任务</Button>}>
          {rows.length ? <div className="dashboard-activity-list">{rows.slice(0, 4).map(task => (
            <button type="button" className="dashboard-activity-entry" key={task.id} title={isTaskFailed(task.status) ? failureReason(task) : String(task.scene || task.model || '')} onClick={() => nav(`/tasks?task=${task.id}`)}>
              <span><strong>{task.model || task.id}</strong><small>{shortTime(task.started_at || task.created_at)} · {formatDurationSeconds(task.duration_seconds)}</small></span>
              <StatusTag status={task.status} />
            </button>
          ))}</div> : <Empty description="暂无任务数据" />}
        </Card>
        <Card className="dashboard-rail-card" title="最近使用模型">
          {(models.data || []).length ? <div className="dashboard-model-list dashboard-model-list-compact">{(models.data || []).slice(0, 4).map(model => <button type="button" className="dash-entry dashboard-model-entry" key={model.id} onClick={() => nav(`/tasks?create=1&model=${encodeURIComponent(model.id)}&scene=${encodeURIComponent(model.scene || '')}`)}><span><strong>{model.name}</strong><p>{model.scene || '未标注场景'} · {model.version || '当前版本'}</p></span><Tag>发起任务</Tag></button>)}</div> : <Empty description="暂无可用模型" />}
        </Card>
      </Col>
    </Row>
    <Card title="求解能力摘要" className="section-gap" extra={<Button type="link" onClick={() => nav('/runtime')}>查看完整求解环境</Button>}>
      <Space wrap><Tag color={solvers.data?.highs?.available ? 'green' : 'orange'}>HiGHS：{solvers.data?.highs?.available ? '可用' : '未就绪'}</Tag><Tag color={solvers.data?.ipopt?.available ? 'green' : 'orange'}>Ipopt：{solvers.data?.ipopt?.available ? '可用' : '未配置'}</Tag><Tag>LP</Tag><Tag>MILP</Tag><Tag>PWL</Tag><Tag>McCormick</Tag><Tag>连续 NLP</Tag></Space>
    </Card>
  </>;
}
