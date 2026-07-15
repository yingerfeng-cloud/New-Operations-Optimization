import { Alert, Button, Card, Collapse, Descriptions, Input, Segmented, Select, Space, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import type { ModelDraft } from '../stores/modelCreationStore';
import { JsonViewer } from '../../../components/JsonViewer';
import { systemTimeFieldCodes } from '../utils/timeDimensionDraft';
import { inferModelProblemType } from '../utils/inferModelProblemType';

type ParameterGroupKey = 'runtime' | 'static' | 'ledger' | 'system' | 'objective_weights';
type ParameterDef = ModelDraft['semantic']['parameters'][number];

interface RuntimeParameterRow {
  key: string;
  code: string;
  name: string;
  unit?: string;
  dimensions: string[];
  source: ParameterGroupKey;
  required: boolean;
  defaultValue: unknown;
  exampleValue: unknown;
  description?: string;
  currentValue: unknown;
  status: 'missing' | 'provided' | 'defaulted' | 'optional';
  disabled?: boolean;
}

const functionMappingRowKeys = new WeakMap<object, string>();
let functionMappingRowSeed = 0;

function functionMappingRowKey(row: Record<string, unknown>) {
  const stableId = row.id || row.mapping_id || row.constraint_id || row.function_asset_id || row.curve_asset_id;
  if (stableId) return String(stableId);
  const existing = functionMappingRowKeys.get(row);
  if (existing) return existing;
  functionMappingRowSeed += 1;
  const generated = `function-mapping-${functionMappingRowSeed}`;
  functionMappingRowKeys.set(row, generated);
  return generated;
}

const groups: Array<{ key: ParameterGroupKey; label: string }> = [
  { key: 'runtime', label: '运行时输入参数' },
  { key: 'static', label: '模型静态参数' },
  { key: 'ledger', label: '业务台账参数' },
  { key: 'system', label: '系统生成参数' },
  { key: 'objective_weights', label: '目标权重参数' },
];

function sourceOf(parameter: ParameterDef): ParameterGroupKey {
  const source = String(parameter.sourceType || parameter.source_type || '').trim();
  if (source === 'static' || source === 'ledger' || source === 'system') return source;
  if (source === 'objective_weights' || /weight|权重/i.test(parameter.code)) return 'objective_weights';
  return 'runtime';
}

function valueToText(value: unknown) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function parseValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const numberValue = Number(text);
    if (!Number.isNaN(numberValue)) return numberValue;
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

export function parseRuntimeParameterJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('运行参数 JSON 的根节点必须为对象，例如 {"load": [1,2,3]}。');
  }
  return parsed as Record<string, unknown>;
}

function RuntimeValueInput({ row, labelPrefix, onCommit }: { row: RuntimeParameterRow; labelPrefix: string; onCommit: (value: unknown) => void }) {
  const externalText = valueToText(row.currentValue);
  const [text, setText] = useState(externalText);
  useEffect(() => setText(externalText), [externalText]);
  return (
    <Input
      aria-label={`${labelPrefix}${row.code} 当前值`}
      value={text}
      placeholder={valueToText(row.defaultValue ?? row.exampleValue)}
      disabled={row.disabled}
      onChange={event => setText(event.target.value)}
      onBlur={() => onCommit(parseValue(text))}
      onPressEnter={() => onCommit(parseValue(text))}
    />
  );
}

export function buildRuntimeParameterRows(draft: ModelDraft): RuntimeParameterRow[] {
  const systemFields = systemTimeFieldCodes(draft.time_dimension);
  return draft.semantic.parameters.filter(parameter => !systemFields.has(parameter.code)).map(parameter => {
    const source = sourceOf(parameter);
    const code = parameter.code;
    const currentValue = draft.runtime_parameters[code] ?? draft.parameter_groups[source]?.[code];
    const defaultValue = parameter.defaultValue ?? parameter.default;
    const loadDisabled = code === 'load_forecast' && draft.runtime_parameters.load_tracking_mode === 'disabled';
    const required = loadDisabled ? false : Boolean(parameter.required ?? source === 'runtime');
    const status: RuntimeParameterRow['status'] = hasValue(currentValue)
      ? 'provided'
      : hasValue(defaultValue)
        ? 'defaulted'
        : required
          ? 'missing'
          : 'optional';
    return {
      key: `${source}:${code}`,
      code,
      name: parameter.name || code,
      unit: parameter.unit,
      dimensions: parameter.indices || parameter.dimension || [],
      source,
      required,
      defaultValue,
      exampleValue: parameter.exampleValue,
      description: parameter.description,
      currentValue,
      status,
      disabled: loadDisabled,
    };
  });
}

export function validateRuntimeParameters(draft: ModelDraft) {
  return buildRuntimeParameterRows(draft)
    .filter(row => row.status === 'missing')
    .map(row => `${row.name} ${row.code} 缺少必填值`);
}

function groupValues(rows: RuntimeParameterRow[], runtimeParameters: Record<string, unknown>) {
  const grouped: ModelDraft['parameter_groups'] = { runtime: {}, static: {}, ledger: {}, system: {}, objective_weights: {} };
  rows.forEach(row => {
    const value = runtimeParameters[row.code];
    if (hasValue(value)) grouped[row.source][row.code] = value;
  });
  return grouped;
}

export function Step4RuntimeParams({ draft, onChange }: { draft: ModelDraft; onChange: (d: ModelDraft) => void }) {
  const rows = useMemo(() => buildRuntimeParameterRows(draft), [draft]);
  const systemFields = useMemo(() => systemTimeFieldCodes(draft.time_dimension), [draft.time_dimension]);
  const businessRuntime = useMemo(() => Object.fromEntries(Object.entries(draft.runtime_parameters).filter(([key]) => !systemFields.has(key))), [draft.runtime_parameters, systemFields]);
  const [json, setJson] = useState(JSON.stringify(businessRuntime, null, 2));
  const missing = validateRuntimeParameters(draft);
  const functionMappings = draft.components.filter(component => String(component.type || component.component_id) === 'function_mapping_component' || component.function_asset_id);
  const parameterCodes = useMemo(() => new Set(draft.semantic.parameters.map(parameter => parameter.code)), [draft.semantic.parameters]);
  const hasHydroPowerMode = parameterCodes.has('hydro_power_mode') || Object.prototype.hasOwnProperty.call(draft.runtime_parameters, 'hydro_power_mode');
  const hasLoadTrackingMode = parameterCodes.has('load_tracking_mode') || Object.prototype.hasOwnProperty.call(draft.runtime_parameters, 'load_tracking_mode');
  const showDispatchModes = hasHydroPowerMode || hasLoadTrackingMode;
  const replacementCode = String(draft.advanced.ui_metadata?.replacement_model_code || draft.semantic.ui_metadata?.replacement_model_code || '');
  const deprecated = Boolean(draft.advanced.ui_metadata?.deprecated || draft.semantic.ui_metadata?.deprecated);

  useEffect(() => {
    setJson(JSON.stringify(businessRuntime, null, 2));
  }, [businessRuntime]);

  const updateHydroMode = (code: string, value: unknown) => {
    const runtimeParameters = { ...draft.runtime_parameters, [code]: value };
    onChange({ ...draft, runtime_parameters: runtimeParameters, parameter_groups: groupValues(rows, runtimeParameters) });
    setJson(JSON.stringify(runtimeParameters, null, 2));
  };

  const updateRuntimeValue = (row: RuntimeParameterRow, value: unknown) => {
    const runtimeParameters = { ...draft.runtime_parameters, [row.code]: value };
    if (!hasValue(value)) delete runtimeParameters[row.code];
    onChange({ ...draft, runtime_parameters: runtimeParameters, parameter_groups: groupValues(rows, runtimeParameters) });
    setJson(JSON.stringify(runtimeParameters, null, 2));
  };

  const applyJson = () => {
    try {
      const imported = parseRuntimeParameterJson(json);
      const runtime = {
        ...Object.fromEntries(Object.entries(draft.runtime_parameters).filter(([key]) => systemFields.has(key))),
        ...Object.fromEntries(Object.entries(imported).filter(([key]) => !systemFields.has(key))),
      };
      onChange({ ...draft, runtime_parameters: runtime, parameter_groups: groupValues(rows, runtime) });
      const nextMissing = validateRuntimeParameters({ ...draft, runtime_parameters: runtime, parameter_groups: groupValues(rows, runtime) });
      if (import.meta.env.MODE !== 'test') {
        if (nextMissing.length) message.warning(`导入完成，但仍缺少 ${nextMissing.length} 个必填参数`);
        else message.success('JSON 参数导入并校验通过');
      }
    } catch (error) {
      if (import.meta.env.MODE !== 'test') message.error(error instanceof Error ? error.message : '参数 JSON 格式错误');
    }
  };

  const buildColumns = (labelPrefix = ''): ColumnsType<RuntimeParameterRow> => [
    { title: '参数编码', dataIndex: 'code', width: 140 },
    { title: '参数名称', dataIndex: 'name', width: 150 },
    { title: '单位', dataIndex: 'unit', width: 90, render: value => value || '-' },
    { title: '维度', dataIndex: 'dimensions', width: 140, render: value => (value as string[]).join(', ') || '标量' },
    { title: '来源', dataIndex: 'source', width: 130, render: value => groups.find(item => item.key === value)?.label || value },
    { title: '必填', dataIndex: 'required', width: 80, render: value => value ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
    { title: '默认值', dataIndex: 'defaultValue', width: 140, render: value => valueToText(value) || '-' },
    { title: '示例值', dataIndex: 'exampleValue', width: 140, render: value => valueToText(value) || '-' },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      width: 180,
      render: (_value, row) => (
        <RuntimeValueInput row={row} labelPrefix={labelPrefix} onCommit={value => updateRuntimeValue(row, value)} />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: status => {
        if (status === 'provided') return <Tag color="green">已填写</Tag>;
        if (status === 'defaulted') return <Tag color="blue">使用默认</Tag>;
        if (status === 'missing') return <Tag color="red">缺失</Tag>;
        return <Tag>可选</Tag>;
      },
    },
    { title: '说明', dataIndex: 'description', width: 180, render: value => value || '-' },
  ];
  const columns = buildColumns();

  return (
    <>
      {deprecated && replacementCode && <Alert className="compact-step-note" type="warning" showIcon title="该模板为兼容入口" description={`新建模型请使用 ${replacementCode}；旧调用将按版本治理规则解析到活动版本。`} />}
      {showDispatchModes && (
        <Card size="small" title="梯级水电求解配置" className="section-gap">
          <Space wrap size={20}>
            <Space orientation="vertical" size={4}>
              <span>水电出力关系</span>
              {hasHydroPowerMode && <Segmented
                aria-label="水电出力关系"
                value={String(draft.runtime_parameters.hydro_power_mode || 'linear')}
                options={[{ label: '线性', value: 'linear' }, { label: '一维严格 PWL', value: 'pwl_1d' }, { label: '二维三角片 PWL', value: 'pwl_2d' }]}
                onChange={value => updateHydroMode('hydro_power_mode', value)}
              />}
            </Space>
            <Space orientation="vertical" size={4}>
              <span>负荷跟踪模式</span>
              {hasLoadTrackingMode && <Select
                aria-label="负荷跟踪模式"
                style={{ width: 180 }}
                value={String(draft.runtime_parameters.load_tracking_mode || 'soft')}
                options={[{ label: '关闭', value: 'disabled' }, { label: '软约束', value: 'soft' }, { label: '硬约束', value: 'hard' }]}
                onChange={value => updateHydroMode('load_tracking_mode', value)}
              />}
            </Space>
            <Tag color={String(draft.runtime_parameters.hydro_power_mode || 'linear') === 'linear' ? 'blue' : 'gold'}>
              {inferModelProblemType(draft)} / {draft.basic_info.solver || 'HiGHS'}
            </Tag>
          </Space>
          <Alert className="section-gap-tight" type="info" showIcon title="当前模型通过分段线性方式近似水电非线性特性，并由 HiGHS 按 LP/MILP 求解。" />
        </Card>
      )}
      <Card size="small" title="时间维度摘要">
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="时间策略">{draft.time_dimension.policy === 'fixed' ? '固定时段' : draft.time_dimension.policy === 'runtime_variable' ? (draft.time_dimension.allowed_horizons?.length ? '候选时段切换' : '运行时自由调整') : draft.time_dimension.policy === 'data_derived' ? '由输入数据推导（试验能力）' : '非时序模型'}</Descriptions.Item>
          {draft.time_dimension.enabled && <Descriptions.Item label="默认 horizon">{draft.time_dimension.default_horizon ?? '-'}</Descriptions.Item>}
          {draft.time_dimension.allowed_horizons?.length ? <Descriptions.Item label="候选值">{draft.time_dimension.allowed_horizons.join('、')}</Descriptions.Item> : null}
          {draft.time_dimension.allowed_horizons?.length ? <Descriptions.Item label="候选粒度">{draft.time_dimension.allowed_horizons.map(horizon => `${horizon}点=${draft.time_dimension.interval_minutes_by_horizon?.[String(horizon)] ?? '-'}分钟`).join('；')}</Descriptions.Item> : null}
          {draft.time_dimension.enabled && <Descriptions.Item label="时间集合">{draft.time_dimension.time_set || 'time'}</Descriptions.Item>}
          {draft.time_dimension.enabled && <Descriptions.Item label="状态集合">{draft.time_dimension.state_time_set || '未启用'}</Descriptions.Item>}
          {draft.time_dimension.enabled && <Descriptions.Item label="默认粒度">{draft.time_dimension.interval_minutes || draft.time_dimension.interval_minutes_by_horizon?.[String(draft.time_dimension.default_horizon)] || '-'} 分钟</Descriptions.Item>}
          {draft.time_dimension.enabled && !draft.time_dimension.allowed_horizons?.length && <Descriptions.Item label="delta_t">{draft.time_dimension.delta_t ?? (draft.time_dimension.interval_minutes ? draft.time_dimension.interval_minutes / 60 : '-')}</Descriptions.Item>}
        </Descriptions>
      </Card>
      {functionMappings.length > 0 && (
        <Card className="section-gap" title="函数/曲线资产绑定">
          <Table
            size="small"
            pagination={false}
            rowKey={functionMappingRowKey}
            dataSource={functionMappings}
            columns={[
              { title: '组件', render: (_, row) => String(row.type || row.component_id || '-') },
              { title: '函数资产', render: (_, row) => String(row.function_asset_id || row.curve_asset_id || '-') },
              { title: 'x', render: (_, row) => String(row.x || '-') },
              { title: 'y', render: (_, row) => String(row.y || '-') },
              { title: '求解策略', render: (_, row) => <Tag color="blue">{String(row.solve_strategy || 'convex_combination_lp')}</Tag> },
            ]}
          />
        </Card>
      )}
      <Alert className="compact-step-note" type="info" showIcon title="运行参数按来源分类，发布前验证必填项、默认值和示例值。" />
      {missing.length > 0 && <Alert className="section-gap" type="warning" showIcon title="缺少必填运行参数" description={missing.join('；')} />}
      <Card className="section-gap" title="基础参数绑定">
        <Descriptions size="small" column={5} items={groups.map(group => ({ key: group.key, label: group.label, children: rows.filter(row => row.source === group.key).length }))} />
      </Card>
      <Tabs
        className="section-gap"
        items={groups.map(group => ({
          key: group.key,
          label: `${group.label} ${rows.filter(row => row.source === group.key).length}`,
          children: (
            <Card>
              <Table className="runtime-parameter-table" size="small" pagination={false} rowKey="key" dataSource={rows.filter(row => row.source === group.key)} columns={columns} />
            </Card>
          ),
        }))}
      />
      <Card className="section-gap" title="时间序列参数">
        <Table className="runtime-parameter-table" size="small" pagination={false} rowKey="key" dataSource={rows.filter(row => row.dimensions.includes('time') || row.dimensions.includes('time_volume'))} columns={buildColumns('时间序列 ')} />
      </Card>
      <Collapse
        className="section-gap"
        items={[{
          key: 'runtime-debug',
          label: '高级调试：JSON 导入 / 运行参数结构预览',
          children: (
            <>
              <Input.TextArea aria-label="运行参数 JSON" rows={8} value={json} onChange={event => setJson(event.target.value)} />
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" onClick={applyJson}>导入并校验</Button>
                <Button onClick={() => setJson(JSON.stringify(businessRuntime, null, 2))}>恢复当前参数</Button>
              </Space>
              <Card title="运行参数结构预览" className="section-gap">
                <JsonViewer value={{ runtime_parameters: businessRuntime, parameter_groups: draft.parameter_groups }} />
              </Card>
            </>
          ),
        }]}
      />
    </>
  );
}
