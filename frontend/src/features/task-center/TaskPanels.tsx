import { Alert, Button, Card, Descriptions, Empty, Progress, Space, Table, Tag, Timeline } from 'antd';
import { JsonViewer } from '../../components/JsonViewer';
import { StatusTag } from '../../components/StatusTag';
import type { SolveResult } from '../../types/result';
import type { SolveTask } from '../../types/task';
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

function statusColor(status: string, current: string) {
  if (current === 'SUCCESS') return 'green';
  if (['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(current)) return status === current ? 'red' : 'gray';
  const currentIndex = stageLabels.findIndex(([key]) => key === current);
  const statusIndex = stageLabels.findIndex(([key]) => key === status);
  return statusIndex <= currentIndex ? 'blue' : 'gray';
}

export function TaskOverviewPanel({ task }: { task?: SolveTask }) {
  if (!task) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择任务" />;
  const status = String(task.status || '').toUpperCase();
  const trace = task.trace || {};
  const problemType = task.problem_type || trace.problem_type || (String(task.solver || '').toLowerCase().includes('ipopt') ? 'NLP' : '-');
  const isNlp = String(problemType).toUpperCase() === 'NLP' || String(task.solver || '').toLowerCase().includes('ipopt');
  return (
    <>
      {task.resolution_warning && <Alert showIcon type="warning" title="模型解析提示" description={task.resolution_warning} className="section-gap" />}
      {task.error && <Alert showIcon type="error" title="任务错误" description={task.error} className="section-gap" />}
      {isNlp && <Alert showIcon type="warning" title="NLP 结果不承诺全局最优" description="Ipopt 用于连续变量 NLP，通常返回局部最优或求解器终止状态；请关注初值、上下界和约束违反摘要。" className="section-gap" />}
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
        <Descriptions.Item label="耗时">{task.duration_seconds === undefined ? '-' : `${task.duration_seconds}s`}</Descriptions.Item>
        <Descriptions.Item label="约束违反摘要">{text(task.constraint_violation_summary ?? trace.constraint_violation_summary)}</Descriptions.Item>
        <Descriptions.Item label="局部最优提示">{text(task.local_optimum_warning ?? trace.local_optimum_warning)}</Descriptions.Item>
      </Descriptions>
      <Card size="small" title="任务进度" className="section-gap">
        <Progress percent={Math.max(0, Math.min(100, Number(task.progress || 0)))} status={status === 'SUCCESS' ? 'success' : ['FAILED', 'TIMEOUT', 'CANCELLED', 'INFEASIBLE'].includes(status) ? 'exception' : 'active'} />
      </Card>
    </>
  );
}

export function TaskTimelinePanel({ task }: { task?: SolveTask }) {
  const current = String(task?.status || 'PENDING').toUpperCase();
  return (
    <Timeline
      items={stageLabels.map(([key, label]) => ({
        color: statusColor(key, current),
        content: <span>{label} <Tag>{key}</Tag></span>,
      }))}
    />
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

export function TaskResultPanel({ result }: { result?: SolveResult }) {
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务完成后展示结果" />;
  const variables = result.variables || result.variable_values || {};
  const metrics = result.metrics || {};
  return (
    <>
      <Card size="small" title="关键指标">
        <Table size="small" pagination={false} rowKey="__row_key" dataSource={rowsFromObject(metrics)} columns={[{ title: '指标', dataIndex: 'key' }, { title: '值', dataIndex: 'value', render: text }]} />
      </Card>
      <Card size="small" title="变量结果" className="section-gap">
        <Table size="small" pagination={false} rowKey="__row_key" dataSource={rowsFromObject(variables)} columns={[{ title: '变量', dataIndex: 'key' }, { title: '结果', dataIndex: 'value', render: text }]} />
      </Card>
    </>
  );
}

export function TaskExplanationPanel({ task, result }: { task?: SolveTask; result?: SolveResult }) {
  const taskError = task?.error && typeof task.error === 'object' ? (task.error as Record<string, unknown>).message : undefined;
  const explanation = result?.business_explanation || result?.explanation || task?.business_explanation || task?.explanation || task?.structured_diagnostic || task?.diagnostics || taskError;
  const supporting = { warnings: task?.warnings, risk_notes: task?.risk_notes, precheck_errors: task?.precheck_errors, infeasibility_diagnosis: task?.infeasibility_diagnosis, solver_diagnostic: task?.solver_diagnostic };
  if (!explanation && !Object.values(supporting).some(value => value !== undefined && value !== null && value !== '')) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无业务解释，请查看技术日志" />;
  const actions = task && isTaskFailed(task.status) ? <Space wrap className="section-gap"><Button href={`/tasks?create=1&model=${encodeURIComponent(String(task.model_id || task.resolved_model_id || ''))}`}>修改参数重新提交</Button><Button href={`/models/${encodeURIComponent(String(task.model_id || task.resolved_model_id || ''))}`}>查看模型</Button><Button href="/runtime">检查求解环境</Button></Space> : null;
  if (typeof explanation === 'string') return <><Alert showIcon type="info" title="主要原因" description={explanation} />{actions}</>;
  const obj = explanation && typeof explanation === 'object' ? explanation as Record<string, unknown> : {};
  return (
    <>
      <Alert showIcon type="info" title="结果解释" description={text(obj.summary || result?.suggestion || '已生成任务诊断，请结合参数、约束和技术日志复核。')} />
      <Card size="small" title="诊断详情" className="section-gap">
        <JsonViewer value={result?.business_output || (Object.keys(obj).length ? obj : supporting)} />
      </Card>
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
