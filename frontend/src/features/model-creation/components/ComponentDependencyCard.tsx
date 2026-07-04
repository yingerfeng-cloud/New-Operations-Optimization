import { Button, Empty, Space, Tag, Typography } from 'antd';
import { EditOutlined, LinkOutlined, WarningOutlined } from '@ant-design/icons';
import type { ModelDraft } from '../stores/modelCreationStore';
import { getComponentBindingRows, getMissingBindingRows } from '../utils/bindingValidation';

export interface BindingTarget {
  componentIndex: number;
  parameterCode: string;
  binding?: Record<string, unknown>;
}

function componentName(component: Record<string, unknown>, index: number) {
  return String(component.display_name || component.name || component.component_id || component.code || `组件 ${index + 1}`);
}

function componentCode(component: Record<string, unknown>, index: number) {
  return String(component.component_id || component.code || component.type || `component_${index + 1}`);
}

function componentRows(component: Record<string, unknown>, key: string) {
  const value = component[key];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function dependencyTags(component: Record<string, unknown>) {
  return [...new Set([
    ...componentRows(component, 'required_sets').map(row => String(row.code || row.name)).filter(Boolean),
    ...componentRows(component, 'variables').map(row => String(row.code || row.name)).filter(Boolean),
    ...((Array.isArray(component.dependencies) ? component.dependencies : []) as string[]),
    ...((Array.isArray(component.depends_on) ? component.depends_on : []) as string[]),
  ])];
}

export function ComponentDependencyCard({
  draft,
  onEditBinding,
}: {
  draft: ModelDraft;
  onEditBinding: (target: BindingTarget) => void;
}) {
  return (
    <section className="component-dependency-card">
      <div className="card-title-row">
        <div>
          <Typography.Title level={5}>组件与依赖</Typography.Title>
          <Typography.Paragraph>查看组件依赖、参数绑定状态和缺失项，点击缺失参数进入绑定面板。</Typography.Paragraph>
        </div>
        <Tag color={draft.components.length ? 'blue' : 'default'}>{draft.components.length} 个组件</Tag>
      </div>
      <div className="component-dependency-list">
        {draft.components.length ? draft.components.map((component, index) => {
          const rows = getComponentBindingRows(component);
          const missingRows = getMissingBindingRows(component);
          const dependencies = dependencyTags(component);
          const statusColor = missingRows.length ? 'orange' : 'green';
          const statusText = missingRows.length ? `缺少 ${missingRows.length} 项` : '已绑定';
          const openTarget = missingRows[0] || rows[0];
          return (
            <div
              role="button"
              tabIndex={0}
              className={`component-dependency-row ${missingRows.length ? 'has-warning' : ''}`}
              key={`${componentCode(component, index)}-${index}`}
              onClick={() => openTarget && onEditBinding({ componentIndex: index, parameterCode: openTarget.code, binding: openTarget.binding })}
              onKeyDown={event => {
                if ((event.key === 'Enter' || event.key === ' ') && openTarget) {
                  onEditBinding({ componentIndex: index, parameterCode: openTarget.code, binding: openTarget.binding });
                }
              }}
            >
              <span className="component-dependency-main">
                <strong>组件：{componentName(component, index)}</strong>
                <small>{componentCode(component, index)}</small>
              </span>
              <span className="component-dependency-tags">
                {dependencies.slice(0, 4).map(item => <Tag key={item} icon={<LinkOutlined />}>依赖 {item}</Tag>)}
                {dependencies.length > 4 && <Tag>+{dependencies.length - 4}</Tag>}
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
                    {row.code}
                  </Tag>
                ))}
              </span>
              <span className="component-dependency-actions">
                <Tag color={statusColor}>{statusText}</Tag>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={event => {
                    event.stopPropagation();
                    if (openTarget) onEditBinding({ componentIndex: index, parameterCode: openTarget.code, binding: openTarget.binding });
                  }}
                >
                  绑定
                </Button>
              </span>
            </div>
          );
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择组件" />}
      </div>
    </section>
  );
}
