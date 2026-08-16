import { Button, Empty, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { AgentAnalyzeResponse, AgentRun, AgentRunStatus, AgentV3Event, AgentV3Task, AgentV3Turn } from '../../types/agent';
import { valueText } from './AgentPanels';

const statusMeta: Record<string, { label: string; color: string; step: number }> = {
  DRAFT: { label: '草稿', color: 'default', step: 0 },
  ROUTING: { label: '识别场景', color: 'processing', step: 0 },
  CLARIFICATION: { label: '等待补充', color: 'warning', step: 0 },
  WAITING_INPUT: { label: '等待补充', color: 'warning', step: 1 },
  PENDING: { label: '待处理', color: 'default', step: 0 },
  PARAMETER_REVIEW: { label: '检查参数', color: 'processing', step: 1 },
  APPROVAL_REQUIRED: { label: '等待确认', color: 'warning', step: 2 },
  READY: { label: '可以提交', color: 'cyan', step: 2 },
  QUEUED: { label: '排队中', color: 'processing', step: 3 },
  RUNNING: { label: '求解中', color: 'processing', step: 3 },
  SUCCEEDED: { label: '已完成', color: 'success', step: 4 },
  FAILED: { label: '失败', color: 'error', step: 4 },
  CANCELLED: { label: '已取消', color: 'default', step: 4 },
};

const steps = ['识别场景', '检查参数', '人工确认', '模型求解', '生成结果'];

export function runStatusMeta(status?: string) {
  return statusMeta[String(status || '').toUpperCase()] || { label: status || '未开始', color: 'default', step: -1 };
}

const turnStatusMeta: Record<string, { label: string; color: string }> = {
  RUNNING: { label: 'Agent 正在处理', color: 'processing' },
  SUCCEEDED: { label: '已回复', color: 'success' },
  FAILED: { label: '本轮失败', color: 'error' },
  INTERRUPTED: { label: '处理已中断', color: 'warning' },
};

export function agentTurnStatusMeta(status?: string) {
  return turnStatusMeta[String(status || '').toUpperCase()] || { label: status || '未开始', color: 'default' };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseTime(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timeValue(...values: Array<string | undefined>) {
  for (const value of values) {
    const parsed = parseTime(value);
    if (parsed !== undefined) return parsed;
  }
  return 0;
}

function newestTurns(turns: AgentV3Turn[]) {
  return [...turns].sort((left, right) => timeValue(right.completed_at, right.updated_at, right.started_at, right.created_at)
    - timeValue(left.completed_at, left.updated_at, left.started_at, left.created_at));
}

function elapsedLabel(start?: string, end?: string) {
  const started = parseTime(start);
  const completed = parseTime(end);
  if (started === undefined || completed === undefined || completed < started) return undefined;
  return `${((completed - started) / 1000).toFixed(1)} 秒`;
}

function taskStatusMeta(task: AgentV3Task) {
  if (task.completion_reason === 'WORKFLOW_SWITCHED') return { label: '已切换', color: 'default', step: 4 };
  return runStatusMeta(task.status);
}

function taskResult(task: AgentV3Task) {
  return recordValue(task.result);
}

function taskLabel(task: AgentV3Task, run?: AgentRun) {
  const result = taskResult(task);
  const currentSkill = String(result.agent_skill_name || result.resolved_skill_name || result.api_skill_name || '');
  const candidates = Array.isArray(result.candidate_skills) ? result.candidate_skills : [];
  const selectedCandidate = candidates
    .map(recordValue)
    .find(candidate => [candidate.agent_skill_name, candidate.platform_skill_name, candidate.api_skill_name]
      .map(value => String(value || ''))
      .includes(currentSkill));
  return String(
    result.display_name
    || result.agent_skill_display_name
    || selectedCandidate?.display_name
    || result.agent_skill_name
    || run?.title
    || task.title
    || '未命名工作流',
  );
}

function eventInvocation(event: AgentV3Event) {
  return recordValue(recordValue(event.payload).invocation);
}

function eventTask(event: AgentV3Event) {
  return recordValue(recordValue(event.payload).task);
}

function eventToolName(event: AgentV3Event) {
  return String(eventInvocation(event).tool_name || 'Agent 工具');
}

function turnTaskIds(turn: AgentV3Turn, events: AgentV3Event[]) {
  const ids = new Set(turn.task_ids || []);
  events.forEach(event => {
    if (event.turn_id === turn.turn_id && event.task_id) ids.add(event.task_id);
  });
  return [...ids];
}

function turnSemanticMeta(turn: AgentV3Turn, events: AgentV3Event[]) {
  if (turn.status !== 'SUCCEEDED') return agentTurnStatusMeta(turn.status);
  const turnEvents = events.filter(event => event.turn_id === turn.turn_id);
  if (turnEvents.some(event => event.type === 'tool.failed')) return { label: '工具调用失败', color: 'error' };
  if (turnEvents.some(event => event.type === 'approval.required')) return { label: '等待确认', color: 'warning' };
  if (turnTaskIds(turn, events).length || turnEvents.some(event => event.type === 'tool.completed')) {
    return { label: '已触发工作流', color: 'blue' };
  }
  if ((turn.attempt_count || 1) > 1) return { label: '重试后完成', color: 'success' };
  return { label: '仅完成问答', color: 'default' };
}

function parameterLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return valueText(value);
  const item = value as Record<string, unknown>;
  const name = String(item.name || item.parameter || item.key || '未命名参数');
  const key = item.key && String(item.key) !== name ? ` · ${String(item.key)}` : '';
  const unit = item.unit ? `（${String(item.unit)}）` : '';
  return `${name}${key}${unit}`;
}

function parameterValue(value: unknown) {
  const text = valueText(value);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function WorkflowTrace({ turn, events, taskId }: { turn: AgentV3Turn; events: AgentV3Event[]; taskId: string }) {
  const turnEvents = events.filter(event => event.turn_id === turn.turn_id && event.task_id === taskId);
  const toolStarts = turnEvents.filter(event => event.type === 'tool.started');
  const toolEnds = turnEvents.filter(event => ['tool.completed', 'tool.failed', 'tool.cancelled', 'tool.skipped'].includes(event.type));
  const firstTool = toolStarts[0];
  const lastTool = toolEnds.at(-1);
  const taskUpdate = [...turnEvents].reverse().find(event => event.type === 'task.updated');
  const updatedTask = taskUpdate ? eventTask(taskUpdate) : {};
  return (
    <div className="agent-workflow-trace" aria-label={`执行轨迹 ${turn.input || turn.turn_id}`}>
      <div className="agent-workflow-trace-step done">
        <i>1</i>
        <div><strong>识别请求与路由</strong><span>{elapsedLabel(turn.started_at, firstTool?.created_at) || '已完成'}</span></div>
      </div>
      {toolStarts.map((event, index) => {
        const invocation = eventInvocation(event);
        const invocationId = String(invocation.invocation_id || '');
        const completed = toolEnds.find(candidate => String(eventInvocation(candidate).invocation_id || '') === invocationId);
        const completeInvocation = completed ? eventInvocation(completed) : {};
        const status = completed?.type === 'tool.failed' ? 'error' : completed ? 'done' : 'active';
        return (
          <div className={`agent-workflow-trace-step ${status}`} key={event.event_id}>
            <i>{index + 2}</i>
            <div>
              <strong>工具执行 · {eventToolName(event)}</strong>
              <span>{elapsedLabel(String(invocation.created_at || event.created_at || ''), String(completeInvocation.updated_at || completed?.created_at || '')) || (completed ? '已完成' : '执行中')}</span>
            </div>
          </div>
        );
      })}
      <div className={`agent-workflow-trace-step ${turn.status === 'SUCCEEDED' ? 'done' : 'error'}`}>
        <i>{toolStarts.length + 2}</i>
        <div>
          <strong>生成回复</strong>
          <span>{elapsedLabel(lastTool?.created_at, turn.completed_at) || (turn.status === 'SUCCEEDED' ? '已完成' : '未完成')}{updatedTask.status ? ` · 工作流 ${runStatusMeta(String(updatedTask.status)).label}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

function WorkflowActivityCard({
  task,
  run,
  turns,
  events,
  current,
  expert,
}: {
  task: AgentV3Task;
  run?: AgentRun;
  turns: AgentV3Turn[];
  events: AgentV3Event[];
  current: boolean;
  expert: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const meta = taskStatusMeta(task);
  const taskEvents = events.filter(event => event.task_id === task.task_id);
  const invocationCount = taskEvents.filter(event => event.type === 'tool.started').length;
  const orderedTurns = newestTurns(turns);
  const visibleTurns = showHistory ? orderedTurns : orderedTurns.slice(0, 1);
  return (
    <details className="agent-workflow-card" open={current || undefined}>
      <summary>
        <div>
          <strong>{taskLabel(task, run)}</strong>
          <span>{task.updated_at || task.created_at || ''}</span>
        </div>
        <Tag color={meta.color}>{meta.label}</Tag>
      </summary>
      <div className="agent-workflow-card-body">
        <div className="agent-workflow-facts">
          <span>调用 {invocationCount || orderedTurns.length} 次</span>
          {expert && run?.model_id && <span>{run.model_id}</span>}
        </div>
        {visibleTurns.length ? visibleTurns.map(turn => (
          <article className="agent-workflow-trigger" key={turn.turn_id}>
            <div className="agent-workflow-trigger-heading">
              <strong>{turn.input || '未命名请求'}</strong>
              <small>{typeof turn.duration_ms === 'number' ? `${(turn.duration_ms / 1000).toFixed(1)} 秒` : ''}</small>
            </div>
            <WorkflowTrace turn={turn} events={events} taskId={task.task_id} />
          </article>
        )) : <Typography.Text type="secondary">暂无可展示的触发记录</Typography.Text>}
        {orderedTurns.length > 1 && (
          <Button className="agent-workflow-history-toggle" type="link" size="small" onClick={() => setShowHistory(value => !value)}>
            {showHistory ? '收起历史调用' : `查看历史调用（${orderedTurns.length - 1}）`}
          </Button>
        )}
      </div>
    </details>
  );
}

export function AgentWorkflowActivity({
  tasks,
  turns,
  events,
  runs,
  currentTaskId,
  expert = false,
}: {
  tasks?: AgentV3Task[];
  turns?: AgentV3Turn[];
  events?: AgentV3Event[];
  runs?: AgentRun[];
  currentTaskId?: string;
  expert?: boolean;
}) {
  const taskRows = useMemo(() => [...(tasks || [])].sort((left, right) => timeValue(right.updated_at, right.created_at)
    - timeValue(left.updated_at, left.created_at)), [tasks]);
  if (!taskRows.length) return null;
  return (
    <section className="agent-workflow-activity" aria-label="工作流活动">
      <div className="agent-activity-section-heading">
        <Typography.Text strong>工作流活动</Typography.Text>
        <Typography.Text type="secondary">{taskRows.length} 个工作流</Typography.Text>
      </div>
      <div className="agent-workflow-list">
        {taskRows.map(task => {
          const run = (runs || []).find(item => item.run_id === task.optimization_run_id)
            || (recordValue(task.result).run as AgentRun | undefined);
          const taskEvents = (events || []).filter(event => event.task_id === task.task_id);
          const boundTurnIds = (turns || [])
            .filter(turn => (turn.task_ids || []).includes(task.task_id))
            .map(turn => turn.turn_id);
          const fallbackEventTurnIds = taskEvents
            .filter(event => ['task.created', 'tool.started', 'tool.completed', 'tool.failed', 'tool.cancelled'].includes(event.type))
            .map(event => event.turn_id)
            .filter((turnId): turnId is string => Boolean(turnId));
          const relatedTurnIds = new Set(boundTurnIds.length ? boundTurnIds : fallbackEventTurnIds);
          const relatedTurns = (turns || []).filter(turn => relatedTurnIds.has(turn.turn_id));
          return (
            <WorkflowActivityCard
              key={task.task_id}
              task={task}
              run={run}
              turns={relatedTurns}
              events={events || []}
              current={task.task_id === currentTaskId}
              expert={expert}
            />
          );
        })}
      </div>
    </section>
  );
}

export function AgentExceptionActivity({ turns, events, retryingTurnId, onRetry }: {
  turns?: AgentV3Turn[];
  events?: AgentV3Event[];
  retryingTurnId?: string;
  onRetry?: (turn: AgentV3Turn) => void;
}) {
  const exceptionTurns = newestTurns((turns || []).filter(turn => {
    if (turnTaskIds(turn, events || []).length) return false;
    const turnEvents = (events || []).filter(event => event.turn_id === turn.turn_id);
    return ['FAILED', 'INTERRUPTED'].includes(turn.status)
      || Boolean(turn.retryable)
      || (turn.attempt_count || 1) > 1
      || turnEvents.some(event => event.type === 'tool.failed');
  }));
  if (!exceptionTurns.length) return null;
  return (
    <section className="agent-turn-activity" aria-label="异常与重试">
      <div className="agent-activity-section-heading">
        <Typography.Text strong>异常与重试</Typography.Text>
        <Typography.Text type="secondary">仅展示需要关注的对话轮次</Typography.Text>
      </div>
      <div className="agent-turn-activity-list">
        {exceptionTurns.map(turn => {
          const meta = turnSemanticMeta(turn, events || []);
          return (
            <article className={`agent-turn-activity-item ${String(turn.status).toLowerCase()}`} key={turn.turn_id}>
              <div className="agent-turn-activity-heading">
                <Tag color={meta.color}>{meta.label}</Tag>
                {typeof turn.duration_ms === 'number' && <small>{(turn.duration_ms / 1000).toFixed(1)} 秒</small>}
              </div>
              <strong>{turn.input || '未命名请求'}</strong>
              {(turn.attempt_count || 1) > 1 && <span>共尝试 {turn.attempt_count} 次，已自动重试 {(turn.attempt_count || 1) - 1} 次</span>}
              {turn.error?.message && <span>{turn.error.message}</span>}
              <small>{turn.completed_at || turn.started_at || ''}</small>
              {turn.retryable && onRetry && (
                <Button size="small" type="link" loading={retryingTurnId === turn.turn_id} onClick={() => onRetry(turn)}>重试本轮</Button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AgentRunInspector({
  run,
  task,
  response,
  turns,
  events,
  expert = false,
  onStartParameterInput,
  onBatchParameterInput,
}: {
  run?: AgentRun;
  task?: AgentV3Task;
  response?: AgentAnalyzeResponse;
  turns?: AgentV3Turn[];
  events?: AgentV3Event[];
  expert?: boolean;
  onStartParameterInput?: () => void;
  onBatchParameterInput?: () => void;
}) {
  if (!run) {
    return (
      <div className="agent-run-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待用户输入后创建优化运行" />
        <div className="agent-run-summary-row"><span>参数完整性</span><strong>尚未检查</strong></div>
      </div>
    );
  }
  const meta = runStatusMeta(run.status || run.workflow_state);
  const terminalError = run.status === 'FAILED' || run.status === 'CANCELLED';
  const taskEvents = (events || []).filter(event => !task || event.task_id === task.task_id);
  const relatedTurns = newestTurns((turns || []).filter(turn => !task || (turn.task_ids || []).includes(task.task_id)));
  const invocationCount = taskEvents.filter(event => event.type === 'tool.started').length || (run.invocation_id ? 1 : relatedTurns.length);
  const draft = response?.parameter_draft || run.parameter_draft || {};
  const sources = response?.parameter_sources || run.parameter_sources || {};
  const filledEntries = Object.entries(draft).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const missing = response?.missing_required || run.missing_required || [];
  const invalid = response?.invalid_parameters || run.invalid_parameters || [];
  const totalParameters = filledEntries.length + missing.length;
  const hasParameterDetails = filledEntries.length > 0 || missing.length > 0 || invalid.length > 0;
  const parametersReviewed = response?.parameter_draft !== undefined
    || response?.missing_required !== undefined
    || run.parameter_draft !== undefined
    || run.missing_required !== undefined
    || meta.step > 0;
  const latestUpdate = relatedTurns[0]?.completed_at || relatedTurns[0]?.updated_at || task?.updated_at || run.updated_at;
  return (
    <div className="agent-run-inspector">
      <div className="agent-run-heading">
        <div>
          <Typography.Text type="secondary">当前工作流</Typography.Text>
          <Typography.Title level={5}>{run.title || run.agent_skill_name || '优化运行'}</Typography.Title>
        </div>
        <Tag color={meta.color}>{meta.label}</Tag>
      </div>
      <div className="agent-run-steps" aria-label="运行进度">
        {steps.map((label, index) => {
          const state = index < meta.step ? 'done' : index === meta.step ? (terminalError ? 'error' : 'active') : 'pending';
          return <div className={`agent-run-step ${state}`} key={label}><i>{index + 1}</i><span>{label}</span></div>;
        })}
      </div>
      <div className="agent-current-workflow-facts" aria-label="当前工作流摘要">
        <span>调用 {invocationCount} 次</span>
        <span>{totalParameters ? `参数 ${filledEntries.length}/${totalParameters}` : parametersReviewed ? '参数已检查' : '参数待检查'}</span>
        {latestUpdate && <span>最近更新 {latestUpdate}</span>}
        {expert && run.model_id && <span>{run.model_id}</span>}
      </div>
      {hasParameterDetails && (
        <details className="agent-current-parameters">
          <summary>
            <div><strong>参数与校验</strong><span>{filledEntries.length ? `已填写 ${filledEntries.length} 项` : '尚未填写'}{missing.length ? ` · 缺失 ${missing.length} 项` : ''}</span></div>
            <span className="agent-parameter-expand-label">展开查看</span>
            <span className="agent-parameter-collapse-label">收起</span>
          </summary>
          <div className="agent-current-parameters-body">
            {missing.length > 0 && (
              <section>
                <strong>缺失参数</strong>
                <div className="agent-current-parameter-list">{missing.map((item, index) => <span key={`${parameterLabel(item)}-${index}`}>{parameterLabel(item)}</span>)}</div>
              </section>
            )}
            {filledEntries.length > 0 && (
              <section>
                <strong>已填写参数</strong>
                <dl>{filledEntries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{parameterValue(value)}{sources[key] ? <small>来源：{valueText(sources[key])}</small> : null}</dd></div>)}</dl>
              </section>
            )}
            {invalid.length > 0 && (
              <section className="is-error">
                <strong>校验问题</strong>
                <div className="agent-current-parameter-list">{invalid.map((item, index) => <span key={`${parameterLabel(item)}-${index}`}>{parameterLabel(item)}</span>)}</div>
              </section>
            )}
            {missing.length > 0 && (onStartParameterInput || onBatchParameterInput) && (
              <div className="agent-current-parameter-actions">
                {onBatchParameterInput && <Button type="primary" size="small" onClick={onBatchParameterInput}>批量补充参数</Button>}
                {onStartParameterInput && <Button size="small" onClick={onStartParameterInput}>填写下一个参数</Button>}
              </div>
            )}
          </div>
        </details>
      )}
      {run.error && <div className="agent-run-error">{run.error}</div>}
    </div>
  );
}

export function responseFromRun(run?: AgentRun) {
  if (!run) return undefined;
  return {
    conversation_id: run.conversation_id,
    run_id: run.run_id,
    workflow_state: run.workflow_state || run.status,
    status: run.status,
    response_type: run.response_type,
    intent: run.intent,
    agent_skill_name: run.agent_skill_name,
    api_skill_name: run.api_skill_name,
    resolved_skill_name: run.api_skill_name,
    parameter_draft: run.parameter_draft,
    parameter_sources: run.parameter_sources,
    missing_required: run.missing_required,
    invalid_parameters: run.invalid_parameters,
    can_use_default: run.default_candidates,
    requires_default_confirmation: run.status === 'APPROVAL_REQUIRED',
    ready_to_invoke: run.status === 'READY' || run.ready_to_invoke,
    invocation_id: run.invocation_id,
    objective_value: run.objective_value,
    result: run.result,
    route_confidence: run.route_confidence,
    selection_reason: run.selection_reason,
    agent_message: run.message,
    run,
  };
}

export function transientRunFromResponse(response: Record<string, unknown> | undefined): AgentRun | undefined {
  if (!response) return undefined;
  const workflow = String(response.workflow_state || response.status || 'ROUTING').toUpperCase();
  const status = workflow === 'READY_TO_INVOKE' ? 'READY'
    : workflow === 'DEFAULT_CONFIRMING' ? 'APPROVAL_REQUIRED'
      : workflow === 'PARAM_COLLECTING' ? 'PARAMETER_REVIEW'
        : workflow === 'RESULT_READY' ? 'SUCCEEDED'
          : workflow as AgentRunStatus;
  return {
    run_id: String(response.run_id || ''),
    conversation_id: String(response.conversation_id || ''),
    status,
    workflow_state: workflow,
    title: String(response.agent_skill_name || '优化运行'),
    agent_skill_name: response.agent_skill_name as string | undefined,
    api_skill_name: (response.resolved_skill_name || response.api_skill_name) as string | undefined,
    intent: response.intent as string | undefined,
    parameter_draft: response.parameter_draft as Record<string, unknown> | undefined,
    parameter_sources: response.parameter_sources as Record<string, unknown> | undefined,
    missing_required: response.missing_required as AgentRun['missing_required'],
    invalid_parameters: response.invalid_parameters as unknown[] | undefined,
    default_candidates: (response.can_use_default || response.default_candidates) as unknown[] | undefined,
    ready_to_invoke: Boolean(response.ready_to_invoke),
    invocation_id: response.invocation_id as string | undefined,
    objective_value: response.objective_value as number | undefined,
    result: response.result as Record<string, unknown> | undefined,
    message: (response.agent_message || response.message) as string | undefined,
  };
}
