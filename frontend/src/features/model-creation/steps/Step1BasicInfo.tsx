import { Alert, Card, Col, Collapse, Descriptions, Form, Input, Radio, Row, Select, Space, Tag, Typography } from 'antd';
import type { ModelTemplate } from '../../../types/template';
import { BLANK_MODEL_ID, getScenarioById, getScenarioModelById, scenarioCatalog } from '../data/scenarioCatalog';
import type { ModelDraft } from '../stores/modelCreationStore';
import type { ScenarioCatalogItem } from '../../../types/scenario';

export function Step1BasicInfo({
  draft,
  templates,
  selectedScenarioId,
  selectedModelId,
  scenarios,
  onChange,
  onCatalogSelection,
  onTemplate,
}: {
  draft: ModelDraft;
  templates: ModelTemplate[];
  selectedScenarioId: string;
  selectedModelId: string;
  scenarios?: ScenarioCatalogItem[];
  onChange: (d: ModelDraft) => void;
  onCatalogSelection: (scenarioId: string, modelId?: string) => void;
  onTemplate: (code: string) => void;
}) {
  const b = draft.basic_info;
  const scenarioOptions = scenarios?.length ? scenarios : scenarioCatalog;
  const scenario = scenarioOptions.find(item => item.id === selectedScenarioId) || getScenarioById(selectedScenarioId) || scenarioOptions[0] || scenarioCatalog[0];
  const selectedModel = selectedModelId === BLANK_MODEL_ID ? undefined : scenario.models.find(model => model.id === selectedModelId) || getScenarioModelById(scenario.id, selectedModelId);
  const modelOptions = [
    ...scenario.models.map(model => ({ value: model.id, label: model.name })),
    { value: BLANK_MODEL_ID, label: '+ 在当前场景下创建空白模型' },
  ];
  const set = (p: Partial<typeof b>) => onChange({ ...draft, basic_info: { ...b, ...p } });
  const createMode = selectedModelId === BLANK_MODEL_ID ? 'blank' : 'template';
  const autoCode = b.model_code || `${scenario.id}_${Date.now().toString().slice(-4)}`;
  const objectiveCount = draft.formulas.filter(formula => formula.kind === 'objective').length;

  return (
    <>
      <Form layout="vertical">
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card title="创建方式" className="model-step-block">
              <Radio.Group
                className="creation-mode-group"
                value={createMode}
                onChange={event => {
                  if (event.target.value === 'blank') onCatalogSelection(scenario.id, BLANK_MODEL_ID);
                  else onCatalogSelection(scenario.id, scenario.models[0]?.id);
                }}
                options={[
                  { value: 'template', label: '从模板克隆' },
                  { value: 'blank', label: '空白创建' },
                ]}
              />
              <Form.Item label="模板加载" className="section-gap">
                <Select allowClear showSearch placeholder="选择后端模板初始化" options={templates.map(t => ({ value: t.code, label: t.name }))} onChange={onTemplate} />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="模型定位" className="model-step-block">
              <Form.Item label="业务场景" required>
                <Select data-testid="scenario-select" aria-label="当前场景" value={scenario.id} options={scenarioOptions.map(item => ({ value: item.id, label: item.name }))} onChange={value => onCatalogSelection(value)} />
              </Form.Item>
              <Form.Item label="建模骨架">
                <Select
                  value={b.modeling_skeleton || 'dispatch_optimization'}
                  options={[
                    { label: '调度优化', value: 'dispatch_optimization' },
                    { label: '容量配置', value: 'capacity_planning' },
                    { label: '状态递推', value: 'state_transition' },
                    { label: '网络流', value: 'network_flow' },
                    { label: '排程', value: 'scheduling' },
                    { label: '资源分配', value: 'resource_allocation' },
                  ]}
                  onChange={value => set({ modeling_skeleton: value, builder_mode: 'component_based' })}
                />
              </Form.Item>
              <Form.Item label="建模模式">
                <Select
                  data-testid="builder-mode-select"
                  aria-label="建模模式"
                  value={b.builder_mode}
                  options={[{ label: '通用线性 Builder', value: 'generic_linear' }, { label: '组件化 Builder', value: 'component_based' }, { label: '模板 Builder', value: 'template_based' }]}
                  onChange={value => set({ builder_mode: value })}
                />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="模型信息" className="model-step-block">
              <Form.Item label="当前模型" required>
                <Select data-testid="model-select" aria-label="当前模型" value={selectedModelId} options={modelOptions} onChange={value => onCatalogSelection(scenario.id, value)} />
              </Form.Item>
              <Form.Item label="模型名称" required>
                <Input value={b.name} onChange={e => set({ name: e.target.value })} />
              </Form.Item>
              <Form.Item label="模型说明">
                <Input.TextArea
                  rows={3}
                  value={String((draft.advanced as Record<string, unknown>).description || '')}
                  onChange={e => onChange({ ...draft, advanced: { ...draft.advanced, description: e.target.value } as typeof draft.advanced })}
                />
              </Form.Item>
              <Collapse
                items={[{
                  key: 'advanced-code',
                  label: '高级编辑：模型编码',
                  children: <Form.Item label="模型编码" required><Input value={autoCode} onChange={e => set({ model_code: e.target.value })} /></Form.Item>,
                }]}
              />
            </Card>
          </Col>
        </Row>
      </Form>

      <Card title="模型摘要" className="section-gap">
        {selectedModel ? (
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="模型范式">{selectedModel.paradigmSummary}</Descriptions.Item>
            <Descriptions.Item label="问题类型">{selectedModel.problemType}</Descriptions.Item>
            <Descriptions.Item label="目标策略">{selectedModel.objectiveSummary}</Descriptions.Item>
            <Descriptions.Item label="集合配置">{selectedModel.setSummary}</Descriptions.Item>
            <Descriptions.Item label="模型说明" span={2}>{selectedModel.description}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert showIcon type="info" title="空白模型" description="将保留当前业务场景，并清空公式、组件、诊断和编译结果。请在后续步骤补齐语义和数学定义。" />
        )}
      </Card>

      <Card title="当前选择摘要" className="section-gap">
        <Space wrap>
          <Tag color="blue">{scenario.name}</Tag>
          <Tag color={createMode === 'blank' ? 'gold' : 'green'}>{createMode === 'blank' ? '空白创建' : '模板克隆'}</Tag>
          <Tag>{b.builder_mode === 'component_based' ? '组件化 Builder' : '通用线性 Builder'}</Tag>
          <Typography.Text type="secondary">编码由系统自动生成，必要时可在高级编辑中调整。</Typography.Text>
        </Space>
      </Card>

      <Card className="section-gap" title="目标策略">
        <div className="model-diagnosis-strip">
          <span className="info-dot">i</span>
          <div>
            <strong>模型范式诊断</strong>
            <p>{`${b.builder_mode === 'generic_linear' ? 'LP/MILP 线性范式' : '组件能力自动汇总'} · 求解器 HiGHS`}</p>
          </div>
        </div>
        {objectiveCount > 0 ? (
          <div className="objective-summary">
            <strong>{objectiveCount} 个目标函数</strong>
            <span>已配置目标策略，可在数学展开步骤继续维护目标函数和约束。</span>
          </div>
        ) : (
          <div className="business-empty-card">
            <strong>暂未配置目标函数</strong>
            <span>完成基础信息后，在“数学展开”步骤定义成本最小化、收益最大化或多目标权重策略。</span>
          </div>
        )}
      </Card>
    </>
  );
}
