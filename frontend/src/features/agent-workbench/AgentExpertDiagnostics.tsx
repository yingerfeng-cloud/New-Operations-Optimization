import { Collapse, Empty, Select, Tabs, Tag, Typography } from 'antd';
import type { AgentAnalyzeResponse, AgentRun, AgentStatus, AgentV3Event, AgentV3Task, AgentV3Turn } from '../../types/agent';
import { valueText } from './AgentPanels';

type SkillOption = { label: string; value: string };

interface AgentExpertDiagnosticsProps {
  response?: AgentAnalyzeResponse;
  run?: AgentRun;
  task?: AgentV3Task;
  turns?: AgentV3Turn[];
  events?: AgentV3Event[];
  status?: AgentStatus;
  selectedSkill?: string;
  skillOptions: SkillOption[];
  onSelectSkill: (value?: string) => void;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '草稿', color: 'default' },
  ROUTING: { label: '路由中', color: 'processing' },
  CLARIFICATION: { label: '等待澄清', color: 'warning' },
  WAITING_INPUT: { label: '等待补充', color: 'warning' },
  PARAMETER_REVIEW: { label: '检查参数', color: 'processing' },
  APPROVAL_REQUIRED: { label: '等待确认', color: 'warning' },
  READY: { label: '可以提交', color: 'cyan' },
  QUEUED: { label: '排队中', color: 'processing' },
  RUNNING: { label: '运行中', color: 'processing' },
  SUCCEEDED: { label: '已完成', color: 'success' },
  FAILED: { label: '失败', color: 'error' },
  CANCELLED: { label: '已取消', color: 'default' },
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function statusMeta(value?: string) {
  return statusLabels[String(value || '').toUpperCase()] || { label: value || '未开始', color: 'default' };
}

function parameterLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return valueText(value);
  const item = recordValue(value);
  const name = String(item.name || item.parameter || item.key || '未命名参数');
  const key = item.key && String(item.key) !== name ? ` · ${String(item.key)}` : '';
  const unit = item.unit ? `（${String(item.unit)}）` : '';
  return `${name}${key}${unit}`;
}

function jsonText(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return valueText(value);
  }
}

function candidateSkill(candidate: Record<string, unknown>) {
  return String(candidate.agent_skill_name || candidate.platform_skill_name || candidate.api_skill_name || '');
}

function candidateLabel(candidate: Record<string, unknown>) {
  return String(candidate.display_name || candidate.agent_skill_name || candidate.platform_skill_name || '未命名 Skill');
}

function scoreLabel(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '-';
  return `${Math.round(score * 100)}%`;
}

function CompactNotice({ label, value, tone = 'info' }: { label: string; value?: unknown; tone?: 'info' | 'warning' | 'error' }) {
  const text = valueText(value);
  if (!text || text === '-') return null;
  return (
    <details className={`agent-expert-notice is-${tone}`}>
      <summary>
        <div><strong>{label}</strong><span>{text}</span></div>
        <span className="agent-expert-notice-expand">展开</span>
        <span className="agent-expert-notice-collapse">收起</span>
      </summary>
      <div className="agent-expert-notice-body">{text}</div>
    </details>
  );
}

function DiagnosticMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warning' | 'error' }) {
  return <div className={`agent-expert-metric ${tone ? `is-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function IdentifierRow({ label, value }: { label: string; value?: unknown }) {
  const text = valueText(value);
  return (
    <div>
      <dt>{label}</dt>
      <dd>{text === '-' ? '-' : <Typography.Text copyable={{ text }}>{text}</Typography.Text>}</dd>
    </div>
  );
}

export function AgentExpertDiagnostics({
  response,
  run,
  task,
  turns = [],
  events = [],
  status,
  selectedSkill,
  skillOptions,
  onSelectSkill,
}: AgentExpertDiagnosticsProps) {
  const taskStatus = statusMeta(task?.status || run?.status || response?.status || response?.workflow_state);
  const currentTurn = turns.find(turn => turn.turn_id === task?.turn_id) || turns.at(-1);
  const taskEvents = events.filter(event => !task || event.task_id === task.task_id || event.turn_id === task.turn_id);
  const toolStarts = taskEvents.filter(event => event.type === 'tool.started');
  const failedEvents = taskEvents.filter(event => event.type === 'tool.failed');
  const approvalEvents = taskEvents.filter(event => event.type === 'approval.required');
  const recentEvents = [...taskEvents].reverse().slice(0, 6);
  const draft = response?.parameter_draft || response?.normalized_parameters || run?.parameter_draft || {};
  const sources = response?.parameter_sources || run?.parameter_sources || {};
  const filledEntries = Object.entries(draft).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const missing = response?.missing_required || run?.missing_required || [];
  const invalid = response?.invalid_parameters || run?.invalid_parameters || [];
  const totalParameters = filledEntries.length + missing.length;
  const completeness = response?.parameter_completeness === undefined
    ? totalParameters ? Math.round((filledEntries.length / totalParameters) * 100) : 100
    : Math.round(response.parameter_completeness * 100);
  const currentSkill = String(response?.agent_skill_name || response?.resolved_skill_name || response?.api_skill_name || run?.agent_skill_name || '');
  const candidates = [...(response?.candidate_skills || [])]
    .sort((left, right) => Number(right.final_score || 0) - Number(left.final_score || 0))
    .slice(0, 3);
  const selectedCandidate = candidates.find(candidate => {
    const values = [candidate.agent_skill_name, candidate.platform_skill_name, candidate.api_skill_name].map(value => String(value || ''));
    return values.includes(currentSkill);
  });
  const workflowTitle = String(run?.title || selectedCandidate?.display_name || response?.display_name || response?.agent_skill_name || '当前 Agent 任务');
  const taskError = task?.error || failedEvents.at(-1)?.payload || run?.error;
  const llmState = String(status?.llm?.operational_state || (status?.llm?.ready ? 'healthy' : 'unknown'));
  const platformHealthy = status?.platform?.reachable !== false && status?.platform?.skill_registry_ok !== false;
  const environmentHealthy = platformHealthy && !['degraded', 'unavailable'].includes(llmState);
  const eventLastUpdated = recentEvents[0]?.created_at || task?.updated_at || run?.updated_at || '-';

  const executionPanel = (
    <div className="agent-expert-tab-panel">
      <div className="agent-expert-metric-grid">
        <DiagnosticMetric label="工具调用" value={toolStarts.length} />
        <DiagnosticMetric label="失败事件" value={failedEvents.length} tone={failedEvents.length ? 'error' : 'good'} />
        <DiagnosticMetric label="等待确认" value={approvalEvents.length} tone={approvalEvents.length ? 'warning' : undefined} />
        <DiagnosticMetric label="本轮耗时" value={typeof currentTurn?.duration_ms === 'number' ? `${(currentTurn.duration_ms / 1000).toFixed(1)} 秒` : '-'} />
      </div>
      <section className="agent-expert-section" aria-label="运行标识">
        <div className="agent-expert-section-heading"><strong>运行标识</strong><span>点击编号可复制</span></div>
        <dl className="agent-expert-identifiers">
          <IdentifierRow label="Run" value={run?.run_id || response?.run_id} />
          <IdentifierRow label="Task" value={task?.task_id || response?.task_session?.task_id} />
          <IdentifierRow label="Turn" value={task?.turn_id || currentTurn?.turn_id} />
          <IdentifierRow label="Invocation" value={response?.invocation_id || run?.invocation_id} />
          <IdentifierRow label="Model" value={run?.model_id || response?.task_session?.model_id} />
        </dl>
      </section>
      {taskError && <CompactNotice label="最近错误" value={taskError} tone="error" />}
      {!environmentHealthy && <CompactNotice label="运行环境异常" value={status?.llm?.last_error || status?.platform?.last_error || `LLM ${llmState}`} tone="warning" />}
      <section className="agent-expert-section" aria-label="最近事件">
        <div className="agent-expert-section-heading"><strong>最近事件</strong><span>{eventLastUpdated}</span></div>
        {recentEvents.length ? (
          <div className="agent-expert-event-list">
            {recentEvents.map(event => {
              const invocation = recordValue(recordValue(event.payload).invocation);
              const detail = String(invocation.tool_name || recordValue(event.payload).message || '');
              return <div key={event.event_id}><i className={event.type.includes('failed') ? 'is-error' : ''} /><span><strong>{event.type}</strong>{detail && <small>{detail}</small>}</span><time>{event.created_at || ''}</time></div>;
            })}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务事件" />}
      </section>
    </div>
  );

  const routingPanel = (
    <div className="agent-expert-tab-panel">
      <section className="agent-expert-section agent-expert-skill-override" aria-label="下一轮指定 Skill">
        <div className="agent-expert-section-heading"><strong>下一轮指定 Skill</strong><span>收起诊断后恢复自动识别</span></div>
        <Select
          aria-label="指定 Skill"
          allowClear
          virtual={false}
          value={selectedSkill}
          onChange={onSelectSkill}
          placeholder="自动识别 Skill"
          options={skillOptions}
        />
      </section>
      <div className="agent-expert-metric-grid is-three">
        <DiagnosticMetric label="路由置信度" value={response?.route_confidence === undefined ? '-' : `${Math.round(response.route_confidence * 100)}%`} />
        <DiagnosticMetric label="参数完整度" value={`${completeness}%`} tone={missing.length ? 'warning' : 'good'} />
        <DiagnosticMetric label="校验问题" value={invalid.length} tone={invalid.length ? 'error' : 'good'} />
      </div>
      <section className="agent-expert-section" aria-label="路由结果">
        <div className="agent-expert-section-heading"><strong>路由结果</strong><Tag color={response?.needs_clarification ? 'gold' : 'blue'}>{response?.needs_clarification ? '需澄清' : '已选定'}</Tag></div>
        <dl className="agent-expert-route-facts">
          <div><dt>业务模型</dt><dd>{workflowTitle}</dd></div>
          <div><dt>Agent Skill</dt><dd>{valueText(response?.agent_skill_name)}</dd></div>
          <div><dt>平台 Skill</dt><dd>{valueText(response?.resolved_skill_name || response?.api_skill_name)}</dd></div>
          <div><dt>意图</dt><dd>{valueText(response?.intent)}</dd></div>
        </dl>
      </section>
      <CompactNotice label="选择理由" value={response?.selection_reason} />
      <CompactNotice label="需要澄清" value={response?.clarification_question} tone="warning" />
      {candidates.length > 0 && (
        <section className="agent-expert-section" aria-label="候选 Skill">
          <div className="agent-expert-section-heading"><strong>候选 Skill</strong><span>仅展示 Top 3</span></div>
          <div className="agent-expert-candidate-list">
            {candidates.map(candidate => {
              const skill = candidateSkill(candidate);
              const active = [candidate.agent_skill_name, candidate.platform_skill_name, candidate.api_skill_name].map(value => String(value || '')).includes(currentSkill);
              return (
                <div className={active ? 'is-current' : ''} key={skill || candidateLabel(candidate)}>
                  <span><strong>{candidateLabel(candidate)}</strong><small>{valueText(candidate.reason)}</small></span>
                  <Tag color={active ? 'blue' : 'default'}>{scoreLabel(candidate.final_score)}</Tag>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="agent-expert-section" aria-label="参数诊断">
        <div className="agent-expert-section-heading"><strong>参数诊断</strong><span>已填写 {filledEntries.length} · 缺失 {missing.length}</span></div>
        <div className="agent-expert-parameter-groups">
          {missing.length > 0 && <details><summary>缺失参数（{missing.length}）<span>展开</span></summary><div className="agent-expert-parameter-list">{missing.map((item, index) => <span key={`${parameterLabel(item)}-${index}`}>{parameterLabel(item)}</span>)}</div></details>}
          {invalid.length > 0 && <details className="is-error"><summary>校验问题（{invalid.length}）<span>展开</span></summary><div className="agent-expert-parameter-list">{invalid.map((item, index) => <span key={`${parameterLabel(item)}-${index}`}>{parameterLabel(item)}</span>)}</div></details>}
          {filledEntries.length > 0 && <details><summary>已填写参数（{filledEntries.length}）<span>展开</span></summary><dl>{filledEntries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}{sources[key] ? <small>来源：{valueText(sources[key])}</small> : null}</dd></div>)}</dl></details>}
          {!missing.length && !invalid.length && !filledEntries.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无参数快照" />}
        </div>
      </section>
    </div>
  );

  const rawPanel = (
    <div className="agent-expert-tab-panel agent-expert-raw-panel">
      <Typography.Paragraph type="secondary">原始数据仅用于排查问题，默认折叠以减少视觉干扰。</Typography.Paragraph>
      <Collapse
        size="small"
        items={[
          { key: 'context', label: '任务上下文', children: <pre>{jsonText({ task, run, response })}</pre> },
          { key: 'events', label: `事件载荷（${taskEvents.length}）`, children: <pre>{jsonText(taskEvents)}</pre> },
          { key: 'environment', label: '运行环境', children: <pre>{jsonText(status)}</pre> },
        ]}
      />
    </div>
  );

  return (
    <section className="agent-expert-diagnostics" aria-label="Agent 诊断信息">
      <div className="agent-expert-context">
        <div><span>当前任务诊断</span><Typography.Title level={5}>{workflowTitle}</Typography.Title></div>
        <Tag color={taskStatus.color}>{taskStatus.label}</Tag>
      </div>
      <Tabs
        className="agent-expert-tabs"
        defaultActiveKey="execution"
        items={[
          { key: 'execution', label: '执行诊断', children: executionPanel },
          { key: 'routing', label: `路由与参数${missing.length ? ` (${missing.length})` : ''}`, children: routingPanel },
          { key: 'raw', label: '原始数据', children: rawPanel },
        ]}
      />
    </section>
  );
}
