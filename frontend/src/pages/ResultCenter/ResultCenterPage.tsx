import { Button, Card, Drawer, Space, Tabs } from 'antd';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResult, getResults } from '../../api/results';
import { DataTable } from '../../components/DataTable';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
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
import type { SolveResult } from '../../types/result';

export function ResultCenterPage() {
  const [id, setId] = useState<string>();
  useEffect(() => { const task = new URLSearchParams(window.location.search).get('task'); if (task) setId(task); }, []);
  const list = useQuery({ queryKey: ['results'], queryFn: getResults });
  const detail = useQuery({ queryKey: ['result', id], queryFn: () => getResult(id!), enabled: !!id });
  const rows = list.data || [];
  const success = rows.filter(result => String(result.status).toUpperCase() === 'SUCCESS').length;
  const objectiveValues = rows.map(result => Number(result.objective_value)).filter(Number.isFinite);
  const bestObjective = objectiveValues.length ? Math.min(...objectiveValues) : undefined;
  const failed = rows.filter(result => ['FAILED', 'INFEASIBLE', 'TIMEOUT', 'CANCELLED'].includes(String(result.status).toUpperCase())).length;

  return (
    <>
      <PageHeader title="结果报告库" description="查看求解结果、关键指标、变量曲线、业务解释和 JSON 结果。导出报告（预留）位于结果详情高级操作，不作为主流程按钮开放。" />
      <MetricGrid>
        <MetricCard title="结果总数" value={rows.length} description="任务结果归档" tone="blue" />
        <MetricCard title="成功结果" value={success} description="可生成报告" tone="green" />
        <MetricCard title="最优目标值" value={bestObjective ?? '-'} description="归档结果对比" tone="amber" />
        <MetricCard title="异常结果" value={failed} description={failed ? '需要查看日志' : '暂无异常'} tone={failed ? 'red' : 'neutral'} />
      </MetricGrid>
      <Card className="content-card section-gap" title="结果列表">
        {rows.length ? (
          <DataTable<SolveResult>
            dataSource={rows}
            loading={list.isLoading}
            columns={[
              { title: '结果/任务编号', render: (_: unknown, result: SolveResult) => result.task_id || result.job_id || result.id },
              { title: '状态', dataIndex: 'status', render: (status: string) => <StatusTag status={status} /> },
              { title: '目标值', dataIndex: 'objective_value' },
              { title: '总成本', render: (_: unknown, result: SolveResult) => String(result.metrics?.total_cost ?? result.summary?.total_cost ?? '-') },
              { title: 'Gap', render: (_: unknown, result: SolveResult) => String(result.metrics?.gap ?? result.summary?.gap ?? '-') },
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
        <ResultKpiStrip result={detail.data} />
        <Tabs className="section-gap" items={[
          { key: 'summary', label: '结论摘要', children: <div className="panel"><ResultExplanationPanel result={detail.data} /></div> },
          { key: 'metrics', label: '关键指标', children: <div className="panel"><ResultMetricsPanel result={detail.data} /></div> },
          { key: 'chart', label: '变量曲线', children: <div className="panel"><ResultChartPanel result={detail.data} /></div> },
          { key: 'hydro', label: '水电结果解释', children: <div className="panel"><ResultCascadeHydroPanel result={detail.data} /></div> },
          { key: 'nlp', label: 'NLP 结果解释', children: <div className="panel"><ResultNlpPanel result={detail.data} /></div> },
          { key: 'variables', label: '变量表', children: <div className="panel"><ResultVariablesPanel result={detail.data} /></div> },
          { key: 'constraints', label: '约束检查', children: <div className="panel"><ResultConstraintsPanel result={detail.data} /></div> },
          { key: 'json', label: 'JSON 原始结果', children: <div className="panel"><JsonViewer value={detail.data} /></div> },
        ]} />
      </Drawer>
    </>
  );
}
