import { Button, Card, Col, Empty, Input, Row, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  analyzeAgentMessage,
  applySampleParameters,
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
import type { AgentAnalyzeResponse, AgentMessage } from '../../types/agent';

function roleLabel(role?: string) {
  if (role === 'user') return '用户';
  if (role === 'assistant' || role === 'agent') return 'Agent';
  return role || '系统';
}

function notifySuccess(text: string) {
  if (import.meta.env.MODE !== 'test') message.success(text);
}

export function AgentWorkbenchPage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [text, setText] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentAnalyzeResponse>();
  const statusRefetchInterval = import.meta.env.MODE === 'test' ? false : 15000;
  const conversationRefetchInterval = import.meta.env.MODE === 'test' ? false : 10000;

  const status = useQuery({ queryKey: ['agent-status'], queryFn: getAgentStatus, refetchInterval: statusRefetchInterval });
  const skills = useQuery({ queryKey: ['agent-skills'], queryFn: getAgentSkills });
  const conversations = useQuery({ queryKey: ['agent-conversations'], queryFn: getAgentConversations, refetchInterval: conversationRefetchInterval });
  const conversation = useQuery({ queryKey: ['agent-conversation', conversationId], queryFn: () => getAgentConversation(conversationId!), enabled: !!conversationId });

  const refreshConversation = (id?: string) => {
    qc.invalidateQueries({ queryKey: ['agent-conversations'] });
    if (id) qc.invalidateQueries({ queryKey: ['agent-conversation', id] });
  };

  const createConversation = useMutation({
    mutationFn: () => createAgentConversation({ title: text.trim() || 'Agent 对话' }),
    onSuccess: data => {
      setConversationId(data.conversation_id);
      refreshConversation(data.conversation_id);
      notifySuccess('会话已创建');
    },
  });

  const analyze = useMutation({
    mutationFn: async () => {
      const content = text.trim();
      const payload = {
        conversation_id: conversationId,
        message: content,
        agent_skill_name: selectedSkill,
        skill_name: selectedSkill,
      };
      setLastUserText(content);
      return analyzeAgentMessage(payload);
    },
    onSuccess: data => {
      setLastResponse(data);
      if (data.conversation_id) setConversationId(data.conversation_id);
      setText('');
      refreshConversation(data.conversation_id || conversationId);
      notifySuccess('Agent 已分析输入');
    },
  });

  const confirmDefaults = useMutation({
    mutationFn: () => confirmAgentDefaults({ conversation_id: activeConversationId!, agent_skill_name: selectedSkill }),
    onSuccess: data => {
      setLastResponse(data);
      refreshConversation(data.conversation_id || activeConversationId);
      notifySuccess('默认值已确认');
    },
  });

  const confirmInvoke = useMutation({
    mutationFn: () => confirmAgentInvoke({ conversation_id: activeConversationId! }),
    onSuccess: data => {
      setLastResponse(data);
      refreshConversation(data.conversation_id || activeConversationId);
      notifySuccess('模型调用已提交');
    },
  });

  const applySample = useMutation({
    mutationFn: () => applySampleParameters({ conversation_id: activeConversationId!, agent_skill_name: selectedSkill }),
    onSuccess: data => {
      setLastResponse(data);
      refreshConversation(data.conversation_id || activeConversationId);
      notifySuccess('示例参数已应用');
    },
  });

  const activeConversationId = lastResponse?.conversation_id || conversationId;
  const llmReady = Boolean(status.data?.llm?.api_key_configured || status.data?.llm?.enabled);
  const platformReachable = Boolean(status.data?.platform?.reachable);
  const currentMessages = conversation.data?.messages || [];
  const fallbackMessages = useMemo<AgentMessage[]>(() => {
    const items: AgentMessage[] = [];
    if (lastUserText) items.push({ role: 'user', text: lastUserText });
    if (lastResponse && responseMessage(lastResponse)) items.push({ role: 'agent', text: responseMessage(lastResponse) });
    return items;
  }, [lastResponse, lastUserText]);
  const chatMessages = currentMessages.length ? currentMessages : fallbackMessages;
  const needsDefault = Boolean(lastResponse?.requires_default_confirmation || /DEFAULT/i.test(String(lastResponse?.workflow_state || lastResponse?.status || '')));
  const readyToInvoke = Boolean(lastResponse?.ready_to_invoke || /READY_TO_INVOKE|PARAMETER_READY/i.test(String(lastResponse?.workflow_state || lastResponse?.status || '')));
  const responseContext = (lastResponse || {}) as Record<string, unknown>;

  const skillOptions = (skills.data || []).map(skill => ({ value: skillValue(skill), label: skillLabel(skill) })).filter(option => option.value);
  const conversationOptions = (conversations.data || []).map(item => ({
    value: item.conversation_id,
    label: item.title || item.last_message || item.conversation_id,
  }));

  return (
    <>
      <PageHeader
        title="Agent 工作台"
        description="通过自然语言完成模型选择、参数抽取、求解调用与结果解释。"
        status={<Space wrap><Tag color={llmReady ? 'green' : 'orange'}>{llmReady ? '大模型服务已配置' : '当前未配置大模型服务，将使用规则引擎完成基础意图识别'}</Tag><Tag color={platformReachable ? 'green' : 'red'}>{platformReachable ? '平台服务可用' : 'Agent 服务暂不可用，请检查后端服务状态'}</Tag></Space>}
        extra={<Button onClick={() => createConversation.mutate()} loading={createConversation.isPending}>新建会话</Button>}
      />
      <Row gutter={[14, 14]} align="stretch" className="agent-workbench-grid">
        <Col xs={24} lg={5}>
          <Card className="content-card agent-session-card" title="会话">
            <Button block type="primary" onClick={() => createConversation.mutate()} loading={createConversation.isPending}>新建会话</Button>
            <Input allowClear className="section-gap" placeholder="搜索会话" />
            <div className="agent-session-list section-gap">
              {conversationOptions.length ? conversationOptions.map(item => (
                <button type="button" className={`agent-session-item ${item.value === conversationId ? 'active' : ''}`} key={item.value} onClick={() => setConversationId(item.value)}>
                  <Typography.Text strong ellipsis>{item.label}</Typography.Text>
                  <Typography.Text type="secondary">{item.value}</Typography.Text>
                </button>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史会话" />}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            className="content-card agent-chat-card"
            title="Agent 对话"
          >
            <div className="agent-message-list">
              <Spin spinning={conversation.isFetching}>
                {chatMessages.length ? chatMessages.map((item, index) => (
                  <div className={`agent-message ${item.role === 'user' ? 'user' : 'agent'}`} key={`${item.role || 'message'}-${index}`}>
                    <b>{roleLabel(item.role)}</b>
                    <div>{valueText(item.text || item.content)}</div>
                  </div>
                )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入优化需求开始对话" />}
              </Spin>
            </div>
            {lastResponse && <div className="agent-confirm-card"><AgentParameterPanel response={lastResponse} /></div>}
            <div className="agent-input-bar">
              <Input.TextArea
                value={text}
                rows={3}
                onChange={event => setText(event.target.value)}
                placeholder="描述优化任务，例如：基于光储模板创建日前调度模型，并补齐运行参数"
                onPressEnter={event => {
                  if (!event.shiftKey && text.trim()) {
                    event.preventDefault();
                    analyze.mutate();
                  }
                }}
              />
              <Space wrap>
                <Button type="primary" loading={analyze.isPending} disabled={!text.trim()} onClick={() => analyze.mutate()}>发送分析</Button>
                <Button disabled={!activeConversationId || !needsDefault} loading={confirmDefaults.isPending} onClick={() => confirmDefaults.mutate()}>确认默认值</Button>
                <Button disabled={!activeConversationId || !selectedSkill} loading={applySample.isPending} onClick={() => applySample.mutate()}>应用示例参数</Button>
                <Button disabled={!activeConversationId || !readyToInvoke} loading={confirmInvoke.isPending} onClick={() => confirmInvoke.mutate()}>确认调用</Button>
              </Space>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <Card className="content-card" title="调用上下文">
            <div className="field">
              <label>当前 Skill</label>
              <Select allowClear virtual={false} style={{ width: '100%' }} value={selectedSkill} onChange={setSelectedSkill} placeholder="选择 Agent Skill" options={skillOptions} loading={skills.isLoading} />
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>服务状态</span><span className="pill blue">/api/agent/status</span></div>
              <AgentStatusPanel status={status.data} />
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>Skill 列表</span><span className="pill blue">agent-skills</span></div>
              <AgentSkillPanel skills={skills.data} selectedSkill={selectedSkill} />
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>意图识别 / 参数抽取</span></div>
              <AgentWorkflowPanel response={lastResponse} />
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>候选模型 / 调用状态</span></div>
              <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                <Typography.Text>候选模型：{valueText(responseContext.resolved_skill_name || responseContext.api_skill_name || selectedSkill || '-')}</Typography.Text>
                <Typography.Text>调用状态：{valueText(lastResponse?.workflow_state || lastResponse?.status || '-')}</Typography.Text>
                <Typography.Text>结果解释：{valueText(responseContext.explanation ? '已生成解释' : responseMessage(lastResponse) || '-')}</Typography.Text>
              </Space>
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>调用结果</span></div>
              <AgentResultPanel response={lastResponse} />
            </div>
            <div className="panel section-gap">
              <div className="panel-title"><span>调用日志</span></div>
              <div className="agent-timeline-item">当前会话：{activeConversationId || '-'}</div>
              <AgentMessageTimeline conversation={conversation.data} fallback={lastResponse} />
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
