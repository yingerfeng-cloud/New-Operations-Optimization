import { Button, Card, Drawer, Space, Tabs } from 'antd';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResult, getResults } from '../../api/results';
import { getModel } from '../../api/models';
import { DataTable } from '../../components/DataTable';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';
import { EmptyActionState, MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import {
  ResultChartPanel,
  ResultBusinessOutputPanel,
  ResultConstraintsPanel,
  ResultExplanationPanel,
  ResultKpiStrip,
  ResultMetricsPanel,
  ResultNlpPanel,
} from '../../features/result-center/ResultPanels';
import { buildResultLabelMap } from '../../features/result-center/resultLabels';
import type { ResultViewDefinition, SolveResult } from '../../types/result';

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const meaningful = (value: unknown): boolean => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== undefined && value !== null && value !== '';
export function resultViewDefinitions(result?: SolveResult): ResultViewDefinition[] {
  if (!result) return [{ key: 'overview', label: '结果概览', kind: 'metrics' }, { key: 'raw', label: '原始结果', kind: 'raw' }];
  const declared = result.result_views || result.result_metadata?.views;
  if (declared?.length) return declared;
  const views: ResultViewDefinition[] = [{ key: 'overview', label: '结果概览', kind: 'metrics', source: 'metrics' }];
  if (meaningful(result.variables) || meaningful(result.variable_values) || meaningful(result.business_variables)) views.push({ key: 'curves', label: '变量曲线', kind: 'timeseries', source: 'variable_values' });
  if (meaningful(result.business_output)) views.push({ key: 'business_output', label: '业务输出', kind: 'business_output', source: 'business_output' });
  if (meaningful(result.constraints) || meaningful(record(result.business_output).constraint_check)) views.push({ key: 'constraints', label: '约束检查', kind: 'constraint_checks', source: 'constraints' });
  if (String(result.problem_type || result.solver_type || '').toUpperCase() === 'NLP') views.push({ key: 'diagnostics', label: '求解诊断', kind: 'solver_diagnostics', source: 'solver' });
  if (meaningful(result.business_explanation) || meaningful(result.explanation) || meaningful(result.suggestion)) views.push({ key: 'advice', label: '业务建议', kind: 'explanation', source: 'business_explanation' });
  views.push({ key: 'raw', label: '原始结果', kind: 'raw', source: '$' });
  return views;
}
export const resultTabKeys = (result?: SolveResult) => resultViewDefinitions(result).map(view => view.key);

function ResultView({ view, result, labelMap }: { view: ResultViewDefinition; result?: SolveResult; labelMap: ReturnType<typeof buildResultLabelMap> }) {
  if (view.kind === 'metrics') return <ResultMetricsPanel result={result} labelMap={labelMap} />;
  if (view.kind === 'timeseries') return <ResultChartPanel result={result} labelMap={labelMap} />;
  if (view.kind === 'business_output') return <ResultBusinessOutputPanel result={result} labelMap={labelMap} />;
  if (view.kind === 'constraint_checks') return <ResultConstraintsPanel result={result} />;
  if (view.kind === 'solver_diagnostics') return <ResultNlpPanel result={result} />;
  if (view.kind === 'explanation') return <ResultExplanationPanel result={result} />;
  if (view.kind === 'raw') return <JsonViewer value={result} />;
  return <JsonViewer value={view.source ? record(result)[view.source] : result} />;
}

export function ResultCenterPage() {
  const [id, setId] = useState<string>();
  useEffect(() => { const task = new URLSearchParams(window.location.search).get('task'); if (task) setId(task); }, []);
  const list = useQuery({ queryKey: ['results'], queryFn: getResults });
  const detail = useQuery({ queryKey: ['result', id], queryFn: () => getResult(id!), enabled: !!id });
  const detailModelId = String(detail.data?.model_id || '');
  const detailModel = useQuery({ queryKey: ['model', detailModelId], queryFn: () => getModel(detailModelId), enabled: !!detailModelId });
  const labelMap = buildResultLabelMap(detailModel.data, detail.data);
  const rows = list.data || [];
  const coveredModels = new Set(rows.map(result => String(result.model || result.model_id || '')).filter(Boolean)).size;
  const latestFinishedAt = rows
    .map(result => String(result.finished_at || ''))
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0];
  const latestFinishedText = latestFinishedAt
    ? new Date(latestFinishedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '-';
  const resultViews = resultViewDefinitions(detail.data);

  return (
    <>
      <PageHeader title="结果报告库" description="查看求解结果、关键指标、变量曲线、业务解释和 JSON 结果。导出报告（预留）位于结果详情高级操作，不作为主流程按钮开放。" />
      <MetricGrid columns={3}>
        <MetricCard title="归档报告" value={rows.length} description="可查看的求解结果" tone="blue" />
        <MetricCard title="模型种类" value={coveredModels} description="当前归档涉及的模型" tone="green" />
        <MetricCard title="最近完成" value={latestFinishedText} description="最新报告归档时间" tone="amber" />
      </MetricGrid>
      <Card className="content-card section-gap" title="结果列表">
        {rows.length ? (
          <DataTable<SolveResult>
            dataSource={rows}
            loading={list.isLoading}
            columns={[
              { title: '结果/任务编号', render: (_: unknown, result: SolveResult) => result.task_id || result.job_id || result.id },
              { title: '模型', render: (_: unknown, result: SolveResult) => String(result.model || result.model_id || '-') },
              { title: <span title="各模型目标函数的含义由建模定义决定，不用于跨模型比较">目标函数值</span>, render: (_: unknown, result: SolveResult) => String(result.objective_value ?? result.total_cost ?? result.metrics?.objective_value ?? result.summary?.objective_value ?? '-') },
              { title: '最优间隙', render: (_: unknown, result: SolveResult) => String(result.gap ?? result.metrics?.gap ?? result.summary?.gap ?? '-') },
              { title: '完成时间', dataIndex: 'finished_at', defaultSortOrder: 'descend', sorter: (left: SolveResult, right: SolveResult) => Date.parse(String(left.finished_at || '')) - Date.parse(String(right.finished_at || '')), render: value => value ? new Date(String(value)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-' },
              { title: '操作', render: (_: unknown, result: SolveResult) => <Button type="link" onClick={() => setId(String(result.task_id || result.job_id || result.id))}>查看报告</Button> },
            ]}
          />
        ) : (
          <EmptyActionState title="暂无结果报告" description="发起求解任务并完成运行后，这里会展示结论摘要、关键指标和变量曲线。" action={<Button type="primary" href="/tasks">去发起求解任务</Button>} />
        )}
      </Card>
      <Drawer
        size="large"
        open={!!id}
        onClose={() => setId(undefined)}
        title={`结果报告 ${id || ''}`}
        footer={<Space style={{ width: '100%', justifyContent: 'flex-end' }}><span className="muted">高级操作：导出报告预留，未作为主流程能力开放。</span><Button onClick={() => setId(undefined)}>关闭</Button></Space>}
      >
        <ResultKpiStrip result={detail.data} labelMap={labelMap} />
        <Tabs className="section-gap" items={resultViews.map(view => ({ key: view.key, label: view.label, children: <div className="panel"><ResultView view={view} result={detail.data} labelMap={labelMap} /></div> }))} />
      </Drawer>
    </>
  );
}
