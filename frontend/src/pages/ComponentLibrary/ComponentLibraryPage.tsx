import { MoreOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Drawer, Dropdown, Select, Space, Tabs, Tag, message } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { copyComponentVersion, createComponent, getComponent, getComponents, offlineComponent, publishComponent, updateComponent, validateComponent } from '../../api/components';
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

type ValidationResult = { valid: boolean; errors?: unknown[] };

function booleanPill(value: boolean | undefined) {
  return <span className={value !== false ? 'pill green' : 'pill amber'}>{value !== false ? '是' : '否'}</span>;
}

function asValidationResult(value: unknown): ValidationResult | undefined {
  if (!value || typeof value !== 'object' || !('valid' in value)) return undefined;
  return value as ValidationResult;
}

export function ComponentLibraryPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [viewId, setViewId] = useState(id);
  const [editing, setEditing] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | undefined>();
  const [filters, setFilters] = useState<{ category?: string; domain?: string; status?: string; implemented?: string }>({});
  const list = useQuery({ queryKey: ['components'], queryFn: getComponents });
  const detail = useQuery({ queryKey: ['component', viewId], queryFn: () => getComponent(viewId!), enabled: !!viewId });
  const done = (text: string) => {
    message.success(text);
    qc.invalidateQueries({ queryKey: ['components'] });
    if (viewId) qc.invalidateQueries({ queryKey: ['component', viewId] });
  };
  const validate = useMutation({ mutationFn: validateComponent, onSuccess: result => { setValidation(result); done(result.valid ? '组件校验通过' : '组件校验未通过'); } });
  const publish = useMutation({ mutationFn: publishComponent, onSuccess: () => done('组件发布成功') });
  const copy = useMutation({ mutationFn: copyComponentVersion, onSuccess: () => done('组件版本复制成功') });
  const offline = useMutation({ mutationFn: offlineComponent, onSuccess: () => done('组件已停用') });
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
    && (!filters.status || String(item.status) === filters.status)
    && (!filters.implemented || String(item.implemented !== false) === filters.implemented));
  const enabledCount = rows.filter(item => item.enabled !== false).length;
  const implementedCount = rows.filter(item => item.implemented !== false).length;
  const publishedCount = rows.filter(item => ['published', '已发布'].includes(String(item.status))).length;
  const availableIds = rows.map(item => item.component_id);
  const missingDeps = rows.filter(item => (item.depends_on || item.dependencies || []).some(dep => !availableIds.includes(dep))).length;
  const c = detail.data;
  const validationResult = validation || asValidationResult(c?.validation_result);

  return (
    <>
      <PageHeader
        title="组件库管理"
        description="可复用约束组件、参数绑定、依赖校验与版本发布。"
        extra={<Button type="primary" onClick={() => { setViewId(undefined); setEditing(true); setValidation(undefined); }}>新建组件</Button>}
      />
      <MetricGrid>
        <MetricCard title="组件总数" value={rows.length} description="组件注册表" tone="blue" />
        <MetricCard title="启用组件" value={enabledCount} description="参与模型装配" tone="green" />
        <MetricCard title="已实现" value={implementedCount} description="已有后端实现" tone="amber" />
        <MetricCard title="依赖缺失" value={missingDeps} description="阻止发布风险" tone={missingDeps ? 'red' : 'neutral'} />
      </MetricGrid>
      <Card className="content-card section-gap" title={`组件清单 · 已发布 ${publishedCount}`}>
        <Space wrap className="full-width">
          <Select allowClear placeholder="分类" style={{ width: 140 }} value={filters.category} onChange={category => setFilters({ ...filters, category })} options={[...new Set(allRows.map(item => String(item.category || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
          <Select allowClear placeholder="领域" style={{ width: 140 }} value={filters.domain} onChange={domain => setFilters({ ...filters, domain })} options={[...new Set(allRows.map(item => String(item.domain || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
          <Select allowClear placeholder="状态" style={{ width: 140 }} value={filters.status} onChange={status => setFilters({ ...filters, status })} options={[...new Set(allRows.map(item => String(item.status || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
          <Select allowClear placeholder="实现状态" style={{ width: 140 }} value={filters.implemented} onChange={implemented => setFilters({ ...filters, implemented })} options={[{ value: 'true', label: '已实现' }, { value: 'false', label: '未实现' }]} />
        </Space>
        <DataTable<ComponentDef>
          className="section-gap"
          loading={list.isLoading}
          dataSource={rows}
          columns={[
            { title: '组件名称', render: (_: unknown, row: ComponentDef) => row.display_name || row.name },
            { title: '组件编码', dataIndex: 'component_id' },
            { title: '分类', dataIndex: 'category' },
            { title: '领域', dataIndex: 'domain' },
            { title: '状态', dataIndex: 'status', render: (status: string) => <StatusTag status={status} /> },
            { title: '启用', dataIndex: 'enabled', render: booleanPill },
            { title: '已实现', dataIndex: 'implemented', render: booleanPill },
            { title: '版本', dataIndex: 'version' },
            {
              title: '操作',
              fixed: 'right' as const,
              width: 180,
              render: (_: unknown, row: ComponentDef) => (
                <Space className="asset-actions">
                  <Button type="link" onClick={() => { setViewId(row.component_id); setEditing(false); setValidation(undefined); }}>查看</Button>
                  <Button type="link" onClick={() => { setViewId(row.component_id); setEditing(true); setValidation(undefined); }}>编辑</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'validate', label: '校验组件' },
                        { key: 'publish', label: '发布组件' },
                        { key: 'copy', label: '复制版本' },
                        { key: 'offline', label: '停用组件', danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'validate') validate.mutate(row.component_id);
                        if (key === 'publish') publish.mutate(row.component_id);
                        if (key === 'copy') copy.mutate(row.component_id);
                        if (key === 'offline') offline.mutate(row.component_id);
                      },
                    }}
                  >
                    <Button type="link" icon={<MoreOutlined />}>更多</Button>
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
            {c && <Button type="primary" onClick={() => publish.mutate(c.component_id)}>发布组件</Button>}
          </Space>
        )}
      >
        {editing ? <ComponentEditor component={c} availableIds={availableIds} onSave={value => save.mutate(value)} /> : c && (
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
                    <Descriptions.Item label="状态"><StatusTag status={c.status} /></Descriptions.Item>
                    <Descriptions.Item label="版本">{c.version || '-'}</Descriptions.Item>
                    <Descriptions.Item label="启用">{booleanPill(c.enabled)}</Descriptions.Item>
                    <Descriptions.Item label="后端实现">{booleanPill(c.implemented)}</Descriptions.Item>
                    <Descriptions.Item label="依赖组件" span={2}>
                      {(c.depends_on || c.dependencies || []).length ? (c.depends_on || c.dependencies || []).map(dep => <Tag key={dep}>{dep}</Tag>) : '无'}
                    </Descriptions.Item>
                    <Descriptions.Item label="组件说明" span={2}>{String(c.description || '-')}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              { key: 'business', label: '业务口径', children: <ComponentBusinessView component={c} /> },
              { key: 'math', label: '数学定义', children: <ComponentMathDefinition component={c} /> },
              { key: 'params', label: '参数绑定', children: <ParameterBindingPanel component={c} /> },
              { key: 'deps', label: '依赖关系', children: <ComponentDependencyPanel component={c} available={availableIds} /> },
              { key: 'validation', label: '校验结果', children: <ComponentValidationPanel result={validationResult} /> },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
