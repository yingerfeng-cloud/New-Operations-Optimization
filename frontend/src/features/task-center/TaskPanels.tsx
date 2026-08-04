import { Alert, Button, Card, Descriptions, Empty, Progress, Space, Table, Tabs, Tag, Timeline } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { LazyEChart } from '../../components/LazyEChart';
import { JsonViewer } from '../../components/JsonViewer';
import { StatusTag } from '../../components/StatusTag';
import type { SolveResult } from '../../types/result';
import { resultLabel, type ResultLabelMap } from '../result-center/resultLabels';
import type { SolveTask, SolverProgressEvent, SolverProgressTrace, TaskStageTiming } from '../../types/task';
import { formatDurationSeconds } from '../../utils/formatDuration';
import { isTaskRetryable, isTaskRunning } from './taskStatus';
import { isTaskFailed } from './taskStatus';

type Row = Record<string, unknown> & { __row_key?: string };

const stageLabels: Array<[string, string]> = [
  ['PENDING', '排队'],
  ['VALIDATING', '参数校验'],
  ['BUILDING_MODEL', '建模'],
  ['SOLVING', '求解'],
  ['FORMATTING_RESULT', '结果整理'],
  ['SUCCESS', '完成'],
];

const stageDurationTraceKeys: Record<string, string> = {
  VALIDATING: 'validation_seconds',
  BUILDING_MODEL: 'model_build_seconds',
  SOLVING: 'solve_seconds',
  FORMATTING_RESULT: 'format_seconds',
};

export function isRunningStatus(status?: string) {
  return isTaskRunning(status);
}

export function isRetryableStatus(status?: string) {
  return isTaskRetryable(status);
}

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function rowsFromObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, item], index) => ({ key, value: item, __row_key: `${key}-${index}` }));
}

function rowsFromArrayOrObject(value: unknown, prefix: string): Row[] {
  if (Array.isArray(value)) return value.map((item, index) => typeof item === 'object' && item ? { ...(item as Row), __row_key: `${prefix}-${index}` } : { item, __row_key: `${prefix}-${index}` });
  return rowsFromObject(value);
}

function TaskVariableValue({ value, variable }: { value: unknown; variable: string }) {
  if (!value || typeof value !== 'object') return <span className="task-variable-scalar">{text(value)}</span>;
  if (Array.isArray(value)) return <div className="task-variable-json"><JsonViewer value={value} /></div>;
  const entries = Object.entries(value as Record<string, unknown>);
  const compact = entries.length > 0 && entries.every(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
  if (!compact) return <div className="task-variable-json"><JsonViewer value={value} /></div>;
  return (
    <div className="task-variable-values">
      {entries.map(([key, item]) => {
        const shortKey = key.startsWith(`${variable}[`) ? key.slice(variable.length) : key;
        return <div className="task-variable-value" key={key}><span title={key}>{shortKey}</span><strong>{text(item)}</strong></div>;
      })}
    </div>
  );
}

function statusColor(status: string, current: string) {
  if (current === 'SUCCESS') return 'green';
  if (['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(current)) return status === current ? 'red' : 'gray';
  const currentIndex = stageLabels.findIndex(([key]) => key === current);
  const statusIndex = stageLabels.findIndex(([key]) => key === status);
  return statusIndex <= currentIndex ? 'blue' : 'gray';
}

function stageTiming(task: SolveTask | undefined, status: string): TaskStageTiming {
  const trace = task?.trace || {};
  const timings = trace.stage_timings;
  const timing = timings && typeof timings === 'object' && !Array.isArray(timings)
    ? (timings as Record<string, TaskStageTiming>)[status]
    : undefined;
  const fallbackDuration = trace[stageDurationTraceKeys[status]];
  const durationSeconds = timing?.duration_seconds ?? (typeof fallbackDuration === 'number' ? fallbackDuration : undefined);
  if (timing) return { ...timing, duration_seconds: durationSeconds };
  if (status === 'PENDING') return { started_at: task?.created_at };
  if (status === 'SUCCESS') return { finished_at: task?.finished_at };
  return { duration_seconds: durationSeconds };
}

function StageTime({ task, status }: { task?: SolveTask; status: string }) {
  const timing = stageTiming(task, status);
  const details: string[] = [];
  if (timing.started_at && !(status === 'SUCCESS' && timing.finished_at === timing.started_at)) details.push(`开始：${timing.started_at}`);
  if (timing.finished_at && (timing.finished_at !== timing.started_at || status === 'SUCCESS')) details.push(`完成：${timing.finished_at}`);
  if (timing.duration_seconds !== undefined) details.push(`耗时：${formatDurationSeconds(timing.duration_seconds)}`);
  return <small className="task-stage-time">{details.length ? details.join(' · ') : '等待执行'}</small>;
}

export function TaskOverviewPanel({ task }: { task?: SolveTask }) {
  if (!task) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择任务" />;
  const status = String(task.status || '').toUpperCase();
  const trace = task.trace || {};
  const problemType = task.problem_type || trace.problem_type || (String(task.solver || '').toLowerCase().includes('ipopt') ? 'NLP' : '-');
  const isNlp = String(problemType).toUpperCase() === 'NLP' || String(task.solver || '').toLowerCase().includes('ipopt');
  const progressStatus = status === 'SUCCESS' ? 'success' : ['FAILED', 'TIMEOUT', 'CANCELLED', 'INFEASIBLE'].includes(status) ? 'exception' : 'active';
  return (
    <>
      <div className="task-overview-progress">
        <span><strong>任务进度</strong><small>{Math.max(0, Math.min(100, Number(task.progress || 0)))}%</small></span>
        <Progress percent={Math.max(0, Math.min(100, Number(task.progress || 0)))} status={progressStatus} showInfo={false} />
      </div>
      {task.resolution_warning && <Alert showIcon type="warning" title="模型解析提示" description={task.resolution_warning} className="compact-notice task-overview-alert" />}
      {task.error && <Alert showIcon type="error" title="任务错误" description={task.error} className="compact-notice task-overview-alert" />}
      {isNlp && <Alert showIcon type="warning" title="NLP 结果不承诺全局最优" description="Ipopt 用于连续变量 NLP，通常返回局部最优或求解器终止状态；请关注初值、上下界和约束违反摘要。" className="compact-notice task-overview-alert" />}
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="任务编号">{task.id}</Descriptions.Item>
        <Descriptions.Item label="状态"><StatusTag status={task.status} /></Descriptions.Item>
        <Descriptions.Item label="模型">{task.model}</Descriptions.Item>
        <Descriptions.Item label="模型ID">{task.resolved_model_id || task.model_id || '-'}</Descriptions.Item>
        <Descriptions.Item label="场景">{task.scene}</Descriptions.Item>
        <Descriptions.Item label="求解器">{task.solver || 'HiGHS'}</Descriptions.Item>
        <Descriptions.Item label="问题类型">{text(problemType)}</Descriptions.Item>
        <Descriptions.Item label="求解器可用性">{text(task.solver_available ?? trace.solver_available)}</Descriptions.Item>
        <Descriptions.Item label="终止状态">{text(task.termination_condition ?? trace.termination_condition)}</Descriptions.Item>
        <Descriptions.Item label="目标值">{text(task.cost)}</Descriptions.Item>
        <Descriptions.Item label="Gap">{text(task.gap)}</Descriptions.Item>
        <Descriptions.Item label="风险">{text(task.risk)}</Descriptions.Item>
        <Descriptions.Item label="重试次数">{text(task.retry_count || 0)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{task.created_at}</Descriptions.Item>
        <Descriptions.Item label="耗时">{formatDurationSeconds(task.duration_seconds)}</Descriptions.Item>
        <Descriptions.Item label="约束违反摘要">{text(task.constraint_violation_summary ?? trace.constraint_violation_summary)}</Descriptions.Item>
        <Descriptions.Item label="局部最优提示">{text(task.local_optimum_warning ?? trace.local_optimum_warning)}</Descriptions.Item>
      </Descriptions>
    </>
  );
}

export function TaskTimelinePanel({ task }: { task?: SolveTask }) {
  const current = String(task?.status || 'PENDING').toUpperCase();
  const stages = (
    <Timeline
      items={stageLabels.map(([key, label]) => ({
        color: statusColor(key, current),
        content: <div className="task-timeline-stage"><span>{label} <Tag>{key}</Tag></span><StageTime task={task} status={key} /></div>,
      }))}
    />
  );
  return <Tabs size="small" defaultActiveKey="stages" items={[
    { key: 'stages', label: '运行阶段', children: stages },
    { key: 'search', label: '最优解搜索', children: <SolverProgressPanel task={task} /> },
  ]} />;
}

function finiteNumber(value: unknown) {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function solverProgress(task?: SolveTask): SolverProgressTrace | undefined {
  const value = task?.trace?.solver_progress;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SolverProgressTrace : undefined;
}

function numericText(value: unknown) {
  const number = finiteNumber(value);
  return number === undefined ? '-' : number.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}

function gapText(value: unknown) {
  const gap = finiteNumber(value);
  if (gap === undefined) return '-';
  return `${Number((gap * 100).toFixed(gap < 0.01 ? 3 : 2))}%`;
}

function elapsedText(value: unknown) {
  const seconds = finiteNumber(value);
  return seconds === undefined ? '-' : seconds === 0 ? '0 s' : formatDurationSeconds(seconds);
}

function eventColor(kind: string) {
  if (['optimality_proven', 'gap_milestone'].includes(kind)) return 'green';
  if (['search_failed', 'infeasible_proven', 'monitoring_unavailable'].includes(kind)) return 'red';
  if (['first_feasible', 'incumbent_improved'].includes(kind)) return 'blue';
  return 'gray';
}

function taskIsTerminal(task?: SolveTask) {
  return ['SUCCESS', 'FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(String(task?.status || '').toUpperCase());
}

function missingProgressDescription(task?: SolveTask) {
  if (!task) return '请选择任务';
  if (taskIsTerminal(task)) return '该任务执行时后端尚未启用最优解搜索采集，真实历史轨迹无法补录；请重新运行任务获取数据。';
  return '任务进入求解阶段后，将在这里展示求解器返回的真实求解轨迹。';
}

function progressStatus(progress?: SolverProgressTrace, task?: SolveTask) {
  if (!progress && taskIsTerminal(task)) return { type: 'warning' as const, title: '该历史任务没有搜索轨迹' };
  if (!progress) return { type: 'info' as const, title: '尚无最优解搜索数据' };
  if (progress.supported === false) return { type: 'warning' as const, title: '当前任务没有详细迭代轨迹' };
  if (progress.status === 'FAILED') return { type: 'error' as const, title: '最优解搜索异常终止' };
  if (progress.status === 'RUNNING' || progress.status === 'WAITING') return { type: 'info' as const, title: '正在接收真实求解数据' };
  return { type: 'success' as const, title: '最优解搜索已完成' };
}

export function SolverProgressPanel({ task }: { task?: SolveTask }) {
  const progress = solverProgress(task);
  const points = useMemo(() => (progress?.points || []).filter(point => finiteNumber(point.elapsed_seconds) !== undefined), [progress?.points]);
  const isLpIteration = progress?.search_mode === 'LP_ITERATION' || points.some(point => finiteNumber(point.iteration_count) !== undefined);
  const latestPoint = points.at(-1);
  const latest = { ...latestPoint, ...(progress?.latest || {}) };
  const events = (progress?.events || []).slice(-8);
  const [visibleCount, setVisibleCount] = useState(points.length);
  const [replaying, setReplaying] = useState(false);
  useEffect(() => { if (!replaying) setVisibleCount(points.length); }, [points.length, replaying]);
  useEffect(() => {
    if (!replaying) return;
    if (visibleCount >= points.length) { setReplaying(false); return; }
    const step = Math.max(1, Math.ceil(points.length / 60));
    const timer = window.setTimeout(() => setVisibleCount(count => Math.min(points.length, count + step)), 180);
    return () => window.clearTimeout(timer);
  }, [points.length, replaying, visibleCount]);
  const renderedPoints = replaying ? points.slice(0, visibleCount) : points;
  const state = progressStatus(progress, task);
  const chartPoints = isLpIteration
    ? renderedPoints.filter(point => finiteNumber(point.iteration_count) !== undefined)
    : renderedPoints;
  const labels = chartPoints.map(point => `${Number(point.elapsed_seconds.toFixed(3))} s`);
  const option = isLpIteration ? {
    animationDuration: 0,
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut' as const,
    color: ['#1677ff'],
    grid: { top: 50, right: 36, bottom: chartPoints.length > 80 ? 68 : 42, left: 72 },
    tooltip: { trigger: 'axis' },
    legend: { top: 8 },
    xAxis: { type: 'category', name: '求解时间', boundaryGap: false, data: labels },
    yAxis: { type: 'value', name: '累计迭代次数', min: 0, minInterval: 1 },
    dataZoom: chartPoints.length > 80 ? [{ type: 'inside', start: 65, end: 100 }, { type: 'slider', height: 18, bottom: 8, start: 65, end: 100 }] : undefined,
    series: [
      { name: '累计迭代次数', type: 'line', step: 'end', symbol: 'circle', symbolSize: 7, areaStyle: { opacity: 0.08 }, data: chartPoints.map(point => point.iteration_count ?? null) },
    ],
  } : {
    animationDuration: 0,
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut' as const,
    color: ['#1677ff', '#52c41a', '#faad14'],
    grid: { top: 50, right: 66, bottom: renderedPoints.length > 80 ? 68 : 42, left: 72 },
    tooltip: { trigger: 'axis' },
    legend: { top: 8, type: 'scroll' },
    xAxis: { type: 'category', name: '求解时间', boundaryGap: false, data: labels },
    yAxis: [
      { type: 'value', name: '目标值 / 最优界', scale: true },
      { type: 'value', name: 'Gap', min: 0, axisLabel: { formatter: '{value}%' } },
    ],
    dataZoom: renderedPoints.length > 80 ? [{ type: 'inside', start: 65, end: 100 }, { type: 'slider', height: 18, bottom: 8, start: 65, end: 100 }] : undefined,
    series: [
      { name: '当前最好解', type: 'line', step: 'end', symbol: 'circle', symbolSize: 7, connectNulls: true, data: renderedPoints.map(point => point.incumbent_objective ?? null) },
      { name: '理论最优界', type: 'line', step: 'end', symbol: 'diamond', symbolSize: 8, connectNulls: true, data: renderedPoints.map(point => point.best_bound ?? null) },
      { name: 'Gap', type: 'line', yAxisIndex: 1, symbol: 'triangle', symbolSize: 7, connectNulls: true, areaStyle: { opacity: 0.08 }, data: renderedPoints.map(point => finiteNumber(point.gap) === undefined ? null : Number(((point.gap || 0) * 100).toFixed(4))) },
    ],
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Alert showIcon type={state.type} title={state.title} description={progress?.message || missingProgressDescription(task)} />
      <div className="solver-progress-metrics">
        <div><span>{isLpIteration ? '最终目标值' : '当前最好解'}</span><strong>{numericText(latest.incumbent_objective)}</strong></div>
        <div><span>{isLpIteration ? '累计迭代次数' : '理论最优界'}</span><strong>{numericText(isLpIteration ? latest.iteration_count : latest.best_bound)}</strong></div>
        <div><span>{isLpIteration ? '求解算法' : '当前 Gap'}</span><strong>{isLpIteration ? (latest.algorithm || '-') : gapText(latest.gap)}</strong></div>
        <div><span>{isLpIteration ? '实际问题类型' : '搜索节点'}</span><strong>{isLpIteration ? 'LP / QP' : numericText(latest.node_count)}</strong></div>
        <div><span>求解时间</span><strong>{elapsedText(latest.elapsed_seconds)}</strong></div>
      </div>
      {chartPoints.length >= 2 ? (
        <Card
          size="small"
          className="solver-progress-chart"
          title={<Space size={8}><span>真实收敛轨迹</span>{progress?.status === 'RUNNING' && <Tag color="processing" className="solver-live-tag">实时</Tag>}</Space>}
          extra={progress?.status === 'COMPLETED' && <Button size="small" disabled={replaying} onClick={() => { setVisibleCount(1); setReplaying(true); }}>{replaying ? '重放中…' : '重放搜索过程'}</Button>}
        >
          <LazyEChart option={option} style={{ height: 360 }} ariaLabel={isLpIteration ? 'HiGHS 真实算法累计迭代次数曲线' : '最好可行解、理论最优界和 Gap 的真实求解收敛曲线'} />
        </Card>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={progress?.message || missingProgressDescription(task)} />
      )}
      {events.length > 0 && <Card size="small" title="关键搜索事件"><Timeline items={events.map((event: SolverProgressEvent, index) => ({
        color: eventColor(event.kind),
        content: <div className="solver-progress-event" key={`${event.kind}-${event.elapsed_seconds}-${index}`}><strong>{event.label}</strong><small>{elapsedText(event.elapsed_seconds)}{event.value !== undefined && event.value !== null ? ` · ${numericText(event.value)}` : ''}</small></div>,
      }))} /></Card>}
    </Space>
  );
}

export function TaskInputPanel({ task }: { task?: SolveTask }) {
  const trace = task?.trace || {};
  const parameters = (task?.runtime_parameters || task?.parameters || trace.runtime_parameters || {}) as Record<string, unknown>;
  const horizon = task?.horizon ?? parameters.horizon ?? trace.horizon;
  return (
    <><Descriptions bordered size="small" column={2} items={[
      { key: 'model', label: '模型', children: task?.model || task?.model_id || '-' }, { key: 'scene', label: '场景', children: task?.scene || '-' },
      { key: 'version', label: '版本', children: text(task?.model_version || trace.model_version) }, { key: 'solver', label: '求解器', children: task?.solver || '-' },
      { key: 'horizon', label: 'horizon', children: text(horizon) }, { key: 'interval', label: '时间粒度', children: text(task?.interval_minutes || trace.interval_minutes) },
      { key: 'source', label: '数据来源', children: text(task?.data_source || trace.data_source || '手工录入') }, { key: 'submitted', label: '提交时间', children: task?.created_at || '-' },
    ]} />
    <Card size="small" title="业务参数" className="section-gap"><Table size="small" pagination={false} rowKey="__row_key" dataSource={rowsFromObject(parameters)} columns={[{ title: '参数', dataIndex: 'key' }, { title: '规模', dataIndex: 'value', render: value => Array.isArray(value) ? `${value.length} 项` : typeof value === 'object' && value ? `${Object.keys(value).length} 项` : '-' }, { title: '值 / 预览', dataIndex: 'value', render: value => <JsonViewer value={value} /> }]} /></Card>
    {Boolean(task?.advanced_config || trace.advanced_config) && <Card size="small" title="高级配置" className="section-gap"><JsonViewer value={task?.advanced_config || trace.advanced_config} /></Card>}</>
  );
}

export function TaskLogsPanel({ task }: { task?: SolveTask }) {
  const logs = task?.recent_logs || [];
  return logs.length ? <Timeline items={logs.map((log, index) => ({ content: log, color: index === logs.length - 1 ? 'blue' : 'gray' }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无求解日志" />;
}

function TaskResultName({ code, labelMap }: { code: unknown; labelMap?: ResultLabelMap }) {
  const technicalCode = String(code || '-');
  const label = resultLabel(technicalCode, labelMap);
  return <span className="result-field-name"><span>{label}</span>{label !== technicalCode && <small>{technicalCode}</small>}</span>;
}

export function TaskResultPanel({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务完成后展示结果" />;
  const variables = result.variables || result.variable_values || {};
  const metrics = result.metrics || {};
  return (
    <>
      <Card size="small" title="关键指标">
        <Table size="small" pagination={false} rowKey="__row_key" dataSource={rowsFromObject(metrics)} columns={[{ title: '指标', dataIndex: 'key', render: value => <TaskResultName code={value} labelMap={labelMap} /> }, { title: '值', dataIndex: 'value', render: text }]} />
      </Card>
      <Card size="small" title="变量结果" className="section-gap">
        <Table
          className="task-variable-table"
          size="small"
          tableLayout="fixed"
          pagination={false}
          rowKey="__row_key"
          dataSource={rowsFromObject(variables)}
          columns={[
            { title: '变量', dataIndex: 'key', width: 180, render: value => <TaskResultName code={value} labelMap={labelMap} /> },
            { title: '结果', dataIndex: 'value', render: (value, row) => <TaskVariableValue value={value} variable={String(row.key || '')} /> },
          ]}
        />
      </Card>
    </>
  );
}

export function TaskExplanationPanel({ task, result }: { task?: SolveTask; result?: SolveResult }) {
  const taskError = task?.error && typeof task.error === 'object' ? (task.error as Record<string, unknown>).message : undefined;
  const explanation = result?.explanation_structured || result?.business_explanation || result?.explanation || task?.explanation_structured || task?.business_explanation || task?.explanation || task?.structured_diagnostic || task?.diagnostics || taskError;
  const supporting = { warnings: task?.warnings, risk_notes: task?.risk_notes, precheck_errors: task?.precheck_errors, infeasibility_diagnosis: task?.infeasibility_diagnosis, solver_diagnostic: task?.solver_diagnostic };
  if (!explanation && !Object.values(supporting).some(value => value !== undefined && value !== null && value !== '')) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无业务解释，请查看技术日志" />;
  const actions = task && isTaskFailed(task.status) ? <Space wrap className="section-gap"><Button href={`/tasks?create=1&model=${encodeURIComponent(String(task.model_id || task.resolved_model_id || ''))}`}>修改参数重新提交</Button><Button href={`/models/${encodeURIComponent(String(task.model_id || task.resolved_model_id || ''))}`}>查看模型</Button><Button href="/runtime">检查求解环境</Button></Space> : null;
  if (typeof explanation === 'string') return <><Alert className="compact-notice" showIcon type="info" title="主要原因" description={explanation} />{actions}</>;
  const obj = explanation && typeof explanation === 'object' ? explanation as Record<string, unknown> : {};
  return (
    <>
      <Alert className="compact-notice" showIcon type="info" title="结果解释" description={text(obj.summary || result?.suggestion || '已生成任务诊断，请结合参数、约束和技术日志复核。')} />
      <Card size="small" title="结构化解释" className="section-gap">
        <JsonViewer value={Object.keys(obj).length ? obj : supporting} />
      </Card>
      {Boolean(result?.evidence_package) && <Card size="small" title="EvidencePackage" className="section-gap"><JsonViewer value={result?.evidence_package} /></Card>}
      {actions}
    </>
  );
}

export function ResultVariableTable({ value, title = '变量结果' }: { value: unknown; title?: string }) {
  return (
    <Card size="small" title={title}>
      <Table size="small" pagination={{ pageSize: 6 }} rowKey="__row_key" dataSource={rowsFromArrayOrObject(value, title)} columns={[
        { title: '项目', dataIndex: 'key', render: (value, row) => text(value || row.name || row.variable || row.item) },
        { title: '值', dataIndex: 'value', render: (value, row) => text(value ?? row.result ?? row.amount ?? row.output) },
      ]} />
    </Card>
  );
}
