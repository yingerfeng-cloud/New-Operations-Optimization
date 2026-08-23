import { Button, Empty, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';
import { getComponentBindingRows, getMissingBindingRows } from '../utils/bindingValidation';
import {
  analyzeComponentDependencies,
  getComponentDependencyIds,
  getComponentId,
  getComponentName,
  getDependentComponentIds,
} from '../../../utils/componentDependencies';

export interface BindingTarget {
  componentIndex: number;
  parameterCode: string;
  binding?: Record<string, unknown>;
}

function componentCode(component: Record<string, unknown>, index: number) {
  return getComponentId(component) || `component_${index + 1}`;
}

export function ComponentDependencyCard({
  draft,
  onEditBinding,
  onSelectComponents,
  onRemoveComponent,
}: {
  draft: ModelDraft;
  onEditBinding: (target: BindingTarget) => void;
  onSelectComponents?: () => void;
  onRemoveComponent?: (index: number, dependentIndices: number[]) => void;
}) {
  const dependencyAnalysis = analyzeComponentDependencies(draft.components);
  const componentById = new Map(draft.components.map(component => [getComponentId(component), component]));

  return (
    <section className="component-dependency-card">
      <div className="card-title-row">
        <div>
          <Typography.Title level={5}>组件与依赖</Typography.Title>
          <Typography.Paragraph>上游组件依赖与参数绑定是两类独立关系；可确定的同名同维参数会自动绑定，其余项进入绑定面板。</Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color={draft.components.length ? 'blue' : 'default'}>{draft.components.length} 个组件</Tag>
          {onSelectComponents && (
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onSelectComponents}>
              从组件库选择
            </Button>
          )}
        </Space>
      </div>
      <div className="component-dependency-list">
        {draft.components.length ? draft.components.map((component, index) => {
          const rows = getComponentBindingRows(component);
          const missingRows = getMissingBindingRows(component);
          const id = componentCode(component, index);
          const dependencies = getComponentDependencyIds(component);
          const missingDependencies = dependencyAnalysis.missing
            .filter(item => item.componentId === id)
            .map(item => item.dependencyId);
          const hasSelfDependency = dependencyAnalysis.selfDependencies.includes(id);
          const componentCycles = dependencyAnalysis.cycles.filter(cycle => cycle.includes(id));
          const dependencyIssueCount = missingDependencies.length + Number(hasSelfDependency) + componentCycles.length;
          const hasWarning = missingRows.length > 0 || dependencyIssueCount > 0;
          const openTarget = missingRows[0] || rows[0];
          const dependentIds = getDependentComponentIds(id, draft.components, index);
          const dependentIndices = draft.components.flatMap((row, componentIndex) => (
            row.enabled !== false && dependentIds.includes(getComponentId(row)) ? [componentIndex] : []
          ));
          const dependentNames = dependentIndices.map(componentIndex => (
            getComponentName(draft.components[componentIndex], `组件 ${componentIndex + 1}`)
          ));
          return (
            <div
              className={`component-dependency-row ${hasWarning ? 'has-warning' : ''} ${openTarget ? '' : 'is-static'}`}
              key={`${id}-${index}`}
              onClick={() => openTarget && onEditBinding({ componentIndex: index, parameterCode: openTarget.code, binding: openTarget.binding })}
            >
              <span className="component-dependency-main">
                <strong>组件：{getComponentName(component, `组件 ${index + 1}`)}</strong>
                <small>{id}</small>
              </span>
              <span className="component-dependency-tags">
                {dependencies.length ? dependencies.map(item => {
                  const selfDependency = item === id;
                  const missing = missingDependencies.includes(item);
                  const dependency = componentById.get(item);
                  const label = dependency ? getComponentName(dependency, item) : item;
                  return (
                    <Tag
                      color={missing || selfDependency ? 'red' : 'blue'}
                      icon={missing || selfDependency ? <WarningOutlined /> : <LinkOutlined />}
                      key={item}
                    >
                      {selfDependency ? '自依赖' : missing ? '缺少依赖' : '依赖'} {label}{label !== item ? `（${item}）` : ''}
                    </Tag>
                  );
                }) : <Tag>无上游组件依赖</Tag>}
                {componentCycles.map(cycle => (
                  <Tag color="red" icon={<WarningOutlined />} key={cycle.join('>')}>
                    循环：{cycle.join(' → ')}
                  </Tag>
                ))}
                {missingRows.map(row => (
                  <Tag
                    color="orange"
                    icon={<WarningOutlined />}
                    key={row.code}
                    onClick={event => {
                      event.stopPropagation();
                      onEditBinding({ componentIndex: index, parameterCode: row.code, binding: row.binding });
                    }}
                  >
                    未绑定：<span>{row.code}</span>
                  </Tag>
                ))}
              </span>
              <span className="component-dependency-actions">
                <Tag color={dependencyIssueCount ? 'red' : 'green'}>
                  {dependencyIssueCount ? `依赖异常 ${dependencyIssueCount} 项` : '依赖完整'}
                </Tag>
                <Tag color={missingRows.length ? 'orange' : 'green'}>
                  {missingRows.length ? `缺少 ${missingRows.length} 个绑定` : rows.length ? '参数已绑定' : '无需绑定'}
                </Tag>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  disabled={!openTarget}
                  onClick={event => {
                    event.stopPropagation();
                    if (openTarget) onEditBinding({ componentIndex: index, parameterCode: openTarget.code, binding: openTarget.binding });
                  }}
                >
                  绑定
                </Button>
                {onRemoveComponent && (
                  <Popconfirm
                    title={dependentIndices.length
                      ? `同时移除 ${dependentIndices.length + 1} 个组件？`
                      : `移除组件“${getComponentName(component, `组件 ${index + 1}`)}”？`}
                    description={dependentIndices.length
                      ? `“${getComponentName(component, `组件 ${index + 1}`)}”被 ${dependentNames.join('、')} 依赖；确认后将一并移除，避免留下失效依赖。`
                      : '已填写的组件参数绑定也会从当前草稿中移除。'}
                    okText={dependentIndices.length ? '同时移除' : '移除'}
                    cancelText="取消"
                    onConfirm={event => {
                      event?.stopPropagation();
                      onRemoveComponent(index, dependentIndices);
                    }}
                  >
                    <Button
                      aria-label={`移除 ${getComponentName(component, `组件 ${index + 1}`)}`}
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={event => event.stopPropagation()}
                    />
                  </Popconfirm>
                )}
              </span>
            </div>
          );
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择组件" />}
      </div>
    </section>
  );
}
