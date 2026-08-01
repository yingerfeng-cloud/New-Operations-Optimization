import { Alert, Button, Drawer, Empty, Input, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getComponents } from '../../../api/components';
import type { ComponentDef } from '../../../types/component';
import type { ModelDraft } from '../stores/modelCreationStore';
import {
  findComponentDependencyCycles,
  getComponentDependencyIds,
  getComponentId,
  getComponentName,
  isPublishedComponent,
} from '../../../utils/componentDependencies';

type DraftComponent = ModelDraft['components'][number];

function isSelectable(component: ComponentDef) {
  return isPublishedComponent(component);
}

function catalogText(value: unknown) {
  const text = String(value || '-');
  return (
    <Tooltip title={text === '-' ? undefined : text}>
      <span className="component-picker-cell-text">{text}</span>
    </Tooltip>
  );
}

export function resolveComponentSelection(selectedIds: string[], rows: ComponentDef[]) {
  const byId = new Map(rows.map(row => [getComponentId(row), row]));
  const explicitIds = [...new Set(selectedIds.map(String).map(id => id.trim()).filter(Boolean))];
  const resolved = new Set(explicitIds);
  const autoAdded = new Set<string>();
  const missing = new Set<string>();
  const unavailable = new Set<string>();
  const queue = [...explicitIds];

  while (queue.length) {
    const id = queue.shift()!;
    const component = byId.get(id);
    if (!component) {
      missing.add(`${id}（组件不存在）`);
      continue;
    }
    if (!isSelectable(component)) unavailable.add(id);
    getComponentDependencyIds(component).forEach(dependencyId => {
      if (resolved.has(dependencyId)) return;
      const dependency = byId.get(dependencyId);
      if (!dependency || !isSelectable(dependency)) {
        missing.add(`${id} → ${dependencyId}（${dependency ? '不可用' : '不存在'}）`);
        return;
      }
      resolved.add(dependencyId);
      autoAdded.add(dependencyId);
      queue.push(dependencyId);
    });
  }

  const graph = new Map<string, string[]>();
  resolved.forEach(id => {
    const component = byId.get(id);
    if (component) graph.set(id, getComponentDependencyIds(component).filter(dependencyId => resolved.has(dependencyId)));
  });

  return {
    ids: [...resolved],
    autoAdded: [...autoAdded],
    missing: [...missing],
    unavailable: [...unavailable],
    cycles: findComponentDependencyCycles(graph),
  };
}

export function materializeComponentSelection(
  selectedIds: string[],
  rows: ComponentDef[],
  selectedComponents: DraftComponent[],
): DraftComponent[] {
  const catalogById = new Map(rows.map(component => [getComponentId(component), component]));
  const existingById = new Map<string, DraftComponent[]>();
  selectedComponents.forEach(component => {
    const id = getComponentId(component);
    if (!id) return;
    existingById.set(id, [...(existingById.get(id) || []), component]);
  });
  return selectedIds.flatMap(id => {
    const definition = catalogById.get(id);
    const existing = existingById.get(id) || [];
    const dependencies = getComponentDependencyIds(definition || existing[0] || {});
    if (existing.length) {
      return existing.map(component => ({
        ...component,
        depends_on: dependencies,
        dependencies,
      }));
    }
    if (!definition) return [];
    return [{
      ...definition,
      component_id: id,
      type: definition.type || id,
      enabled: true,
      depends_on: dependencies,
      dependencies,
    }];
  });
}

export function ComponentPickerDrawer({
  open,
  selectedComponents,
  onClose,
  onConfirm,
}: {
  open: boolean;
  selectedComponents: DraftComponent[];
  onClose: () => void;
  onConfirm: (components: DraftComponent[]) => void;
}) {
  const componentQuery = useQuery({
    queryKey: ['components'],
    queryFn: getComponents,
    enabled: open,
  });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const existingById = useMemo(
    () => {
      const grouped = new Map<string, DraftComponent[]>();
      selectedComponents.forEach(component => {
        const id = getComponentId(component);
        if (!id) return;
        grouped.set(id, [...(grouped.get(id) || []), component]);
      });
      return grouped;
    },
    [selectedComponents],
  );
  const rows = useMemo(() => {
    const merged = new Map<string, ComponentDef>();
    (componentQuery.data || []).forEach(component => merged.set(getComponentId(component), component));
    selectedComponents.forEach(component => {
      const id = getComponentId(component);
      if (id && !merged.has(id)) merged.set(id, component as ComponentDef);
    });
    return [...merged.values()].filter(component => getComponentId(component));
  }, [componentQuery.data, selectedComponents]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedIds([...new Set(selectedComponents.map(getComponentId).filter(Boolean))]);
  }, [open, selectedComponents]);

  const visibleRows = rows.filter(component => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return true;
    return [
      getComponentName(component),
      getComponentId(component),
      component.domain,
      component.category,
      component.description,
    ].some(value => String(value || '').toLowerCase().includes(keyword));
  });
  const resolution = resolveComponentSelection(selectedIds, rows);
  const resolvedInstanceCount = resolution.ids.reduce(
    (count, id) => count + (existingById.get(id)?.length || 1),
    0,
  );

  const applySelection = () => {
    if (resolution.missing.length || resolution.unavailable.length || resolution.cycles.length || componentQuery.isError) return;
    onConfirm(materializeComponentSelection(resolution.ids, rows, selectedComponents));
  };

  return (
    <Drawer
      className="component-picker-drawer"
      size="min(1120px, 94vw)"
      title="从组件库选择"
      open={open}
      onClose={onClose}
      footer={(
        <div className="component-picker-footer">
          <Typography.Text type="secondary">
            已选 {resolvedInstanceCount} 个组件
            {resolvedInstanceCount !== resolution.ids.length ? `（${resolution.ids.length} 类）` : ''}
            {resolution.autoAdded.length ? `，自动补齐 ${resolution.autoAdded.length} 类依赖` : ''}
          </Typography.Text>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              disabled={componentQuery.isLoading
                || componentQuery.isError
                || resolution.missing.length > 0
                || resolution.unavailable.length > 0
                || resolution.cycles.length > 0}
              onClick={applySelection}
            >
              应用选择
            </Button>
          </Space>
        </div>
      )}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">
          选择参与当前模型装配的组件。已配置组件会保留参数绑定，所需依赖将在确认时自动加入。
        </Typography.Paragraph>
        <Input.Search
          allowClear
          placeholder="搜索组件名称、编码、领域或分类"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        {resolution.autoAdded.length > 0 && (
          <Alert
            type="info"
            showIcon
            title="将自动补齐组件依赖"
            description={resolution.autoAdded.join('、')}
          />
        )}
        {resolution.missing.length > 0 && (
          <Alert
            type="error"
            showIcon
            title="存在不可用的组件依赖"
            description={resolution.missing.join('；')}
          />
        )}
        {resolution.unavailable.length > 0 && (
          <Alert
            type="error"
            showIcon
            title="已选组件不可用"
            description={`${resolution.unavailable.join('、')} 已停用或尚未实现，请取消选择后再应用。`}
          />
        )}
        {resolution.cycles.length > 0 && (
          <Alert
            type="error"
            showIcon
            title="组件依赖存在循环"
            description={resolution.cycles.map(cycle => cycle.join(' → ')).join('；')}
          />
        )}
        {componentQuery.isError && (
          <Alert
            type="error"
            showIcon
            title="组件库加载失败"
            description="请检查后端服务后重试。当前不会覆盖草稿中的已有组件。"
            action={<Button size="small" icon={<ReloadOutlined />} onClick={() => componentQuery.refetch()}>重试</Button>}
          />
        )}
        <Table<ComponentDef>
          className="component-picker-table"
          rowKey={row => getComponentId(row)}
          loading={componentQuery.isLoading}
          dataSource={visibleRows}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的组件" /> }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1000 }}
          tableLayout="fixed"
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys: resolution.ids,
            onSelect: (row, selected) => {
              const id = getComponentId(row);
              setSelectedIds(current => selected
                ? [...new Set([...current, id])]
                : current.filter(item => item !== id));
            },
            onSelectAll: (selected, _selectedRows, changedRows) => {
              const changedIds = changedRows.map(getComponentId);
              setSelectedIds(current => selected
                ? [...new Set([...current, ...changedIds])]
                : current.filter(id => !changedIds.includes(id)));
            },
            getCheckboxProps: row => ({
              disabled: (!isSelectable(row) && !existingById.has(getComponentId(row)))
                || resolution.autoAdded.includes(getComponentId(row)),
              name: `选择组件 ${getComponentName(row)}`,
            }),
          }}
          columns={[
            {
              title: '组件',
              width: 250,
              fixed: 'left',
              render: (_, row) => (
                <span className="component-picker-name">
                  <strong>{getComponentName(row)}</strong>
                  <small>{getComponentId(row)}</small>
                  {(existingById.get(getComponentId(row))?.length || 0) > 1 && (
                    <Tag>{existingById.get(getComponentId(row))!.length} 个实例</Tag>
                  )}
                  {resolution.autoAdded.includes(getComponentId(row)) && <Tag color="cyan">自动依赖</Tag>}
                </span>
              ),
            },
            { title: '领域', dataIndex: 'domain', width: 160, render: catalogText },
            { title: '分类', dataIndex: 'category', width: 180, render: catalogText },
            {
              title: '问题类型',
              width: 110,
              render: (_, row) => String(row.problem_type || row.problem_type_effect || '-'),
            },
            {
              title: '依赖',
              width: 210,
              render: (_, row) => {
                const dependencies = getComponentDependencyIds(row);
                return dependencies.length
                  ? <Space size={[0, 4]} wrap>{dependencies.map(item => <Tag key={item}>{item}</Tag>)}</Space>
                  : '-';
              },
            },
            {
              title: '状态',
              width: 90,
              fixed: 'right',
              render: (_, row) => (
                <Tag color={isSelectable(row) ? 'green' : 'default'}>
                  {isSelectable(row) ? '可用' : '不可用'}
                </Tag>
              ),
            },
          ]}
        />
      </Space>
    </Drawer>
  );
}
