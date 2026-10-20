import { CopyOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Descriptions, Form, Input, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModelAssetDetail, getModels } from '../../api/models';
import { createTask, getTask } from '../../api/tasks';
import { getResult } from '../../api/results';
import { readSession, writeSession, terminalTask } from '../../api/taskTracking';
import { QueryState } from '../../components/QueryState';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { EmptyActionState, FilterBar } from '../../components/WorkspaceUI';
import type { ModelAsset } from '../../types/model';
import { capabilityOrFallback } from '../../features/demo/demoCapabilities';

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

const invocationRowKeys = new WeakMap<object, string>();
let invocationRowSeed = 0;

function invocationRowKey(row: Record<string, unknown>) {
  const stableId = row.id || row.invocation_id || row.task_id;
  if (stableId) return String(stableId);
  const existing = invocationRowKeys.get(row);
  if (existing) return existing;
  invocationRowSeed += 1;
  const generated = `invocation-${invocationRowSeed}`;
  invocationRowKeys.set(row, generated);
  return generated;
}

function nested(source: unknown, path: string[]): Record<string, unknown> {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {};
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
}

function parameterRows(model?: ModelAsset, detail?: Record<string, unknown>) {
  const sources = [
    model?.parameter_schema,
    model?.input_contract,
    nested(model?.semantic_spec, ['parameter_schema']),
    nested(detail, ['parameter_schema']),
    nested(detail, ['semantic_spec']),
  ];
  const rows = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const item of [...asRecords((source || {}).parameters), ...asRecords((source || {}).runtime_parameters), ...asRecords((source || {}).parameter_bindings)]) {
      const code = String(item.code || item.parameter || item.parameter_code || item.model_parameter || '');
      if (!code) continue;
      rows.set(code, {
        code,
        name: item.name || item.label || item.display_name || code,
        required: Boolean(item.required ?? rows.get(code)?.required),
        unit: item.unit || '',
        example: item.example ?? item.exampleValue ?? item.default,
        description: item.description || '',
      });
    }
  }
  for (const item of asRecords(detail?.runtime_input_schema)) {
    const code = String(item.key || item.code || '');
    if (code) rows.set(code, { ...rows.get(code), ...item, code, example: item.sample_value ?? item.default_value ?? rows.get(code)?.example });
  }
  return [...rows.values()];
}

function samplePayload(rows: Record<string, unknown>[]) {
  return Object.fromEntries(rows.map(row => [row.code, row.example ?? null]));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function samplePayloadFor(model?: ModelAsset, detail?: Record<string, unknown>, rows: Record<string, unknown>[] = []) {
  const sample = objectValue(detail?.sample_runtime_parameters || model?.sample_runtime_parameters);
  if (Object.keys(sample).length) return sample;
  const code = String(model?.template_id || model?.id || '');
  if (code === 'nonlinear_hydro_power_demo') {
    return { horizon: 3, time: [0, 1, 2], k: 0.9, flow_min: 10, flow_max: 100, head_min: 20, head_max: 80, power_max: 5000 };
  }
  return samplePayload(rows);
}

function buildModeText(value?: unknown) {
  return value === 'component_based' ? '组件化 Builder' : value === 'generic_linear' ? '通用线性 Builder' : value === 'template_based' ? '模板 Builder' : String(value || '-');
}

function statusText(value?: unknown) {
  const text = String(value || '-');
  const map: Record<string, string> = {
    published: '已发布',
    trial: '试运行',
    developing: '草稿',
    offline: '已下线',
  };
  return map[text] || text;
}

export function ModelServicesPage() {
  const nav = useNavigate();
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const services = useMemo(() => (models.data || []).filter(model => model.status === 'published'), [models.data]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>();
  const [problemFilter, setProblemFilter] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [debugPayload, setDebugPayload] = useState('');
  const [debugResult, setDebugResult] = useState<Record<string, unknown>>();
  const [trackedId, setTrackedId] = useState<string>();
  const trackedTask = useQuery({ queryKey: ['task', trackedId], queryFn: () => getTask(trackedId!), enabled: !!trackedId,
    refetchInterval: query => terminalTask(query.state.data?.status) ? false : 1500,
  });
  const trackedResult = useQuery({ queryKey: ['result', trackedId], queryFn: () => getResult(trackedId!), enabled: !!trackedId && trackedTask.data?.status === 'SUCCESS' });
  const filteredServices = useMemo(() => services.filter(model => {
    const text = `${model.name || ''} ${model.id || ''} ${model.problem_type || model.model_problem_type || ''}`.toLowerCase();
    const matchesKeyword = !keyword || text.includes(keyword.toLowerCase());
    const matchesStatus = !statusFilter || String(model.status) === statusFilter;
    const problem = String(model.problem_type || model.model_problem_type || '');
    const matchesProblem = !problemFilter || problem === problemFilter;
    return matchesKeyword && matchesStatus && matchesProblem;
  }), [keyword, problemFilter, services, statusFilter]);
  const selected = filteredServices.find(model => model.id === selectedId) || filteredServices[0];
  const detail = useQuery({ queryKey: ['model-service-detail', selected?.id], queryFn: () => getModelAssetDetail(selected!.id), enabled: !!selected?.id });
  const parameters = useMemo(() => parameterRows(selected, detail.data), [selected, detail.data]);
  const selectedCapability = capabilityOrFallback(selected || {});
  const selectedSamplePayload = useMemo(() => samplePayloadFor(selected, detail.data, parameters), [detail.data, parameters, selected]);
  const endpoint = selected ? '/api/tasks' : '';
  const formalCode = String((selected?.semantic_spec || {}).model_code || selected?.template_id || selected?.id || '');
  const example = selected ? `curl -X POST http://localhost:8000/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ model_code: formalCode, problem_type: selectedCapability.problemType, solver: selectedCapability.solver, runtime_parameters: selectedSamplePayload, async_run: true }, null, 2)}'` : '';

  useEffect(() => {
    if (!selectedId && filteredServices[0]) setSelectedId(filteredServices[0].id);
  }, [filteredServices, selectedId]);

  useEffect(() => {
    if (selected) {
      setDebugPayload(JSON.stringify(selectedSamplePayload, null, 2));
      setDebugResult(undefined);
      setTrackedId(readSession<{ taskId?: string }>(`optiforge-service-debug:${selected.id}`)?.taskId);
    }
  }, [selected, selectedSamplePayload]);

  const copyExample = async () => {
    await navigator.clipboard.writeText(example);
    message.success('API 示例已复制');
  };

  const debugInvoke = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('请选择模型服务');
      let runtime_parameters: unknown;
      try {
        runtime_parameters = JSON.parse(debugPayload || '{}');
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        throw new Error(`运行参数 JSON 格式错误：${text}`);
      }
      if (!runtime_parameters || typeof runtime_parameters !== 'object' || Array.isArray(runtime_parameters)) throw new Error('运行参数 JSON 必须是对象');
      const capability = capabilityOrFallback(selected);
      const storageKey = `optiforge-service-debug:${selected.id}`;
      const previous = readSession<{ key: string; payload: Record<string, unknown>; taskId?: string }>(storageKey);
      if (previous?.taskId) return getTask(previous.taskId);
      const pending = previous || { key: crypto.randomUUID(), payload: { model_id: selected.id, model: selected.id, model_code: selected.template_id || selected.id, solver: capability.solver, runtime_parameters, parameters: runtime_parameters, async_run: true } };
      writeSession(storageKey, pending);
      const task = await createTask({ ...pending.payload, idempotency_key: pending.key });
      writeSession(storageKey, { ...pending, taskId: task.id });
      return task;
    },
    onSuccess: task => { if (task.model_id && task.model_id !== selected?.id) return; setTrackedId(task.id); setDebugResult(undefined); },
    onError: error => {
      const httpStatus = (error as { response?: { status?: number } }).response?.status;
      if (selected && httpStatus && httpStatus < 500) writeSession(`optiforge-service-debug:${selected.id}`, undefined);
      const messageText = error instanceof Error ? error.message : String(error);
      const businessHint = messageText.includes('Ipopt') ? 'Ipopt 不可用，请检查 NLP 求解器环境。'
        : messageText.includes('JSON') ? messageText
        : '提交或连接暂未确认，请重试恢复原任务，或到任务中心查询。';
      setDebugResult({ status: 'ERROR', error: businessHint, raw_error: messageText });
    },
  });

  const trackingActive = !!trackedId && !terminalTask(trackedTask.data?.status);
  const debugDisplay = trackedTask.data ? { ...trackedTask.data, ...(trackedResult.data ? { result: trackedResult.data } : {}) } : debugResult;

  return (
    <>
      <PageHeader title="模型服务治理与在线调用" description="管理已发布模型服务，查看服务摘要、运行参数、调用记录并进行在线调试。" />
      <div className="service-console-layout">
        <Card className="content-card service-list-card" title="服务列表">
          <div className="service-filter-bar">
            <FilterBar onReset={() => { setKeyword(''); setStatusFilter(undefined); setProblemFilter(undefined); }}>
              <Input allowClear prefix={<SearchOutlined />} placeholder="搜索服务名称或编码" value={keyword} onChange={event => setKeyword(event.target.value)} />
              <Select allowClear placeholder="状态" value={statusFilter} onChange={setStatusFilter} options={[...new Set(services.map(item => String(item.status)))].map(value => ({ value, label: statusText(value) }))} />
              <Select allowClear placeholder="问题类型" value={problemFilter} onChange={setProblemFilter} options={[...new Set(services.map(item => String(item.problem_type || item.model_problem_type || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
            </FilterBar>
          </div>
          <QueryState query={models} title="服务列表"><div className="service-list">
            {filteredServices.map(model => (
              <button type="button" className={`service-list-item ${model.id === selected?.id ? 'active' : ''}`} key={model.id} onClick={() => setSelectedId(model.id)}>
                <span className="service-list-title">{model.name}</span>
                <span className="service-list-code">{model.id}</span>
                <span className="service-list-meta"><StatusTag status={String(model.status)} /><Tag>{capabilityOrFallback(model).solver || 'HiGHS'}</Tag></span>
              </button>
            ))}
          </div></QueryState>
        </Card>
        {!selected ? (
          <QueryState query={models} title="服务列表"><EmptyActionState title="暂无已发布模型服务" description="发布模型后会自动出现在服务治理台。" /></QueryState>
        ) : (
          <Card className="content-card" title={selected.name}>
            <Tabs
              items={[
                {
                  key: 'overview',
                  label: '服务概览',
                  children: (
                    <>
                      <Descriptions bordered size="small" column={2} items={[
                        { key: 'id', label: '固定模型 ID', children: selected.id },
                        { key: 'formal-code', label: '正式服务编码', children: formalCode },
                        { key: 'name', label: '服务名称', children: selected.name },
                        { key: 'endpoint', label: '调用接口', children: endpoint },
                        { key: 'method', label: '方法', children: 'POST' },
                        { key: 'mode', label: '建模模式', children: buildModeText(selected.build_mode) },
                        { key: 'problem', label: '问题类型', children: selected.problem_type || selected.model_problem_type || '-' },
                        { key: 'solver', label: '推荐求解器', children: selectedCapability.solver },
                        { key: 'nonlinear', label: '非线性处理方式', children: selectedCapability.nonlinearHandling },
                      ]} />
                      <Table
                        className="section-gap"
                        loading={detail.isFetching}
                        size="small"
                        rowKey="code"
                        pagination={false}
                        dataSource={parameters}
                        columns={[
                          { title: '编码', dataIndex: 'code' },
                          { title: '名称', dataIndex: 'name' },
                          { title: '必填', dataIndex: 'required', render: value => value ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
                          { title: '单位', dataIndex: 'unit' },
                          { title: '格式与轴顺序', dataIndex: 'format_description', render: value => value || '以模型 schema 为准' },
                          { title: '示例', dataIndex: 'example', render: value => value === undefined ? '-' : JSON.stringify(value) },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'debug',
                  label: '在线调试',
                  children: (
                    <Form layout="vertical">
                      <Alert type="info" title="在线调试固定当前模型 ID；对外稳定调用使用 API 示例中的 model_code，解析当时的正式版本。" />
                      <Form.Item label="运行参数 JSON">
                        <Input.TextArea aria-label="运行参数 JSON" rows={8} value={debugPayload} onChange={event => setDebugPayload(event.target.value)} />
                      </Form.Item>
                      <Space>
                        <Button type="primary" disabled={trackingActive} loading={debugInvoke.isPending} onClick={() => debugInvoke.mutate()}>{trackedId ? '恢复任务' : '发起测试调用'}</Button>
                        {trackedId && terminalTask(trackedTask.data?.status) && <Button onClick={() => { writeSession(`optiforge-service-debug:${selected.id}`, undefined); setTrackedId(undefined); setDebugResult(undefined); }}>新建测试调用</Button>}
                        <Typography.Text type="secondary">提交后自动跟踪任务，可返回本页继续查看。</Typography.Text>
                      </Space>
                      {trackedId && <QueryState query={trackedTask} title="调试任务"><span>任务编号：{trackedId} · 状态：{trackedTask.data?.status || '读取中'}</span></QueryState>}
                      {debugDisplay && <Card className="section-gap" size="small" title="调试返回"><JsonViewer value={debugDisplay} /></Card>}
                      {trackedTask.data?.status === 'SUCCESS' && <QueryState query={trackedResult} title="调试结果"><span /></QueryState>}
                      {(debugDisplay || trackedId) && (
                        <Space className="section-gap" wrap>
                          <Button onClick={() => nav(trackedId ? `/tasks?task=${encodeURIComponent(trackedId)}` : '/tasks')}>跳转任务中心</Button>
                          <Button onClick={() => nav(trackedId ? `/results?task=${encodeURIComponent(trackedId)}` : '/results')}>跳转结果中心</Button>
                        </Space>
                      )}
                    </Form>
                  ),
                },
                {
                  key: 'history',
                  label: '调用记录',
                  children: <Table
                    size="small"
                    rowKey={invocationRowKey}
                    pagination={false}
                    dataSource={[...asRecords((detail.data || {}).recent_invocations), ...asRecords((detail.data || {}).recent_tasks)]}
                    columns={[
                      { title: '调用 ID', render: (_, row) => String(row.invocation_id || row.task_id || '-') },
                      { title: '状态', dataIndex: 'status' },
                      { title: '耗时', dataIndex: 'duration_seconds' },
                      { title: '时间', render: (_, row) => String(row.created_at || row.finished_at || '-') },
                    ]}
                  />,
                },
              ]}
            />
            <Collapse
              className="section-gap"
              items={[{
                key: 'developer',
                label: '开发者信息',
                children: (
                  <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                    <Card size="small" title="示例请求" extra={<Button icon={<CopyOutlined />} onClick={copyExample}>复制</Button>}><Typography.Paragraph code style={{ whiteSpace: 'pre-wrap' }}>{example}</Typography.Paragraph></Card>
                    <Card size="small" title="示例响应"><JsonViewer value={{ task_id: 'task_xxx', status: 'SUCCESS', model_code: selected.template_id || selected.id, problem_type: selectedCapability.problemType, solver: selectedCapability.solver, solver_available: true, termination_condition: selectedCapability.problemType === 'NLP' ? 'locallyOptimal / optimal' : 'optimal', objective: 0, runtime: 0.1, constraint_violation_summary: {}, local_optimum_warning: selectedCapability.problemType === 'NLP' ? 'Ipopt 结果不承诺全局最优。' : undefined }} /></Card>
                    <Card size="small" title="高级契约"><JsonViewer value={{ input_contract: selected.input_contract, output_contract: selected.output_contract, parameter_schema: selected.parameter_schema }} /></Card>
                  </Space>
                ),
              }]}
            />
          </Card>
        )}
      </div>
      {models.isError && <Alert className="section-gap" showIcon type="error" title="服务列表加载失败" />}
    </>
  );
}
