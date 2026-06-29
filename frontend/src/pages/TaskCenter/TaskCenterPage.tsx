import { Alert, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelTask, createTask, getTask, getTasks, retryTask } from '../../api/tasks';
import { getModelAssetDetail, getModelSchema, getModels } from '../../api/models';
import { getResult } from '../../api/results';
import { DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import {
  TaskExplanationPanel,
  TaskInputPanel,
  TaskLogsPanel,
  TaskOverviewPanel,
  TaskResultPanel,
  TaskTimelinePanel,
  isRetryableStatus,
  isRunningStatus,
} from '../../features/task-center/TaskPanels';
import type { SolveTask } from '../../types/task';

interface RuntimeField {
  code: string;
  name: string;
  required: boolean;
  defaultValue?: unknown;
  exampleValue?: unknown;
  type?: string;
  unit?: string;
  description?: string;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function getNestedRecord(source: unknown, path: string[]): Record<string, unknown> {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {};
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
}

function runtimeFieldsFromContracts(schema?: Record<string, unknown>, detail?: Record<string, unknown>): RuntimeField[] {
  const sources = [
    getNestedRecord(schema, ['parameter_schema']),
    getNestedRecord(schema, ['semantic_schema']),
    getNestedRecord(schema, ['input_contract']),
    getNestedRecord(detail, ['parameter_schema']),
    getNestedRecord(detail, ['semantic_spec']),
  ];
  const rows = new Map<string, RuntimeField>();
  for (const source of sources) {
    for (const item of [...asRecords(source.parameters), ...asRecords(source.runtime_parameters), ...asRecords(source.parameter_bindings)]) {
      const code = String(item.code || item.parameter || item.parameter_code || item.model_parameter || '');
      if (!code) continue;
      const existing = rows.get(code);
      rows.set(code, {
        code,
        name: String(item.name || item.label || item.display_name || existing?.name || code),
        required: Boolean(item.required ?? existing?.required),
        defaultValue: item.default ?? item.defaultValue ?? existing?.defaultValue,
        exampleValue: item.example ?? item.exampleValue ?? item.sample ?? existing?.exampleValue,
        type: String(item.type || item.value_type || existing?.type || ''),
        unit: String(item.unit || existing?.unit || ''),
        description: String(item.description || existing?.description || ''),
      });
    }
  }
  return [...rows.values()];
}

function parseRuntimeValue(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[-+]?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (['true', 'false'].includes(trimmed.toLowerCase())) return trimmed.toLowerCase() === 'true';
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function normalizeRuntimeParameters(value: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseRuntimeValue(item)]).filter(([, item]) => item !== undefined));
}

function validateRuntimeParameters(fields: RuntimeField[], parameters: Record<string, unknown>) {
  const missing = fields.filter(field => field.required && (parameters[field.code] === undefined || parameters[field.code] === null || parameters[field.code] === '')).map(field => field.code);
  return {
    valid: missing.length === 0,
    title: missing.length ? `缺少必填参数：${missing.join('、')}` : `参数校验通过：${Object.keys(parameters).length} 个参数将随任务提交`,
  };
}

export function TaskCenterPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [runtimeJson, setRuntimeJson] = useState('');
  const [parameterValidation, setParameterValidation] = useState<{ valid: boolean; title: string }>();
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 5000;
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval });
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const selectedModelId = Form.useWatch('model_id', form);
  const schema = useQuery({ queryKey: ['model-schema', selectedModelId], queryFn: () => getModelSchema(selectedModelId), enabled: !!selectedModelId });
  const assetDetail = useQuery({ queryKey: ['model-asset-detail', selectedModelId], queryFn: () => getModelAssetDetail(selectedModelId), enabled: !!selectedModelId });
  const runtimeFields = useMemo(() => runtimeFieldsFromContracts(schema.data, assetDetail.data), [schema.data, assetDetail.data]);
  const detail = useQuery({ queryKey: ['task', viewId], queryFn: () => getTask(viewId!), enabled: !!viewId });
  const result = useQuery({ queryKey: ['result', viewId], queryFn: () => getResult(viewId!), enabled: !!viewId && detail.data?.status === 'SUCCESS' });
  const refresh = (taskId?: string) => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    if (taskId) {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['result', taskId] });
    }
  };
  const create = useMutation({ mutationFn: createTask, onSuccess: task => { message.success('求解任务已提交'); setCreateOpen(false); refresh(task.id); setViewId(task.id); } });
  const cancel = useMutation({ mutationFn: cancelTask, onSuccess: task => { message.success('任务已取消'); refresh(task.id); } });
  const retry = useMutation({ mutationFn: retryTask, onSuccess: task => { message.success('任务已重试'); refresh(task.id); setViewId(task.id); } });
  const rows = tasks.data || [];
  const running = rows.filter(task => isRunningStatus(task.status)).length;
  const success = rows.filter(task => String(task.status).toUpperCase() === 'SUCCESS').length;
  const failed = rows.filter(task => ['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(String(task.status).toUpperCase())).length;
  const current = detail.data;
  useEffect(() => {
    if (!selectedModelId || !runtimeFields.length) return;
    const defaults = Object.fromEntries(runtimeFields.map(field => [field.code, field.defaultValue ?? field.exampleValue]).filter(([, value]) => value !== undefined));
    form.setFieldValue('parameters', defaults);
    setParameterValidation(undefined);
  }, [form, runtimeFields, selectedModelId]);

  const importRuntimeJson = () => {
    try {
      const parsed = JSON.parse(runtimeJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 必须是对象');
      form.setFieldValue('parameters', parsed);
      const normalized = normalizeRuntimeParameters(parsed as Record<string, unknown>);
      setParameterValidation(validateRuntimeParameters(runtimeFields, normalized));
    } catch (error) {
      setParameterValidation({ valid: false, title: `JSON 导入失败：${String(error)}` });
    }
  };

  const validateCurrentParameters = () => {
    const normalized = normalizeRuntimeParameters(form.getFieldValue('parameters') || {});
    const result = validateRuntimeParameters(runtimeFields, normalized);
    setParameterValidation(result);
    return result;
  };

  const submitTask = (value: Record<string, unknown>) => {
    const runtimeParameters = normalizeRuntimeParameters(value.parameters as Record<string, unknown>);
    const validation = validateRuntimeParameters(runtimeFields, runtimeParameters);
    setParameterValidation(validation);
    if (!validation.valid) return;
    create.mutate({ ...value, model: value.model_id, scene: 'power optimization', runtime_parameters: runtimeParameters, parameters: runtimeParameters, async_run: true });
  };

  return (
    <>
      <PageHeader title="任务调度中心" description="提交、监控、重试和取消所有求解任务。" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>创建任务</Button>} />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={6}><div className="card metric blue"><span>任务总数</span><b>{rows.length}</b><span>真实任务队列</span></div></Col>
        <Col xs={24} md={6}><div className="card metric amber"><span>运行中</span><b>{running}</b><span>校验 / 建模 / 求解</span></div></Col>
        <Col xs={24} md={6}><div className="card metric green"><span>成功</span><b>{success}</b><span>可查看结果</span></div></Col>
        <Col xs={24} md={6}><div className="card metric red"><span>失败/无解</span><b>{failed}</b><span>需查看日志</span></div></Col>
      </Row>
      <Card className="content-card section-gap" title="求解任务列表">
        <DataTable<SolveTask>
          dataSource={rows}
          loading={tasks.isLoading}
          columns={[
            { title: '任务编号', dataIndex: 'id' },
            { title: '模型名称', dataIndex: 'model' },
            { title: '状态', dataIndex: 'status', render: (status: string) => <StatusTag status={status} /> },
            { title: '进度', dataIndex: 'progress', render: (progress: number) => `${progress || 0}%` },
            { title: '创建时间', dataIndex: 'created_at' },
            { title: '开始时间', dataIndex: 'started_at' },
            { title: '结束时间', dataIndex: 'finished_at' },
            { title: '求解器', dataIndex: 'solver', render: (solver: string) => <span className="pill blue">{solver || 'HiGHS'}</span> },
            { title: '目标值', dataIndex: 'cost' },
            {
              title: '操作',
              fixed: 'right' as const,
              render: (_: unknown, task: SolveTask) => (
                <Space className="task-actions">
                  <Button type="link" onClick={() => setViewId(task.id)}>查看</Button>
                  <Button danger type="link" disabled={!isRunningStatus(task.status)} onClick={() => cancel.mutate(task.id)}>取消</Button>
                  {isRetryableStatus(task.status) && <Button type="link" onClick={() => retry.mutate(task.id)}>重试</Button>}
                  {task.status === 'SUCCESS' && <Button type="link" onClick={() => setViewId(task.id)}>查看结果</Button>}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title="创建求解任务"
        open={createOpen}
        width={860}
        onCancel={() => setCreateOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={validateCurrentParameters}>校验参数</Button>
            <Button form="create-task-form" htmlType="submit" type="primary" loading={create.isPending}>提交求解并打开详情</Button>
          </Space>
        )}
      >
        <div className="form-card modal-form-card">
          <Form id="create-task-form" form={form} layout="vertical" onFinish={submitTask}>
            <Form.Item name="model_id" label="选择模型" rules={[{ required: true }]}><Select options={models.data?.map(model => ({ value: model.id, label: model.name }))} /></Form.Item>
            <Form.Item name="horizon" label="调度时段" initialValue={24}><InputNumber min={1} /></Form.Item>
            <Form.Item name="solver" label="求解器" initialValue="HiGHS"><Select options={[{ value: 'HiGHS' }]} /></Form.Item>
            <Card size="small" title="运行参数契约" loading={schema.isFetching || assetDetail.isFetching}>
              <Table<RuntimeField>
                size="small"
                pagination={false}
                rowKey="code"
                dataSource={runtimeFields}
                locale={{ emptyText: selectedModelId ? '当前模型未声明运行参数契约' : '请选择模型后读取参数契约' }}
                columns={[
                  { title: '参数', dataIndex: 'name', render: (_, row) => <Space><span>{row.name}</span>{row.required && <Tag color="red">必填</Tag>}</Space> },
                  { title: '编码', dataIndex: 'code' },
                  { title: '单位', dataIndex: 'unit', width: 90 },
                  {
                    title: '调用参数',
                    render: (_, row) => (
                      <Form.Item name={['parameters', row.code]} style={{ margin: 0 }} rules={row.required ? [{ required: true, message: `请输入 ${row.code}` }] : undefined}>
                        <Input placeholder={row.exampleValue !== undefined ? JSON.stringify(row.exampleValue) : row.description || row.code} />
                      </Form.Item>
                    ),
                  },
                ]}
              />
              <Form.Item label="JSON 导入" className="section-gap">
                <Input.TextArea rows={4} value={runtimeJson} onChange={event => setRuntimeJson(event.target.value)} placeholder='{"load":[100,120],"horizon":24}' />
                <Button className="section-gap-tight" onClick={importRuntimeJson}>导入 JSON 参数</Button>
              </Form.Item>
              {parameterValidation && <Alert showIcon type={parameterValidation.valid ? 'success' : 'warning'} title={parameterValidation.title} />}
            </Card>
          </Form>
        </div>
      </Modal>
      <Drawer
        size="large"
        open={!!viewId}
        onClose={() => setViewId(undefined)}
        title={`任务 ${viewId || ''}`}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setViewId(undefined)}>关闭</Button>
            {current && <Button danger disabled={!isRunningStatus(current.status)} onClick={() => cancel.mutate(current.id)}>取消任务</Button>}
            {current && isRetryableStatus(current.status) && <Button type="primary" onClick={() => retry.mutate(current.id)}>重试任务</Button>}
          </Space>
        )}
      >
        <Tabs items={[
          { key: 'overview', label: '任务概览', children: <TaskOverviewPanel task={current} /> },
          { key: 'timeline', label: '调度进度', children: <TaskTimelinePanel task={current} /> },
          { key: 'input', label: '输入参数', children: <TaskInputPanel task={current} /> },
          { key: 'logs', label: '求解日志', children: <TaskLogsPanel task={current} /> },
          { key: 'result', label: '变量/约束结果', children: <TaskResultPanel result={result.data} /> },
          { key: 'explain', label: '结果解释', children: <TaskExplanationPanel result={result.data} /> },
        ]} />
      </Drawer>
    </>
  );
}
