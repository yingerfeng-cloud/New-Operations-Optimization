import { CopyOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Form, Input, Row, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getModelAssetDetail, getModels } from '../../api/models';
import { createTask } from '../../api/tasks';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';
import type { ModelAsset } from '../../types/model';

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
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
  return [...rows.values()];
}

function samplePayload(rows: Record<string, unknown>[]) {
  return Object.fromEntries(rows.map(row => [row.code, row.example ?? null]));
}

export function ModelServicesPage() {
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const services = useMemo(() => (models.data || []).filter(model => ['published', 'trial', 'tested', '已发布', '试运行', '已测试'].includes(String(model.status))), [models.data]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>();
  const [problemFilter, setProblemFilter] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [debugPayload, setDebugPayload] = useState('');
  const [debugResult, setDebugResult] = useState<Record<string, unknown>>();
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
  const endpoint = selected ? `/api/tasks` : '';
  const example = selected ? `curl -X POST http://localhost:8000/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ model_id: selected.id, runtime_parameters: samplePayload(parameters), async_run: false }, null, 2)}'` : '';

  useEffect(() => {
    if (!selectedId && filteredServices[0]) setSelectedId(filteredServices[0].id);
  }, [filteredServices, selectedId]);

  useEffect(() => {
    if (selected) {
      setDebugPayload(JSON.stringify(samplePayload(parameters), null, 2));
      setDebugResult(undefined);
    }
  }, [parameters, selected]);

  const copyExample = async () => {
    await navigator.clipboard.writeText(example);
    message.success('API 示例已复制');
  };

  const debugInvoke = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('请选择模型服务');
      const runtime_parameters = JSON.parse(debugPayload || '{}');
      return createTask({ model_id: selected.id, model: selected.id, runtime_parameters, parameters: runtime_parameters, async_run: false });
    },
    onSuccess: task => {
      const row = task as Record<string, unknown>;
      setDebugResult({
        task_id: row.id || row.task_id,
        status: row.status,
        objective: row.cost ?? row.objective_value,
        error: row.error || row.message || null,
      });
    },
    onError: error => setDebugResult({ status: 'ERROR', error: String(error) }),
  });

  return (
    <>
      <PageHeader title="模型服务治理与在线调用" description="管理已发布模型服务，查看接口契约、运行参数、调用示例、调用记录并进行在线调试。" />
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={9}>
          <Card className="content-card" title="已发布模型服务列表">
            <Space className="full-width" orientation="vertical" size={10}>
              <Input allowClear placeholder="搜索服务名称、编码或问题类型" value={keyword} onChange={event => setKeyword(event.target.value)} />
              <Space wrap>
                <Select allowClear placeholder="状态" style={{ width: 130 }} value={statusFilter} onChange={setStatusFilter} options={[...new Set(services.map(item => String(item.status)))].map(value => ({ value, label: value }))} />
                <Select allowClear placeholder="问题类型" style={{ width: 180 }} value={problemFilter} onChange={setProblemFilter} options={[...new Set(services.map(item => String(item.problem_type || item.model_problem_type || '')).filter(Boolean))].map(value => ({ value, label: value }))} />
              </Space>
            </Space>
            <Table<ModelAsset>
              className="section-gap"
              size="small"
              rowKey="id"
              loading={models.isLoading}
              dataSource={filteredServices}
              pagination={{ pageSize: 8 }}
              rowClassName={record => record.id === selected?.id ? 'selected-service-row' : ''}
              onRow={record => ({ onClick: () => setSelectedId(record.id) })}
              columns={[
                { title: '服务', dataIndex: 'name' },
                { title: '状态', dataIndex: 'status', render: status => <Tag color="green">{String(status)}</Tag> },
                { title: '求解器', dataIndex: 'solver' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          {!selected ? (
            <Alert showIcon type="info" title="暂无已发布模型服务" />
          ) : (
            <Card className="content-card" title={selected.name}>
              <Tabs
                items={[
                  {
                    key: 'basic',
                    label: '基本信息',
                    children: <Descriptions bordered size="small" column={2} items={[
                      { key: 'id', label: '模型 ID', children: selected.id },
                      { key: 'name', label: '服务名称', children: selected.name },
                      { key: 'endpoint', label: '调用接口', children: endpoint },
                      { key: 'method', label: '方法', children: 'POST' },
                      { key: 'mode', label: '建模模式', children: selected.build_mode },
                      { key: 'problem', label: '问题类型', children: selected.problem_type || selected.model_problem_type || '-' },
                    ]} />,
                  },
                  {
                    key: 'params',
                    label: '调用参数',
                    children: <Table
                      loading={detail.isFetching}
                      size="small"
                      rowKey="code"
                      pagination={false}
                      dataSource={parameters}
                      columns={[
                        { title: '编码', dataIndex: 'code' },
                        { title: '名称', dataIndex: 'name' },
                        { title: '必填', dataIndex: 'required', render: value => value ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
                        { title: '示例', dataIndex: 'example', render: value => value === undefined ? '-' : JSON.stringify(value) },
                      ]}
                    />,
                  },
                  {
                    key: 'request',
                    label: '示例请求',
                    children: <Card size="small" title="调用示例" extra={<Button icon={<CopyOutlined />} onClick={copyExample}>复制</Button>}><Typography.Paragraph code copyable={false} style={{ whiteSpace: 'pre-wrap' }}>{example}</Typography.Paragraph></Card>,
                  },
                  {
                    key: 'response',
                    label: '示例响应',
                    children: <JsonViewer value={{ task_id: 'task_xxx', status: 'SUCCESS', objective_value: 0, result_summary: '求解完成后返回业务指标、关键变量和报告入口。' }} />,
                  },
                  {
                    key: 'history',
                    label: '调用记录',
                    children: <Table
                      size="small"
                      rowKey={row => String(row.invocation_id || row.task_id || row.created_at || row.model_id)}
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
                  {
                    key: 'debug',
                    label: '在线调试',
                    children: (
                      <Form layout="vertical">
                        <Form.Item label="运行参数 JSON">
                          <Input.TextArea rows={8} value={debugPayload} onChange={event => setDebugPayload(event.target.value)} />
                        </Form.Item>
                        <Space>
                          <Button type="primary" loading={debugInvoke.isPending} onClick={() => debugInvoke.mutate()}>发起测试调用</Button>
                          <Typography.Text type="secondary">调用现有任务接口并回显任务状态。</Typography.Text>
                        </Space>
                        {debugResult && <Card className="section-gap" size="small" title="调试返回"><JsonViewer value={debugResult} /></Card>}
                      </Form>
                    ),
                  },
                  {
                    key: 'raw',
                    label: '高级契约',
                    children: <JsonViewer value={{ input_contract: selected.input_contract, output_contract: selected.output_contract, parameter_schema: selected.parameter_schema }} />,
                  },
                ]}
              />
            </Card>
          )}
        </Col>
      </Row>
    </>
  );
}
