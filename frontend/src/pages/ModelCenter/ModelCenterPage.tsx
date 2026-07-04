import { MoreOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Dropdown, Input, Modal, Select, Space, Tabs, Tag, message } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { copyModel, getModel, getModelAssetDetail, getModels, offlineModel, publishModel, testModel } from '../../api/models';
import { cloneTemplate, getTemplates } from '../../api/templates';
import { DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { FilterBar, MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import {
  ModelBasicPanel,
  ModelComponentPanel,
  ModelGenericPanel,
  ModelGovernancePanel,
  ModelHistoryPanel,
  ModelRuntimePanel,
  ModelSemanticPanel,
} from '../../features/model-center/ModelAssetPanels';
import type { ModelAsset } from '../../types/model';

const callableStatuses = new Set(['published', 'trial', 'tested', '已发布', '试运行', '已测试']);

function buildModeText(value: unknown) {
  return value === 'component_based' ? '组件化 Builder' : value === 'generic_linear' ? '通用线性 Builder' : String(value || '-');
}

function statusText(value: unknown) {
  const text = String(value || '-');
  const map: Record<string, string> = { published: '已发布', trial: '试运行', tested: '已测试', draft: '草稿', developing: '开发中', offline: '已下线' };
  return map[text] || text;
}

function problemType(model: ModelAsset) {
  return model.model_problem_type || model.problem_type || '-';
}

function isCallable(model: ModelAsset) {
  return callableStatuses.has(String(model.status));
}

function templateCapability(template: { code?: string; problem_type?: string; tags?: string[]; scenario?: string; description?: string }) {
  if (template.code === 'cascade_hydro_dispatch_v1') {
    return {
      problemType: 'MILP',
      functionAssets: '1D PWL + 2D PWL',
      useCase: '日前/日内水电优化调度',
    };
  }
  return {
    problemType: template.problem_type || '-',
    functionAssets: (template.tags || []).some(tag => /piecewise|PWL/i.test(tag)) ? 'PWL' : '-',
    useCase: template.scenario || template.description || '-',
  };
}

export function ModelCenterPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { id } = useParams();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [template, setTemplate] = useState<string>();
  const [viewId, setViewId] = useState(id);
  const [filters, setFilters] = useState<{ build?: string; problem?: string; status?: string; scene?: string; keyword?: string }>({});
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const detail = useQuery({ queryKey: ['model', viewId], queryFn: () => getModel(viewId!), enabled: !!viewId });
  const assetDetail = useQuery({ queryKey: ['model-asset-detail', viewId], queryFn: () => getModelAssetDetail(viewId!), enabled: !!viewId });

  const refresh = (modelId?: string) => {
    qc.invalidateQueries({ queryKey: ['models'] });
    if (modelId) {
      qc.invalidateQueries({ queryKey: ['model', modelId] });
      qc.invalidateQueries({ queryKey: ['model-asset-detail', modelId] });
    }
  };
  const publish = useMutation({ mutationFn: publishModel, onSuccess: model => { message.success('模型发布成功'); refresh(model.id); } });
  const test = useMutation({ mutationFn: (modelId: string) => testModel(modelId, {}), onSuccess: model => { message.success('模型测试完成'); refresh(model.id); } });
  const copy = useMutation({ mutationFn: copyModel, onSuccess: model => { message.success('模型复制成功'); refresh(model.id); setViewId(model.id); } });
  const offline = useMutation({ mutationFn: offlineModel, onSuccess: model => { message.success('模型已下线'); refresh(model.id); } });
  const clone = useMutation({
    mutationFn: cloneTemplate,
    onSuccess: model => {
      message.success('模板克隆成功');
      refresh(model.id);
      setTemplateOpen(false);
      nav(`/models/${model.id}`);
      setViewId(model.id);
    },
  });

  const allRows = models.data || [];
  const rows = allRows.filter(model => {
    const text = `${model.name || ''} ${model.id || ''} ${model.template_id || ''}`.toLowerCase();
    return (!filters.keyword || text.includes(filters.keyword.toLowerCase()))
      && (!filters.build || model.build_mode === filters.build)
      && (!filters.problem || problemType(model) === filters.problem)
      && (!filters.status || String(model.status) === filters.status)
      && (!filters.scene || String(model.scene || '') === filters.scene);
  });
  const publishedCount = rows.filter(isCallable).length;
  const developingCount = rows.filter(model => ['developing', 'draft', '开发中', '草稿'].includes(String(model.status))).length;
  const componentBasedCount = rows.filter(model => model.build_mode === 'component_based').length;
  const genericCount = rows.filter(model => model.build_mode === 'generic_linear').length;
  const current = detail.data;
  const currentAssetDetail = assetDetail.data || {};

  return (
    <>
      <PageHeader
        title="模型资产中心"
        description="模型版本管理、发布治理、模板克隆、测试运行与资产沉淀。"
        extra={<><Button onClick={() => setTemplateOpen(true)}>从模板克隆</Button><Button type="primary" onClick={() => nav('/models/create')}>创建模型</Button></>}
      />
      <MetricGrid>
        <MetricCard title="模型资产数" value={rows.length} description="真实后端资产" tone="blue" onClick={() => nav('/models/create')} />
        <MetricCard title="可调用模型" value={publishedCount} description="已发布 / 试运行 / 已测试" tone="green" />
        <MetricCard title="开发中" value={developingCount} description="草稿与待发布版本" tone="amber" />
        <MetricCard title="Builder 覆盖" value={componentBasedCount + genericCount} description={`组件化 ${componentBasedCount} / 通用线性 ${genericCount}`} tone="purple" />
      </MetricGrid>
      <Card className="content-card section-gap" title="模型资产列表">
        <FilterBar onReset={() => setFilters({})}>
          <Input allowClear placeholder="搜索模型名称或编码" style={{ width: 220 }} value={filters.keyword} onChange={event => setFilters({ ...filters, keyword: event.target.value })} />
          <Select allowClear placeholder="建模方式" style={{ width: 160 }} value={filters.build} onChange={build => setFilters({ ...filters, build })} options={[...new Set(allRows.map(item => item.build_mode).filter(Boolean))].map(value => ({ value, label: buildModeText(value) }))} />
          <Select allowClear placeholder="问题类型" style={{ width: 160 }} value={filters.problem} onChange={problem => setFilters({ ...filters, problem })} options={[...new Set(allRows.map(problemType).filter(Boolean))].map(value => ({ value, label: value }))} />
          <Select allowClear placeholder="状态" style={{ width: 140 }} value={filters.status} onChange={status => setFilters({ ...filters, status })} options={[...new Set(allRows.map(item => String(item.status)).filter(Boolean))].map(value => ({ value, label: statusText(value) }))} />
          <Select allowClear placeholder="业务场景" style={{ width: 160 }} value={filters.scene} onChange={scene => setFilters({ ...filters, scene })} options={[...new Set(allRows.map(item => String(item.scene || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
        </FilterBar>
        <DataTable<ModelAsset>
          loading={models.isLoading}
          dataSource={rows}
          columns={[
            { title: '模型名称', render: (_: unknown, model: ModelAsset) => <Space orientation="vertical" size={0}><strong>{model.name}</strong><span className="muted">{model.template_id || model.id}</span></Space> },
            { title: '构建方式', dataIndex: 'build_mode', render: buildModeText },
            { title: '问题类型', render: (_: unknown, model: ModelAsset) => problemType(model) },
            { title: '业务场景', dataIndex: 'scene' },
            { title: '状态', dataIndex: 'status', render: (status: string) => <StatusTag status={statusText(status)} /> },
            { title: '求解器', dataIndex: 'solver', render: (solver: string) => <span className="pill blue">{solver || 'HiGHS'}</span> },
            { title: '更新时间', dataIndex: 'updated_at' },
            {
              title: '操作',
              fixed: 'right' as const,
              width: 120,
              render: (_: unknown, model: ModelAsset) => (
                <Space className="asset-actions">
                  <Button type="link" onClick={() => setViewId(model.id)}>查看</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'edit', label: '编辑' },
                        { key: 'test', label: '测试运行' },
                        { key: 'publish', label: isCallable(model) ? '下线模型' : '发布模型' },
                        { key: 'copy', label: '复制版本' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'edit') nav(`/models/create?source=${encodeURIComponent(model.id)}`);
                        if (key === 'test') test.mutate(model.id);
                        if (key === 'publish') (isCallable(model) ? offline : publish).mutate(model.id);
                        if (key === 'copy') copy.mutate(model.id);
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
        open={!!viewId}
        onClose={() => setViewId(undefined)}
        title={current?.name || '模型详情'}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setViewId(undefined)}>关闭</Button>
            {current && <Button onClick={() => test.mutate(current.id)}>测试运行</Button>}
            {current && <Button onClick={() => copy.mutate(current.id)}>复制版本</Button>}
            {current && <Button type="primary" onClick={() => isCallable(current) ? offline.mutate(current.id) : publish.mutate(current.id)}>{isCallable(current) ? '下线模型' : '发布模型'}</Button>}
          </Space>
        )}
      >
        {current && (
          <Tabs
            items={[
              { key: 'basic', label: '基本信息', children: <ModelBasicPanel model={current} detail={currentAssetDetail} /> },
              { key: 'semantic', label: '模型语义', children: <ModelSemanticPanel model={current} detail={currentAssetDetail} /> },
              { key: 'generic', label: 'generic_spec', children: <ModelGenericPanel model={current} detail={currentAssetDetail} /> },
              { key: 'component', label: '组件装配', children: <ModelComponentPanel model={current} detail={currentAssetDetail} /> },
              { key: 'runtime', label: '运行参数', children: <ModelRuntimePanel model={current} detail={currentAssetDetail} /> },
              { key: 'governance', label: '发布治理', children: <ModelGovernancePanel model={current} detail={currentAssetDetail} /> },
              { key: 'history', label: '调用记录', children: <ModelHistoryPanel detail={currentAssetDetail} /> },
            ]}
          />
        )}
      </Drawer>
      <Modal title="选择内置模板" open={templateOpen} onCancel={() => setTemplateOpen(false)} onOk={() => template && clone.mutate(template)} confirmLoading={clone.isPending}>
        <div className="form-card">
          <Select showSearch style={{ width: '100%' }} value={template} onChange={setTemplate} options={templates.data?.map(item => ({ value: item.code, label: `${item.name} (${item.code})` }))} />
          <div className="template-card-grid section-gap">
            {(templates.data || []).map(item => {
              const capability = templateCapability(item);
              return (
                <Card
                  key={item.code}
                  size="small"
                  className={template === item.code ? 'selected-template-card' : undefined}
                  onClick={() => setTemplate(item.code)}
                  title={item.name}
                  extra={<Tag color={capability.problemType === 'MILP' ? 'purple' : 'blue'}>模型类型：{capability.problemType}</Tag>}
                >
                  <Space orientation="vertical" size={4}>
                    <span>函数资产：{capability.functionAssets}</span>
                    <span>适用场景：{capability.useCase}</span>
                    <span className="muted">{item.code}</span>
                  </Space>
                </Card>
              );
            })}
          </div>
          <p className="muted mt">克隆后会生成真实模型资产，可继续进入模型详情或模型创建流程完善。</p>
        </div>
      </Modal>
    </>
  );
}
