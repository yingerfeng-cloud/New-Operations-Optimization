import { Alert, Button, Card, Descriptions, Space, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../../api/client';
import { QueryState } from '../../components/QueryState';

interface Row {
  key: string; name: string; unit: string; change: string; comparable: boolean; delta: number | null;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
}
interface Comparison {
  comparable: boolean; message: string; source_model_id?: string;
  objective?: { before?: number; after?: number; delta?: number | null; unit?: string };
  metrics: Row[]; decisions: Row[]; constraints: Row[];
  residuals?: { before?: number; after?: number };
}
const value = (item: unknown) => item === undefined || item === null ? '未记录' : String(item);

export function UpdateComparisonPanel({ candidateId, contentHash }: { candidateId: string; contentHash?: string }) {
  const query = useQuery({ queryKey: ['update-comparison', candidateId, contentHash], queryFn: () => unwrap<Comparison>(apiClient.get(`/api/models/${candidateId}/update-comparison`)) });
  const comparison = query.data;
  const numericColumns = [
    { title: '指标 / 决策', render: (_: unknown, row: Row) => `${row.name} · ${row.key}` },
    { title: '单位', dataIndex: 'unit' },
    { title: '原版本', render: (_: unknown, row: Row) => value(row.before?.value) },
    { title: '候选版本', render: (_: unknown, row: Row) => value(row.after?.value) },
    { title: '差值（新−旧）', render: (_: unknown, row: Row) => row.comparable ? value(row.delta) : '不可比' },
    { title: '口径检查', dataIndex: 'change' },
  ];
  return <Card size="small" title="新旧业务结果对比" data-testid="update-business-comparison" extra={<Button size="small" onClick={() => void query.refetch()}>刷新对比</Button>}>
    <QueryState query={query} title="新旧业务结果">
      {comparison && <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert type={comparison.comparable ? 'info' : 'warning'} showIcon title={comparison.message} />
        <Descriptions size="small" column={2} items={[
          { key: 'source', label: '原模型版本', children: comparison.source_model_id || '未记录' },
          { key: 'candidate', label: '候选模型版本', children: candidateId },
          { key: 'objective', label: '模型加权目标', children: `${value(comparison.objective?.before)} → ${value(comparison.objective?.after)}` },
          { key: 'residual', label: '最大约束违反量（原→新）', children: `${value(comparison.residuals?.before)} → ${value(comparison.residuals?.after)}` },
        ]} />
        <Typography.Text>指标、决策及约束来自模型实际声明和求解结果。单位未声明或定义变化时仅展示原值；差值不直接解释为经济收益。</Typography.Text>
        {comparison.metrics.length > 0 && <Table<Row> size="small" rowKey="key" pagination={{ pageSize: 10 }} dataSource={comparison.metrics} columns={numericColumns} title={() => '模型声明的关键指标'} />}
        <Table<Row> size="small" rowKey="key" pagination={{ pageSize: 10 }} dataSource={comparison.decisions} columns={numericColumns} title={() => '实际决策与物理量'} />
        <Table<Row> size="small" rowKey="key" pagination={{ pageSize: 10 }} dataSource={comparison.constraints} title={() => '实际约束及残差'} columns={[
          { title: '约束', dataIndex: 'key' },
          { title: '原边界 [下界, 上界]', render: (_, row) => `[${value(row.before?.lower)}, ${value(row.before?.upper)}]` },
          { title: '新边界 [下界, 上界]', render: (_, row) => `[${value(row.after?.lower)}, ${value(row.after?.upper)}]` },
          { title: '约束值（原→新）', render: (_, row) => `${value(row.before?.body)} → ${value(row.after?.body)}` },
          { title: '违反量（原→新）', render: (_, row) => `${value(row.before?.violation)} → ${value(row.after?.violation)}` },
          { title: '变化', dataIndex: 'change' },
        ]} />
      </Space>}
    </QueryState>
  </Card>;
}
