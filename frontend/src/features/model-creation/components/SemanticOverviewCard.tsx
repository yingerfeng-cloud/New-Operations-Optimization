import { Button, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, BranchesOutlined, EditOutlined, FunctionOutlined, NodeIndexOutlined, PlusOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';

function formatList(value?: string[]) {
  return (value || []).join(', ');
}

type SemanticParameter = ModelDraft['semantic']['parameters'][number];
type SemanticSet = ModelDraft['semantic']['sets'][number];

type ParameterMetadata = SemanticParameter & {
  role?: string;
  field_role?: string;
  semantic_role?: string;
  ui_role?: string;
  runtime_editable?: boolean;
  editable?: boolean;
  source_system?: string;
  sourceSystem?: string;
};

function parameterMetadata(parameter: SemanticParameter) {
  return parameter as ParameterMetadata;
}

/**
 * A few model contracts expose set members as input fields with the same code
 * as their set (for example `workload` and `cluster`). They are not a second
 * semantic set; they are the member-list contract used to populate that set.
 */
function isSetMemberParameter(parameter: SemanticParameter, sets: SemanticSet[]) {
  const metadata = parameterMetadata(parameter);
  const set = sets.find(item => item.code === parameter.code);
  if (!set) return false;

  const role = String(metadata.role || metadata.field_role || metadata.semantic_role || metadata.ui_role || '').toLowerCase();
  if (role === 'time_labels') return false;
  if (role === 'set_members') return true;

  const dimensions = parameter.indices || parameter.dimension || parameter.dimensions || parameter.index_sets || [];
  const source = String(metadata.sourceType || metadata.source_type || metadata.source_system || metadata.sourceSystem || '').toLowerCase();
  const setOwner = String(set.managed_by || '').toLowerCase();
  const isSelfIndexed = dimensions.length === 1 && dimensions[0] === parameter.code;

  return isSelfIndexed
    || setOwner === 'time_dimension'
    || metadata.runtime_editable === false
    || metadata.editable === false
    || source === 'system'
    // These are standard contract-owned dimensions in the compute-power model.
    || ['time', 'time_volume', 'workload', 'cluster'].includes(parameter.code);
}

function semanticItem({
  key,
  code,
  name,
  meta,
  color = 'blue',
  onEdit,
}: {
  key: string;
  code: string;
  name?: string;
  meta?: string;
  color?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="semantic-item-card" key={key} data-field-code={code} data-object-id={code}>
      <div className="semantic-item-main">
        <Typography.Text strong>{name || code}</Typography.Text>
        <Typography.Text type="secondary">{code}</Typography.Text>
      </div>
      <div className="semantic-item-actions">
        {meta && <Tag color={color}>{meta}</Tag>}
        {onEdit && (
          <Tooltip title="编辑">
            <Button
              aria-label={`编辑 ${name || code}`}
              className="semantic-item-edit"
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={onEdit}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function SemanticOverviewCard({
  draft,
  onAddSet,
  onAddParameter,
  onAddVariable,
  onEditSet,
  onEditParameter,
  onEditVariable,
}: {
  draft: ModelDraft;
  onAddSet: () => void;
  onAddParameter: () => void;
  onAddVariable: () => void;
  onEditSet?: (index: number) => void;
  onEditParameter?: (index: number) => void;
  onEditVariable?: (index: number) => void;
}) {
  const managedSetParameters = draft.semantic.parameters.filter(parameter => isSetMemberParameter(parameter, draft.semantic.sets));
  const ordinaryParameters = draft.semantic.parameters
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isSetMemberParameter(item, draft.semantic.sets));
  const managedSetParameterSummary = managedSetParameters.length ? (
    <div className="semantic-group-note" role="note">
      <Space wrap size={[4, 4]}>
        <Tag color="cyan">集合成员字段</Tag>
        {managedSetParameters.map(item => <Tag key={item.code} color="cyan">{item.name || item.code} · {item.code}</Tag>)}
      </Space>
      <Typography.Text type="secondary">
        这些字段用于提供或同步集合成员，不是第二套集合定义；时间维度和业务系统会按契约管理它们。
      </Typography.Text>
    </div>
  ) : null;
  const groups = [
    {
      key: 'sets',
      title: '集合',
      icon: <ApartmentOutlined />,
      color: 'blue',
      action: onAddSet,
      items: draft.semantic.sets.map((item, index) => semanticItem({
        key: `set-${item.code}-${index}`,
        code: item.code,
        name: item.name,
        meta: item.defaultSize ? `${item.defaultSize} 项` : item.dimensionType || item.sourceType || item.source_type || '集合',
        color: 'blue',
        onEdit: onEditSet ? () => onEditSet(index) : undefined,
      })),
      note: undefined,
      countLabel: undefined,
    },
    {
      key: 'parameters',
      title: '参数',
      icon: <FunctionOutlined />,
      color: 'green',
      action: onAddParameter,
      items: ordinaryParameters.map(({ item, index }) => semanticItem({
        key: `parameter-${item.code}-${index}`,
        code: item.code,
        name: item.name,
        meta: formatList(item.indices || item.dimension) || item.unit || '标量',
        color: item.required === false ? 'default' : 'green',
        onEdit: onEditParameter ? () => onEditParameter(index) : undefined,
      })),
      note: managedSetParameterSummary,
      countLabel: managedSetParameters.length
        ? `${ordinaryParameters.length} 个参数 + ${managedSetParameters.length} 个集合成员字段`
        : String(ordinaryParameters.length),
    },
    {
      key: 'variables',
      title: '变量',
      icon: <NodeIndexOutlined />,
      color: 'purple',
      action: onAddVariable,
      items: draft.semantic.variables.map((item, index) => semanticItem({
        key: `variable-${item.code}-${index}`,
        code: item.code,
        name: item.name,
        meta: formatList(item.indices || item.dimension) || item.variableType || item.domain || '变量',
        color: 'purple',
        onEdit: onEditVariable ? () => onEditVariable(index) : undefined,
      })),
      note: undefined,
      countLabel: undefined,
    },
    {
      key: 'rules',
      title: '业务规则',
      icon: <BranchesOutlined />,
      color: 'orange',
      items: draft.formulas.filter(item => item.kind === 'constraint').map((item, index) => semanticItem({
        key: `rule-${item.formula_id}-${index}`,
        code: item.formula_id,
        name: item.name,
        meta: item.compile_status,
        color: item.compile_status === 'ready' ? 'green' : 'orange',
      })),
      note: undefined,
      countLabel: undefined,
    },
  ];

  return (
    <section className="semantic-overview-card" data-section-key="overview">
      <div className="card-title-row">
        <div>
          <Typography.Title level={5}>语义结构概览</Typography.Title>
          <Typography.Paragraph>集中维护集合、参数、变量和业务规则，支撑后续数学展开。</Typography.Paragraph>
        </div>
      </div>
      <div className="semantic-group-grid">
        {groups.map(group => (
          <div className="semantic-group-card" key={group.key} data-section-key={group.key}>
            <div className="semantic-group-head">
              <Space>
                <Tag color={group.color} icon={group.icon}>{group.title}</Tag>
                <Typography.Text type="secondary">{group.countLabel ?? group.items.length}</Typography.Text>
              </Space>
              {group.action && <Button size="small" type="text" icon={<PlusOutlined />} onClick={group.action} aria-label={`新增${group.title}`} />}
            </div>
            {group.note}
            <div className="semantic-item-list">
              {group.items.length ? group.items : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内容" />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
