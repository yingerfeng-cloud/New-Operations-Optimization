import { MoreOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Dropdown, Input, Modal, Select, Space, Tabs, Tag, Tooltip, message } from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getModel, getModelAssetDetail, getModels, offlineModel, publishModel, testModel } from '../../api/models';
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
  ModelDemoPanel,
  ModelRuntimePanel,
  ModelSemanticPanel,
} from '../../features/model-center/ModelAssetPanels';
import { capabilityOrFallback } from '../../features/demo/demoCapabilities';
import type { ModelAsset } from '../../types/model';

const callableStatuses = new Set(['published', 'trial', 'tested', '已发布', '试运行', '已测试']);

function buildModeText(value: unknown) {
  return value === 'component_based' ? '组件化 Builder' : value === 'generic_linear' ? '通用线性 Builder' : value === 'template_based' ? '模板 Builder' : String(value || '-');
}

function statusText(value: unknown) {
  const text = String(value || '-');
  const map: Record<string, string> = { published: '已发布', trial: '试运行', tested: '已测试', draft: '草稿', developing: '开发中', offline: '已下线' };
  return map[text] || text;
}

function problemType(model: ModelAsset) {
  return model.model_problem_type || model.problem_type || '-';
}

function displayText(value: unknown, fallback = '未配置') {
  const text = String(value || '').trim();
  return text && text !== '-' ? text : fallback;
}

function renderDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '-';
  const [date, time] = text.replace('T', ' ').split(' ');
  return (
    <div className="model-asset-date">
      <span>{date}</span>
      {time && <span>{time.slice(0, 5)}</span>}
    </div>
  );
}

function isCallable(model: ModelAsset) {
  return callableStatuses.has(String(model.status));
}

function editAction(model: ModelAsset) {
  const status = String(model.status || '');
  if (status === 'published' || status === '已发布') {
    return { label: '创建新版本', url: `/models/create?mode=version&source=${encodeURIComponent(model.id)}` };
  }
  return {
    label: status === 'tested' || status === '已测试' ? '继续编辑' : '编辑草稿',
    url: `/models/${encodeURIComponent(model.id)}/edit`,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function defaultTestParameters(model: ModelAsset, detail: Record<string, unknown> = {}) {
  const semantic = objectValue(model.semantic_spec);
  const detailSemantic = objectValue(detail.semantic_spec);
  const draft = objectValue(model.model_draft || detail.model_draft);
  return {
    ...objectValue(semantic.sample_runtime_parameters),
    ...objectValue(detailSemantic.sample_runtime_parameters),
    ...objectValue(draft.runtime_parameters),
    ...objectValue(model.parameters),
    ...objectValue(detail.parameters),
  };
}

function templateCapability(template: { code?: string; problem_type?: string; tags?: string[]; scenario?: string; description?: string }) {
  const capability = capabilityOrFallback(template as Record<string, unknown>, template.problem_type || '-');
  return {
    problemType: capability.problemType,
    solver: capability.solver,
    functionAssets: capability.functionAssets,
    useCase: capability.useCase,
  };
}

export function ModelCenterPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { id } = useParams();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [template, setTemplate] = useState<string>();
  const viewId = id;
  const [expertView, setExpertView] = useState(false);
  const [filters, setFilters] = useState<{ build?: string; problem?: string; status?: string; scene?: string; keyword?: string }>({});
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const templates = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const detail = useQuery({ queryKey: ['model', viewId], queryFn: () => getModel(viewId!), enabled: !!viewId });
  const assetDetail = useQuery({ queryKey: ['model-asset-detail', viewId], queryFn: () => getModelAssetDetail(viewId!), enabled: !!viewId });

  useEffect(() => {
    setExpertView(false);
  }, [viewId]);

  const refresh = (modelId?: string) => {
    qc.invalidateQueries({ queryKey: ['models'] });
    if (modelId) {
      qc.invalidateQueries({ queryKey: ['model', modelId] });
      qc.invalidateQueries({ queryKey: ['model-asset-detail', modelId] });
    }
  };
  const publish = useMutation({ mutationFn: publishModel, onSuccess: model => { message.success('模型发布成功'); refresh(model.id); } });
  const test = useMutation({
    mutationFn: ({ model, detail: testDetail = {} }: { model: ModelAsset; detail?: Record<string, unknown> }) => testModel(model.id, { parameters: defaultTestParameters(model, testDetail) }),
    onSuccess: model => { message.success('模型测试完成'); refresh(model.id); },
  });
  const offline = useMutation({ mutationFn: offlineModel, onSuccess: model => { message.success('模型已下线'); refresh(model.id); } });
  const clone = useMutation({
    mutationFn: cloneTemplate,
    onSuccess: model => {
      message.success('模板克隆成功');
      refresh(model.id);
      setTemplateOpen(false);
      nav(`/models/${model.id}`);
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
  const templateCount = rows.filter(model => model.build_mode === 'template_based').length;
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
        <MetricCard title="Builder 覆盖" value={componentBasedCount + genericCount + templateCount} description={`组件化 ${componentBasedCount} / 通用线性 ${genericCount} / 模板 ${templateCount}`} tone="purple" />
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
          className="model-asset-table"
          loading={models.isLoading}
          dataSource={rows}
          scroll={{ x: 1080 }}
          columns={[
            {
              title: '模型资产',
              width: 360,
              render: (_: unknown, model: ModelAsset) => {
                const capability = capabilityOrFallback(model);
                const scene = displayText(capability.useCase || model.scene, '暂无业务场景说明');
                return (
                  <div className="model-asset-summary">
                    <strong className="model-asset-name">{model.name}</strong>
                    <span className="model-asset-code">{model.template_id || model.id}</span>
                    <Tooltip title={scene}>
                      <span className="model-asset-scene">{scene}</span>
                    </Tooltip>
                  </div>
                );
              },
            },
            {
              title: '建模与求解',
              width: 210,
              render: (_: unknown, model: ModelAsset) => {
                const capability = capabilityOrFallback(model);
                return (
                  <div className="model-asset-meta-stack">
                    <Tag color="blue">{buildModeText(model.build_mode)}</Tag>
                    <Space size={6} wrap>
                      <Tag color={capability.problemType === 'NLP' ? 'magenta' : 'purple'}>{capability.problemType || '-'}</Tag>
                      <span className="pill blue">{displayText(capability.solver, 'HiGHS')}</span>
                    </Space>
                  </div>
                );
              },
            },
            {
              title: '能力摘要',
              width: 300,
              render: (_: unknown, model: ModelAsset) => {
                const capability = capabilityOrFallback(model);
                const tags = capability.tags.slice(0, 3);
                return (
                  <div className="model-asset-capability">
                    <span>函数资产：{displayText(capability.functionAssets)}</span>
                    <span>非线性：{displayText(capability.nonlinearHandling, problemType(model) === 'NLP' ? '原生非线性' : '线性/模板展开')}</span>
                    {tags.length > 0 && <Space size={[4, 4]} wrap>{tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space>}
                  </div>
                );
              },
            },
            {
              title: '状态',
              width: 150,
              render: (_: unknown, model: ModelAsset) => {
                const capability = capabilityOrFallback(model);
                return (
                  <div className="model-asset-status-cell">
                    <StatusTag status={statusText(model.status)} />
                    {capability.onlineDebug ? <Tag color="green">可调试</Tag> : <Tag>未开放调试</Tag>}
                  </div>
                );
              },
            },
            { title: '更新时间', width: 130, dataIndex: 'updated_at', render: renderDate },
            {
              title: '操作',
              width: 140,
              render: (_: unknown, model: ModelAsset) => (
                <Space className="asset-actions">
                  <Button aria-label="查看" size="small" onClick={() => nav(`/models/${encodeURIComponent(model.id)}`)}>查看</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'edit', label: editAction(model).label },
                        { key: 'test', label: '测试运行' },
                        { key: 'publish', label: isCallable(model) ? '下线模型' : '发布模型' },
                        { key: 'copy', label: '复制模型' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'edit') nav(editAction(model).url);
                        if (key === 'test') test.mutate({ model });
                        if (key === 'publish') (isCallable(model) ? offline : publish).mutate(model.id);
                        if (key === 'copy') nav(`/models/create?mode=clone&source=${encodeURIComponent(model.id)}`);
                      },
                    }}
                  >
                    <Button size="small" icon={<MoreOutlined />}>更多</Button>
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
        onClose={() => nav('/models')}
        title={<Space>{current?.name || '模型详情'}<Button type="link" onClick={() => setExpertView(value => !value)}>{expertView ? '业务视图' : '专家视图'}</Button></Space>}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => nav('/models')}>关闭</Button>
            {current && <Button onClick={() => test.mutate({ model: current, detail: currentAssetDetail })}>测试运行</Button>}
            {current && <Button onClick={() => nav(`/models/create?mode=clone&source=${encodeURIComponent(current.id)}`)}>复制模型</Button>}
            {current && <Button type="primary" onClick={() => isCallable(current) ? offline.mutate(current.id) : publish.mutate(current.id)}>{isCallable(current) ? '下线模型' : '发布模型'}</Button>}
          </Space>
        )}
      >
        {!current && viewId && (detail.isLoading || detail.isFetching) && <Card loading />}
        {current && (
          <Tabs
            items={[
              { key: 'basic', label: '基本信息', children: <ModelBasicPanel model={current} detail={currentAssetDetail} /> },
              ...(expertView ? [
                { key: 'semantic', label: '模型语义', children: <ModelSemanticPanel model={current} detail={currentAssetDetail} /> },
                { key: 'generic', label: 'generic_spec', children: <ModelGenericPanel model={current} detail={currentAssetDetail} /> },
                { key: 'component', label: '组件装配', children: <ModelComponentPanel model={current} detail={currentAssetDetail} /> },
              ] : []),
              { key: 'runtime', label: '运行参数', children: <ModelRuntimePanel model={current} detail={currentAssetDetail} /> },
              { key: 'demo', label: '演示说明', children: <ModelDemoPanel model={current} /> },
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
              const deprecated = Boolean((item as Record<string, unknown>).deprecated);
              const replacementCode = String((item as Record<string, unknown>).replacement_model_code || '');
              return (
                <Card
                  key={item.code}
                  size="small"
                  className={template === item.code ? 'selected-template-card' : undefined}
                  onClick={() => setTemplate(item.code)}
                  title={item.name}
                  extra={<Space>{deprecated && <Tag color="warning">已弃用</Tag>}<Tag color={String(capability.problemType).includes('MILP') ? 'purple' : 'blue'}>模型类型：{capability.problemType}</Tag></Space>}
                >
                  <Space orientation="vertical" size={4}>
                    <span>求解器：{capability.solver}</span>
                    <span>函数资产：{capability.functionAssets}</span>
                    <span>适用场景：{capability.useCase}</span>
                    {deprecated && replacementCode && <span className="muted">替代模型：{replacementCode}</span>}
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
