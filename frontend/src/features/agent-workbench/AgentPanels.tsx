import { Alert, Button, Card, Collapse, Descriptions, Empty, Space, Table, Tag } from 'antd';
import { JsonViewer } from '../../components/JsonViewer';
import { StatusTag } from '../../components/StatusTag';
import type { AgentAnalyzeResponse, AgentConversation, AgentMessage, AgentSkill, AgentStatus } from '../../types/agent';

type Row = Record<string, unknown> & { __row_key: string };

export function valueText(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function parameterText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return valueText(value);
  const record = value as Record<string, unknown>;
  const name = valueText(record.name || record.parameter || record.key || '未命名参数');
  const key = record.key && String(record.key) !== name ? ` · ${String(record.key)}` : '';
  const unit = record.unit ? `（${String(record.unit)}）` : '';
  const error = record.message || record.error;
  return `${name}${key}${unit}${error ? `：${String(error)}` : ''}`;
}

function parameterValueText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return valueText(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${valueText(item)}`)
    .join('，');
}

function objectRows(value?: Record<string, unknown>) {
  return Object.entries(value || {}).map(([key, item], index) => ({ key, value: item, __row_key: `${key}-${index}` }));
}

function listRows(value?: unknown[], prefix = 'row'): Row[] {
  return (value || []).map((item, index) => typeof item === 'object' && item ? { ...(item as Record<string, unknown>), __row_key: `${prefix}-${index}` } : { item, __row_key: `${prefix}-${index}` });
}

function parameterList(values: unknown[], className: string) {
  return (
    <div className={`agent-missing-parameter-list ${className}`}>
      {values.map((value, index) => (
        <span className="agent-missing-parameter-chip" key={`${parameterText(value)}-${index}`}>
          {parameterText(value)}
        </span>
      ))}
    </div>
  );
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

type AgentModelCandidate = Record<string, unknown>;

function modelCandidateSkill(candidate: AgentModelCandidate) {
  return String(candidate.agent_skill_name || candidate.platform_skill_name || candidate.api_skill_name || '');
}

function modelCandidateLabel(candidate: AgentModelCandidate) {
  return String(candidate.display_name || candidate.agent_skill_name || candidate.platform_skill_name || '未命名优化模型');
}

function modelCandidateConfidence(candidate?: AgentModelCandidate) {
  const value = Number(candidate?.final_score);
  return Number.isFinite(value) ? value : undefined;
}

export function AgentModelDecisionCard({
  response,
  choosing,
  onChoose,
  onReviewParameters,
  onStartParameterInput,
  onBatchParameterInput,
}: {
  response?: AgentAnalyzeResponse;
  choosing?: boolean;
  onChoose: (skillName: string, label: string) => void;
  onReviewParameters?: () => void;
  onStartParameterInput?: () => void;
  onBatchParameterInput?: () => void;
}) {
  if (!response) return null;
  const candidates = (response.candidate_skills || []).filter(candidate => modelCandidateSkill(candidate));
  const currentSkill = String(response.agent_skill_name || response.resolved_skill_name || response.api_skill_name || '');
  const selectedCandidate = candidates.find(candidate => {
    const agentSkill = String(candidate.agent_skill_name || '');
    const platformSkill = String(candidate.platform_skill_name || candidate.api_skill_name || '');
    return Boolean(currentSkill && [agentSkill, platformSkill].includes(currentSkill));
  }) || (!response.needs_clarification ? candidates[0] : undefined);
  const selectedLabel = selectedCandidate
    ? modelCandidateLabel(selectedCandidate)
    : String(response.display_name || response.agent_skill_name || response.resolved_skill_name || response.api_skill_name || '');
  if (!selectedLabel && candidates.length === 0) return null;

  const selectedSkill = selectedCandidate ? modelCandidateSkill(selectedCandidate) : currentSkill;
  const confidence = response.route_confidence ?? modelCandidateConfidence(selectedCandidate);
  const missingCount = response.missing_required?.length || 0;
  const requiresChoice = Boolean(response.needs_clarification || !selectedSkill);

  return (
    <section className={`agent-model-decision ${requiresChoice ? 'requires-choice' : 'auto-selected'}`} aria-label="优化模型选择">
      <div className="agent-model-decision-head">
        <div>
          <span className="agent-model-eyebrow">{requiresChoice ? '需要确认优化场景' : '已自动选择优化模型'}</span>
          <strong>{selectedLabel || '请选择一个优化模型'}</strong>
        </div>
        {confidence !== undefined && <Tag color={requiresChoice ? 'gold' : 'blue'}>{`匹配度 ${Math.round(confidence * 100)}%`}</Tag>}
      </div>
      {response.selection_reason && <p className="agent-model-reason">选择依据：{String(response.selection_reason)}</p>}
      {requiresChoice && response.clarification_question && <p className="agent-model-question">{response.clarification_question}</p>}

      {candidates.length > 0 && (
        <details className="agent-model-candidates" open={requiresChoice || undefined}>
          <summary>{requiresChoice ? '请选择最符合需求的模型' : '查看或更换模型'}</summary>
          <div className="agent-model-candidate-list">
            {candidates.map(candidate => {
              const skillName = modelCandidateSkill(candidate);
              const label = modelCandidateLabel(candidate);
              const score = modelCandidateConfidence(candidate);
              const isCurrent = Boolean(selectedSkill && skillName === selectedSkill);
              return (
                <div className={`agent-model-candidate ${isCurrent ? 'is-current' : ''}`} key={skillName}>
                  <div>
                    <strong>{label}</strong>
                    <span>{score === undefined ? '候选优化模型' : `匹配度 ${Math.round(score * 100)}%`}</span>
                    {candidate.reason ? <small>{String(candidate.reason)}</small> : null}
                  </div>
                  <Button
                    size="small"
                    type={isCurrent ? 'default' : 'primary'}
                    disabled={isCurrent || choosing}
                    loading={choosing && !isCurrent}
                    aria-label={isCurrent ? `当前模型 ${label}` : `选择模型 ${label}`}
                    onClick={() => onChoose(skillName, label)}
                  >
                    {isCurrent ? '当前使用' : '选择'}
                  </Button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {!requiresChoice && (
        <div className="agent-model-actions">
          {missingCount > 0 && onBatchParameterInput && <Button type="primary" onClick={onBatchParameterInput}>批量补充参数</Button>}
          {missingCount > 0 && !onBatchParameterInput && onStartParameterInput && <Button type="primary" onClick={onStartParameterInput}>填写下一个参数</Button>}
          {missingCount > 0 && onReviewParameters && <Button onClick={onReviewParameters}>{`查看所需参数（${missingCount}）`}</Button>}
        </div>
      )}
    </section>
  );
}

export function AgentParameterPanel({ response }: { response?: AgentAnalyzeResponse }) {
  if (!response) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无参数草稿" />;
  const missing = response.missing_required || [];
  const invalid = response.invalid_parameters || [];
  return (
    <>
      {missing.length > 0 && <Alert showIcon type="warning" title={<span className="agent-alert-title">缺失必填参数 <span className="agent-alert-count">{missing.length}</span></span>} description={parameterList(missing, 'is-warning')} className="section-gap agent-missing-parameters-alert" />}
      {invalid.length > 0 && <Alert showIcon type="error" title={<span className="agent-alert-title">参数校验失败 <span className="agent-alert-count">{invalid.length}</span></span>} description={parameterList(invalid, 'is-error')} className="section-gap agent-missing-parameters-alert" />}
      <Card size="small" title="参数草稿" className="agent-parameter-draft-card">
        <div className="agent-parameter-health-grid">
          <div className="agent-parameter-health-item">
            <span>字段完整性</span>
            <strong>{response.parameter_completeness === undefined ? '-' : `${Math.round(response.parameter_completeness * 100)}%`}</strong>
          </div>
          <div className="agent-parameter-health-item">
            <span>业务可行性</span>
            <Tag color={response.business_feasible === undefined ? 'default' : response.business_feasible ? 'green' : 'red'}>{response.business_feasible === undefined ? '待检查' : response.business_feasible ? '通过' : '不通过'}</Tag>
          </div>
          <div className="agent-parameter-health-item">
            <span>契约适配度</span>
            <strong>{response.schema_fit_score === undefined ? '-' : `${Math.round(response.schema_fit_score * 100)}%`}</strong>
          </div>
        </div>
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
          className="agent-parameter-table"
        />
      </Card>
      {Boolean(response.can_use_default?.length) && (
        <Card size="small" title="可使用默认值" className="section-gap">
          <Table size="small" pagination={false} rowKey="__row_key" dataSource={listRows(response.can_use_default, 'default')} columns={[{ title: '参数', render: (_, row) => parameterText(row.name || row.parameter || row.item || row) }, { title: '默认值', render: (_, row) => parameterValueText(row.default ?? row.value) }]} />
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
  const evidenceRecord = (evidence && typeof evidence === 'object' ? evidence : {}) as Record<string, unknown>;
  const evidenceModel = (evidenceRecord.model && typeof evidenceRecord.model === 'object' ? evidenceRecord.model : {}) as Record<string, unknown>;
  const derivedMetrics = (evidenceRecord.derived_metrics && typeof evidenceRecord.derived_metrics === 'object' ? evidenceRecord.derived_metrics : {}) as Record<string, unknown>;
  const resultMeta = [
    ['会话', response.conversation_id],
    ['调用编号', response.invocation_id],
    ['任务编号', response.task_session?.task_id],
    ['目标值', response.objective_value],
  ] as const;
  return (
    <>
      <div className="agent-result-summary">
        {resultMeta.map(([label, value]) => <div className="agent-result-summary-item" key={label}><span>{label}</span><strong>{valueText(value)}</strong></div>)}
      </div>
      {Object.keys(derivedMetrics).length > 0 && <Card size="small" title={`业务指标 · ${valueText(evidenceModel.profile_name || 'generic')}`} className="section-gap agent-derived-metrics-card"><JsonViewer value={derivedMetrics} /></Card>}
      {(facts.length + inferences.length + recommendations.length + risks.length + manual.length + limitations.length > 0) && <Space orientation="vertical" size={8} className="full-width section-gap agent-result-explanation-list">
        <Card size="small" title="事实" className="agent-result-explanation-card">{facts.length ? facts.map((item, index) => <div key={`fact-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="推断" className="agent-result-explanation-card">{inferences.length ? inferences.map((item, index) => <div key={`inference-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="建议" className="agent-result-explanation-card">{recommendations.length ? recommendations.map((item, index) => <div key={`recommendation-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="风险提示" className="agent-result-explanation-card">{risks.length ? risks.map((item, index) => <div key={`risk-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="人工复核点" className="agent-result-explanation-card">{manual.length ? manual.map((item, index) => <div key={`manual-${index}`}>{valueText(item)}</div>) : '无'}</Card>
        <Card size="small" title="解释限制" className="agent-result-explanation-card">{limitations.length ? limitations.map((item, index) => <div key={`limit-${index}`}>{valueText(item)}</div>) : '无'}</Card>
      </Space>}
      {evidence !== undefined && <Collapse className="section-gap agent-evidence-collapse" items={[{ key: 'evidence', label: '查看原始 evidence package', children: <JsonViewer value={evidence} /> }]} />}
      {result !== undefined && <Card size="small" title="原始结果" className="section-gap agent-raw-result-card">
        {resultRecord && Object.keys(resultRecord).length === 0 ? <div className="agent-raw-result-empty"><span>暂无结构化结果</span><code>{'{}'}</code></div> : <JsonViewer value={result} />}
      </Card>}
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
