import { Button, Card, Empty, Space, Tag, Tooltip, theme } from 'antd';
import { ArrowRightOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
import { PLATFORM_TAGLINE } from '../../app/brand';
import { taskTrendOption } from './dashboardCharts';

const callable = new Set(['PUBLISHED', 'ACTIVE', 'ONLINE', 'READY']);
const TREND_WINDOWS = [7, 14, 30] as const;
type TrendWindow = typeof TREND_WINDOWS[number];
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
  const { token } = theme.useToken();
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(7);
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
  const trendDays = Array.from({ length: trendWindow }, (_, offset) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (trendWindow - 1 - offset));
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
  const scenarioPalette = ['#466bc4', '#5aa68e', '#8e82bd', '#c6a26a', '#78a8b8', '#98a5b8'];
  const peakDay = trend.reduce((peak, day) => day.total > peak.total ? day : peak, trend[0]);
  const trendTaskCount = trend.reduce((sum, day) => sum + day.total, 0);
  const completedTrendTasks = rows.filter(task => trend.some(day => day.key === dateKey(task.created_at)) && normalizeTaskStatus(task.status) === 'SUCCESS');
  const completedDurations = completedTrendTasks.map(task => Number(task.duration_seconds)).filter(value => Number.isFinite(value) && value >= 0);
  const averageDuration = completedDurations.length ? completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length : undefined;
  const trendOption = taskTrendOption(trend, token.fontFamily);
  const scenarioOption = {
    animation: false,
    textStyle: { fontFamily: token.fontFamily },
    color: scenarioPalette,
    title: { text: String(scenarioTotal), subtext: '任务总数', left: '50%', top: '35%', textAlign: 'center', textStyle: { color: token.colorText, fontSize: 24, fontWeight: 600 }, subtextStyle: { color: '#8995a8', fontSize: 11, lineHeight: 18 } },
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 个任务 · {d}%', backgroundColor: '#fff', borderColor: '#e5eaf2', textStyle: { color: '#53637e', fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 8px 28px #20314914;' },
    series: [{ type: 'pie', radius: ['66%', '84%'], center: ['50%', '50%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 4 }, label: { show: false }, labelLine: { show: false }, emphasis: { scale: false }, data: scenarioData }],
  };

  if (models.isLoading && tasks.isLoading) return <SectionLoading label="正在加载生产运行概况…" />;
  if (models.isError && tasks.isError) return <ErrorState title="工作台数据加载失败" description="当前无法获取模型和任务数据。" retry={() => { void models.refetch(); void tasks.refetch(); }} />;

  return <>
    <PageHeader title="生产运筹工作台" description={`${PLATFORM_TAGLINE} 从业务场景和运行任务出发，优先处理运行中与异常任务。`} extra={<Space><Button onClick={() => nav('/scenarios')}>从业务场景开始</Button><Button type="primary" onClick={() => nav('/tasks?create=1')}>发起优化任务</Button></Space>} />
    <section className="dashboard-overview" aria-label="生产运行概况">
      <MetricGrid>
        <MetricCard title="运行中任务" value={tasks.isLoading ? '-' : running.length} description="排队、校验、建模与求解" tone="amber" onClick={() => nav('/tasks')} />
        <MetricCard title="失败 / 无解" value={tasks.isLoading ? '-' : failed.length} description="待诊断和处理" tone={failed.length ? 'red' : 'neutral'} onClick={() => nav('/tasks')} />
        <MetricCard title="已发布模型" value={models.isLoading ? '-' : published} description="可用于发起任务" tone="blue" onClick={() => nav('/models')} />
        <MetricCard title="近 7 天任务" value={tasks.isLoading ? '-' : recentSevenDays.length} description={`成功率 ${successRate}`} tone="green" onClick={() => nav('/results')} />
      </MetricGrid>
    </section>
    <div className="section-gap dashboard-operations-grid">
      <Card className="dashboard-chart-card dashboard-trend-card" title={<div className="dashboard-card-heading"><span>任务运行态势</span><Tooltip trigger={['hover', 'focus']} title="按任务创建日期统计；无任务日期不计算成功率，折线保留断点。"><button type="button" className="dashboard-chart-help" aria-label="任务趋势统计说明"><InfoCircleOutlined /></button></Tooltip></div>} extra={<Space size={8}><div className="dashboard-trend-window" role="group" aria-label="任务运行态势统计窗口">{TREND_WINDOWS.map(window => <button key={window} type="button" className={trendWindow === window ? 'active' : ''} aria-pressed={trendWindow === window} onClick={() => setTrendWindow(window)}>近 {window} 天</button>)}</div></Space>}>
        <div className="dashboard-chart-summary">
          <span><small>任务总量</small><strong>{trendTaskCount}</strong></span>
          <span><small>峰值日期</small><strong>{peakDay?.total ? `${peakDay.label} · ${peakDay.total}` : '-'}</strong></span>
          <span><small>成功平均耗时</small><strong>{formatDurationSeconds(averageDuration)}</strong></span>
        </div>
        <LazyEChart style={{ height: 272, minHeight: 272 }} option={trendOption} ariaLabel={`近 ${trendWindow} 天任务量与成功率趋势`} />
      </Card>
      <Card className="dashboard-rail-card dashboard-tasks-card" title="最近任务" extra={<Button type="link" size="small" onClick={() => nav('/tasks')}>全部任务</Button>}>
        {rows.length ? <>
          <div className="dashboard-task-summary" aria-label="全部任务状态概览">
            <span>运行中 <b>{running.length}</b></span><span>异常 <b>{failed.length}</b></span><span>成功 <b>{success.length}</b></span>
          </div>
          <div className="dashboard-activity-list">{rows.slice(0, 6).map(task => (
            <button type="button" className="dashboard-activity-entry" key={task.id} title={isTaskFailed(task.status) ? failureReason(task) : String(task.scene || task.model || '')} onClick={() => nav(`/tasks?task=${encodeURIComponent(task.id)}`)}>
              <span className="dashboard-entry-title"><strong title={task.model || task.id}>{task.model || task.id}</strong><StatusTag status={task.status} /></span>
              <span className="dashboard-entry-meta">
                <code title={task.id}>{task.id}</code>
                <time>{shortTime(task.started_at || task.created_at)}</time>
                {task.solver && <span>{task.solver}</span>}
                <span className="dashboard-task-measure">{isTaskRunning(task.status) && Number.isFinite(task.progress) ? `进度 ${Math.round(task.progress)}%` : <>耗时 {formatDurationSeconds(task.duration_seconds)}</>}</span>
              </span>
            </button>
          ))}</div>
        </> : <Empty description="暂无任务数据" />}
      </Card>
      <Card className="dashboard-chart-card dashboard-scene-card" title="业务场景结构" extra={<span className="dashboard-card-hint">按业务场景库统计</span>}>
        {scenarioData.length ? <div className="dashboard-scene-layout">
          <LazyEChart style={{ height: 180, minHeight: 180 }} option={scenarioOption} ariaLabel="业务场景任务占比" />
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
      <Card className="dashboard-rail-card dashboard-models-card" title="最近使用模型" extra={<Button type="link" size="small" onClick={() => nav('/models')}>全部模型</Button>}>
        {(models.data || []).length ? <div className="dashboard-model-list dashboard-model-list-compact">{(models.data || []).slice(0, 5).map(model => (
          <button type="button" className="dash-entry dashboard-model-entry" key={model.id} onClick={() => nav(`/tasks?create=1&model=${encodeURIComponent(model.id)}&scene=${encodeURIComponent(model.scene || '')}`)}>
            <span className="dashboard-entry-main">
              <strong title={model.name}>{model.name}</strong>
              <span className="dashboard-model-meta">
                <span className="dashboard-model-scene" title={model.scene || '未标注场景'}>{model.scene || '未标注场景'}</span>
                <span>{model.version || '当前版本'}</span>
                {model.solver && <span>{model.solver}</span>}
                <StatusTag status={model.status} />
              </span>
            </span>
            <span className="dashboard-model-action">发起任务 <ArrowRightOutlined aria-hidden /></span>
          </button>
        ))}</div> : <Empty description="暂无可用模型" />}
      </Card>
    </div>
    <Card title="求解能力摘要" className="section-gap" extra={<Button type="link" onClick={() => nav('/runtime')}>查看完整求解环境</Button>}>
      <Space wrap><Tag color={solvers.data?.highs?.available ? 'green' : 'orange'}>HiGHS：{solvers.data?.highs?.available ? '可用' : '未就绪'}</Tag><Tag color={solvers.data?.ipopt?.available ? 'green' : 'orange'}>Ipopt：{solvers.data?.ipopt?.available ? '可用' : '未配置'}</Tag><Tag>LP</Tag><Tag>MILP</Tag><Tag>PWL</Tag><Tag>McCormick</Tag><Tag>连续 NLP</Tag></Space>
    </Card>
  </>;
}
