import { Table, Tag } from 'antd';
import type { ComponentDef, SchemaItem } from '../../types/component';

type BindingRow = SchemaItem & Record<string, unknown> & {
  binding_status: string;
};

const bindingRowKeys = new WeakMap<object, string>();
let bindingRowSeed = 0;

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function bindingRowKey(row: BindingRow) {
  const stableId = row.id || row.parameter_id || row.binding_id;
  if (stableId) return String(stableId);
  const existing = bindingRowKeys.get(row);
  if (existing) return existing;
  bindingRowSeed += 1;
  const generated = `binding-${bindingRowSeed}`;
  bindingRowKeys.set(row, generated);
  return generated;
}

function sameParameter(binding: Record<string, unknown>, code: string) {
  return binding.parameter === code || binding.parameter_code === code || binding.code === code || binding.component_parameter === code;
}

export function ParameterBindingPanel({ component }: { component: ComponentDef }) {
  const explicit = Array.isArray(component.parameter_bindings) ? component.parameter_bindings as Array<Record<string, unknown>> : [];
  const rows: BindingRow[] = (component.parameters || []).map(parameter => {
    const binding = explicit.find(item => sameParameter(item, parameter.code));
    const merged = { ...parameter, ...(binding || {}) } as BindingRow;
    merged.binding_status = String(binding?.status || (binding || parameter.source_system || parameter.default !== undefined ? '已绑定' : '未绑定'));
    return merged;
  });
  return (
    <Table
      rowKey={bindingRowKey}
      pagination={false}
      dataSource={rows}
      columns={[
        { title: '参数编码', dataIndex: 'code', render: (value: unknown, row: BindingRow) => text(value || row.parameter || row.component_parameter) },
        { title: '参数名称', dataIndex: 'name', render: text },
        { title: '数据来源', dataIndex: 'source_system', render: (value: unknown, row: BindingRow) => text(value || row.source || row.source_path || row.runtime_key) },
        { title: '是否必填', render: (_: unknown, row: BindingRow) => row.required ? '是' : '否' },
        { title: '默认值', dataIndex: 'default', render: text },
        { title: '单位', dataIndex: 'unit', render: text },
        { title: '示例值', dataIndex: 'sample_value', render: text },
        { title: '模型参数', dataIndex: 'model_parameter', render: text },
        { title: '绑定状态', dataIndex: 'binding_status', render: (status: string) => <Tag color={status === '已绑定' || status === 'bound' ? 'green' : 'orange'}>{status}</Tag> },
      ]}
    />
  );
}
