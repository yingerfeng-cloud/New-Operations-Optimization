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
  ResultConstraintsPanel,
  ResultCascadeHydroPanel,
  ResultExplanationPanel,
  ResultKpiStrip,
  ResultMetricsPanel,
  ResultNlpPanel,
  ResultVariablesPanel,
} from '../../features/result-center/ResultPanels';
import { buildResultLabelMap } from '../../features/result-center/resultLabels';
import type { SolveResult } from '../../types/result';

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const meaningful = (value: unknown): boolean => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== undefined && value !== null && value !== '';
const anyData = (result: SolveResult, keys: string[]) => keys.some(key => meaningful(result[key]) || meaningful(record(result.business_output)[key]));
export function resultTabKeys(result?: SolveResult) {
  if (!result) return ['overview', 'raw'];
  const output = record(result.business_output); const allKeys = new Set([...Object.keys(result), ...Object.keys(output), ...Object.keys(record(result.metrics))]);
  const has = (...patterns: string[]) => [...allKeys].some(key => patterns.some(pattern => key.toLowerCase().includes(pattern)));
  const declared = new Set([...(result.result_capabilities || []), ...(result.result_metadata?.capabilities || [])]);
  const declares = (...capabilities: string[]) => capabilities.some(capability => declared.has(capability));
  const keys = ['overview'];
  const variablesAvailable = meaningful(result.variables) || meaningful(result.variable_values) || meaningful(result.business_variables);
  if ((declares('variable_series') && variablesAvailable) || (!declared.size && variablesAvailable)) keys.push('curves');
  const hydroAvailable = anyData(result, ['hydro_process', 'reservoir_process', 'reservoirs', 'storage_series', 'storage_curve', 'water_level_series', 'water_balance_check', 'forebay_level_curve', 'tailwater_level_curve']);
  if ((declares('hydro_process') && hydroAvailable) || (!declared.size && (hydroAvailable || has('reservoir', 'storage', 'water_level', 'hydro')))) keys.push('reservoir');
  const dispatchAvailable = anyData(result, ['dispatch_series', 'power_series', 'power_curve', 'load_series', 'load_curve', 'station_power', 'station_power_curve', 'load_comparison']);
  if ((declares('dispatch_series', 'hydro_process') && dispatchAvailable) || (!declared.size && (dispatchAvailable || has('power', 'output', 'dispatch', 'load')))) keys.push('dispatch');
  const pwlAvailable = anyData(result, ['pwl_diagnostics', 'pwl_diagnostic', 'triangle_diagnostics', 'function_asset_diagnostics', 'function_asset_interpolation']);
  if ((declares('pwl_diagnostics') && pwlAvailable) || (!declared.size && (pwlAvailable || has('pwl', 'triangle', 'function_asset')))) keys.push('pwl');
  const convergenceAvailable = anyData(result, ['nlp_convergence', 'convergence_diagnostics', 'solver_diagnostics']);
  if ((declares('nlp_convergence') && convergenceAvailable) || (!declared.size && (convergenceAvailable || has('nlp', 'convergence', 'termination', 'local_optimum')))) keys.push('convergence');
  const explanationAvailable = meaningful(result.business_explanation) || meaningful(result.explanation) || meaningful(result.suggestion);
  if ((declares('business_explanation') && explanationAvailable) || (!declared.size && explanationAvailable)) keys.push('advice');
  keys.push('raw'); return [...new Set(keys)];
}

export function ResultCenterPage() {
  const [id, setId] = useState<string>();
  useEffect(() => { const task = new URLSearchParams(window.location.search).get('task'); if (task) setId(task); }, []);
  const list = useQuery({ queryKey: ['results'], queryFn: getResults });
  const detail = useQuery({ queryKey: ['result', id], queryFn: () => getResult(id!), enabled: !!id });
  const detailModelId = String(detail.data?.model_id || '');
  const detailModel = useQuery({ queryKey: ['model', detailModelId], queryFn: () => getModel(detailModelId), enabled: !!detailModelId });
  const labelMap = buildResultLabelMap(detailModel.data);
  const rows = list.data || [];
  const coveredModels = new Set(rows.map(result => String(result.model || result.model_id || '')).filter(Boolean)).size;
  const latestFinishedAt = rows
    .map(result => String(result.finished_at || ''))
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0];
  const latestFinishedText = latestFinishedAt
    ? new Date(latestFinishedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '-';
  const tabKeys = resultTabKeys(detail.data);
  const tabCandidates = {
    overview: { key: 'overview', label: '结果概览', children: <div className="panel"><ResultMetricsPanel result={detail.data} labelMap={labelMap} /></div> },
    curves: { key: 'curves', label: '变量曲线', children: <div className="panel"><ResultChartPanel result={detail.data} labelMap={labelMap} /></div> },
    reservoir: { key: 'reservoir', label: '水库过程', children: <div className="panel"><ResultCascadeHydroPanel result={detail.data} /></div> },
    dispatch: { key: 'dispatch', label: '出力与负荷', children: <div className="panel"><ResultVariablesPanel result={detail.data} labelMap={labelMap} /></div> },
    pwl: { key: 'pwl', label: 'PWL 诊断', children: <div className="panel"><ResultConstraintsPanel result={detail.data} /></div> },
    convergence: { key: 'convergence', label: '收敛诊断', children: <div className="panel"><ResultNlpPanel result={detail.data} /></div> },
    advice: { key: 'advice', label: '业务建议', children: <div className="panel"><ResultExplanationPanel result={detail.data} /></div> },
    raw: { key: 'raw', label: '原始结果', children: <div className="panel"><JsonViewer value={detail.data} /></div> },
  } as const;

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
              { title: 'Gap', render: (_: unknown, result: SolveResult) => String(result.gap ?? result.metrics?.gap ?? result.summary?.gap ?? '-') },
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
        <Tabs className="section-gap" items={tabKeys.map(key => tabCandidates[key as keyof typeof tabCandidates])} />
      </Drawer>
    </>
  );
}
