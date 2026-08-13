import { Alert, Card, Descriptions, Empty, Space, Table, Tag } from 'antd';
import type { ReactNode } from 'react';
import { LazyEChart } from '../../components/LazyEChart';
import { JsonViewer } from '../../components/JsonViewer';
import type { SolveResult } from '../../types/result';
import { resultLabel, type ResultLabelMap } from './resultLabels';

type RowValue = Record<string, unknown> & { __row_key?: string };

function text(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function resultValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}

function previewText(value: unknown, maxLength = 58) {
  const content = text(value);
  return `${content.slice(0, maxLength)}…`;
}

function ResultSummaryGrid({ items, compact = false }: { items: Array<{ key: string; label: ReactNode; value: unknown }>; compact?: boolean }) {
  return (
    <div className={`result-summary-grid${compact ? ' result-summary-grid-compact' : ''}`}>
      {items.map(item => (
        <div className="result-summary-item" key={item.key}>
          <span>{item.label}</span>
          <strong title={text(item.value)}>{resultValue(item.value)}</strong>
        </div>
      ))}
    </div>
  );
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

type NumericSeries = { name: string; values: number[]; labels: string[] };

function numericSeries(result?: SolveResult, labelMap?: ResultLabelMap): NumericSeries[] {
  const candidates = [
    objectValue(result?.variables),
    objectValue(result?.variable_values),
    objectValue(result?.business_output),
  ];
  for (const source of candidates) {
    for (const [name, value] of Object.entries(source)) {
      if (Array.isArray(value) && value.length > 1 && value.every(item => typeof item === 'number')) {
        return [{ name: resultLabel(name, labelMap), values: value as number[], labels: value.map((_, index) => String(index)) }];
      }
      if (value && typeof value === 'object') {
        const rows = (value as Record<string, unknown>).rows;
        if (Array.isArray(rows)) {
          const numericKey = Object.keys(rows[0] || {}).find(key => rows.every(row => typeof row?.[key] === 'number'));
          if (numericKey && rows.length > 1) return [{
            name: `${resultLabel(name, labelMap)} · ${resultLabel(numericKey, labelMap)}`,
            values: rows.map(row => row[numericKey] as number),
            labels: rows.map((row, index) => String(row.time ?? row.time_index ?? index)),
          }];
        }

        const scalarEntries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
        const groups = new Map<string, Array<{ time: number; label: string; value: number }>>();
        scalarEntries.forEach(([key, item]) => {
          const match = key.match(/^.*\[([^\]]+)\]$/);
          if (!match) return;
          const indices = match[1].split(',').map(part => part.trim());
          const time = Number(indices.at(-1));
          if (!Number.isFinite(time)) return;
          const group = indices.slice(0, -1).join(' · ') || resultLabel(name, labelMap);
          const current = groups.get(group) || [];
          current.push({ time, label: String(indices.at(-1)), value: item });
          groups.set(group, current);
        });
        const groupedSeries = [...groups.entries()]
          .map(([group, points]) => ({
            name: group === resultLabel(name, labelMap) ? group : `${resultLabel(name, labelMap)} · ${group}`,
            values: points.sort((a, b) => a.time - b.time).map(point => point.value),
            labels: points.sort((a, b) => a.time - b.time).map(point => point.label),
          }))
          .filter(series => series.values.length > 1);
        if (groupedSeries.length) return groupedSeries.slice(0, 8);
      }
    }
  }
  return [];
}

function ResultFieldName({ code, labels }: { code: unknown; labels?: ResultLabelMap }) {
  const technicalCode = String(code || '-');
  const label = resultLabel(technicalCode, labels);
  return <span className="result-field-name" title={label !== technicalCode ? technicalCode : undefined}><span>{label}</span></span>;
}

export function ResultKpiStrip({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  const rows = metricRows(result);
  return rows.length
    ? <ResultSummaryGrid items={rows.map(([key, value]) => ({ key, label: <ResultFieldName code={key} labels={labelMap} />, value }))} />
    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关键指标" />;
}

export function ResultChartPanel({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  const chartSeries = numericSeries(result, labelMap);
  if (!chartSeries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前结果未返回可绘制的时序变量；目标函数值是单个汇总指标，不作为曲线展示。" />;
  const labels = chartSeries.reduce((longest, series) => series.labels.length > longest.length ? series.labels : longest, [] as string[]);
  const hasLegend = chartSeries.length > 1;
  return (
    <LazyEChart
      style={{ height: 400 }}
      option={{
        title: { text: chartSeries.length === 1 ? chartSeries[0].name : '变量时序曲线', left: 12, top: 8, textStyle: { fontSize: 14 } },
        grid: { top: hasLegend ? 78 : 52, right: 24, bottom: 36, left: 48 },
        tooltip: { trigger: 'axis' },
        legend: hasLegend ? { top: 36, left: 12, right: 16, type: 'scroll' } : undefined,
        xAxis: { type: 'category', name: '时段', data: labels },
        yAxis: { type: 'value' },
        series: chartSeries.map((series, index) => ({
          name: series.name,
          type: 'line',
          smooth: true,
          symbolSize: 7,
          data: series.values,
          lineStyle: { width: 3 },
          areaStyle: chartSeries.length === 1 && index === 0 ? { opacity: 0.1 } : undefined,
        })),
      }}
    />
  );
}

export function ResultMetricsPanel({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="__row_key"
      dataSource={rowsFrom(result?.metrics || result?.summary || {}, 'metric')}
      columns={[
        { title: '指标', dataIndex: 'key', render: value => <ResultFieldName code={value} labels={labelMap} /> },
        { title: '值', dataIndex: 'value', render: text },
      ]}
    />
  );
}

function ResultVariableValue({ value, variable }: { value: unknown; variable: string }) {
  if (!value || typeof value !== 'object') return <span className="task-variable-scalar">{text(value)}</span>;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const compact = entries.length > 0 && entries.every(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
  if (!compact) return <div className="task-variable-json"><JsonViewer value={value} /></div>;
  return (
    <div className="task-variable-values result-variable-values">
      {entries.map(([key, item]) => {
        const shortKey = key.startsWith(`${variable}[`) ? key.slice(variable.length) : key;
        return <div className="task-variable-value" key={key}><span title={key}>{shortKey}</span><strong>{text(item)}</strong></div>;
      })}
    </div>
  );
}

export function ResultVariablesPanel({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  const variables = result?.business_variables || result?.variables || result?.variable_values || {};
  return (
    <Table
      className="result-variable-table"
      size="small"
      tableLayout="fixed"
      pagination={{ pageSize: 8 }}
      rowKey="__row_key"
      dataSource={rowsFrom(variables, 'variable')}
      columns={[
        { title: '变量/对象', dataIndex: 'key', width: 190, render: (value, row) => <ResultFieldName code={value || row.name || row.variable || row.item} labels={labelMap} /> },
        { title: '结果', dataIndex: 'value', render: (value, row) => <ResultVariableValue value={value ?? row.result ?? row.amount ?? row.output ?? row.rows} variable={String(row.key || row.name || row.variable || '')} /> },
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

function businessOutputContent(value: unknown, key: string, labelMap?: ResultLabelMap) {
  if (Array.isArray(value)) {
    if (!value.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
    if (value.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      const fields = [...new Set(value.flatMap(item => Object.keys(item as Record<string, unknown>)))];
      return (
        <Table
          className="result-wide-table"
          scroll={{ x: 'max-content' }}
          size="small"
          pagination={{ pageSize: 8 }}
          rowKey="__row_key"
          dataSource={rowsFrom(value, key)}
          columns={fields.map(field => ({ title: resultLabel(field, labelMap), dataIndex: field, render: text }))}
        />
      );
    }
    return <JsonViewer value={value} />;
  }
  const object = objectValue(value);
  if (Object.keys(object).length) {
    const scalar = Object.values(object).every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    if (scalar) {
      return <ResultSummaryGrid compact items={Object.entries(object).map(([field, item]) => ({ key: field, label: resultLabel(field, labelMap), value: item }))} />;
    }
    return <JsonViewer value={value} />;
  }
  return <strong>{resultValue(value)}</strong>;
}

export function ResultBusinessOutputPanel({ result, labelMap }: { result?: SolveResult; labelMap?: ResultLabelMap }) {
  const output = objectValue(result?.business_output);
  const entries = Object.entries(output).filter(([, value]) => meaningfulBusinessOutput(value));
  if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前结果未返回业务输出" />;
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {entries.map(([key, value]) => (
        <Card key={key} title={<ResultFieldName code={key} labels={labelMap} />}>
          {businessOutputContent(value, key, labelMap)}
        </Card>
      ))}
    </Space>
  );
}

function meaningfulBusinessOutput(value: unknown) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function ResultExplanationPanel({ result }: { result?: SolveResult }) {
  const explanation = result?.explanation_structured || result?.business_explanation || result?.explanation;
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择结果" />;
  if (typeof explanation === 'string') return <details className="inline-help-note result-explanation-note"><summary><span>i</span><b>业务解释</b><small>{previewText(explanation)}</small></summary><p>{explanation}</p></details>;
  const obj = objectValue(explanation);
  const summary = text(obj.summary || result.suggestion || '结果已生成。');
  return (
    <>
      <details className="inline-help-note result-explanation-note"><summary><span>i</span><b>业务解释</b><small>{previewText(summary)}</small></summary><p>{summary}</p></details>
      <Card size="small" title="事实 / 推断 / 建议 / 风险" className="section-gap">
        <JsonViewer value={{ facts: obj.facts || [], inferences: obj.inferences || [], recommendations: obj.recommendations || [], risk_notes: obj.risk_notes || obj.risks || [], manual_review_points: obj.manual_review_points || [], limitations: obj.limitations || [] }} />
      </Card>
      {Boolean(result.evidence_package) && <Card size="small" title="EvidencePackage" className="section-gap"><JsonViewer value={result.evidence_package} /></Card>}
    </>
  );
}

export function ResultNlpPanel({ result }: { result?: SolveResult }) {
  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择结果" />;
  const solver = String(result.solver || result.solver_name || '');
  const problem = String(result.problem_type || result.solver_type || '');
  const isNlp = problem.toUpperCase() === 'NLP' || solver.toLowerCase().includes('ipopt');
  if (!isNlp) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前结果不是 NLP / Ipopt 结果" />;
  const variables = result.variables || result.variable_values || result.business_variables || {};
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        className="compact-notice"
        showIcon
        type="warning"
        title="该结果来自 Ipopt 原生非线性求解"
        description="Ipopt 通常返回局部最优或求解器终止状态，不承诺全局最优。请关注初值、变量上下界、模型尺度和约束违反摘要。"
      />
      <Card title="NLP 求解摘要">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="求解器"><Tag color="geekblue">{solver || 'Ipopt'}</Tag></Descriptions.Item>
          <Descriptions.Item label="问题类型"><Tag color="purple">{problem || 'NLP'}</Tag></Descriptions.Item>
          <Descriptions.Item label="终止状态">{text(result.termination_condition || result.raw_termination_condition)}</Descriptions.Item>
          <Descriptions.Item label="目标值">{text(result.objective_value)}</Descriptions.Item>
          <Descriptions.Item label="运行耗时">{text(result.runtime || result.solve_time)}</Descriptions.Item>
          <Descriptions.Item label="局部最优提示">{text(result.local_optimum_warning || 'NLP 结果不承诺全局最优。')}</Descriptions.Item>
          <Descriptions.Item label="约束违反摘要" span={2}>{text(result.constraint_violation_summary || '未返回约束违反摘要')}</Descriptions.Item>
          <Descriptions.Item label="初值敏感性提示" span={2}>建议复核初值、上下界和变量尺度；不同初值可能得到不同局部解。</Descriptions.Item>
          <Descriptions.Item label="变量上下界提示" span={2}>连续变量 NLP 应提供明确上下界，避免无界或尺度过大的求解问题。</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="变量结果">
        <Table
          size="small"
          pagination={{ pageSize: 8 }}
          rowKey="__row_key"
          dataSource={rowsFrom(variables, 'nlp-variable')}
          columns={[
            { title: '变量', dataIndex: 'key', render: (value, row) => text(value || row.name || row.variable || row.item) },
            { title: '结果', dataIndex: 'value', render: (value, row) => text(value ?? row.result ?? row.amount ?? row.output ?? row.rows) },
          ]}
        />
      </Card>
    </Space>
  );
}
