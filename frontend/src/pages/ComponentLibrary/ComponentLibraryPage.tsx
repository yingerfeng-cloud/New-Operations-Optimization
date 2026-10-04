import { DeleteOutlined, MoreOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Drawer, Dropdown, Modal, Select, Space, Spin, Tabs, Tag, message } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { copyComponentVersion, createComponent, deleteComponent, getComponent, getComponents, offlineComponent, publishComponent, updateComponent, validateComponent } from '../../api/components';
import { getSystemConfig } from '../../api/systemConfig';
import { DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { ComponentDependencyPanel } from '../../features/component-library/ComponentDependencyPanel';
import { ComponentBusinessView, ComponentMathDefinition } from '../../features/component-library/ComponentSchemaTables';
import { ParameterBindingPanel } from '../../features/component-library/ParameterBindingPanel';
import { ComponentValidationPanel } from '../../features/component-library/ComponentValidationPanel';
import { ComponentEditor } from '../../features/component-library/ComponentEditor';
import type { ComponentDef } from '../../types/component';
import type { DictionaryItem } from '../../types/systemConfig';
import {
  analyzeComponentDependencies,
  COMPONENT_PUBLISHED_STATUS,
  getComponentDependencyIds,
  getComponentId,
  isPublishedComponent,
} from '../../utils/componentDependencies';

type ValidationResult = { valid: boolean; execution_ready?: boolean; errors?: unknown[] };

function asValidationResult(value: unknown): ValidationResult | undefined {
  if (!value || typeof value !== 'object' || !('valid' in value)) return undefined;
  return value as ValidationResult;
}

function optionsFromDictionary(items: DictionaryItem[] | undefined, rows: ComponentDef[], key: 'category' | 'domain') {
  const values = new Map<string, string>();
  (items || []).filter(item => item.enabled !== false).forEach(item => values.set(item.label, item.label));
  rows.map(item => String(item[key] || '').trim()).filter(Boolean).forEach(value => values.set(value, value));
  return [...values.entries()].map(([value, label]) => ({ value, label }));
}

export function ComponentLibraryPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [viewId, setViewId] = useState(id);
  const [editing, setEditing] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | undefined>();
  const [filters, setFilters] = useState<{ category?: string; domain?: string; status?: string }>({});
  const list = useQuery({ queryKey: ['components'], queryFn: getComponents });
  const config = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const detail = useQuery({ queryKey: ['component', viewId], queryFn: () => getComponent(viewId!), enabled: !!viewId });
  const done = (text: string) => {
    message.success(text);
    qc.invalidateQueries({ queryKey: ['components'] });
    if (viewId) qc.invalidateQueries({ queryKey: ['component', viewId] });
  };
  const validate = useMutation({ mutationFn: validateComponent, onSuccess: result => { setValidation(result); done(result.valid && result.execution_ready ? '组件执行校验通过' : '组件尚未达到发布条件'); } });
  const publish = useMutation({ mutationFn: publishComponent, onSuccess: () => { done('组件发布成功'); setEditing(false); } });
  const copy = useMutation({ mutationFn: copyComponentVersion, onSuccess: component => { done('已复制为新的草稿版本'); setViewId(component.component_id); setEditing(true); } });
  const offline = useMutation({ mutationFn: offlineComponent, onSuccess: () => { done('组件已停用'); setEditing(false); } });
  const remove = useMutation({
    mutationFn: deleteComponent,
    onSuccess: (_result, componentId) => {
      if (viewId === componentId) {
        setViewId(undefined);
        setEditing(false);
        setValidation(undefined);
      }
      qc.removeQueries({ queryKey: ['component', componentId] });
      qc.invalidateQueries({ queryKey: ['components'] });
      message.success('草稿组件已删除');
    },
  });
  const confirmDelete = (component: ComponentDef) => Modal.confirm({
    title: '删除草稿组件？',
    icon: <DeleteOutlined />,
    content: `组件 ${component.component_id} 将被永久删除，此操作无法撤销。已发布、已停用或已被模型引用的组件不能删除。`,
    okText: '删除草稿',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => remove.mutateAsync(component.component_id),
  });
  const save = useMutation({
    mutationFn: (value: Partial<ComponentDef>) => viewId ? updateComponent(viewId, value) : createComponent(value),
    onSuccess: component => {
      done('组件保存成功');
      setViewId(component.component_id);
      setEditing(false);
    },
  });
  const allRows = list.data || [];
  const rows = allRows.filter(item => (!filters.category || item.category === filters.category)
    && (!filters.domain || item.domain === filters.domain)
    && (!filters.status || String(item.status) === filters.status));
  const publishedCount = rows.filter(item => String(item.status).toLowerCase() === COMPONENT_PUBLISHED_STATUS).length;
  const draftCount = rows.filter(item => String(item.status).toLowerCase() === 'draft').length;
  const dependencyAnalysis = analyzeComponentDependencies(allRows);
  const componentById = new Map(allRows.map(item => [getComponentId(item), item]));
  const unavailableDependencyOwners = allRows.flatMap(item => (
    getComponentDependencyIds(item).some(dependencyId => {
      const dependency = componentById.get(dependencyId);
      return dependency && !isPublishedComponent(dependency);
    })
      ? [getComponentId(item)]
      : []
  ));
  const dependencyIssueIds = new Set([
    ...dependencyAnalysis.missing.map(item => item.componentId),
    ...dependencyAnalysis.selfDependencies,
    ...dependencyAnalysis.cycles.flatMap(cycle => cycle),
    ...unavailableDependencyOwners,
  ]);
  const dependencyIssueCount = rows.filter(item => dependencyIssueIds.has(getComponentId(item))).length;
  const c = detail.data;
  const dictionaries = config.data?.dictionaries;
  const validationResult = validation || asValidationResult(c?.validation_result);

  return (
    <>
      <PageHeader
        title="组件库管理"
        description="可复用约束组件、参数接口、依赖校验与版本发布。"
        extra={<Button type="primary" onClick={() => { setViewId(undefined); setEditing(true); setValidation(undefined); }}>新建组件</Button>}
      />
      <MetricGrid>
        <MetricCard title="组件总数" value={rows.length} description="组件注册表" tone="blue" />
        <MetricCard title="已发布" value={publishedCount} description="可用于新模型" tone="green" />
        <MetricCard title="草稿" value={draftCount} description="校验发布后可用" tone="amber" />
        <MetricCard title="依赖异常" value={dependencyIssueCount} description="缺失、自依赖或循环" tone={dependencyIssueCount ? 'red' : 'neutral'} />
      </MetricGrid>
      <Card className="content-card section-gap" title={`组件清单 · 生命周期已发布 ${publishedCount}`}>
        <Space wrap className="full-width component-filter-bar">
          <Select allowClear placeholder="分类" style={{ width: 140 }} value={filters.category} onChange={category => setFilters({ ...filters, category })} options={optionsFromDictionary(dictionaries?.component_categories, allRows, 'category')} />
          <Select allowClear placeholder="领域" style={{ width: 140 }} value={filters.domain} onChange={domain => setFilters({ ...filters, domain })} options={optionsFromDictionary(dictionaries?.component_domains, allRows, 'domain')} />
          <Select allowClear placeholder="生命周期状态" style={{ width: 150 }} value={filters.status} onChange={status => setFilters({ ...filters, status })} options={[...new Set(allRows.map(item => String(item.status || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
        </Space>
        <DataTable<ComponentDef>
          className="component-list-table"
          loading={list.isLoading}
          dataSource={rows}
          columns={[
            { title: '组件名称', render: (_: unknown, row: ComponentDef) => row.display_name || row.name },
            { title: '组件编码', dataIndex: 'component_id' },
            { title: '分类', dataIndex: 'category' },
            { title: '领域', dataIndex: 'domain' },
            { title: <span title="生命周期状态：草稿、已发布或已停用">生命周期状态</span>, dataIndex: 'status', render: (status: string) => <StatusTag status={status} /> },
            { title: '版本', dataIndex: 'version' },
            {
              title: '操作',
              fixed: 'right' as const,
              width: 210,
              render: (_: unknown, row: ComponentDef) => (
                <Space className="asset-actions" size={4}>
                  <Button type="link" onClick={() => { setViewId(row.component_id); setEditing(false); setValidation(undefined); }}>查看</Button>
                  <Button
                    type="link"
                    title={String(row.status).toLowerCase() === 'draft' ? '编辑草稿' : '基于当前版本创建草稿副本后编辑'}
                    onClick={() => {
                      setValidation(undefined);
                      if (String(row.status).toLowerCase() === 'draft') {
                        setViewId(row.component_id);
                        setEditing(true);
                      } else {
                        copy.mutate(row.component_id);
                      }
                    }}
                  >{String(row.status).toLowerCase() === 'draft' ? '编辑' : '复制编辑'}</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'validate', label: '校验组件' },
                        { key: 'publish', label: String(row.status).toLowerCase() === 'offline' ? '重新发布' : '发布组件', disabled: String(row.status).toLowerCase() === 'published' },
                        { key: 'copy', label: '复制版本' },
                        { key: 'offline', label: '停用组件', danger: true, disabled: String(row.status).toLowerCase() !== 'published' },
                        { type: 'divider' },
                        { key: 'delete', label: '删除草稿', icon: <DeleteOutlined />, danger: true, disabled: String(row.status).toLowerCase() !== 'draft' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'validate') validate.mutate(row.component_id);
                        if (key === 'publish') publish.mutate(row.component_id);
                        if (key === 'copy') copy.mutate(row.component_id);
                        if (key === 'offline') offline.mutate(row.component_id);
                        if (key === 'delete') confirmDelete(row);
                      },
                    }}
                  >
                    <Button type="link" icon={<MoreOutlined />} aria-label="更多">更多</Button>
                  </Dropdown>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        size="large"
        open={!!viewId || editing}
        onClose={() => { setViewId(undefined); setEditing(false); setValidation(undefined); }}
        title={editing ? '组件编辑器' : c?.display_name || c?.name || '组件详情'}
        footer={editing ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setViewId(undefined); setEditing(false); setValidation(undefined); }}>取消</Button>
            {c && <Button onClick={() => validate.mutate(c.component_id)}>校验组件</Button>}
            {c && <Button onClick={() => publish.mutate(c.component_id)}>发布组件</Button>}
            <Button form="component-editor-form" htmlType="submit" type="primary">保存草稿</Button>
          </Space>
        ) : (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setViewId(undefined); setEditing(false); setValidation(undefined); }}>关闭</Button>
            {c && <Button onClick={() => validate.mutate(c.component_id)}>校验</Button>}
            {c && String(c.status).toLowerCase() !== 'published' && <Button type="primary" onClick={() => publish.mutate(c.component_id)}>{String(c.status).toLowerCase() === 'offline' ? '重新发布' : '发布组件'}</Button>}
            {c && String(c.status).toLowerCase() !== 'draft' && <Button onClick={() => copy.mutate(c.component_id)}>复制为新草稿</Button>}
          </Space>
        )}
      >
        {editing ? (
          viewId && !c
            ? <div className="component-editor-loading"><Spin description="正在加载完整组件定义…" /></div>
            : (
              <ComponentEditor
                key={c?.component_id || 'new-component'}
                component={c}
                availableComponents={allRows}
                dictionaries={dictionaries}
                onSave={value => save.mutate(value)}
              />
            )
        ) : c && (
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="组件名称">{c.display_name || c.name}</Descriptions.Item>
                    <Descriptions.Item label="组件编码">{c.component_id}</Descriptions.Item>
                    <Descriptions.Item label="分类">{c.category || '-'}</Descriptions.Item>
                    <Descriptions.Item label="领域">{c.domain || '-'}</Descriptions.Item>
                    <Descriptions.Item label="生命周期状态"><StatusTag status={c.status} /></Descriptions.Item>
                    <Descriptions.Item label="版本">{c.version || '-'}</Descriptions.Item>
                    <Descriptions.Item label="建模可用性">
                      <Tag color={String(c.status).toLowerCase() === 'published' ? 'green' : 'default'}>
                        {String(c.status).toLowerCase() === 'published' ? '可用于新模型' : '不可用于新模型'}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="依赖组件" span={2}>
                      {getComponentDependencyIds(c).length ? getComponentDependencyIds(c).map(dep => <Tag key={dep}>{dep}</Tag>) : '无'}
                    </Descriptions.Item>
                    <Descriptions.Item label="组件说明" span={2}>{String(c.description || '-')}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              { key: 'business', label: '业务口径', children: <ComponentBusinessView component={c} /> },
              { key: 'math', label: '数学定义', children: <ComponentMathDefinition component={c} /> },
              { key: 'params', label: '参数接口', children: <ParameterBindingPanel component={c} /> },
              { key: 'deps', label: '依赖关系', children: <ComponentDependencyPanel component={c} available={allRows} /> },
              { key: 'validation', label: '校验结果', children: <ComponentValidationPanel result={validationResult} /> },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
