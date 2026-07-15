import { Alert, Card, Col, Collapse, Descriptions, Form, Input, Radio, Row, Select, Space, Tag, Typography } from 'antd';
import type { ModelTemplate } from '../../../types/template';
import type { ModelAsset } from '../../../types/model';
import { scenarioCatalog } from '../data/scenarioCatalog';
import type { ModelDraft, ModelWorkspaceContext } from '../stores/modelCreationStore';
import type { ScenarioCatalogItem } from '../../../types/scenario';

export function Step1BasicInfo({
  draft,
  workspace,
  sourceAsset,
  templates,
  scenarios,
  onChange,
  onScenario,
  onTemplate,
}: {
  draft: ModelDraft;
  workspace: ModelWorkspaceContext;
  sourceAsset?: ModelAsset;
  templates: ModelTemplate[];
  scenarios?: ScenarioCatalogItem[];
  onChange: (d: ModelDraft) => void;
  onScenario: (scenarioId: string) => void;
  onTemplate: (code: string) => void;
}) {
  const b = draft.basic_info;
  const scenarioOptions = scenarios?.length ? scenarios : scenarioCatalog;
  const set = (p: Partial<typeof b>) => onChange({ ...draft, basic_info: { ...b, ...p } });
  const objectiveCount = draft.formulas.filter(formula => formula.kind === 'objective').length;
  const isAssetMode = workspace.mode === 'edit' || workspace.mode === 'clone' || workspace.mode === 'version';

  return (
    <>
      <Form layout="vertical">
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card title="创建方式" className="model-step-block">
              <Radio.Group
                className="creation-mode-group"
                value={workspace.mode === 'template' ? 'template' : 'blank'}
                onChange={event => {
                  if (event.target.value === 'blank') onTemplate('');
                }}
                disabled={isAssetMode}
                options={[
                  { value: 'template', label: '从模板创建' },
                  { value: 'blank', label: '空白创建' },
                ]}
              />
              <Form.Item label="模型模板" className="section-gap">
                <Select allowClear showSearch disabled={isAssetMode} value={workspace.templateCode ?? null} placeholder="未选择" options={templates.map(t => ({ value: t.code, label: t.name }))} onChange={value => onTemplate(value || '')} />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="模型定位" className="model-step-block">
              <Form.Item label="业务场景" required>
                <Select data-testid="scenario-select" aria-label="当前场景" disabled={isAssetMode} value={b.scenario_id ?? null} placeholder="未选择" options={scenarioOptions.map(item => ({ value: item.id, label: item.name }))} onChange={onScenario} />
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
              {isAssetMode && sourceAsset && (
                <Descriptions size="small" column={1} className="workspace-source-summary">
                  <Descriptions.Item label={workspace.mode === 'edit' ? '正在编辑' : '来源模型'}>{sourceAsset.name}</Descriptions.Item>
                  <Descriptions.Item label="当前版本">{sourceAsset.version}</Descriptions.Item>
                  <Descriptions.Item label="状态">{sourceAsset.status}</Descriptions.Item>
                </Descriptions>
              )}
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
                  children: <Form.Item label="模型编码" required><Input value={b.model_code} onChange={e => set({ model_code: e.target.value })} /></Form.Item>,
                }]}
              />
            </Card>
          </Col>
        </Row>
      </Form>

      <Card title="模型摘要" className="section-gap">
        {isAssetMode && sourceAsset ? (
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="问题类型">{sourceAsset.model_problem_type || sourceAsset.problem_type}</Descriptions.Item>
            <Descriptions.Item label="Builder">{sourceAsset.build_mode}</Descriptions.Item>
            <Descriptions.Item label="集合">{draft.semantic.sets.length}</Descriptions.Item>
            <Descriptions.Item label="组件">{draft.components.length}</Descriptions.Item>
            <Descriptions.Item label="公式" span={2}>{draft.formulas.length}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert showIcon type="info" title={workspace.mode === 'template' ? '后端模板已加载' : '空白模型'} description={workspace.mode === 'template' ? '集合、参数、变量、组件、公式、时间维度和运行参数均来自后端模板详情。' : '当前工作台未选择历史模型或目录模型，请按需选择业务场景和后端模板。'} />
        )}
      </Card>

      <Card title="当前选择摘要" className="section-gap">
        <Space wrap>
          <Tag color="blue">{b.scenario || '业务场景未选择'}</Tag>
          <Tag color={workspace.mode === 'new' ? 'gold' : 'green'}>{workspace.mode === 'new' ? '空白创建' : workspace.mode}</Tag>
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
