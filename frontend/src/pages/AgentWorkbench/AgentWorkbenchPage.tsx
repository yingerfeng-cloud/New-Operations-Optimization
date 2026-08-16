import { Alert, App as AntApp, Button, Card, Drawer, Dropdown, Empty, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  agentRunEventStreamUrl,
  agentConversationEventStreamUrl,
  cancelAgentTask,
  createAgentTurn,
  createAgentConversation,
  deleteAgentConversation,
  getAgentConversation,
  getAgentConversations,
  getAgentSkills,
  getAgentStatus,
  retryAgentTurn,
  resolveAgentApproval,
} from '../../api/agents';
import {
  AgentModelDecisionCard,
  AgentResultPanel,
  responseMessage,
  skillLabel,
  skillValue,
  valueText,
} from '../../features/agent-workbench/AgentPanels';
import { AgentExpertDiagnostics } from '../../features/agent-workbench/AgentExpertDiagnostics';
import {
  AgentExceptionActivity,
  AgentRunInspector,
  AgentWorkflowActivity,
  agentTurnStatusMeta,
  responseFromRun,
  runStatusMeta,
  transientRunFromResponse,
} from '../../features/agent-workbench/AgentRunPanels';
import type { AgentAnalyzeResponse, AgentMessage, AgentRun, AgentV3Approval, AgentV3Turn } from '../../types/agent';
import type { AgentConversationSummary } from '../../types/agent';
import { HistoryOutlined, MenuOutlined, MoreOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';

const examples = ['帮我梳理今天的工作', '解释什么是机组组合', '制定明日机组组合计划', '分析中长期合同与现货敞口'];
const roleLabel = (role?: string) => role === 'user' ? '用户' : role === 'assistant' || role === 'agent' ? 'Agent' : role || '系统';
const activeStatuses = new Set(['DRAFT', 'ROUTING', 'CLARIFICATION', 'PARAMETER_REVIEW', 'APPROVAL_REQUIRED', 'READY', 'QUEUED', 'RUNNING']);

interface AgentTurnSubmission {
  content?: string;
  preferredSkill?: string;
}

interface BatchParameterField {
  id: string;
  key: string;
  name: string;
  unit: string;
  label: string;
}

function batchParameterFields(response?: AgentAnalyzeResponse): BatchParameterField[] {
  return (response?.missing_required || []).map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined;
    const key = String(record?.key || record?.parameter || record?.name || item || `parameter_${index + 1}`);
    const name = String(record?.name || record?.parameter || record?.key || item || `参数 ${index + 1}`);
    const unit = String(record?.unit || '').trim();
    const technicalKey = key !== name ? ` · ${key}` : '';
    const unitLabel = unit ? `（${unit}）` : '';
    return {
      id: `${key}-${index}`,
      key,
      name,
      unit,
      label: `${name}${technicalKey}${unitLabel}`,
    };
  });
}

function TurnFailureCard({ turn, retrying, onRetry }: { turn: AgentV3Turn; retrying: boolean; onRetry: () => void }) {
  const interrupted = turn.status === 'INTERRUPTED';
  return (
    <div className="agent-turn-failure" role="alert">
      <div className="agent-turn-failure-icon" aria-hidden="true">!</div>
      <div>
        <strong>{interrupted ? '本轮处理已中断' : '本轮未完成'}</strong>
        <span>{turn.error?.message || 'Agent 未能完成本轮处理。'}</span>
        <small>
          {turn.error?.protocol && `协议：${turn.error.protocol}`}
          {turn.error?.provider_request_id && ` · 请求编号：${turn.error.provider_request_id}`}
        </small>
      </div>
      {turn.retryable && <Button size="small" loading={retrying} onClick={onRetry}>重试本轮</Button>}
    </div>
  );
}

export function AgentWorkbenchPage() {
  const { message: messageApi } = AntApp.useApp();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentAnalyzeResponse>();
  const [pendingApproval, setPendingApproval] = useState<AgentV3Approval>();
  const [expertView, setExpertView] = useState(false);
  const [runInspectorOpen, setRunInspectorOpen] = useState(false);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentConversationSummary>();
  const [batchParameterOpen, setBatchParameterOpen] = useState(false);
  const [batchParameterValues, setBatchParameterValues] = useState<Record<string, string>>({});
  const [batchParameterError, setBatchParameterError] = useState('');
  const activityTriggerRef = useRef<HTMLButtonElement>(null);
  const inspectorDialogRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TextAreaRef>(null);
  const pendingClientTurnIdRef = useRef<string | undefined>(undefined);
  const submittedTextRef = useRef<string | undefined>(undefined);
  const submittedConversationIdRef = useRef<string | undefined>(undefined);

  const pollingInterval = import.meta.env.MODE === 'test' ? false : 15000;
  const status = useQuery({ queryKey: ['agent-status'], queryFn: getAgentStatus, refetchInterval: pollingInterval, retry: 1 });
  const skills = useQuery({ queryKey: ['agent-skills'], queryFn: getAgentSkills, retry: 1 });
  const conversations = useQuery({ queryKey: ['agent-conversations'], queryFn: getAgentConversations, refetchInterval: pollingInterval, retry: 1 });
  const conversation = useQuery({
    queryKey: ['agent-conversation', conversationId],
    queryFn: () => getAgentConversation(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: query => {
      const run = query.state.data?.active_run;
      return import.meta.env.MODE !== 'test' && run && activeStatuses.has(run.status) ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!conversationId && conversations.data?.length) setConversationId(conversations.data[0].conversation_id);
  }, [conversationId, conversations.data]);

  useEffect(() => {
    if (!conversation.data || conversation.data.conversation_id !== conversationId) return;
    setPendingApproval(conversation.data.pending_approvals?.at(-1));
  }, [conversation.data, conversationId]);

  useEffect(() => {
    if (!runInspectorOpen) return undefined;
    inspectorDialogRef.current?.querySelector<HTMLButtonElement>('[aria-label="关闭运行检查器"]')?.focus();
    return undefined;
  }, [runInspectorOpen]);

  const selectedTask = [...(conversation.data?.agent_tasks || [])].reverse().find(task =>
    ['PENDING', 'RUNNING', 'WAITING_INPUT', 'APPROVAL_REQUIRED'].includes(task.status),
  ) || conversation.data?.agent_tasks?.at(-1);
  const activeTask = selectedTask && ['PENDING', 'RUNNING', 'WAITING_INPUT', 'APPROVAL_REQUIRED'].includes(selectedTask.status)
    ? selectedTask
    : undefined;
  const persistedTaskResult = selectedTask?.result;
  const currentTaskResponse = lastResponse || (persistedTaskResult as AgentAnalyzeResponse | undefined);
  const responseRun = currentTaskResponse?.run || transientRunFromResponse(currentTaskResponse as Record<string, unknown> | undefined);
  // The selected V3 task is the sole source of run state. Falling back to the
  // conversation's former global run can display and operate on another task.
  const activeRun: AgentRun | undefined = responseRun;
  const selectedCandidates = Array.isArray(currentTaskResponse?.candidate_skills) ? currentTaskResponse.candidate_skills : [];
  const selectedSkillName = String(currentTaskResponse?.agent_skill_name || currentTaskResponse?.resolved_skill_name || currentTaskResponse?.api_skill_name || '');
  const selectedCandidate = selectedCandidates.find(candidate => [candidate.agent_skill_name, candidate.platform_skill_name, candidate.api_skill_name]
    .map(value => String(value || ''))
    .includes(selectedSkillName));
  const persistedRunTitle = String(activeRun?.title || '');
  const runTitleLooksInternal = Boolean(persistedRunTitle && /^[a-z0-9_.-]+$/i.test(persistedRunTitle));
  const selectedWorkflowTitle = String(
    (!runTitleLooksInternal ? persistedRunTitle : '')
    || currentTaskResponse?.display_name
    || selectedCandidate?.display_name
    || persistedRunTitle
    || currentTaskResponse?.agent_skill_name
    || activeRun?.agent_skill_name
    || '',
  );
  const displayRun: AgentRun | undefined = activeRun && selectedTask
    ? {
        ...activeRun,
        title: selectedWorkflowTitle || activeRun.title,
        status: selectedTask.status,
        workflow_state: selectedTask.status,
        task_id: selectedTask.task_id,
        error: selectedTask.error || activeRun.error,
      }
    : activeRun;
  const activeResponse = currentTaskResponse || responseFromRun(activeRun);
  const batchFields = useMemo(() => batchParameterFields(activeResponse), [activeResponse]);
  const responseResult = activeResponse?.result;
  const hasMeaningfulResult = Boolean(
    activeResponse
    && (
      activeResponse.invocation_id
      || activeResponse.objective_value !== undefined
      || (responseResult && typeof responseResult === 'object' && Object.keys(responseResult).length > 0)
      || ['RESULT_READY', 'SUCCESS', 'SUCCEEDED'].includes(String(activeResponse.workflow_state || activeResponse.status || '').toUpperCase())
    )
  );
  const latestTurn = conversation.data?.turns?.at(-1);
  // A legacy run snapshot is task output, not a second lifecycle authority.
  // Once a V3 task exists its status wins, including terminal cancellation.
  const inspectorStatus = runStatusMeta(selectedTask?.status || activeRun?.status || activeRun?.workflow_state);
  const inspectorStatusTone = inspectorStatus.color === 'success'
    ? 'success'
    : inspectorStatus.color === 'error'
      ? 'error'
      : inspectorStatus.color === 'warning'
        ? 'warning'
        : inspectorStatus.color === 'processing' || inspectorStatus.color === 'cyan'
          ? 'processing'
          : 'idle';
  const inspectorStatusBusy = selectedTask
    ? ['PENDING', 'RUNNING'].includes(selectedTask.status)
    : Boolean(activeRun && activeStatuses.has(String(activeRun.status || activeRun.workflow_state || '').toUpperCase()));
  const latestTurnOverridesTask = Boolean(latestTurn && ['RUNNING', 'FAILED', 'INTERRUPTED'].includes(latestTurn.status));
  // A Turn reports whether the conversational exchange itself completed. Once
  // that exchange is over, the task remains the authority for the business
  // lifecycle, including terminal states such as CANCELLED and SUCCEEDED.
  const activityTask = latestTurnOverridesTask ? undefined : selectedTask;
  const activityStatus = activityTask
    ? inspectorStatus
    : agentTurnStatusMeta(latestTurn?.status);
  const activityStatusTone = activityTask
    ? inspectorStatusTone
    : activityStatus.color === 'success'
      ? 'success'
      : activityStatus.color === 'error'
        ? 'error'
        : activityStatus.color === 'warning'
          ? 'warning'
          : activityStatus.color === 'processing'
            ? 'processing'
            : 'idle';
  const activityStatusBusy = latestTurnOverridesTask
    ? latestTurn?.status === 'RUNNING'
    : inspectorStatusBusy;

  useEffect(() => {
    if (!activeRun?.run_id || typeof EventSource === 'undefined' || import.meta.env.MODE === 'test') return undefined;
    const source = new EventSource(agentRunEventStreamUrl(activeRun.run_id, activeRun.events?.at(-1)?.sequence || 0));
    const refreshRun = () => {
      void qc.invalidateQueries({ queryKey: ['agent-conversation', activeRun.conversation_id] });
      void qc.invalidateQueries({ queryKey: ['agent-conversations'] });
    };
    source.addEventListener('run-event', refreshRun);
    return () => source.close();
  }, [activeRun?.conversation_id, activeRun?.events, activeRun?.run_id, qc]);

  useEffect(() => {
    if (!conversationId || typeof EventSource === 'undefined' || import.meta.env.MODE === 'test') return undefined;
    const source = new EventSource(agentConversationEventStreamUrl(conversationId));
    const refreshConversation = () => {
      void qc.invalidateQueries({ queryKey: ['agent-conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['agent-conversations'] });
    };
    source.addEventListener('agent-event', refreshConversation);
    return () => source.close();
  }, [conversationId, qc]);

  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['agent-status'] });
    void qc.invalidateQueries({ queryKey: ['agent-conversations'] });
    if (id) void qc.invalidateQueries({ queryKey: ['agent-conversation', id] });
  };
  const clearTransientContext = () => {
    setLastResponse(undefined);
    setLastUserText('');
    setPendingApproval(undefined);
    pendingClientTurnIdRef.current = undefined;
    submittedTextRef.current = undefined;
    submittedConversationIdRef.current = undefined;
  };

  const createConversationMutation = useMutation({
    mutationFn: () => createAgentConversation({ title: '新会话' }),
    onSuccess: data => {
      clearTransientContext();
      setSelectedSkill(undefined);
      setText('');
      setMobileSessionsOpen(false);
      setConversationId(data.conversation_id);
      refresh(data.conversation_id);
    },
  });
  const analyze = useMutation({
    mutationFn: async (submission?: AgentTurnSubmission) => {
      const content = String(submission?.content ?? text).trim();
      const preferredSkill = submission?.preferredSkill ?? selectedSkill;
      submittedTextRef.current = content;
      setLastUserText(content);
      setText('');
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        const created = await createAgentConversation({ title: '新会话' });
        targetConversationId = created.conversation_id;
        setConversationId(created.conversation_id);
        qc.setQueryData(['agent-conversation', created.conversation_id], created);
        refresh(created.conversation_id);
      }
      const clientTurnId = pendingClientTurnIdRef.current || globalThis.crypto?.randomUUID?.() || `turn-${Date.now()}`;
      pendingClientTurnIdRef.current = clientTurnId;
      submittedConversationIdRef.current = targetConversationId;
      return createAgentTurn(
        targetConversationId,
        content,
        preferredSkill ? { preferred_skill: preferredSkill } : {},
        clientTurnId,
      );
    },
    onSuccess: data => {
      const latestTaskResult = data.tasks.at(-1)?.result;
      setLastResponse(latestTaskResult as AgentAnalyzeResponse | undefined);
      setPendingApproval(data.approvals.at(-1));
      setConversationId(data.conversation_id);
      qc.setQueryData(['agent-conversation', data.conversation_id], data.conversation);
      setText('');
      setLastUserText('');
      submittedTextRef.current = undefined;
      submittedConversationIdRef.current = undefined;
      pendingClientTurnIdRef.current = undefined;
      refresh(data.conversation_id);
    },
    onError: (error: unknown) => {
      const statusCode = (error as { response?: { status?: number } })?.response?.status;
      const serverRecordedTurn = Boolean(statusCode && (statusCode >= 500 || statusCode === 409));
      if (serverRecordedTurn) {
        const recordedConversationId = submittedConversationIdRef.current;
        submittedTextRef.current = undefined;
        submittedConversationIdRef.current = undefined;
        pendingClientTurnIdRef.current = undefined;
        refresh(recordedConversationId || conversationId);
        return;
      }
      setLastUserText('');
      setText(current => current || submittedTextRef.current || '');
      submittedTextRef.current = undefined;
      submittedConversationIdRef.current = undefined;
      if (statusCode) pendingClientTurnIdRef.current = undefined;
      messageApi.error(statusCode ? '消息未被接受，请检查内容后重试' : '连接中断，消息尚未确认送达，请重试');
    },
  });
  const retryTurn = useMutation({
    mutationFn: (turnId: string) => retryAgentTurn(turnId),
    onSuccess: data => {
      const latestTaskResult = data.tasks.at(-1)?.result;
      setLastResponse(latestTaskResult as AgentAnalyzeResponse | undefined);
      setPendingApproval(data.approvals.at(-1));
      qc.setQueryData(['agent-conversation', data.conversation_id], data.conversation);
      refresh(data.conversation_id);
    },
    onError: () => {
      refresh(conversationId);
      messageApi.error('本轮仍未完成，已保留原请求，可稍后再次重试');
    },
  });
  const resolveApproval = useMutation({
    mutationFn: ({ approval, decision }: { approval: AgentV3Approval; decision: 'approve' | 'reject' }) =>
      resolveAgentApproval(approval.approval_id, decision),
    onSuccess: data => {
      setLastResponse(data.result || (data.task.result as AgentAnalyzeResponse | undefined));
      setPendingApproval(data.next_approval || undefined);
      refresh(data.task.conversation_id);
      if (data.task.status === 'SUCCEEDED') messageApi.success('优化任务已完成');
    },
    onError: () => messageApi.error('审批处理失败，请稍后重试'),
  });
  const cancelTask = useMutation({
    mutationFn: (taskId: string) => cancelAgentTask(taskId),
    onSuccess: data => {
      if (data.status === 'CANCELLED' && pendingApproval?.task_id === data.task_id) setPendingApproval(undefined);
      refresh(data.conversation_id);
      if (data.status === 'CANCELLED') messageApi.success('任务已取消');
      else messageApi.info('任务已经结束，无需取消');
    },
    onError: () => messageApi.error('取消任务失败，请稍后重试'),
  });
  const deleteConversationMutation = useMutation({
    mutationFn: (id: string) => deleteAgentConversation(id),
    onSuccess: (_data, id) => {
      const nextConversationId = conversations.data?.find(item => item.conversation_id !== id)?.conversation_id;
      const deletingActive = conversationId === id;
      qc.setQueryData<AgentConversationSummary[]>(['agent-conversations'], current => (current || []).filter(item => item.conversation_id !== id));
      void qc.removeQueries({ queryKey: ['agent-conversation', id] });
      setDeleteTarget(undefined);
      if (deletingActive) {
        clearTransientContext();
        setSelectedSkill(undefined);
        setText('');
        setConversationId(nextConversationId);
      }
      refresh(nextConversationId);
      messageApi.success('会话已删除');
    },
    onError: () => messageApi.error('删除会话失败，请稍后重试'),
  });

  const chatMessages = useMemo<AgentMessage[]>(() => {
    const items = [...(conversation.data?.messages || [])];
    if (lastUserText && !items.some(item => (item.text || item.content) === lastUserText)) items.push({ role: 'user', text: lastUserText });
    const reply = responseMessage(lastResponse);
    if (reply && !items.some(item => (item.text || item.content) === reply)) items.push({ role: 'agent', text: reply });
    return items;
  }, [conversation.data?.messages, lastResponse, lastUserText]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [analyze.isPending, chatMessages.length]);

  const needsDefault = Boolean(activeTask && pendingApproval?.payload?.action === 'confirm_defaults');
  const readyToInvoke = Boolean(activeTask && pendingApproval?.payload?.action === 'confirm_invoke');
  const conversationOptions = (conversations.data || [])
    .map(item => ({ ...item, label: item.title || item.last_message || item.conversation_id, searchable: `${item.title || ''} ${item.last_message || ''} ${item.conversation_id}`.toLowerCase() }))
    .filter(item => item.searchable.includes(search.trim().toLowerCase()));
  const skillOptions = (skills.data || []).flatMap(item => {
    const value = skillValue(item);
    return value ? [{ value, label: skillLabel(item) }] : [];
  });
  const llmEnabled = Boolean(status.data?.llm?.enabled);
  const llmReady = Boolean(status.data?.llm?.ready);
  const llmOperationalState = status.data?.llm?.operational_state;
  const serviceState = status.isPending
    ? { color: 'processing', label: '服务检查中' }
    : !llmEnabled
      ? { color: 'warning', label: '模型未配置' }
      : llmOperationalState === 'healthy' && llmReady
        ? { color: 'green', label: '智能体可用' }
        : llmOperationalState === 'healthy'
          ? { color: 'warning', label: 'Function Calling 待检查' }
        : llmOperationalState === 'degraded'
          ? { color: 'warning', label: '模型连接不稳定' }
          : llmOperationalState === 'unavailable'
            ? { color: 'error', label: '模型服务不可用' }
            : llmOperationalState === 'recovering'
              ? { color: 'processing', label: '模型服务恢复中' }
              : { color: 'default', label: '模型能力待检查' };

  const startConversation = () => createConversationMutation.mutate();
  const selectConversation = (id: string) => {
    clearTransientContext();
    setSelectedSkill(undefined);
    setConversationId(id);
    setText('');
    setBatchParameterOpen(false);
    setBatchParameterValues({});
    setBatchParameterError('');
    setMobileSessionsOpen(false);
  };
  const toggleExpertView = () => {
    if (expertView) setSelectedSkill(undefined);
    setExpertView(value => !value);
  };
  const send = () => {
    if (text.trim() && !analyze.isPending) analyze.mutate(undefined);
  };
  const chooseModel = (skillName: string, label: string) => {
    if (analyze.isPending) return;
    const currentSkill = String(activeResponse?.agent_skill_name || activeResponse?.resolved_skill_name || activeResponse?.api_skill_name || '');
    const switching = Boolean(currentSkill && currentSkill !== skillName && !currentSkill.endsWith(skillName) && !skillName.endsWith(currentSkill));
    analyze.mutate({
      content: switching ? `切换为“${label}”` : `使用“${label}”继续当前任务`,
      preferredSkill: skillName,
    });
  };
  const startParameterInput = () => {
    const firstMissing = activeResponse?.missing_required?.[0];
    const missingRecord = firstMissing && typeof firstMissing === 'object'
      ? firstMissing as Record<string, unknown>
      : undefined;
    const parameterName = String(missingRecord?.name || missingRecord?.key || firstMissing || '缺失参数');
    const parameterUnit = String(missingRecord?.unit || '').trim();
    const prompt = `${parameterName}${parameterUnit ? `（${parameterUnit}）` : ''}：`;
    pendingClientTurnIdRef.current = undefined;
    setText(current => current.trim() ? current : prompt);
    globalThis.requestAnimationFrame?.(() => composerRef.current?.focus());
  };
  const openBatchParameterInput = () => {
    setBatchParameterValues({});
    setBatchParameterError('');
    setBatchParameterOpen(true);
  };
  const closeBatchParameterInput = () => {
    setBatchParameterOpen(false);
    setBatchParameterValues({});
    setBatchParameterError('');
  };
  const writeBatchParametersToComposer = () => {
    const completedFields = batchFields
      .map(field => ({ field, value: String(batchParameterValues[field.id] || '').trim() }))
      .filter(item => item.value);
    if (!completedFields.length) {
      setBatchParameterError('请至少填写一个参数；未填写的参数可以稍后继续补充。');
      return;
    }
    const parameterMessage = [
      '请为当前工作流补充以下参数：',
      ...completedFields.map(({ field, value }) => `- ${field.name}${field.unit ? `（${field.unit}）` : ''}：${value}`),
    ].join('\n');
    const guidedPrompts = new Set(batchFields.map(field => `${field.name}${field.unit ? `（${field.unit}）` : ''}：`));
    pendingClientTurnIdRef.current = undefined;
    setText(current => {
      const draft = current.trim();
      return !draft || guidedPrompts.has(draft) ? parameterMessage : `${draft}\n\n${parameterMessage}`;
    });
    closeBatchParameterInput();
    globalThis.requestAnimationFrame?.(() => composerRef.current?.focus());
  };
  const sessionMenu = (item: AgentConversationSummary): MenuProps => ({
    items: [{ key: 'delete', label: '删除会话', danger: true }],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'delete') setDeleteTarget(item);
    },
  });
  const closeRunInspector = () => {
    setRunInspectorOpen(false);
    activityTriggerRef.current?.focus();
  };
  const handleInspectorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRunInspector();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(inspectorDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []).filter(element => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      inspectorDialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const renderSessionContent = () => (
    <>
      <Input allowClear placeholder="搜索标题、最近消息或会话 ID" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="agent-session-list section-gap">
        {conversationOptions.length ? conversationOptions.map(item => {
          const latestTurnOverridesTask = ['RUNNING', 'FAILED', 'INTERRUPTED'].includes(String(item.latest_turn_status || ''));
          const runMeta = latestTurnOverridesTask
            ? agentTurnStatusMeta(item.latest_turn_status)
            : item.active_task_status || item.latest_task_status || item.active_run_status
              ? runStatusMeta(item.active_task_status || item.latest_task_status || item.active_run_status)
              : agentTurnStatusMeta(item.latest_turn_status);
          return (
            <div className={`agent-session-item ${item.conversation_id === conversationId ? 'active' : ''}`} key={item.conversation_id}>
              <div className="agent-session-item-main">
                <button type="button" className="agent-session-select" aria-label={`打开会话 ${item.label}`} onClick={() => selectConversation(item.conversation_id)}>
                  <Typography.Text strong ellipsis>{item.label}</Typography.Text>
                  <span><Tag color={runMeta.color}>{runMeta.label}</Tag><Typography.Text type="secondary">{item.updated_at || item.conversation_id}</Typography.Text></span>
                </button>
                <Dropdown menu={sessionMenu(item)} trigger={['click']} placement="bottomRight">
                  <Button type="text" className="agent-session-actions" aria-label={`管理会话 ${item.label}`} icon={<MoreOutlined />} onClick={event => event.stopPropagation()} />
                </Dropdown>
              </div>
            </div>
          );
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? '没有匹配会话' : '暂无历史会话'} />}
      </div>
    </>
  );

  return (
    <div className="agent-workbench-page">
      {status.isError && <Alert className="agent-service-alert" showIcon type="error" title="Agent 服务不可用" description="当前前端未能连接 Agent API，请检查统一后端服务是否以 combined 模式启动。" action={<Button size="small" onClick={() => status.refetch()}>重新检查</Button>} />}
      <div className="agent-workbench-layout">
        <Card
          className="content-card agent-session-card"
          title="会话"
          extra={<Button type="text" className="agent-new-conversation" onClick={startConversation} loading={createConversationMutation.isPending}>新建</Button>}
        >
          {renderSessionContent()}
        </Card>

        <Card
          className="content-card agent-chat-card"
          title={(
            <div className="agent-chat-heading">
              <strong>Agent 工作台</strong>
              <div className="agent-chat-heading-meta">
                <span>
                  <i className={`agent-service-dot ${status.isPending || serviceState.color === 'processing' ? 'processing' : serviceState.color === 'green' ? 'success' : serviceState.color === 'error' ? 'error' : 'warning'}`} aria-hidden="true" />
                  {serviceState.label}
                </span>
                <b aria-hidden="true">·</b>
                <span>{expertView && selectedSkill ? `已指定 Skill：${selectedSkill}` : '默认自动识别 Skill'}</span>
              </div>
            </div>
          )}
          extra={(
            <Space size={8} className="agent-chat-extra">
              <Button type="text" className="agent-mobile-session-trigger" icon={<MenuOutlined />} aria-label="打开会话列表" onClick={() => setMobileSessionsOpen(true)}>会话</Button>
              <span className={`agent-run-status-chip ${activityStatusTone} ${activityStatusBusy ? 'is-running' : ''}`} role="status" aria-live="polite">
                <span className="agent-run-status-indicator" aria-hidden="true" />
                <span>{activityStatus.label}</span>
              </span>
              <Button ref={activityTriggerRef} type="text" className={`agent-activity-trigger ${runInspectorOpen ? 'is-active' : ''}`} icon={<HistoryOutlined />} aria-label="查看运行详情" aria-expanded={runInspectorOpen} aria-controls="agent-run-inspector" onClick={() => setRunInspectorOpen(true)}>活动</Button>
            </Space>
          )}
        >
          <div className="agent-message-list" aria-live="polite" aria-busy={analyze.isPending}>
            {/* Background refreshes must not blur the transcript; the inline
                thinking state already communicates an in-flight turn. */}
            <Spin spinning={conversation.isPending && Boolean(conversationId)}>
              {chatMessages.length ? (
                <>
                  {chatMessages.map((item, index) => {
                    const failedTurn = item.role === 'user'
                      ? conversation.data?.turns?.find(turn => turn.turn_id === item.turn_id && ['FAILED', 'INTERRUPTED'].includes(turn.status))
                      : undefined;
                    return (
                      <div className="agent-message-group" key={String(item.message_id || item.created_at || `${item.role}-${index}`)}>
                        <div className={`agent-message ${item.role === 'user' ? 'user' : 'agent'}`}>
                          <b>{roleLabel(item.role)}</b>
                          <div>{valueText(item.text || item.content)}</div>
                          {item.created_at && <small>{item.created_at}</small>}
                        </div>
                        {failedTurn && <TurnFailureCard turn={failedTurn} retrying={retryTurn.isPending && retryTurn.variables === failedTurn.turn_id} onRetry={() => retryTurn.mutate(failedTurn.turn_id)} />}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="agent-empty-prompts">
                  <Typography.Title level={4}>今天想完成什么？</Typography.Title>
                  <Typography.Paragraph className="agent-empty-prompts-copy" type="secondary">可以直接聊天、分析问题，或让 Agent 调用运筹优化 Skill 完成复杂任务。</Typography.Paragraph>
                  <div className="agent-empty-prompts-actions">{examples.map(example => <button key={example} type="button" onClick={() => setText(example)}>{example}</button>)}</div>
                </div>
              )}
              {!analyze.isPending && activeResponse && (
                <AgentModelDecisionCard
                  response={activeResponse}
                  choosing={analyze.isPending}
                  onChoose={chooseModel}
                  onReviewParameters={() => setRunInspectorOpen(true)}
                  onStartParameterInput={startParameterInput}
                  onBatchParameterInput={openBatchParameterInput}
                />
              )}
              {analyze.isPending && (
                <div className="agent-message agent agent-waiting" role="status" aria-label="Agent 正在思考">
                  <b>Agent</b>
                  <div className="agent-thinking-indicator" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="agent-waiting-label">正在思考</span>
                </div>
              )}
              <div ref={messageEndRef} className="agent-message-end" aria-hidden="true" />
            </Spin>
          </div>
          <div className="agent-input-bar">
            <Input.TextArea
              ref={composerRef}
              aria-label="给 Agent 发消息"
              value={text}
              autoSize={{ minRows: 1, maxRows: 6 }}
              onChange={event => {
                if (event.target.value !== text) pendingClientTurnIdRef.current = undefined;
                setText(event.target.value);
              }}
              placeholder="给 Agent 发消息"
              onPressEnter={event => { if (!event.shiftKey && text.trim()) { event.preventDefault(); send(); } }}
            />
            <div className="agent-composer-actions">
              <Typography.Text type="secondary">Enter 发送 · Shift+Enter 换行</Typography.Text>
              <Space wrap>
                {pendingApproval && <Button danger loading={resolveApproval.isPending} onClick={() => resolveApproval.mutate({ approval: pendingApproval, decision: 'reject' })}>拒绝</Button>}
                {needsDefault && pendingApproval && <Button loading={resolveApproval.isPending} onClick={() => resolveApproval.mutate({ approval: pendingApproval, decision: 'approve' })}>确认默认值</Button>}
                {readyToInvoke && pendingApproval && <Button type="primary" loading={resolveApproval.isPending} onClick={() => resolveApproval.mutate({ approval: pendingApproval, decision: 'approve' })}>提交优化任务</Button>}
                <Button aria-label="发送" type={needsDefault || readyToInvoke ? 'default' : 'primary'} disabled={!text.trim() || analyze.isPending} onClick={send}>发送</Button>
              </Space>
            </div>
          </div>
        </Card>

        <div id="agent-run-inspector" className={`agent-run-inspector-layer ${runInspectorOpen ? 'is-open' : ''}`}>
          {runInspectorOpen && (
            <>
              <button type="button" className="agent-run-inspector-backdrop" aria-label="关闭活动面板" onClick={closeRunInspector} />
              <div ref={inspectorDialogRef} className="agent-run-card-open" role="dialog" aria-modal="true" aria-labelledby="agent-run-inspector-title" tabIndex={-1} onKeyDown={handleInspectorKeyDown}>
                <Card className="content-card agent-run-card" title={<Space size={8}><span id="agent-run-inspector-title">活动</span><Typography.Text type="secondary">· {activityStatus.label}</Typography.Text></Space>} extra={<Space size={4}>{activeTask && <Button danger type="text" loading={cancelTask.isPending} onClick={() => cancelTask.mutate(activeTask.task_id)}>取消任务</Button>}<Button type="link" onClick={toggleExpertView}>{expertView ? '收起诊断' : '诊断信息'}</Button><Button type="text" aria-label="关闭运行检查器" aria-expanded={runInspectorOpen} aria-controls="agent-run-inspector" onClick={closeRunInspector}>关闭</Button></Space>}>
                  {expertView ? (
                    <AgentExpertDiagnostics
                      response={activeResponse}
                      run={displayRun}
                      task={selectedTask}
                      turns={conversation.data?.turns}
                      events={conversation.data?.events}
                      status={status.data}
                      selectedSkill={selectedSkill}
                      skillOptions={skillOptions}
                      onSelectSkill={setSelectedSkill}
                    />
                  ) : (
                    <>
                      {displayRun && (
                        <AgentRunInspector
                          run={displayRun}
                          task={selectedTask}
                          response={activeResponse}
                          turns={conversation.data?.turns}
                          events={conversation.data?.events}
                          onStartParameterInput={startParameterInput}
                          onBatchParameterInput={openBatchParameterInput}
                        />
                      )}
                      <AgentWorkflowActivity
                        tasks={conversation.data?.agent_tasks}
                        turns={conversation.data?.turns}
                        events={conversation.data?.events}
                        runs={conversation.data?.runs}
                        currentTaskId={selectedTask?.task_id}
                      />
                      <AgentExceptionActivity events={conversation.data?.events} turns={conversation.data?.turns} retryingTurnId={retryTurn.isPending ? retryTurn.variables : undefined} onRetry={turn => retryTurn.mutate(turn.turn_id)} />
                      {hasMeaningfulResult && activeResponse && <div className="agent-inspector-result"><AgentResultPanel response={activeResponse} /></div>}
                    </>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
      <Drawer rootClassName="agent-mobile-session-drawer" title="会话" placement="left" size="default" open={mobileSessionsOpen} destroyOnHidden onClose={() => setMobileSessionsOpen(false)} extra={<Button type="text" onClick={startConversation} loading={createConversationMutation.isPending}>新建</Button>}>
        {renderSessionContent()}
      </Drawer>
      <Modal
        rootClassName="agent-batch-parameter-modal"
        open={batchParameterOpen}
        title={`批量补充参数${batchFields.length ? `（${batchFields.length} 项待补充）` : ''}`}
        okText="写入对话"
        cancelText="取消"
        okButtonProps={{ disabled: batchFields.length === 0 }}
        destroyOnHidden
        onCancel={closeBatchParameterInput}
        onOk={writeBatchParametersToComposer}
      >
        <Typography.Paragraph type="secondary">可一次填写任意多项。写入后请在对话框复核并发送，未填写项会继续保留。</Typography.Paragraph>
        {batchFields.length ? (
          <div className="agent-batch-parameter-form">
            {batchFields.map(field => (
              <label key={field.id}>
                <span>{field.label}</span>
                <Input.TextArea
                  aria-label={`填写参数 ${field.name}`}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  placeholder={`请输入${field.name}`}
                  value={batchParameterValues[field.id] || ''}
                  onChange={event => {
                    setBatchParameterValues(values => ({ ...values, [field.id]: event.target.value }));
                    if (batchParameterError) setBatchParameterError('');
                  }}
                />
              </label>
            ))}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有需要补充的参数" />}
        {batchParameterError && <Alert className="agent-batch-parameter-error" type="warning" showIcon title={batchParameterError} />}
      </Modal>
      <Modal open={Boolean(deleteTarget)} title="删除会话？" okText="删除会话" cancelText="取消" okButtonProps={{ danger: true, loading: deleteConversationMutation.isPending }} onCancel={() => setDeleteTarget(undefined)} onOk={() => deleteTarget && deleteConversationMutation.mutate(deleteTarget.conversation_id)}>
        <Typography.Paragraph>确定删除“{deleteTarget?.title || deleteTarget?.last_message || deleteTarget?.conversation_id}”吗？删除后会同时删除该会话关联的运行记录，且无法恢复。</Typography.Paragraph>
      </Modal>
    </div>
  );
}
