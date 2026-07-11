import { MoreOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Drawer, Dropdown, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelTask, createTask, getTask, getTasks, retryTask } from '../../api/tasks';
import { getModelAssetDetail, getModelSchema, getModels } from '../../api/models';
import { getResult } from '../../api/results';
import { DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
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
import { capabilityOrFallback } from '../../features/demo/demoCapabilities';
import { extractDimensions } from '../../features/model-creation/utils/modelDimensions';

interface RuntimeField {
  code: string;
  name: string;
  required: boolean;
  dimension?: string[];
  defaultValue?: unknown;
  exampleValue?: unknown;
  type?: string;
  unit?: string;
  description?: string;
}

type TimeDimensionPolicy = 'not_applicable' | 'fixed' | 'runtime_variable' | 'data_derived';

interface TimeDimensionConfig {
  enabled: boolean;
  policy: TimeDimensionPolicy;
  default_horizon?: number;
  allowed_horizons?: number[];
  min_horizon?: number;
  max_horizon?: number;
  horizon_step?: number;
  time_set?: string;
  state_time_set?: string | null;
  interval_minutes?: number;
  delta_t?: number;
  interval_minutes_by_horizon?: Record<string, number>;
  delta_t_by_horizon?: Record<string, number>;
  label_set?: string;
  label_generation?: string;
  editable?: boolean;
  derive_from?: string | null;
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function defaultRuntimeParametersFromModel(model?: Record<string, unknown>, detail?: Record<string, unknown>) {
  const semantic = objectValue(model?.semantic_spec);
  const detailSemantic = objectValue(detail?.semantic_spec);
  const draft = objectValue(model?.model_draft || detail?.model_draft);
  return {
    ...objectValue(semantic.sample_runtime_parameters),
    ...objectValue(detailSemantic.sample_runtime_parameters),
    ...objectValue(draft.runtime_parameters),
    ...objectValue(model?.parameters),
    ...objectValue(detail?.parameters),
  };
}

function runtimeFieldsFromContracts(schema?: Record<string, unknown>, detail?: Record<string, unknown>): RuntimeField[] {
  const sources = [
    getNestedRecord(schema, ['input_schema']),
    getNestedRecord(schema, ['parameter_schema']),
    getNestedRecord(schema, ['semantic_schema']),
    getNestedRecord(schema, ['input_contract']),
    getNestedRecord(detail, ['parameter_schema']),
    getNestedRecord(detail, ['semantic_spec']),
    getNestedRecord(detail, ['component_spec']),
  ];
  const rows = new Map<string, RuntimeField>();
  for (const source of sources) {
    for (const item of [...asRecords(source.parameters), ...asRecords(source.runtime_parameters), ...asRecords(source.parameter_bindings)]) {
      const code = String(item.code || item.math_param || item.key || item.parameter || item.parameter_code || item.model_parameter || '');
      if (!code) continue;
      const existing = rows.get(code);
      rows.set(code, {
        code,
        name: String(item.name || item.label || item.display_name || existing?.name || code),
        required: Boolean(item.required ?? existing?.required),
        dimension: extractDimensions(item).length ? extractDimensions(item) : existing?.dimension,
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

function readTimeDimension(source: unknown): TimeDimensionConfig | undefined {
  const config = objectValue(objectValue(source).ui_metadata).time_dimension;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const record = config as Record<string, unknown>;
  const policy = String(record.policy || 'not_applicable') as TimeDimensionPolicy;
  if (!['not_applicable', 'fixed', 'runtime_variable', 'data_derived'].includes(policy)) return undefined;
  const allowedHorizons = Array.isArray(record.allowed_horizons)
    ? record.allowed_horizons.map(Number).filter(value => Number.isInteger(value) && value > 0)
    : [];
  const numberMap = (value: unknown) => Object.fromEntries(
    Object.entries(objectValue(value))
      .map(([key, item]) => [key, Number(item)])
      .filter(([, item]) => Number.isFinite(item)),
  );
  return {
    enabled: Boolean(record.enabled ?? policy !== 'not_applicable'),
    policy,
    default_horizon: typeof record.default_horizon === 'number' ? record.default_horizon : record.default_horizon ? Number(record.default_horizon) : undefined,
    allowed_horizons: [...new Set(allowedHorizons)],
    min_horizon: record.min_horizon === undefined ? undefined : Number(record.min_horizon),
    max_horizon: record.max_horizon === undefined ? undefined : Number(record.max_horizon),
    horizon_step: record.horizon_step === undefined ? undefined : Number(record.horizon_step),
    time_set: String(record.time_set || 'time'),
    state_time_set: Object.prototype.hasOwnProperty.call(record, 'state_time_set')
      ? record.state_time_set === null || record.state_time_set === '' ? null : String(record.state_time_set)
      : undefined,
    interval_minutes: record.interval_minutes === undefined ? undefined : Number(record.interval_minutes),
    delta_t: record.delta_t === undefined ? undefined : Number(record.delta_t),
    interval_minutes_by_horizon: numberMap(record.interval_minutes_by_horizon),
    delta_t_by_horizon: numberMap(record.delta_t_by_horizon),
    label_set: record.label_set ? String(record.label_set) : undefined,
    label_generation: record.label_generation ? String(record.label_generation) : undefined,
    editable: Boolean(record.editable ?? policy === 'runtime_variable'),
    derive_from: record.derive_from === undefined ? null : record.derive_from === null ? null : String(record.derive_from),
  };
}

function getTimeDimensionConfig(
  selectedModel: Record<string, unknown> | undefined,
  schema: Record<string, unknown> | undefined,
  detail: Record<string, unknown> | undefined,
  defaults: Record<string, unknown>,
): TimeDimensionConfig {
  const explicit = readTimeDimension(detail)
    || readTimeDimension(selectedModel)
    || readTimeDimension(schema)
    || readTimeDimension(objectValue(detail?.semantic_spec))
    || readTimeDimension(objectValue(detail?.component_spec))
    || readTimeDimension(objectValue(detail?.generic_spec))
    || readTimeDimension(objectValue(schema?.semantic_schema));
  const fields = runtimeFieldsFromContracts(schema, detail);
  if (explicit) {
    if (explicit.state_time_set !== undefined) return explicit;
    const hasLegacyStateTime = Array.isArray(defaults.time_volume) || fields.some(field => (field.dimension || []).includes('time_volume'));
    return { ...explicit, state_time_set: hasLegacyStateTime ? 'time_volume' : null };
  }
  const hasTime = Array.isArray(defaults.time) || Array.isArray(defaults.time_volume) || fields.some(field => (field.dimension || []).some(dim => ['time', 'time_volume'].includes(dim)));
  if (!hasTime) return { enabled: false, policy: 'not_applicable', editable: false, time_set: 'time', state_time_set: null };
  const defaultHorizon = typeof defaults.horizon === 'number' ? defaults.horizon : Array.isArray(defaults.time) ? defaults.time.length : undefined;
  const hasStateTime = Array.isArray(defaults.time_volume) || fields.some(field => (field.dimension || []).includes('time_volume'));
  return { enabled: true, policy: 'fixed', default_horizon: defaultHorizon, editable: false, time_set: 'time', state_time_set: hasStateTime ? 'time_volume' : null };
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

function serializeRuntimeValue(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function serializeRuntimeParameters(value: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, serializeRuntimeValue(item)])
      .filter(([, item]) => item !== undefined),
  );
}

function normalizeRuntimeParameters(value: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseRuntimeValue(item)]).filter(([, item]) => item !== undefined));
}

function validateRuntimeParameters(fields: RuntimeField[], parameters: Record<string, unknown>, timeDimension?: TimeDimensionConfig, horizon?: number) {
  const missing = fields.filter(field => field.required && (parameters[field.code] === undefined || parameters[field.code] === null || parameters[field.code] === '')).map(field => field.code);
  const timeError = validateTimeSeriesFields(fields, parameters, timeDimension, horizon);
  return {
    valid: missing.length === 0 && !timeError,
    title: missing.length ? `缺少必填参数：${missing.join('、')}` : timeError || `参数校验通过：${Object.keys(parameters).length} 个参数将随任务提交`,
  };
}

export function validateTimeSeriesFields(fields: RuntimeField[], parameters: Record<string, unknown>, timeDimension?: TimeDimensionConfig, horizon?: number) {
  if (!timeDimension || !['runtime_variable', 'data_derived'].includes(timeDimension.policy)) return '';
  const timeSet = timeDimension.time_set || 'time';
  const stateTimeSet = timeDimension.state_time_set || null;
  const allowedHorizons = timeDimension.allowed_horizons || [];
  if (timeDimension.policy === 'runtime_variable' && allowedHorizons.length && (!horizon || !allowedHorizons.includes(horizon))) {
    return `当前模型仅支持 ${allowedHorizons.join('、')} 点切换，请选择有效的调度时段。`;
  }
  const derivedValue = timeDimension.policy === 'data_derived' && timeDimension.derive_from ? parameters[timeDimension.derive_from] : undefined;
  const derivedField = fields.find(field => field.code === timeDimension.derive_from);
  const derivedTimeIndex = derivedField?.dimension?.indexOf(timeSet) ?? 0;
  const derivedRows = Array.isArray(derivedValue) ? derivedValue : derivedValue && typeof derivedValue === 'object' ? Object.values(derivedValue) : [];
  const derivedHorizon = derivedTimeIndex <= 0
    ? derivedRows.length || undefined
    : (() => { const first = derivedRows[0]; return Array.isArray(first) ? first.length : first && typeof first === 'object' ? Object.keys(first).length : undefined; })();
  const expectedHorizon = timeDimension.policy === 'data_derived'
    ? derivedHorizon || Number(parameters.horizon || 0)
    : horizon || Number(parameters.horizon || timeDimension.default_horizon || 0);
  if (!expectedHorizon) return '';
  for (const field of fields) {
    if (!field.dimension?.some(dim => dim === timeSet || Boolean(stateTimeSet && dim === stateTimeSet))) continue;
    if (!(field.code in parameters)) continue;
    const value = parameters[field.code];
    const timeDim = field.dimension[field.dimension.length - 1];
    const expected = stateTimeSet && timeDim === stateTimeSet ? expectedHorizon + 1 : expectedHorizon;
    const actual = Array.isArray(value) ? value.length : value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : undefined;
    if (field.dimension.length === 1 && actual !== expected) {
      return `当前调度时段为 ${expectedHorizon}，但 ${field.code} 长度为 ${actual ?? '非数组'}，请提供 ${expected} 个点。`;
    }
    if (field.dimension.length >= 2) {
      const rows = Array.isArray(value) ? value : value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [];
      for (const row of rows) {
        const rowLength = Array.isArray(row) ? row.length : row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row).length : undefined;
        if (rowLength !== expected) return `当前调度时段为 ${expectedHorizon}，但 ${field.code} 内层时间序列长度为 ${rowLength ?? '非数组'}，请提供 ${expected} 个点。`;
      }
    }
  }
  return '';
}

function stripSystemTimeParameters(parameters: Record<string, unknown>, timeDimension: TimeDimensionConfig) {
  if (!timeDimension.enabled) return parameters;
  const timeSet = timeDimension.time_set || 'time';
  const stateTimeSet = timeDimension.state_time_set || null;
  const systemCodes = ['horizon', timeSet, ...(stateTimeSet ? [stateTimeSet] : [])];
  if (timeDimension.label_generation === 'auto' && timeDimension.label_set) systemCodes.push(timeDimension.label_set);
  const managedGranularity = managedTimeGranularityFields(timeDimension);
  systemCodes.push(...managedGranularity);
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => !systemCodes.includes(key)));
}

function managedTimeGranularityFields(timeDimension: TimeDimensionConfig) {
  const result: string[] = [];
  const managesInterval = timeDimension.interval_minutes !== undefined
    || Boolean(Object.keys(timeDimension.interval_minutes_by_horizon || {}).length)
    || timeDimension.label_generation === 'auto';
  const managesDelta = timeDimension.delta_t !== undefined
    || Boolean(Object.keys(timeDimension.delta_t_by_horizon || {}).length)
    || timeDimension.interval_minutes !== undefined
    || Boolean(Object.keys(timeDimension.interval_minutes_by_horizon || {}).length);
  if (managesInterval) result.push('interval_minutes');
  if (managesDelta) result.push('delta_t');
  return result;
}

function timeGranularitySummary(timeDimension: TimeDimensionConfig) {
  if ((timeDimension.allowed_horizons || []).length) {
    return timeDimension.allowed_horizons?.map(horizon => `${horizon} 点=${timeDimension.interval_minutes_by_horizon?.[String(horizon)] ?? '-'} 分钟`).join('；');
  }
  if (timeDimension.interval_minutes !== undefined || timeDimension.delta_t !== undefined) {
    const delta = timeDimension.delta_t ?? (timeDimension.interval_minutes !== undefined ? timeDimension.interval_minutes / 60 : undefined);
    return `时间粒度 ${timeDimension.interval_minutes ?? '-'} 分钟，delta_t=${delta ?? '-'}`;
  }
  return undefined;
}

function horizonOptionLabel(horizon: number, timeDimension: TimeDimensionConfig) {
  const minutes = timeDimension.interval_minutes_by_horizon?.[String(horizon)];
  const granularity = minutes === 60 ? '小时级' : minutes === 30 ? '半小时级' : minutes === 15 ? '15分钟级' : '';
  return granularity ? `${horizon}点 / ${granularity}` : `${horizon} 点`;
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
  const selectedModel = useMemo(() => (models.data || []).find(model => model.id === selectedModelId), [models.data, selectedModelId]);
  const selectedCapability = capabilityOrFallback(selectedModel || {});
  const schema = useQuery({ queryKey: ['model-schema', selectedModelId], queryFn: () => getModelSchema(selectedModelId), enabled: !!selectedModelId });
  const assetDetail = useQuery({ queryKey: ['model-asset-detail', selectedModelId], queryFn: () => getModelAssetDetail(selectedModelId), enabled: !!selectedModelId });
  const modelDefaultParameters = useMemo(() => defaultRuntimeParametersFromModel(selectedModel as Record<string, unknown> | undefined, assetDetail.data), [assetDetail.data, selectedModel]);
  const runtimeFields = useMemo(() => runtimeFieldsFromContracts(schema.data, assetDetail.data).map(field => ({
    ...field,
    defaultValue: field.defaultValue ?? modelDefaultParameters[field.code],
    exampleValue: field.exampleValue ?? modelDefaultParameters[field.code],
  })), [schema.data, assetDetail.data, modelDefaultParameters]);
  const timeDimension = useMemo(() => getTimeDimensionConfig(selectedModel as Record<string, unknown> | undefined, schema.data, assetDetail.data, modelDefaultParameters), [selectedModel, schema.data, assetDetail.data, modelDefaultParameters]);
  const visibleRuntimeFields = useMemo(() => {
    if (!timeDimension.enabled) return runtimeFields;
    const systemCodes = new Set(['horizon', timeDimension.time_set || 'time']);
    if (timeDimension.state_time_set) systemCodes.add(timeDimension.state_time_set);
    if (timeDimension.label_generation === 'auto' && timeDimension.label_set) systemCodes.add(timeDimension.label_set);
    managedTimeGranularityFields(timeDimension).forEach(code => systemCodes.add(code));
    return runtimeFields.filter(field => !systemCodes.has(field.code));
  }, [runtimeFields, timeDimension]);
  const runtimeFieldDefaults = useMemo(() => Object.fromEntries(
    visibleRuntimeFields
      .map(field => [field.code, field.defaultValue ?? field.exampleValue])
      .filter(([, value]) => value !== undefined),
  ), [visibleRuntimeFields]);
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
    if (!selectedModelId) return;
    const defaults = { ...modelDefaultParameters, ...runtimeFieldDefaults };
    form.setFieldValue('parameters', serializeRuntimeParameters(stripSystemTimeParameters(defaults, timeDimension)));
    const defaultHorizon = timeDimension.default_horizon ?? defaults.horizon ?? (Array.isArray(defaults.time) ? defaults.time.length : undefined);
    form.setFieldValue('horizon', defaultHorizon === undefined || defaultHorizon === '' ? undefined : Number(defaultHorizon));
    setParameterValidation(undefined);
    form.setFieldValue('solver', selectedCapability.problemType === 'NLP' ? 'Ipopt' : 'HiGHS');
  }, [form, modelDefaultParameters, runtimeFieldDefaults, selectedCapability.problemType, selectedModelId, timeDimension]);

  const effectiveRuntimeParameters = (value: Record<string, unknown> = {}) => {
    const normalized = {
      ...modelDefaultParameters,
      ...runtimeFieldDefaults,
      ...normalizeRuntimeParameters(value),
    };
    return Object.fromEntries(Object.entries(normalized).filter(([, item]) => item !== undefined && item !== null && item !== ''));
  };

  const importRuntimeJson = () => {
    try {
      const parsed = JSON.parse(runtimeJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 必须是对象');
      const imported = parsed as Record<string, unknown>;
      const managed = managedTimeGranularityFields(timeDimension);
      const ignored = managed.filter(code => code in imported);
      const sanitized = stripSystemTimeParameters(imported, timeDimension);
      form.setFieldValue('parameters', serializeRuntimeParameters(sanitized));
      const normalized = stripSystemTimeParameters(effectiveRuntimeParameters(sanitized), timeDimension);
      const validation = validateRuntimeParameters(visibleRuntimeFields, normalized, timeDimension, Number(form.getFieldValue('horizon') || timeDimension.default_horizon || 0));
      setParameterValidation(ignored.length
        ? { ...validation, title: `${ignored.join('、')} 由模型时间契约管理，本次导入值已忽略。${validation.valid ? '' : validation.title}` }
        : validation);
    } catch (error) {
      setParameterValidation({ valid: false, title: `JSON 导入失败：${String(error)}` });
    }
  };

  const validateCurrentParameters = () => {
    const normalized = stripSystemTimeParameters(effectiveRuntimeParameters(form.getFieldValue('parameters') || {}), timeDimension);
    const result = validateRuntimeParameters(visibleRuntimeFields, normalized, timeDimension, Number(form.getFieldValue('horizon') || timeDimension.default_horizon || 0));
    setParameterValidation(result);
    return result;
  };

  const submitTask = (value: Record<string, unknown>) => {
    const runtimeParameters = stripSystemTimeParameters(effectiveRuntimeParameters(value.parameters as Record<string, unknown>), timeDimension);
    const payload: Record<string, unknown> = { ...value };
    delete payload.horizon;
    if (timeDimension.policy === 'runtime_variable' && value.horizon !== undefined && value.horizon !== null && value.horizon !== '') {
      runtimeParameters.horizon = Number(value.horizon);
      payload.horizon = Number(value.horizon);
    }
    const validation = validateRuntimeParameters(visibleRuntimeFields, runtimeParameters, timeDimension, Number(value.horizon || timeDimension.default_horizon || 0));
    setParameterValidation(validation);
    if (!validation.valid) return;
    if (selectedCapability.problemType === 'MINLP_RESERVED') {
      setParameterValidation({ valid: false, title: '当前模型属于 MINLP_RESERVED，平台未开放生产级 MINLP 求解；建议改用 PWL 或 McCormick 线性化。' });
      return;
    }
    create.mutate({ ...payload, model: value.model_id, scene: 'power optimization', solver: value.solver || selectedCapability.solver, runtime_parameters: runtimeParameters, parameters: runtimeParameters, async_run: true });
  };

  return (
    <>
      <PageHeader title="任务调度中心" description="提交、监控、重试和取消所有求解任务。" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>创建任务</Button>} />
      <MetricGrid>
        <MetricCard title="任务总数" value={rows.length} description="真实任务队列" tone="blue" />
        <MetricCard title="运行中" value={running} description="校验 / 建模 / 求解" tone="amber" />
        <MetricCard title="成功" value={success} description="可查看结果" tone="green" />
        <MetricCard title="失败/无解" value={failed} description="需查看日志" tone={failed ? 'red' : 'neutral'} />
      </MetricGrid>
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
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'cancel', label: '取消任务', danger: true, disabled: !isRunningStatus(task.status) },
                        { key: 'retry', label: '重试任务', disabled: !isRetryableStatus(task.status) },
                        { key: 'result', label: '查看结果', disabled: task.status !== 'SUCCESS' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'cancel') cancel.mutate(task.id);
                        if (key === 'retry') retry.mutate(task.id);
                        if (key === 'result') setViewId(task.id);
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
        title="创建求解任务"
        open={createOpen}
        destroyOnHidden
        size="large"
        onClose={() => setCreateOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={validateCurrentParameters}>校验参数</Button>
            <Button form="create-task-form" htmlType="submit" type="primary" loading={create.isPending}>提交求解并打开详情</Button>
          </Space>
        )}
      >
        <div className="task-create-panel">
          <Form id="create-task-form" form={form} layout="vertical" onFinish={submitTask}>
            <Card size="small" title="选择模型">
              <Form.Item name="model_id" label="选择模型" rules={[{ required: true }]}><Select options={models.data?.map(model => ({ value: model.id, label: model.name }))} /></Form.Item>
            </Card>
            <Card size="small" title="运行配置">
              {timeDimension.policy === 'runtime_variable' && (
                <Form.Item
                  name="horizon"
                  label="调度时段"
                  tooltip="当前模型声明支持运行时调整调度时段；填写后必须与时间序列参数长度一致。"
                  extra={timeGranularitySummary(timeDimension)}
                >
                  {(timeDimension.allowed_horizons || []).length ? (
                    <Select options={timeDimension.allowed_horizons?.map(horizon => ({ value: horizon, label: horizonOptionLabel(horizon, timeDimension) }))} />
                  ) : (
                    <InputNumber min={timeDimension.min_horizon || 1} max={timeDimension.max_horizon} step={timeDimension.horizon_step || 1} placeholder={timeDimension.default_horizon === undefined ? '使用模型默认' : String(timeDimension.default_horizon)} />
                  )}
                </Form.Item>
              )}
              {timeDimension.policy === 'fixed' && (
                <Alert showIcon type="info" className="section-gap-tight" title={`调度时段：固定 ${timeDimension.default_horizon ?? '-'} 点，不支持运行时修改`} description={timeGranularitySummary(timeDimension)} />
              )}
              {timeDimension.policy === 'data_derived' && (
                <Alert showIcon type="info" className="section-gap-tight" title="调度时段由时间序列长度自动推导" description={timeGranularitySummary(timeDimension)} />
              )}
              <Form.Item name="solver" label="求解器" initialValue="HiGHS">
                <Select options={selectedCapability.problemType === 'NLP' ? [{ value: 'Ipopt', label: 'Ipopt' }] : [{ value: 'HiGHS', label: 'HiGHS' }]} />
              </Form.Item>
              <Alert showIcon type={selectedCapability.problemType === 'NLP' ? 'warning' : 'info'} title={`当前问题类型：${selectedCapability.problemType || '-'}`} description={selectedCapability.problemType === 'NLP' ? '求解方式：原生非线性求解；风险：可能为局部最优，依赖初值、变量上下界和模型尺度。' : selectedCapability.nonlinearHandling !== '-' ? `非线性处理：${selectedCapability.nonlinearHandling}；求解器：HiGHS。` : 'LP/MILP 默认使用 HiGHS。'} />
            </Card>
            <Card size="small" title="参数契约" loading={schema.isFetching || assetDetail.isFetching}>
              <Table<RuntimeField>
                size="small"
                pagination={false}
                rowKey="code"
                dataSource={visibleRuntimeFields}
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
            </Card>
            <Card size="small" title="JSON 导入 / 校验">
              <Form.Item label="JSON 导入" className="section-gap">
                <Input.TextArea rows={4} value={runtimeJson} onChange={event => setRuntimeJson(event.target.value)} placeholder='{"load":[100,120],"horizon":24}' />
                <Button className="section-gap-tight" onClick={importRuntimeJson}>导入 JSON 参数</Button>
              </Form.Item>
              {parameterValidation && <Alert showIcon type={parameterValidation.valid ? 'success' : 'warning'} title={parameterValidation.title} />}
            </Card>
          </Form>
        </div>
      </Drawer>
      <Drawer
        size="large"
        open={!!viewId}
        destroyOnHidden
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
