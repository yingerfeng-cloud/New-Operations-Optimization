import { Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { analyzeAgentMessage, confirmAgentDefaults, confirmAgentInvoke, createAgentConversation, getAgentConversation, getAgentConversations, getAgentSkills, getAgentStatus } from '../../api/agents';
import { PageHeader } from '../../components/PageHeader';
import { AgentMessageTimeline, AgentParameterPanel, AgentResultPanel, AgentSkillPanel, AgentStatusPanel, AgentWorkflowPanel, responseMessage, skillLabel, skillValue, valueText } from '../../features/agent-workbench/AgentPanels';
import type { AgentAnalyzeResponse, AgentMessage } from '../../types/agent';

const examples = ['制定明日机组组合计划', '优化储能充放电策略', '分析中长期合同与现货敞口', '生成梯级水电调度方案'];
const roleLabel = (role?: string) => role === 'user' ? '用户' : role === 'assistant' || role === 'agent' ? 'Agent' : role || '系统';

export function AgentWorkbenchPage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentAnalyzeResponse>();
  const [expertView, setExpertView] = useState(false);
  const interval = import.meta.env.MODE === 'test' ? false : 15000;
  const status = useQuery({ queryKey: ['agent-status'], queryFn: getAgentStatus, refetchInterval: interval });
  const skills = useQuery({ queryKey: ['agent-skills'], queryFn: getAgentSkills });
  const conversations = useQuery({ queryKey: ['agent-conversations'], queryFn: getAgentConversations, refetchInterval: interval });
  const conversation = useQuery({ queryKey: ['agent-conversation', conversationId], queryFn: () => getAgentConversation(conversationId!), enabled: !!conversationId });
  const refresh = (id?: string) => { qc.invalidateQueries({ queryKey: ['agent-conversations'] }); if (id) qc.invalidateQueries({ queryKey: ['agent-conversation', id] }); };
  const clearExecutionContext = () => { setLastResponse(undefined); setLastUserText(''); };
  const createConversationMutation = useMutation({ mutationFn: () => createAgentConversation({ title: '新会话' }), onSuccess: data => { clearExecutionContext(); setSelectedSkill(undefined); setConversationId(data.conversation_id); refresh(data.conversation_id); } });
  const startConversation = () => { clearExecutionContext(); setSelectedSkill(undefined); setText(''); createConversationMutation.mutate(); };
  const selectConversation = (id: string) => { clearExecutionContext(); setConversationId(id); };
  const toggleExpertView = () => { if (expertView) setSelectedSkill(undefined); setExpertView(value => !value); };
  const analyze = useMutation({ mutationFn: () => { const content = text.trim(); setLastUserText(content); return analyzeAgentMessage({ conversation_id: conversationId, message: content, ...(selectedSkill ? { agent_skill_name: selectedSkill, skill_name: selectedSkill } : {}) }); }, onSuccess: data => { setLastResponse(data); setConversationId(data.conversation_id || conversationId); setText(''); refresh(data.conversation_id || conversationId); } });
  const activeConversationId = lastResponse?.conversation_id || conversationId;
  const confirmDefaults = useMutation({ mutationFn: () => confirmAgentDefaults({ conversation_id: activeConversationId!, ...(selectedSkill ? { agent_skill_name: selectedSkill } : {}) }), onSuccess: data => { setLastResponse(data); refresh(data.conversation_id || activeConversationId); } });
  const confirmInvoke = useMutation({ mutationFn: () => confirmAgentInvoke({ conversation_id: activeConversationId! }), onSuccess: data => { setLastResponse(data); refresh(data.conversation_id || activeConversationId); message.success('优化任务已提交'); } });
  const fallbackMessages = useMemo<AgentMessage[]>(() => { const items: AgentMessage[] = []; if (lastUserText) items.push({ role: 'user', text: lastUserText }); if (lastResponse && responseMessage(lastResponse)) items.push({ role: 'agent', text: responseMessage(lastResponse) }); return items; }, [lastResponse, lastUserText]);
  const chatMessages = conversation.data?.messages?.length ? conversation.data.messages : fallbackMessages;
  const needsDefault = Boolean(lastResponse?.requires_default_confirmation || /DEFAULT/i.test(String(lastResponse?.workflow_state || lastResponse?.status || '')));
  const readyToInvoke = Boolean(lastResponse?.ready_to_invoke || /READY_TO_INVOKE|PARAMETER_READY/i.test(String(lastResponse?.workflow_state || lastResponse?.status || '')));
  const context = (lastResponse || {}) as Record<string, unknown>;
  const conversationOptions = (conversations.data || []).map(item => ({ value: item.conversation_id, label: item.title || item.last_message || item.conversation_id, searchable: `${item.title || ''} ${item.last_message || ''} ${item.conversation_id}`.toLowerCase() })).filter(item => item.searchable.includes(search.trim().toLowerCase()));
  const skillOptions = (skills.data || []).map(item => ({ value: skillValue(item), label: skillLabel(item) })).filter(item => item.value);

  return <>
    <PageHeader title="Agent 工作台" description="用业务语言描述优化需求，Agent 将自动识别场景、匹配模型、确认参数并生成结果。" status={<Space wrap><Tag color={status.data?.platform?.reachable ? 'green' : 'orange'}>{status.data?.platform?.reachable ? '服务可用' : '服务待检查'}</Tag><Tag>{expertView && selectedSkill ? `已指定 Skill：${selectedSkill}` : '默认自动识别 Skill'}</Tag></Space>} extra={<Button onClick={startConversation} loading={createConversationMutation.isPending}>新建会话</Button>} />
    <div className="agent-workbench-layout">
      <Card className="content-card agent-session-card" title="会话"><Button block type="primary" onClick={startConversation}>新建会话</Button><Input allowClear className="section-gap" placeholder="搜索标题、最近消息或会话 ID" value={search} onChange={event => setSearch(event.target.value)} /><div className="agent-session-list section-gap">{conversationOptions.length ? conversationOptions.map(item => <button type="button" className={`agent-session-item ${item.value === conversationId ? 'active' : ''}`} key={item.value} onClick={() => selectConversation(item.value)}><Typography.Text strong ellipsis>{item.label}</Typography.Text><Typography.Text type="secondary">{item.value}</Typography.Text></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? '没有匹配会话' : '暂无历史会话'} />}</div></Card>
      <Card className="content-card agent-chat-card" title="优化对话"><div className="agent-message-list"><Spin spinning={conversation.isFetching}>{chatMessages.length ? chatMessages.map((item, index) => <div className={`agent-message ${item.role === 'user' ? 'user' : 'agent'}`} key={`${item.role}-${index}`}><b>{roleLabel(item.role)}</b><div>{valueText(item.text || item.content)}</div></div>) : <div className="agent-empty-prompts"><Typography.Title level={4}>今天需要优化什么？</Typography.Title><Typography.Paragraph type="secondary">选择示例只会填入输入框，不会直接提交。</Typography.Paragraph><div>{examples.map(example => <button key={example} type="button" onClick={() => setText(example)}>{example}</button>)}</div></div>}</Spin></div>{lastResponse && <div className="agent-confirm-card"><AgentParameterPanel response={lastResponse} /></div>}<div className="agent-input-bar"><Input.TextArea value={text} rows={3} onChange={event => setText(event.target.value)} placeholder="描述优化目标、时间范围和可用数据" onPressEnter={event => { if (!event.shiftKey && text.trim()) { event.preventDefault(); analyze.mutate(); } }} /><Space wrap><Button type="primary" loading={analyze.isPending} disabled={!text.trim()} onClick={() => analyze.mutate()}>发送需求</Button><Button disabled={!activeConversationId || !needsDefault} onClick={() => confirmDefaults.mutate()}>确认默认值</Button><Button disabled={!activeConversationId || !readyToInvoke} onClick={() => confirmInvoke.mutate()}>提交优化任务</Button></Space></div></Card>
      <Card className="content-card" title="任务进展" extra={<Button type="link" onClick={toggleExpertView}>{expertView ? '返回业务视图' : '专家视图'}</Button>}>{!expertView ? <div className="agent-business-context"><div><span>识别场景</span><strong>{valueText(context.scene || context.intent || '等待需求')}</strong></div><div><span>匹配模型</span><strong>{valueText(context.resolved_model_name || context.resolved_skill_name || '自动匹配')}</strong></div><div><span>参数完整性</span><strong>{lastResponse ? needsDefault ? '需要确认' : '已检查' : '尚未检查'}</strong></div><div><span>任务状态</span><strong>{valueText(lastResponse?.workflow_state || lastResponse?.status || '未开始')}</strong></div><AgentWorkflowPanel response={lastResponse} />{lastResponse && <AgentResultPanel response={lastResponse} />}</div> : <><div className="field"><label>指定 Skill</label><Select aria-label="指定 Skill" allowClear virtual={false} style={{ width: '100%' }} value={selectedSkill} onChange={setSelectedSkill} placeholder="自动识别 Skill（可手工指定）" options={skillOptions} /></div><div className="panel section-gap"><AgentStatusPanel status={status.data} /></div><div className="panel section-gap"><AgentSkillPanel skills={skills.data} selectedSkill={selectedSkill} /></div><div className="panel section-gap"><AgentMessageTimeline conversation={conversation.data} fallback={lastResponse} /></div></>}</Card>
    </div>
  </>;
}
