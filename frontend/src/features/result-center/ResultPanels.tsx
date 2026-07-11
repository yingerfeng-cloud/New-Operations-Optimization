import { Alert, Card, Col, Descriptions, Empty, Row, Space, Statistic, Table, Tag } from 'antd';
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

function hydroRows(result?: SolveResult, key?: string): RowValue[] {
  const output = objectValue(result?.business_output);
  return rowsFrom(output[key || ''] || (result as Record<string, unknown> | undefined)?.[key || ''], key || 'hydro');
}

function hydroChartOption(title: string, rows: RowValue[], valueField: string) {
  const reservoirs = [...new Set(rows.map(row => String(row.reservoir || row.station || '-')))];
  const labels = [...new Set(rows.map(row => String(row.time ?? row.time_index ?? '-')))];
  return {
    title: { text: title, left: 12, top: 10, textStyle: { fontSize: 14 } },
    grid: { top: 58, right: 24, bottom: 36, left: 56 },
    tooltip: { trigger: 'axis' },
    legend: { top: 10, right: 16 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: reservoirs.map(reservoir => ({
      name: reservoir,
      type: 'line',
      smooth: true,
      data: labels.map(label => {
        const row = rows.find(item => String(item.reservoir || item.station || '-') === reservoir && String(item.time ?? item.time_index ?? '-') === label);
        return Number(row?.[valueField] || 0);
      }),
    })),
  };
}

export function ResultCascadeHydroPanel({ result }: { result?: SolveResult }) {
  const output = objectValue(result?.business_output);
  const hasHydroResult = Boolean(output.storage_curve || output.dispatch_detail || output.water_balance_check || output.function_asset_interpolation);
  if (!hasHydroResult) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无水电结果解释" />;

  const dispatchRows = rowsFrom(output.dispatch_detail, 'dispatch_detail');
  const storageRows = hydroRows(result, 'storage_curve').length ? hydroRows(result, 'storage_curve') : dispatchRows;
  const outflowRows = hydroRows(result, 'outflow_curve').length ? hydroRows(result, 'outflow_curve') : dispatchRows;
  const powerRows = hydroRows(result, 'power_curve').length ? hydroRows(result, 'power_curve') : dispatchRows;
  const spillRows = hydroRows(result, 'spill_curve').length ? hydroRows(result, 'spill_curve') : dispatchRows;
  const balanceRows = hydroRows(result, 'water_balance_check');
  const interpolationRows = hydroRows(result, 'function_asset_interpolation');
  const metrics = objectValue(result?.metrics || result?.summary);
  const functionAssetSummary = objectValue(output.function_asset_summary || output.function_assets);
  const loadRows = rowsFrom(output.load_tracking || output.system_curve, 'load_tracking');
  const hasLoadCompare = loadRows.length > 0;
  const objectiveBreakdown = objectValue(output.objective_breakdown);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <ResultKpiStrip result={result} />
      <Card title="水电调度关键指标">
        <Descriptions size="small" column={3} items={[
          { key: 'generation', label: '总发电量', children: text(metrics.total_generation_MWh ?? metrics.total_generation ?? metrics.generation) },
          { key: 'spill', label: '总弃水量', children: text(metrics.total_spill_million_m3 ?? metrics.total_spill ?? metrics.total_spill_m3s_sum) },
          { key: 'loadDeviation', label: '负荷跟踪偏差', children: text(metrics.total_abs_load_deviation_MW ?? metrics.load_tracking_deviation) },
          { key: 'terminalDeviation', label: '期末库容偏差', children: text(metrics.terminal_storage_deviation ?? metrics.total_terminal_volume_deviation) },
          { key: 'objective', label: '目标函数值', children: text(result?.objective_value ?? metrics.objective_value) },
          { key: 'solver', label: '求解器', children: text(result?.solver || result?.solver_name || 'HiGHS') },
          { key: 'problem', label: '问题类型', children: text(result?.problem_type || 'MILP') },
          { key: 'runtime', label: '运行耗时', children: text(result?.runtime || result?.solve_time) },
        ]} />
      </Card>
      <Card title="目标函数拆解">
        <Descriptions size="small" column={3} items={[
          { key: 'generation', label: '发电量价值', children: text(objectiveBreakdown.generation_value) },
          { key: 'revenue', label: '收益价值', children: text(objectiveBreakdown.revenue_value) },
          { key: 'spillPenalty', label: '弃水惩罚', children: text(objectiveBreakdown.spill_penalty_value) },
          { key: 'terminalPenalty', label: '期末库容偏差惩罚', children: text(objectiveBreakdown.terminal_storage_penalty_value) },
          { key: 'loadPenalty', label: '负荷偏差惩罚', children: text(objectiveBreakdown.load_deviation_penalty_value) },
          { key: 'total', label: '总目标值', children: text(objectiveBreakdown.total_objective_value) },
        ]} />
      </Card>
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}><Card title="库容过程曲线"><ReactECharts style={{ height: 300 }} option={hydroChartOption('库容过程曲线', storageRows, storageRows[0]?.storage !== undefined ? 'storage' : 'volume_start_million_m3')} /></Card></Col>
        <Col xs={24} lg={12}><Card title="出库流量曲线"><ReactECharts style={{ height: 300 }} option={hydroChartOption('出库流量曲线', outflowRows, outflowRows[0]?.outflow !== undefined ? 'outflow' : 'q_out_m3s')} /></Card></Col>
        <Col xs={24} lg={12}><Card title="出力曲线"><ReactECharts style={{ height: 300 }} option={hydroChartOption('出力曲线', powerRows, powerRows[0]?.power !== undefined ? 'power' : 'station_power_MW')} /></Card></Col>
        <Col xs={24} lg={12}><Card title="弃水曲线"><ReactECharts style={{ height: 300 }} option={hydroChartOption('弃水曲线', spillRows, spillRows[0]?.spill !== undefined ? 'spill' : 'q_spill_m3s')} /></Card></Col>
      </Row>
      {hasLoadCompare && <Card title="负荷跟踪解释"><Table size="small" pagination={{ pageSize: 6 }} rowKey="__row_key" dataSource={loadRows} columns={['time_index', 'load_forecast_MW', 'total_hydro_power_MW', 'load_dev_pos_MW', 'load_dev_neg_MW', 'deviation_rate', 'hard_constraint_satisfied'].map(field => ({ title: field, dataIndex: field, render: text }))} /></Card>}
      {!hasLoadCompare && <Alert showIcon type="info" title="负荷预测 vs 总出力曲线" description="当前结果未返回 load_forecast 或总出力对比数据，因此不编造曲线。" />}
      <Card title="水量平衡校验表">
        <Table
          size="small"
          pagination={{ pageSize: 6 }}
          rowKey="__row_key"
          dataSource={balanceRows}
          columns={['time_index', 'station', 'local_and_upstream_inflow_m3s', 'q_out_m3s', 'volume_start_million_m3', 'volume_end_million_m3', 'balance_error_million_m3', 'delay_mapping'].map(field => ({
            title: field,
            dataIndex: field,
            render: text,
          }))}
        />
      </Card>
      <Card title="函数资产插值解释">
        <Descriptions className="section-gap-tight" size="small" column={3} items={[
          { key: 'curves1d', label: '使用的 1D 曲线', children: text(functionAssetSummary.curves_1d || functionAssetSummary.piecewise_1d || '水位库容曲线、尾水位流量曲线') },
          { key: 'surfaces2d', label: '使用的 2D 曲面', children: text(functionAssetSummary.surfaces_2d || functionAssetSummary.piecewise_2d || '水电出力二维曲面') },
          { key: 'triangles', label: '2D 曲面三角形数量', children: text(functionAssetSummary.triangle_count ?? objectValue(output.function_assets).triangle_count ?? '-') },
          { key: 'extrapolation', label: '外推风险', children: text(functionAssetSummary.extrapolation_risk ?? '未返回外推风险明细') },
          { key: 'points', label: '插值点数量', children: text(functionAssetSummary.interpolation_point_count ?? interpolationRows.length) },
          { key: 'lambda', label: 'triangle / lambda 示例', children: text(interpolationRows.find(row => objectValue(row.power_surface).selected_triangle || objectValue(row.power_surface).lambda) ? objectValue(interpolationRows.find(row => objectValue(row.power_surface).selected_triangle || objectValue(row.power_surface).lambda)?.power_surface) : '当前结果未返回三角形插值明细，可在高级求解日志中开启。') },
        ]} />
        <Table
          size="small"
          pagination={{ pageSize: 6 }}
          rowKey="__row_key"
          dataSource={interpolationRows}
          columns={[
            { title: '时段', render: (_, row) => text(row.time_index ?? row.time) },
            { title: '电站', render: (_, row) => text(row.station ?? row.reservoir) },
            { title: '类型', dataIndex: 'type', render: text },
            { title: '函数资产', render: (_, row) => text(row.function_asset_id || objectValue(row.power_surface).function_asset_id || objectValue(row.level_storage).function_asset_id || objectValue(row.tailwater_outflow).function_asset_id) },
            { title: '一维区间', render: (_, row) => text(row.segment_index !== undefined ? { segment: row.segment_index, left: row.left_breakpoint, right: row.right_breakpoint, weights: row.weights } : row.level_storage || row.tailwater_outflow || '-') },
            { title: '二维三角片', render: (_, row) => text(row.selected_triangle !== undefined ? { triangle: row.selected_triangle, vertices: row.vertices, weights: row.lambda_weights } : row.power_surface || '-') },
          ]}
        />
      </Card>
    </Space>
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
