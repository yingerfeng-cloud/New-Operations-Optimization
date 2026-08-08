import { Alert, Table } from 'antd';
import type { ComponentDef, SchemaItem } from '../../types/component';

type ParameterRow = SchemaItem & Record<string, unknown>;

const bindingRowKeys = new WeakMap<object, string>();
let bindingRowSeed = 0;

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function bindingRowKey(row: ParameterRow) {
  const stableId = row.id || row.parameter_id || row.binding_id;
  if (stableId) return String(stableId);
  const existing = bindingRowKeys.get(row);
  if (existing) return existing;
  bindingRowSeed += 1;
  const generated = `binding-${bindingRowSeed}`;
  bindingRowKeys.set(row, generated);
  return generated;
}

export function ParameterBindingPanel({ component }: { component: ComponentDef }) {
  const rows = (component.parameters || []) as ParameterRow[];
  return (
    <>
      <Alert
        className="compact-notice"
        showIcon
        type="info"
        title="这里定义组件需要哪些参数"
        description="具体模型参数的映射在建模装配时完成，组件资产不保存模型专属绑定。"
      />
      <Table
        style={{ marginTop: 12 }}
        rowKey={bindingRowKey}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '参数编码', dataIndex: 'code', render: (value: unknown, row: ParameterRow) => text(value || row.parameter) },
          { title: '参数名称', dataIndex: 'name', render: text },
          { title: '建议来源', dataIndex: 'source_system', render: (value: unknown, row: ParameterRow) => text(value || row.source_type || row.sourceType) },
          { title: '是否必填', render: (_: unknown, row: ParameterRow) => row.required !== false ? '是' : '否' },
          { title: '默认值', dataIndex: 'default', render: (value: unknown, row: ParameterRow) => text(value ?? row.default_value ?? row.defaultValue) },
          { title: '单位', dataIndex: 'unit', render: text },
          { title: '示例值', dataIndex: 'sample_value', render: text },
        ]}
      />
    </>
  );
}
