import { Alert, Card, Collapse, Descriptions, Empty, Space, Table, Tag } from 'antd';
import { JsonViewer } from '../../components/JsonViewer';
import { StatusTag } from '../../components/StatusTag';
import type { AgentAnalyzeResponse, AgentConversation, AgentMessage, AgentSkill, AgentStatus } from '../../types/agent';

type Row = Record<string, unknown> & { __row_key: string };

export function valueText(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function objectRows(value?: Record<string, unknown>) {
  return Object.entries(value || {}).map(([key, item], index) => ({ key, value: item, __row_key: `${key}-${index}` }));
}

function listRows(value?: unknown[], prefix = 'row'): Row[] {
  return (value || []).map((item, index) => typeof item === 'object' && item ? { ...(item as Record<string, unknown>), __row_key: `${prefix}-${index}` } : { item, __row_key: `${prefix}-${index}` });
}

export function skillLabel(skill?: AgentSkill) {
  if (!skill) return '-';
  return String(skill.display_name || skill.name || skill.skill_name || '-');
}

export function skillValue(skill?: AgentSkill) {
  if (!skill) return undefined;
  return String(skill.name || skill.skill_name || skill.display_name || '');
}

export function responseMessage(response?: AgentAnalyzeResponse) {
  return response?.agent_message || response?.message || '';
}

export function AgentStatusPanel({ status }: { status?: AgentStatus }) {
  const llm = status?.llm || {};
  const platform = status?.platform || {};
  const apiReady = Boolean(llm.api_key_configured || llm.enabled);
  return (
    <Descriptions size="small" bordered column={1}>
      <Descriptions.Item label="大模型服务"><Tag color={apiReady ? 'green' : 'gold'}>{apiReady ? '已配置' : '使用规则引擎识别基础意图'}</Tag></Descriptions.Item>
      <Descriptions.Item label="Provider">{valueText(llm.provider)}</Descriptions.Item>
      <Descriptions.Item label="模型">{valueText(llm.model)}</Descriptions.Item>
      <Descriptions.Item label="平台服务"><Tag color={platform.reachable ? 'green' : 'red'}>{platform.reachable ? '可用' : '暂不可用，请检查后端服务状态'}</Tag></Descriptions.Item>
      <Descriptions.Item label="Skill 状态"><Tag color={platform.skill_registry_ok ? 'green' : 'gold'}>{platform.skill_registry_ok ? '可用' : '暂无可用 Skill，请先在系统配置或组件库中启用'}</Tag></Descriptions.Item>
      <Descriptions.Item label="Skill 数量">{valueText(platform.skill_count)}</Descriptions.Item>
    </Descriptions>
  );
}

export function AgentSkillPanel({ skills, selectedSkill }: { skills?: AgentSkill[]; selectedSkill?: string }) {
  const rows = skills || [];
  if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用 Skill，请先在系统配置或组件库中启用。" />;
  return (
    <Space orientation="vertical" size={8} className="full-width">
      <Space wrap>
        {rows.map(skill => {
          const value = skillValue(skill);
          return <Tag key={value || skillLabel(skill)} color={value === selectedSkill ? 'blue' : skill.enabled === false ? 'default' : 'green'}>{skillLabel(skill)}</Tag>;
        })}
      </Space>
      <Table
        size="small"
        pagination={false}
        rowKey={(record) => skillValue(record) || skillLabel(record)}
        dataSource={rows}
        columns={[
          { title: 'Skill', render: (_, skill) => skillLabel(skill) },
          { title: '状态', render: (_, skill) => <StatusTag status={skill.validation?.status || (skill.enabled === false ? 'offline' : 'valid')} /> },
          { title: '必填参数', render: (_, skill) => (skill.required_parameters || []).join(', ') || '-' },
        ]}
      />
    </Space>
  );
}

export function AgentWorkflowPanel({ response }: { response?: AgentAnalyzeResponse }) {
  if (!response) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待用户输入后展示识别结果" />;
  return (
    <>
      <Descriptions size="small" bordered column={1}>
        <Descriptions.Item label="响应类型">{valueText(response.response_type)}</Descriptions.Item>
        <Descriptions.Item label="意图">{valueText(response.intent)}</Descriptions.Item>
        <Descriptions.Item label="工作流"><StatusTag status={response.workflow_state || response.status} /></Descriptions.Item>
        <Descriptions.Item label="Agent Skill">{valueText(response.agent_skill_name)}</Descriptions.Item>
        <Descriptions.Item label="平台 Skill">{valueText(response.resolved_skill_name || response.api_skill_name)}</Descriptions.Item>
        <Descriptions.Item label="路由置信度">{response.route_confidence === undefined ? '-' : `${Math.round(response.route_confidence * 100)}%`}</Descriptions.Item>
        <Descriptions.Item label="选择理由">{valueText(response.selection_reason)}</Descriptions.Item>
        <Descriptions.Item label="需要澄清"><Tag color={response.needs_clarification ? 'orange' : 'green'}>{response.needs_clarification ? '是' : '否'}</Tag></Descriptions.Item>
      </Descriptions>
      {Boolean(response.candidate_skills?.length) && <Card size="small" title="候选 Skill Top 3" className="section-gap"><Table size="small" pagination={false} rowKey={(row) => String(row.agent_skill_name || row.platform_skill_name)} dataSource={response.candidate_skills} columns={[{ title: 'Skill', render: (_, row) => valueText(row.display_name || row.agent_skill_name || row.platform_skill_name) }, { title: '分数', render: (_, row) => valueText(row.final_score) }, { title: '理由', render: (_, row) => valueText(row.reason) }]} /></Card>}
      {response.clarification_question && <Alert showIcon type="warning" title="需要澄清" description={response.clarification_question} className="section-gap" />}
      {responseMessage(response) && <Alert showIcon type="info" title="Agent 回复" description={responseMessage(response)} className="section-gap" />}
    </>
  );
}

export function AgentParameterPanel({ response }: { response?: AgentAnalyzeResponse }) {
  if (!response) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无参数草稿" />;
  const missing = response.missing_required || [];
  const invalid = response.invalid_parameters || [];
  return (
    <>
      {missing.length > 0 && <Alert showIcon type="warning" title="缺失必填参数" description={missing.map(valueText).join('；')} className="section-gap" />}
      {invalid.length > 0 && <Alert showIcon type="error" title="参数校验失败" description={invalid.map(valueText).join('；')} className="section-gap" />}
      <Card size="small" title="参数草稿">
        <Descriptions size="small" bordered column={1} className="section-gap">
          <Descriptions.Item label="参数完整度">{response.parameter_completeness === undefined ? '-' : `${Math.round(response.parameter_completeness * 100)}%`}</Descriptions.Item>
          <Descriptions.Item label="Schema 适配度">{response.schema_fit_score === undefined ? '-' : `${Math.round(response.schema_fit_score * 100)}%`}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          pagination={false}
          rowKey="__row_key"
          dataSource={objectRows(response.parameter_draft || response.normalized_parameters)}
          columns={[
            { title: '参数', dataIndex: 'key' },
            { title: '值', dataIndex: 'value', render: valueText },
            { title: '来源', dataIndex: 'key', render: (key: string) => valueText(response.parameter_sources?.[key]) },
          ]}
          locale={{ emptyText: '暂无参数' }}
        />
      </Card>
      {Boolean(response.can_use_default?.length) && (
        <Card size="small" title="可使用默认值" className="section-gap">
          <Table size="small" pagination={false} rowKey="__row_key" dataSource={listRows(response.can_use_default, 'default')} columns={[{ title: '参数', render: (_, row) => valueText(row.name || row.parameter || row.item) }, { title: '默认值', render: (_, row) => valueText(row.default ?? row.value) }]} />
        </Card>
      )}
    </>
  );
}

export function AgentResultPanel({ response }: { response?: AgentAnalyzeResponse }) {
  const result = response?.result || response?.task_session?.result;
  if (!response || (!result && !response.task_session && response.objective_value === undefined)) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="调用完成后展示结果" />;
  const resultRecord = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const structured = ((resultRecord.explanation_structured || (typeof response.explanation === 'object' ? response.explanation : {})) || {}) as Record<string, unknown>;
  const facts = Array.isArray(structured.facts) ? structured.facts : [];
  const inferences = Array.isArray(structured.inferences) ? structured.inferences : [];
  const recommendations = Array.isArray(structured.recommendations) ? structured.recommendations : [];
  const risks = Array.isArray(structured.risk_notes) ? structured.risk_notes : [];
  const manual = Array.isArray(structured.manual_review_points) ? structured.manual_review_points : [];
  const limitations = Array.isArray(structured.limitations) ? structured.limitations : [];
  const evidence = resultRecord.evidence_package;
  return (
    <>
      <Descriptions size="small" bordered column={1}>
        <Descriptions.Item label="会话">{valueText(response.conversation_id)}</Descriptions.Item>
        <Descriptions.Item label="调用编号">{valueText(response.invocation_id)}</Descriptions.Item>
        <Descriptions.Item label="任务编号">{valueText(response.task_session?.task_id)}</Descriptions.Item>
        <Descriptions.Item label="目标值">{valueText(response.objective_value)}</Descriptions.Item>
      </Descriptions>
      {(facts.length + inferences.length + recommendations.length + risks.length + manual.length + limitations.length > 0) && <Space orientation="vertical" size={8} className="full-width section-gap">
        <Card size="small" title="事实">{facts.length ? facts.map((item, index) => <div key={`fact-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="推断">{inferences.length ? inferences.map((item, index) => <div key={`inference-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="建议">{recommendations.length ? recommendations.map((item, index) => <div key={`recommendation-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="风险提示">{risks.length ? risks.map((item, index) => <div key={`risk-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="人工复核点">{manual.length ? manual.map((item, index) => <div key={`manual-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="解释限制">{limitations.length ? limitations.map((item, index) => <div key={`limit-${index}`}>{valueText(item)}</div>) : '无'}</Card>
      </Space>}
      {evidence !== undefined && <Collapse className="section-gap" items={[{ key: 'evidence', label: '查看原始 evidence package', children: <JsonViewer value={evidence} /> }]} />}
      {result !== undefined && <Card size="small" title="原始结果" className="section-gap"><JsonViewer value={result} /></Card>}
    </>
  );
}

export function AgentMessageTimeline({ conversation, fallback }: { conversation?: AgentConversation; fallback?: AgentAnalyzeResponse }) {
  const messages = conversation?.messages || [];
  if (!messages.length && !fallback) return <div className="agent-timeline-item">等待调用</div>;
  const items = messages.map((message: AgentMessage, index) => ({
    color: message.role === 'user' ? 'blue' : 'green',
    content: <span>{valueText(message.role || 'agent')}：{valueText(message.text || message.content)}</span>,
    key: `${message.role || 'message'}-${index}`,
  }));
  if (fallback && responseMessage(fallback)) {
    items.push({ color: 'green', content: <span>agent：{responseMessage(fallback)}</span>, key: 'fallback-response' });
  }
  return (
    <div className="agent-timeline-list">
      {items.map(item => <div className={`agent-timeline-item ${item.color}`} key={item.key}>{item.content}</div>)}
    </div>
  );
}
