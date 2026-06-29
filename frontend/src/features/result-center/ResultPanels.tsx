import { Alert, Card, Col, Empty, Row, Statistic, Table } from 'antd';
import ReactECharts from 'echarts-for-react';
import { JsonViewer } from '../../components/JsonViewer';
import type { SolveResult } from '../../types/result';

type RowValue = Record<string, unknown> & { __row_key?: string };

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rowsFrom(value: unknown, prefix: string): RowValue[] {
  if (Array.isArray(value)) return value.map((item, index) => typeof item === 'object' && item ? { ...(item as RowValue), __row_key: `${prefix}-${index}` } : { item, __row_key: `${prefix}-${index}` });
  const obj = objectValue(value);
  return Object.entries(obj).map(([key, item], index) => ({ key, value: item, __row_key: `${prefix}-${key}-${index}` }));
}

function metricRows(result?: SolveResult) {
  const metrics = objectValue(result?.metrics || result?.summary);
  if (result?.objective_value !== undefined && metrics.objective_value === undefined) metrics.objective_value = result.objective_value;
  return Object.entries(metrics).slice(0, 4);
}

function firstNumericSeries(result?: SolveResult) {
  const candidates = [
    objectValue(result?.variables),
    objectValue(result?.variable_values),
    objectValue(result?.business_output),
  ];
  for (const source of candidates) {
    for (const [name, value] of Object.entries(source)) {
      if (Array.isArray(value) && value.every(item => typeof item === 'number')) return { name, values: value as number[] };
      if (value && typeof value === 'object') {
        const rows = (value as Record<string, unknown>).rows;
        if (Array.isArray(rows)) {
          const numericKey = Object.keys(rows[0] || {}).find(key => rows.every(row => typeof row?.[key] === 'number'));
          if (numericKey) return { name: `${name}.${numericKey}`, values: rows.map(row => row[numericKey] as number) };
        }
      }
    }
  }
  return { name: '目标值', values: result?.objective_value !== undefined ? [result.objective_value] : [] };
}

export function ResultKpiStrip({ result }: { result?: SolveResult }) {
  const rows = metricRows(result);
  return rows.length ? (
    <Row gutter={[14, 14]}>
      {rows.map(([key, value]) => (
        <Col xs={24} md={6} key={key}>
          <Card className="result-kpi"><Statistic title={key} value={typeof value === 'number' ? value : text(value)} /></Card>
        </Col>
      ))}
    </Row>
  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关键指标" />;
}

export function ResultChartPanel({ result }: { result?: SolveResult }) {
  const series = firstNumericSeries(result);
  if (!series.values.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可绘制数值序列" />;
  return (
    <ReactECharts
      style={{ height: 400 }}
      option={{
        title: { text: series.name, left: 12, top: 10, textStyle: { fontSize: 14 } },
        grid: { top: 58, right: 24, bottom: 36, left: 48 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: series.values.map((_, index) => index) },
        yAxis: { type: 'value' },
        series: [{ type: 'line', smooth: true, data: series.values, lineStyle: { color: '#2166c2', width: 3 }, areaStyle: { color: 'rgba(33,102,194,.12)' } }],
      }}
    />
  );
}

export function ResultMetricsPanel({ result }: { result?: SolveResult }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="__row_key"
      dataSource={rowsFrom(result?.metrics || result?.summary || {}, 'metric')}
      columns={[
        { title: '指标', dataIndex: 'key', render: text },
        { title: '值', dataIndex: 'value', render: text },
      ]}
    />
  );
}

export function ResultVariablesPanel({ result }: { result?: SolveResult }) {
  const variables = result?.business_variables || result?.variables || result?.variable_values || {};
  return (
    <Table
      size="small"
      pagination={{ pageSize: 8 }}
      rowKey="__row_key"
      dataSource={rowsFrom(variables, 'variable')}
      columns={[
        { title: '变量/对象', dataIndex: 'key', render: (value, row) => text(value || row.name || row.variable || row.item) },
        { title: '结果', dataIndex: 'value', render: (value, row) => text(value ?? row.result ?? row.amount ?? row.output ?? row.rows) },
      ]}
    />
  );
}

export function ResultConstraintsPanel({ result }: { result?: SolveResult }) {
  return (
    <Table
      size="small"
      pagination={{ pageSize: 8 }}
      rowKey="__row_key"
      dataSource={rowsFrom(result?.constraints || objectValue(result?.business_output).constraint_check || {}, 'constraint')}
      columns={[
        { title: '约束', dataIndex: 'key', render: (value, row) => text(value || row.name || row.constraint) },
        { title: '检查结果', dataIndex: 'value', render: (value, row) => text(value ?? row.status ?? row.slack ?? row.binding) },
      ]}
    />
  );
}

export function ResultExplanationPanel({ result }: { result?: SolveResult }) {
  const explanation = result?.business_explanation || result?.explanation;
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择结果" />;
  if (typeof explanation === 'string') return <Alert showIcon type="info" title="业务解释" description={explanation} />;
  const obj = objectValue(explanation);
  return (
    <>
      <Alert showIcon type="info" title="业务解释" description={text(obj.summary || result.suggestion || '结果已生成。')} />
      <Card size="small" title="风险提示 / 下一步" className="section-gap">
        <JsonViewer value={{ risk_notes: obj.risk_notes || obj.risks || [], next_actions: obj.next_actions || obj.actions || [] }} />
      </Card>
    </>
  );
}
