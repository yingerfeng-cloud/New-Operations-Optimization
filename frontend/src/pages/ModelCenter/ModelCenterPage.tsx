import { MoreOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Dropdown, Input, Modal, Select, Space, Tabs, Tag, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getModel, getModelAssetDetail, getModels, offlineModel, publishModel, returnModelToDraft, testModel } from '../../api/models';
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
import {
  isImmutableVersion,
  lifecycleActionLabel,
  lifecycleActions,
  lifecycleHint,
  lifecycleStatus,
  lifecycleStatusText,
  testActionLabel,
  type ModelLifecycleAction,
} from '../../features/model-center/modelLifecycle';

function buildModeText(value: unknown) {
  return value === 'component_based' ? '组件化 Builder' : value === 'generic_linear' ? '通用线性 Builder' : value === 'template_based' ? '模板 Builder' : String(value || '-');
}

function statusText(value: unknown) {
  return lifecycleStatusText(value);
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

function editAction(model: ModelAsset) {
  if (lifecycleStatus(model.status) === 'trial' && !model.published_at) {
    return { label: '退回草稿并修改', url: `/models/${encodeURIComponent(model.id)}/edit`, returnToDraft: true };
  }
  if (isImmutableVersion(model)) {
    return { label: '创建新版本并修改', url: `/models/create?mode=version&source=${encodeURIComponent(model.id)}` };
  }
  return {
    label: '编辑草稿',
    url: `/models/${encodeURIComponent(model.id)}/edit`,
  };
}

function errorMessage(error: unknown) {
  const response = (error as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    return String(record.message || record.code || '操作失败');
  }
  return error instanceof Error ? error.message : '操作失败';
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
  const [modalApi, modalContextHolder] = Modal.useModal();
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
  const publish = useMutation({
    mutationFn: publishModel,
    onSuccess: model => { message.success('模型状态已更新为已发布'); refresh(model.id); },
    onError: error => message.error(`发布失败：${errorMessage(error)}`),
  });
  const test = useMutation({
    mutationFn: ({ model, detail: testDetail = {} }: { model: ModelAsset; detail?: Record<string, unknown> }) => testModel(model.id, { parameters: defaultTestParameters(model, testDetail) }),
    onSuccess: model => {
      message.success(lifecycleStatus(model.status) === 'published' ? '验证运行通过，模型保持已发布' : '模型测试通过，状态已更新为试运行');
      refresh(model.id);
    },
    onError: error => message.error(`测试失败：${errorMessage(error)}`),
  });
  const offline = useMutation({
    mutationFn: offlineModel,
    onSuccess: model => { message.success('模型已下线'); refresh(model.id); },
    onError: error => message.error(`下线失败：${errorMessage(error)}`),
  });
  const returnDraft = useMutation({
    mutationFn: returnModelToDraft,
    onSuccess: model => {
      message.success('模型已退回草稿，原测试基线已清除');
      refresh(model.id);
      nav(`/models/${encodeURIComponent(model.id)}/edit`);
    },
    onError: error => message.error(`退回草稿失败：${errorMessage(error)}`),
  });
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
  const publishedCount = rows.filter(model => model.status === 'published').length;
  const trialCount = rows.filter(model => model.status === 'trial').length;
  const developingCount = rows.filter(model => model.status === 'developing').length;
  const current = detail.data;
  const currentAssetDetail = assetDetail.data || {};

  const executeEditAction = (model: ModelAsset) => {
    const action = editAction(model);
    if (!action.returnToDraft) {
      nav(action.url);
      return;
    }
    modalApi.confirm({
      title: '退回草稿并修改？',
      content: '退回后将清除当前试运行的测试凭据；修改完成后需要重新测试，才能再次进入试运行。',
      okText: '退回草稿',
      cancelText: '取消',
      onOk: () => returnDraft.mutateAsync(model.id),
    });
  };

  const executeLifecycleAction = (model: ModelAsset, action: ModelLifecycleAction) => {
    const label = lifecycleActionLabel(action);
    modalApi.confirm({
      title: `${label}？`,
      content: action === 'offline'
        ? '下线后新的任务和服务调用将不再使用该模型版本，历史记录会保留。'
        : action === 'republish'
          ? '将恢复这个已测试通过的历史版本；同一 model_code 当前正在正式服务的版本会自动下线。'
          : action === 'promote'
            ? '系统将校验当前内容与试运行测试基线一致，然后正式发布；不会重复执行求解测试。'
          : '发布后当前版本将成为正式可用版本；后续修改会基于该版本生成新草稿。',
      okText: label,
      cancelText: '取消',
      okButtonProps: { danger: action === 'offline' },
      onOk: () => action === 'offline'
        ? offline.mutateAsync(model.id)
        : publish.mutateAsync(model.id),
    });
  };

  return (
    <>
      {modalContextHolder}
      <PageHeader
        title="模型资产中心"
        description="模型版本管理、发布治理、模板克隆、测试运行与资产沉淀。"
        extra={<><Button onClick={() => setTemplateOpen(true)}>从模板克隆</Button><Button type="primary" onClick={() => nav('/models/create')}>创建模型</Button></>}
      />
      <MetricGrid>
        <MetricCard title="模型资产数" value={rows.length} description="真实后端资产" tone="blue" />
        <MetricCard title="正式服务" value={publishedCount} description="已发布，可被 API / Skill 调用" tone="green" />
        <MetricCard title="试运行验收" value={trialCount} description="仅按 model_id 调试" tone="purple" />
        <MetricCard title="草稿" value={developingCount} description="可直接编辑的未发布版本" tone="amber" />
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
              render: (_: unknown, model: ModelAsset) => (
                  <div className="model-asset-status-cell">
                    <Tooltip title={lifecycleHint(model)}>
                      <span><StatusTag status={statusText(model.status)} /></span>
                    </Tooltip>
                    {model.status === 'published'
                      ? <Tag color="green">正式服务</Tag>
                      : model.status === 'trial'
                        ? <Tag color="purple">仅限验收调试</Tag>
                        : <Tag>未开放调用</Tag>}
                  </div>
                ),
            },
            { title: '更新时间', width: 130, dataIndex: 'updated_at', render: renderDate },
            {
              title: '操作',
              width: 140,
              render: (_: unknown, model: ModelAsset) => {
                const actions = lifecycleActions(model);
                const status = lifecycleStatus(model.status);
                const unavailableActionLabel = status === 'developing' || status === 'publish_failed'
                  ? '正式发布（需先测试进入试运行）'
                  : status === 'offline'
                    ? '恢复为正式版本（需先测试）'
                    : '暂无可用状态操作';
                return (
                  <Space className="asset-actions">
                    <Button aria-label="查看" size="small" onClick={() => nav(`/models/${encodeURIComponent(model.id)}`)}>查看</Button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: ([
                          { key: 'status', label: `当前状态：${statusText(model.status)}`, disabled: true },
                          { type: 'divider' },
                          { key: 'edit', label: editAction(model).label },
                          { key: 'test', label: testActionLabel(model) },
                          ...actions.map(action => ({
                            key: `lifecycle-${action}`,
                            label: lifecycleActionLabel(action),
                            danger: action === 'offline',
                          })),
                          ...(actions.length
                            ? []
                            : [{ key: 'lifecycle-unavailable', label: unavailableActionLabel, disabled: true }]),
                          { key: 'copy', label: '复制为独立模型' },
                        ] satisfies MenuProps['items']),
                        onClick: ({ key }) => {
                          if (key === 'edit') executeEditAction(model);
                          if (key === 'test') test.mutate({ model });
                          const action = actions.find(item => key === `lifecycle-${item}`);
                          if (action) executeLifecycleAction(model, action);
                          if (key === 'copy') nav(`/models/create?mode=clone&source=${encodeURIComponent(model.id)}`);
                        },
                      }}
                    >
                      <Button size="small" icon={<MoreOutlined />}>更多</Button>
                    </Dropdown>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>
      <Drawer
        size="large"
        open={!!viewId}
        onClose={() => nav('/models')}
        title={(
          <Space>
            {current?.name || '模型详情'}
            {current && (
              <Tooltip title={lifecycleHint(current)}>
                <span><StatusTag status={statusText(current.status)} /></span>
              </Tooltip>
            )}
            <Button type="link" onClick={() => setExpertView(value => !value)}>{expertView ? '业务视图' : '专家视图'}</Button>
          </Space>
        )}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => nav('/models')}>关闭</Button>
            {current && <Button onClick={() => executeEditAction(current)}>{editAction(current).label}</Button>}
            {current && <Button onClick={() => test.mutate({ model: current, detail: currentAssetDetail })}>{testActionLabel(current)}</Button>}
            {current && <Button onClick={() => nav(`/models/create?mode=clone&source=${encodeURIComponent(current.id)}`)}>复制为独立模型</Button>}
            {current && lifecycleActions(current).map(action => (
              <Button
                key={action}
                type={action === 'offline' ? 'default' : 'primary'}
                danger={action === 'offline'}
                onClick={() => executeLifecycleAction(current, action)}
              >
                {lifecycleActionLabel(action)}
              </Button>
            ))}
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
              { key: 'documentation', label: '模型说明', children: <ModelDemoPanel model={current} detail={currentAssetDetail} /> },
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
