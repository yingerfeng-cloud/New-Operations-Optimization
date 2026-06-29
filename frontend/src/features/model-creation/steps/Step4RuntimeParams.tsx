import { Alert, Button, Card, Collapse, Descriptions, Input, Space, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import type { ModelDraft } from '../stores/modelCreationStore';
import { JsonViewer } from '../../../components/JsonViewer';

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

export function buildRuntimeParameterRows(draft: ModelDraft): RuntimeParameterRow[] {
  return draft.semantic.parameters.map(parameter => {
    const source = sourceOf(parameter);
    const code = parameter.code;
    const currentValue = draft.runtime_parameters[code] ?? draft.parameter_groups[source]?.[code];
    const defaultValue = parameter.defaultValue ?? parameter.default;
    const required = Boolean(parameter.required ?? source === 'runtime');
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
  const [json, setJson] = useState(JSON.stringify(draft.runtime_parameters, null, 2));
  const missing = validateRuntimeParameters(draft);
  const functionMappings = draft.components.filter(component => String(component.type || component.component_id) === 'function_mapping_component' || component.function_asset_id);

  const updateRuntimeValue = (row: RuntimeParameterRow, value: unknown) => {
    const runtimeParameters = { ...draft.runtime_parameters, [row.code]: value };
    if (!hasValue(value)) delete runtimeParameters[row.code];
    onChange({ ...draft, runtime_parameters: runtimeParameters, parameter_groups: groupValues(rows, runtimeParameters) });
    setJson(JSON.stringify(runtimeParameters, null, 2));
  };

  const applyJson = () => {
    try {
      const runtime = JSON.parse(json) as Record<string, unknown>;
      onChange({ ...draft, runtime_parameters: runtime, parameter_groups: groupValues(rows, runtime) });
      const nextMissing = validateRuntimeParameters({ ...draft, runtime_parameters: runtime, parameter_groups: groupValues(rows, runtime) });
      if (import.meta.env.MODE !== 'test') {
        if (nextMissing.length) message.warning(`导入完成，但仍缺少 ${nextMissing.length} 个必填参数`);
        else message.success('JSON 参数导入并校验通过');
      }
    } catch {
      if (import.meta.env.MODE !== 'test') message.error('参数 JSON 格式错误');
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
        <Input
          aria-label={`${labelPrefix}${row.code} 当前值`}
          defaultValue={valueToText(row.currentValue)}
          placeholder={valueToText(row.defaultValue || row.exampleValue)}
          onBlur={event => updateRuntimeValue(row, parseValue(event.target.value))}
        />
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
      {functionMappings.length > 0 && (
        <Card className="section-gap" title="函数/曲线资产绑定">
          <Table
            size="small"
            pagination={false}
            rowKey={row => String(row.constraint_id || row.function_asset_id || row.curve_asset_id || row.component_id || row.type)}
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
      <Alert type="info" showIcon title="运行参数按来源分类，发布前验证必填项、默认值和示例值。" />
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
              <Table size="small" pagination={false} rowKey="key" dataSource={rows.filter(row => row.source === group.key)} columns={columns} scroll={{ x: 1450 }} />
            </Card>
          ),
        }))}
      />
      <Card className="section-gap" title="时间序列参数">
        <Table size="small" pagination={false} rowKey="key" dataSource={rows.filter(row => row.dimensions.includes('time') || row.dimensions.includes('time_volume'))} columns={buildColumns('时间序列 ')} scroll={{ x: 1450 }} />
      </Card>
      <Collapse
        className="section-gap"
        defaultActiveKey={['runtime-debug']}
        items={[{
          key: 'runtime-debug',
          label: '高级调试：JSON 导入 / 运行参数结构预览',
          children: (
            <>
              <Input.TextArea aria-label="运行参数 JSON" rows={8} value={json} onChange={event => setJson(event.target.value)} />
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" onClick={applyJson}>导入并校验</Button>
                <Button onClick={() => setJson(JSON.stringify(draft.runtime_parameters, null, 2))}>恢复当前参数</Button>
              </Space>
              <Card title="运行参数结构预览" className="section-gap">
                <JsonViewer value={{ runtime_parameters: draft.runtime_parameters, parameter_groups: draft.parameter_groups }} />
              </Card>
            </>
          ),
        }]}
      />
    </>
  );
}
