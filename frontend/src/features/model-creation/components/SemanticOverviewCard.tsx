import { Button, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, BranchesOutlined, EditOutlined, FunctionOutlined, NodeIndexOutlined, PlusOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';

function formatList(value?: string[]) {
  return (value || []).join(', ');
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
    },
    {
      key: 'parameters',
      title: '参数',
      icon: <FunctionOutlined />,
      color: 'green',
      action: onAddParameter,
      items: draft.semantic.parameters.map((item, index) => semanticItem({
        key: `parameter-${item.code}-${index}`,
        code: item.code,
        name: item.name,
        meta: formatList(item.indices || item.dimension) || item.unit || '标量',
        color: item.required === false ? 'default' : 'green',
        onEdit: onEditParameter ? () => onEditParameter(index) : undefined,
      })),
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
                <Typography.Text type="secondary">{group.items.length}</Typography.Text>
              </Space>
              {group.action && <Button size="small" type="text" icon={<PlusOutlined />} onClick={group.action} aria-label={`新增${group.title}`} />}
            </div>
            <div className="semantic-item-list">
              {group.items.length ? group.items : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内容" />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
