import { Card, Empty, Table } from 'antd';
import type { ComponentDef, SchemaItem } from '../../types/component';
import { FormulaDisplay } from '../formula-editor/FormulaDisplay';

function renderJson(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function rowsFrom(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

export function SchemaItemTable({ rows, title }: { rows?: SchemaItem[]; title: string }) {
  const dataSource = (rows || []).map((row, index) => ({ ...row, __row_key: row.code || row.key || `${title}-${index}` }));
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="__row_key"
      dataSource={dataSource}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无 ${title}`} /> }}
      columns={[
        { title: '编码', dataIndex: 'code', render: (value: string | undefined, row: SchemaItem) => value || row.key || '-' },
        { title: '名称', dataIndex: 'name', render: (value: string | undefined) => value || '-' },
        { title: '维度', dataIndex: 'dimension', render: (value: string[] | undefined) => Array.isArray(value) ? value.join(', ') : '-' },
        { title: '单位', dataIndex: 'unit', render: (value: string | undefined) => value || '-' },
        { title: '必填', dataIndex: 'required', render: (value: boolean | undefined) => value ? '是' : '否' },
        { title: '默认值', dataIndex: 'default', render: renderJson },
        { title: '示例值', dataIndex: 'sample_value', render: renderJson },
        { title: '来源', dataIndex: 'source_system', render: (value: string | undefined) => value || '-' },
      ]}
    />
  );
}

export function ComponentMathDefinition({ component }: { component: ComponentDef }) {
  const constraints = [...rowsFrom(component.generated_constraints), ...rowsFrom(component.constraints)].map((row, index) => ({ ...row, __row_key: row.constraint_id || row.name || `constraint-${index}` }));
  const objectiveTerms = [...rowsFrom(component.generated_objective_terms), ...rowsFrom(component.objective_terms)].map((row, index) => ({ ...row, __row_key: row.term_id || row.name || `objective-${index}` }));
  const columns = [
    { title: '名称', dataIndex: 'name', render: (value: unknown, row: Record<string, unknown>) => String(value || row.constraint_id || row.term_id || '-') },
    { title: '公式', render: (_value: unknown, row: Record<string, unknown>) => <FormulaDisplay row={row} /> },
    { title: '索引', dataIndex: 'indices', render: (value: unknown) => Array.isArray(value) ? value.join(', ') : '-' },
    { title: '求解参与', dataIndex: 'solve_participation', render: (value: unknown) => String(value || 'solve_active') },
  ];
  return (
    <div className="section-gap">
      <Card size="small" title="约束公式">
        <Table size="small" pagination={false} rowKey="__row_key" dataSource={constraints} columns={columns} />
      </Card>
      <Card size="small" title="目标项" className="section-gap">
        <Table size="small" pagination={false} rowKey="__row_key" dataSource={objectiveTerms} columns={columns} />
      </Card>
    </div>
  );
}

export function ComponentBusinessView({ component }: { component: ComponentDef }) {
  return (
    <div className="section-gap">
      <Card size="small" title="required_sets">
        <SchemaItemTable title="required_sets" rows={component.required_sets} />
      </Card>
      <Card size="small" title="parameters" className="section-gap">
        <SchemaItemTable title="parameters" rows={component.parameters} />
      </Card>
      <Card size="small" title="variables" className="section-gap">
        <SchemaItemTable title="variables" rows={component.variables} />
      </Card>
    </div>
  );
}
