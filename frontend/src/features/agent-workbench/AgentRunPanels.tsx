import { Empty, Tag, Typography } from 'antd';
import type { AgentRun, AgentRunStatus } from '../../types/agent';
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

export function AgentRunInspector({ run }: { run?: AgentRun }) {
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
  return (
    <div className="agent-run-inspector">
      <div className="agent-run-heading">
        <div>
          <Typography.Text type="secondary">当前运行</Typography.Text>
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
      <div className="agent-run-summary">
        <div className="agent-run-summary-row"><span>识别场景</span><strong>{valueText(run.intent || run.agent_skill_name || '自动识别')}</strong></div>
        <div className="agent-run-summary-row"><span>匹配模型</span><strong>{valueText(run.model_id || run.api_skill_name || '自动匹配')}</strong></div>
        <div className="agent-run-summary-row"><span>参数完整性</span><strong>{run.missing_required?.length ? `缺少 ${run.missing_required.length} 项` : '已检查'}</strong></div>
        {run.invocation_id && <div className="agent-run-summary-row"><span>调用编号</span><strong>{run.invocation_id}</strong></div>}
      </div>
      {run.error && <div className="agent-run-error">{run.error}</div>}
      <div className="agent-run-events" aria-label="运行事件">
        <Typography.Text strong>运行记录</Typography.Text>
        {(run.events || []).length ? [...(run.events || [])].reverse().slice(0, 8).map(event => (
          <div className="agent-run-event" key={event.event_id}>
            <i />
            <div><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}<small>{event.created_at || ''}</small></div>
          </div>
        )) : <Typography.Text type="secondary">暂无运行事件</Typography.Text>}
      </div>
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
