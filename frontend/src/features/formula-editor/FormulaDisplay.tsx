import { Collapse, Space, Typography } from 'antd';

export function FormulaDisplay({ row }: { row: Record<string, unknown> }) {
  const readable = String(row.display_formula || row.readable_formula || row.formula || row.expression || row.dsl_formula || row.math_expression || row.name || '-');
  const dsl = String(row.dsl_formula || row.formula || row.expression || row.math_expression || '-');
  return (
    <Space orientation="vertical" size={4}>
      <Typography.Text>{readable}</Typography.Text>
      <Collapse
        size="small"
        ghost
        items={[{ key: 'dsl', label: '原始 DSL', children: <Typography.Text code>{dsl}</Typography.Text> }]}
      />
    </Space>
  );
}
