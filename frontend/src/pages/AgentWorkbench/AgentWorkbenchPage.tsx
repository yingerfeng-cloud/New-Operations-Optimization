import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  agentRunEventStreamUrl,
  analyzeAgentMessage,
  confirmAgentDefaults,
  confirmAgentInvoke,
  createAgentConversation,
  getAgentConversation,
  getAgentConversations,
  getAgentSkills,
  getAgentStatus,
} from '../../api/agents';
import { PageHeader } from '../../components/PageHeader';
import {
  AgentMessageTimeline,
  AgentParameterPanel,
  AgentResultPanel,
  AgentSkillPanel,
  AgentStatusPanel,
  AgentWorkflowPanel,
  responseMessage,
  skillLabel,
  skillValue,
  valueText,
} from '../../features/agent-workbench/AgentPanels';
import {
  AgentRunInspector,
  responseFromRun,
  runStatusMeta,
  transientRunFromResponse,
} from '../../features/agent-workbench/AgentRunPanels';
import type { AgentAnalyzeResponse, AgentMessage, AgentRun } from '../../types/agent';

const examples = ['制定明日机组组合计划', '优化储能充放电策略', '分析中长期合同与现货敞口', '生成梯级水电调度方案'];
const roleLabel = (role?: string) => role === 'user' ? '用户' : role === 'assistant' || role === 'agent' ? 'Agent' : role || '系统';
const activeStatuses = new Set(['DRAFT', 'ROUTING', 'CLARIFICATION', 'PARAMETER_REVIEW', 'APPROVAL_REQUIRED', 'READY', 'QUEUED', 'RUNNING']);

export function AgentWorkbenchPage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentAnalyzeResponse>();
  const [expertView, setExpertView] = useState(false);

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

  const responseRun = lastResponse?.run || transientRunFromResponse(lastResponse as Record<string, unknown> | undefined);
  const activeRun: AgentRun | undefined = responseRun || conversation.data?.active_run;
  const activeResponse = lastResponse || responseFromRun(activeRun);
  const activeConversationId = activeResponse?.conversation_id || conversationId;

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

  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['agent-conversations'] });
    if (id) void qc.invalidateQueries({ queryKey: ['agent-conversation', id] });
  };
  const clearTransientContext = () => {
    setLastResponse(undefined);
    setLastUserText('');
  };

  const createConversationMutation = useMutation({
    mutationFn: () => createAgentConversation({ title: '新会话' }),
    onSuccess: data => {
      clearTransientContext();
      setSelectedSkill(undefined);
      setText('');
      setConversationId(data.conversation_id);
      refresh(data.conversation_id);
    },
  });
  const analyze = useMutation({
    mutationFn: () => {
      const content = text.trim();
      setLastUserText(content);
      return analyzeAgentMessage({
        conversation_id: conversationId,
        message: content,
        ...(selectedSkill ? { agent_skill_name: selectedSkill, skill_name: selectedSkill } : {}),
      });
    },
    onSuccess: data => {
      setLastResponse(data);
      setConversationId(data.conversation_id || conversationId);
      setText('');
      refresh(data.conversation_id || conversationId);
    },
  });
  const confirmDefaults = useMutation({
    mutationFn: () => confirmAgentDefaults({
      conversation_id: activeConversationId!,
      ...(activeRun?.run_id ? { run_id: activeRun.run_id } : {}),
      ...(selectedSkill ? { agent_skill_name: selectedSkill } : {}),
    }),
    onSuccess: data => {
      setLastResponse(data);
      refresh(data.conversation_id || activeConversationId);
    },
  });
  const confirmInvoke = useMutation({
    mutationFn: () => confirmAgentInvoke({
      conversation_id: activeConversationId!,
      ...(activeRun?.run_id ? { run_id: activeRun.run_id, idempotency_key: `invoke:${activeRun.run_id}` } : {}),
    }),
    onSuccess: data => {
      setLastResponse(data);
      refresh(data.conversation_id || activeConversationId);
      if (!data.already_running) message.success('优化任务已提交');
    },
  });

  const chatMessages = useMemo<AgentMessage[]>(() => {
    const items = [...(conversation.data?.messages || [])];
    if (lastUserText && !items.some(item => (item.text || item.content) === lastUserText)) items.push({ role: 'user', text: lastUserText });
    const reply = responseMessage(lastResponse);
    if (reply && !items.some(item => (item.text || item.content) === reply)) items.push({ role: 'agent', text: reply });
    return items;
  }, [conversation.data?.messages, lastResponse, lastUserText]);

  const needsDefault = Boolean(activeResponse?.requires_default_confirmation || activeRun?.status === 'APPROVAL_REQUIRED' || /DEFAULT/i.test(String(activeResponse?.workflow_state || activeResponse?.status || '')));
  const readyToInvoke = !needsDefault && Boolean(activeResponse?.ready_to_invoke || activeRun?.status === 'READY' || /READY_TO_INVOKE|PARAMETER_READY/i.test(String(activeResponse?.workflow_state || activeResponse?.status || '')));
  const conversationOptions = (conversations.data || [])
    .map(item => ({ ...item, label: item.title || item.last_message || item.conversation_id, searchable: `${item.title || ''} ${item.last_message || ''} ${item.conversation_id}`.toLowerCase() }))
    .filter(item => item.searchable.includes(search.trim().toLowerCase()));
  const skillOptions = (skills.data || []).map(item => ({ value: skillValue(item), label: skillLabel(item) })).filter(item => item.value);
  const platformReachable = Boolean(status.data?.platform?.reachable);
  const serviceState = status.isPending
    ? { color: 'processing', label: '服务检查中' }
    : platformReachable
      ? { color: 'green', label: '服务可用' }
      : { color: 'red', label: '服务不可用' };

  const startConversation = () => createConversationMutation.mutate();
  const selectConversation = (id: string) => {
    clearTransientContext();
    setConversationId(id);
    setText('');
  };
  const toggleExpertView = () => {
    if (expertView) setSelectedSkill(undefined);
    setExpertView(value => !value);
  };
  const send = () => {
    if (text.trim() && !analyze.isPending) analyze.mutate();
  };

  return (
    <>
      <PageHeader
        title="Agent 工作台"
        description="描述业务目标，Agent 将识别场景、校验参数并创建可追踪的优化运行。"
        status={<Space wrap><Tag color={serviceState.color}>{serviceState.label}</Tag><Tag>{expertView && selectedSkill ? `已指定 Skill：${selectedSkill}` : '默认自动识别 Skill'}</Tag></Space>}
        extra={<Button type="primary" onClick={startConversation} loading={createConversationMutation.isPending}>新建会话</Button>}
      />
      {status.isError && <Alert className="agent-service-alert" showIcon type="error" title="Agent 服务不可用" description="当前前端未能连接 Agent API，请检查统一后端服务是否以 combined 模式启动。" action={<Button size="small" onClick={() => status.refetch()}>重新检查</Button>} />}
      <div className="agent-workbench-layout">
        <Card className="content-card agent-session-card" title="会话与运行">
          <Input allowClear placeholder="搜索标题、最近消息或会话 ID" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="agent-session-list section-gap">
            {conversationOptions.length ? conversationOptions.map(item => {
              const runMeta = runStatusMeta(item.active_run_status);
              return (
                <button type="button" className={`agent-session-item ${item.conversation_id === conversationId ? 'active' : ''}`} key={item.conversation_id} onClick={() => selectConversation(item.conversation_id)}>
                  <Typography.Text strong ellipsis>{item.label}</Typography.Text>
                  <span><Tag color={runMeta.color}>{runMeta.label}</Tag><Typography.Text type="secondary">{item.updated_at || item.conversation_id}</Typography.Text></span>
                </button>
              );
            }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? '没有匹配会话' : '暂无历史会话'} />}
          </div>
        </Card>

        <Card className="content-card agent-chat-card" title="优化对话">
          <div className="agent-message-list" aria-live="polite">
            <Spin spinning={conversation.isFetching}>
              {chatMessages.length ? chatMessages.map((item, index) => (
                <div className={`agent-message ${item.role === 'user' ? 'user' : 'agent'}`} key={String(item.message_id || item.created_at || `${item.role}-${index}`)}>
                  <b>{roleLabel(item.role)}</b>
                  <div>{valueText(item.text || item.content)}</div>
                  {item.created_at && <small>{item.created_at}</small>}
                </div>
              )) : (
                <div className="agent-empty-prompts">
                  <Typography.Title level={4}>今天需要优化什么？</Typography.Title>
                  <Typography.Paragraph type="secondary">先描述目标；Agent 会在执行前展示参数和审批项。</Typography.Paragraph>
                  <div>{examples.map(example => <button key={example} type="button" onClick={() => setText(example)}>{example}</button>)}</div>
                </div>
              )}
            </Spin>
          </div>
          {activeResponse && activeRun && <div className="agent-confirm-card"><AgentParameterPanel response={activeResponse} /></div>}
          <div className="agent-input-bar">
            <Input.TextArea
              aria-label="优化需求"
              value={text}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={event => setText(event.target.value)}
              placeholder="描述优化目标、时间范围和可用数据"
              onPressEnter={event => { if (!event.shiftKey && text.trim()) { event.preventDefault(); send(); } }}
            />
            <div className="agent-composer-actions">
              <Typography.Text type="secondary">Enter 发送 · Shift+Enter 换行</Typography.Text>
              <Space wrap>
                {needsDefault && <Button loading={confirmDefaults.isPending} disabled={!activeConversationId} onClick={() => confirmDefaults.mutate()}>确认默认值</Button>}
                {readyToInvoke && <Button type="primary" loading={confirmInvoke.isPending} disabled={!activeConversationId} onClick={() => confirmInvoke.mutate()}>提交优化任务</Button>}
                <Button type={needsDefault || readyToInvoke ? 'default' : 'primary'} loading={analyze.isPending} disabled={!text.trim()} onClick={send}>发送需求</Button>
              </Space>
            </div>
          </div>
        </Card>

        <Card className="content-card agent-run-card" title="运行检查器" extra={<Button type="link" onClick={toggleExpertView}>{expertView ? '返回业务视图' : '专家视图'}</Button>}>
          <AgentRunInspector run={activeRun} />
          {activeResponse && <AgentResultPanel response={activeResponse} />}
          {expertView && (
            <div className="agent-expert-panel">
              <div className="field"><label>指定 Skill</label><Select aria-label="指定 Skill" allowClear virtual={false} value={selectedSkill} onChange={setSelectedSkill} placeholder="自动识别 Skill（可手工指定）" options={skillOptions} /></div>
              <div className="panel section-gap"><AgentWorkflowPanel response={activeResponse} /></div>
              <div className="panel section-gap"><AgentStatusPanel status={status.data} /></div>
              <div className="panel section-gap"><AgentSkillPanel skills={skills.data} selectedSkill={selectedSkill} /></div>
              <div className="panel section-gap"><AgentMessageTimeline conversation={conversation.data} fallback={lastResponse} /></div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
