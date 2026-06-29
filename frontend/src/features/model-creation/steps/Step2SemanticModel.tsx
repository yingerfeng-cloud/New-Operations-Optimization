import { Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import type { ModelDraft } from '../stores/modelCreationStore';

type SemanticKind = 'sets' | 'parameters' | 'variables';
type SetRow = ModelDraft['semantic']['sets'][number];
type ParameterRow = ModelDraft['semantic']['parameters'][number];
type VariableRow = ModelDraft['semantic']['variables'][number];
type SemanticRow = SetRow | ParameterRow | VariableRow;

const sourceOptions = [
  { label: '运行时注入', value: 'runtime' },
  { label: '静态参数', value: 'static' },
  { label: '业务台账', value: 'ledger' },
  { label: '系统生成', value: 'system' },
];

const variableTypeOptions = [
  { label: '连续变量', value: 'continuous' },
  { label: '0-1 变量', value: 'binary' },
  { label: '整数变量', value: 'integer' },
];

const variableDomainMap = {
  continuous: 'NonNegativeReals',
  binary: 'Binary',
  integer: 'Integers',
} as const;

function parseList(value?: string | string[]) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function formatList(value?: string[]) {
  return (value || []).join(', ');
}

function duplicateCodes(rows: Array<{ code: string }>) {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  rows.forEach(row => {
    const code = row.code.trim();
    if (!code) return;
    if (seen.has(code)) duplicated.add(code);
    seen.add(code);
  });
  return duplicated;
}

function getComponentRows(component: Record<string, unknown>, key: string) {
  const value = component[key];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function rowKey(row: { code?: string; name?: string }) {
  return String(row.code || row.name || crypto.randomUUID());
}

export function Step2SemanticModel({ draft, onChange }: { draft: ModelDraft; onChange: (d: ModelDraft) => void }) {
  const [editing, setEditing] = useState<{ kind: SemanticKind; index?: number; row: SemanticRow }>();
  const [form] = Form.useForm<Record<string, unknown>>();

  const setRows = <K extends SemanticKind>(kind: K, rows: ModelDraft['semantic'][K]) => {
    onChange({ ...draft, semantic: { ...draft.semantic, [kind]: rows } });
  };
  const openEdit = (kind: SemanticKind, row?: SemanticRow, index?: number) => {
    const defaults = {
      sets: { code: `set_${draft.semantic.sets.length + 1}`, name: `业务集合 ${draft.semantic.sets.length + 1}`, sourceType: 'runtime', defaultSize: 1 },
      parameters: { code: `param_${draft.semantic.parameters.length + 1}`, name: `业务参数 ${draft.semantic.parameters.length + 1}`, sourceType: 'runtime', required: true },
      variables: { code: `var_${draft.semantic.variables.length + 1}`, name: `决策变量 ${draft.semantic.variables.length + 1}`, variableType: 'continuous', lowerBound: 0, domain: variableDomainMap.continuous },
    } as const;
    const next = row || defaults[kind];
    setEditing({ kind, index, row: next });
    form.setFieldsValue({
      ...next,
      dimensionText: formatList(('indices' in next ? next.indices : undefined) || ('dimension' in next ? next.dimension : undefined)),
      defaultText: 'defaultValue' in next || 'default' in next ? String((next as ParameterRow).defaultValue ?? (next as ParameterRow).default ?? '') : '',
      exampleText: 'exampleValue' in next ? String((next as ParameterRow).exampleValue ?? '') : '',
    });
  };
  const removeRow = (kind: SemanticKind, index: number) => {
    setRows(kind, draft.semantic[kind].filter((_, rowIndex) => rowIndex !== index) as never);
  };
  const saveEditing = () => {
    if (!editing) return;
    const values = form.getFieldsValue();
    let row: SemanticRow;
    if (editing.kind === 'sets') {
      row = {
        code: String(values.code || ''),
        name: String(values.name || ''),
        description: String(values.description || ''),
        dimensionType: String(values.dimensionType || 'business'),
        sourceType: values.sourceType as SetRow['sourceType'],
        source_type: values.sourceType as SetRow['source_type'],
        defaultSize: Number(values.defaultSize || 0),
      };
    } else if (editing.kind === 'parameters') {
      const dimension = parseList(values.dimensionText as string);
      row = {
        code: String(values.code || ''),
        name: String(values.name || ''),
        unit: String(values.unit || ''),
        indices: dimension,
        dimension,
        sourceType: values.sourceType as ParameterRow['sourceType'],
        source_type: values.sourceType as ParameterRow['source_type'],
        required: Boolean(values.required),
        defaultValue: values.defaultText,
        default: values.defaultText,
        exampleValue: values.exampleText,
        description: String(values.description || ''),
      };
    } else {
      const dimension = parseList(values.dimensionText as string);
      const variableType = (values.variableType || 'continuous') as VariableRow['variableType'];
      row = {
        code: String(values.code || ''),
        name: String(values.name || ''),
        variableType,
        indices: dimension,
        dimension,
        lowerBound: values.lowerBound as string | number,
        upperBound: values.upperBound as string | number,
        unit: String(values.unit || ''),
        description: String(values.description || ''),
        domain: variableType ? variableDomainMap[variableType] : variableDomainMap.continuous,
      };
    }
    const rows = [...draft.semantic[editing.kind]] as SemanticRow[];
    if (editing.index === undefined) rows.push(row);
    else rows[editing.index] = row;
    setRows(editing.kind, rows as never);
    setEditing(undefined);
  };

  const setDuplicates = duplicateCodes(draft.semantic.sets);
  const parameterDuplicates = duplicateCodes(draft.semantic.parameters);
  const variableDuplicates = duplicateCodes(draft.semantic.variables);
  const duplicateMessages = [
    setDuplicates.size ? `集合编码重复：${Array.from(setDuplicates).join(', ')}` : '',
    parameterDuplicates.size ? `参数编码重复：${Array.from(parameterDuplicates).join(', ')}` : '',
    variableDuplicates.size ? `变量编码重复：${Array.from(variableDuplicates).join(', ')}` : '',
  ].filter(Boolean);

  const actionColumn = (kind: SemanticKind): ColumnsType<SemanticRow>[number] => ({
    title: '操作',
    fixed: 'right',
    width: 140,
    render: (_value, row, index) => (
      <Space>
        <Button type="link" onClick={() => openEdit(kind, row, index)}>编辑</Button>
        <Popconfirm title="确认删除？" onConfirm={() => removeRow(kind, index)}>
          <Button danger type="link">删除</Button>
        </Popconfirm>
      </Space>
    ),
  });

  const setColumns: ColumnsType<SetRow> = [
    { title: '编码', dataIndex: 'code', render: value => <Typography.Text type={setDuplicates.has(value) ? 'danger' : undefined}>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'name' },
    { title: '结构类型', dataIndex: 'dimensionType', render: value => value || '-' },
    { title: '来源', render: (_, row) => row.sourceType || row.source_type || 'runtime' },
    { title: '默认规模', dataIndex: 'defaultSize', render: value => value ?? '-' },
    { title: '说明', dataIndex: 'description', render: value => value || '-' },
    actionColumn('sets') as ColumnsType<SetRow>[number],
  ];
  const parameterColumns: ColumnsType<ParameterRow> = [
    { title: '编码', dataIndex: 'code', render: value => <Typography.Text type={parameterDuplicates.has(value) ? 'danger' : undefined}>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'name' },
    { title: '维度', render: (_, row) => formatList(row.indices || row.dimension) || '标量' },
    { title: '单位', dataIndex: 'unit', render: value => value || '-' },
    { title: '必填', dataIndex: 'required', render: value => value ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
    { title: '默认值', render: (_, row) => String(row.defaultValue ?? row.default ?? '-') },
    { title: '示例值', dataIndex: 'exampleValue', render: value => String(value ?? '-') },
    actionColumn('parameters') as ColumnsType<ParameterRow>[number],
  ];
  const variableColumns: ColumnsType<VariableRow> = [
    { title: '编码', dataIndex: 'code', render: value => <Typography.Text type={variableDuplicates.has(value) ? 'danger' : undefined}>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'variableType', render: value => variableTypeOptions.find(item => item.value === value)?.label || '连续变量' },
    { title: '维度/索引', render: (_, row) => formatList(row.indices || row.dimension) || '标量' },
    { title: '下界', dataIndex: 'lowerBound', render: value => value ?? '-' },
    { title: '上界', dataIndex: 'upperBound', render: value => value ?? '-' },
    { title: '单位', dataIndex: 'unit', render: value => value || '-' },
    actionColumn('variables') as ColumnsType<VariableRow>[number],
  ];

  const renderComponentPanel = () => {
    if (draft.basic_info.builder_mode !== 'component_based') return null;
    return (
      <Card title="组件化 Builder 回写" className="section-gap">
        {draft.components.length ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {draft.components.map(component => {
              const name = String(component.display_name || component.name || component.code || component.component_id || rowKey({ code: String(component.component_id || '') }));
              const dependencies = [...new Set([...(Array.isArray(component.dependencies) ? component.dependencies as string[] : []), ...(Array.isArray(component.depends_on) ? component.depends_on as string[] : [])])];
              return (
                <Card key={name} size="small" title={name}>
                  <Tabs
                    size="small"
                    items={[
                      { key: 'required_sets', label: 'required_sets', children: <Table size="small" pagination={false} rowKey={row => String(row.code || row.name)} dataSource={getComponentRows(component, 'required_sets')} columns={[{ title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' }, { title: '维度', dataIndex: 'dimension', render: value => formatList(value) }]} /> },
                      { key: 'parameters', label: 'parameters', children: <Table size="small" pagination={false} rowKey={row => String(row.code || row.name)} dataSource={getComponentRows(component, 'parameters')} columns={[{ title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' }, { title: '单位', dataIndex: 'unit' }, { title: '来源', dataIndex: 'source_system' }]} /> },
                      { key: 'variables', label: 'variables', children: <Table size="small" pagination={false} rowKey={row => String(row.code || row.name)} dataSource={getComponentRows(component, 'variables')} columns={[{ title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' }, { title: '维度', dataIndex: 'dimension', render: value => formatList(value) }]} /> },
                      { key: 'dependencies', label: 'dependencies', children: dependencies.length ? <Space wrap>{dependencies.map(item => <Tag key={item}>{item}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无组件依赖" /> },
                    ]}
                  />
                </Card>
              );
            })}
          </Space>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择组件" />}
      </Card>
    );
  };

  return (
    <>
      <Alert type="info" showIcon title="时间集合约定" description="time = 调度时段，长度 horizon；time_volume = 状态时点，长度 horizon + 1。储能 SOC、水库库容等状态变量应使用 time_volume。" />
      <Card title="结构化时间集合" className="section-gap">
        <Space orientation="vertical" size={6}>
          <Typography.Text><Tag color="blue">time</Tag> 调度时段，长度 horizon，用于出力、负荷、价格等逐时变量和参数。</Typography.Text>
          <Typography.Text><Tag color="geekblue">time_volume</Tag> 状态时点，长度 horizon + 1，用于 SOC、库容等跨时段状态变量。</Typography.Text>
        </Space>
      </Card>
      {duplicateMessages.length > 0 && <Alert className="section-gap" type="error" showIcon title="编码唯一性校验失败" description={duplicateMessages.join('；')} />}
      <Tabs
        className="section-gap"
        items={[
          { key: 'sets', label: `集合 ${draft.semantic.sets.length}`, children: <Card extra={<Button data-testid="add-set" onClick={() => openEdit('sets')}>新增集合</Button>}><Table size="small" pagination={false} rowKey="code" dataSource={draft.semantic.sets} columns={setColumns} scroll={{ x: 1050 }} /></Card> },
          { key: 'parameters', label: `参数 ${draft.semantic.parameters.length}`, children: <Card extra={<Button data-testid="add-parameter" onClick={() => openEdit('parameters')}>新增参数</Button>}><Table size="small" pagination={false} rowKey="code" dataSource={draft.semantic.parameters} columns={parameterColumns} scroll={{ x: 1200 }} /></Card> },
          { key: 'variables', label: `变量 ${draft.semantic.variables.length}`, children: <Card extra={<Button data-testid="add-variable" onClick={() => openEdit('variables')}>新增变量</Button>}><Table size="small" pagination={false} rowKey="code" dataSource={draft.semantic.variables} columns={variableColumns} scroll={{ x: 1200 }} /></Card> },
          { key: 'rules', label: '业务规则', children: <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="业务规则用于描述边界、守恒、启停等约束口径，后续可转换为组件或公式。" /></Card> },
        ]}
      />
      {renderComponentPanel()}
      <Drawer
        size="large"
        title={editing ? `${editing.index === undefined ? '新增' : '编辑'}${editing.kind === 'sets' ? '集合' : editing.kind === 'parameters' ? '参数' : '变量'}` : ''}
        open={!!editing}
        onClose={() => setEditing(undefined)}
        footer={<Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="primary" onClick={saveEditing}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="名称"><Input /></Form.Item>
          {editing?.kind === 'sets' && (
            <>
              <Form.Item name="dimensionType" label="结构类型"><Input placeholder="time / business" /></Form.Item>
              <Form.Item name="sourceType" label="来源"><Select options={sourceOptions} /></Form.Item>
              <Form.Item name="defaultSize" label="默认规模"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </>
          )}
          {editing?.kind === 'parameters' && (
            <>
              <Form.Item name="dimensionText" label="维度"><Input placeholder="time, unit" /></Form.Item>
              <Form.Item name="unit" label="单位"><Input /></Form.Item>
              <Form.Item name="sourceType" label="来源"><Select options={sourceOptions} /></Form.Item>
              <Form.Item name="required" label="运行必填" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name="defaultText" label="默认值"><Input /></Form.Item>
              <Form.Item name="exampleText" label="示例值"><Input /></Form.Item>
            </>
          )}
          {editing?.kind === 'variables' && (
            <>
              <Form.Item name="variableType" label="类型"><Select options={variableTypeOptions} /></Form.Item>
              <Form.Item name="dimensionText" label="维度/索引"><Input placeholder="unit, time" /></Form.Item>
              <Form.Item name="lowerBound" label="下界"><Input /></Form.Item>
              <Form.Item name="upperBound" label="上界"><Input /></Form.Item>
              <Form.Item name="unit" label="单位"><Input /></Form.Item>
            </>
          )}
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
