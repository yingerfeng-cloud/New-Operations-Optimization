import { Button, Card, Col, Drawer, Row, Space, Tabs } from 'antd';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResult, getResults } from '../../api/results';
import { DataTable } from '../../components/DataTable';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import {
  ResultChartPanel,
  ResultConstraintsPanel,
  ResultExplanationPanel,
  ResultKpiStrip,
  ResultMetricsPanel,
  ResultVariablesPanel,
} from '../../features/result-center/ResultPanels';
import type { SolveResult } from '../../types/result';

export function ResultCenterPage() {
  const [id, setId] = useState<string>();
  const list = useQuery({ queryKey: ['results'], queryFn: getResults });
  const detail = useQuery({ queryKey: ['result', id], queryFn: () => getResult(id!), enabled: !!id });
  const rows = list.data || [];
  const success = rows.filter(result => String(result.status).toUpperCase() === 'SUCCESS').length;
  const objectiveValues = rows.map(result => Number(result.objective_value)).filter(Number.isFinite);
  const bestObjective = objectiveValues.length ? Math.min(...objectiveValues) : undefined;
  return (
    <>
      <PageHeader title="结果报告库" description="查看求解结果、关键指标、变量曲线、业务解释和 JSON 结果。" extra={<Button disabled>导出报告（预留）</Button>} />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={6}><div className="card metric blue"><span>结果总数</span><b>{rows.length}</b><span>任务结果归档</span></div></Col>
        <Col xs={24} md={6}><div className="card metric green"><span>成功结果</span><b>{success}</b><span>可生成报告</span></div></Col>
        <Col xs={24} md={6}><div className="card metric amber"><span>最优目标值</span><b>{bestObjective ?? '-'}</b><span>归档结果对比</span></div></Col>
        <Col xs={24} md={6}><div className="card metric red"><span>导出</span><b>预留</b><span>后续接入报告导出</span></div></Col>
      </Row>
      <Card className="content-card section-gap" title="结果列表">
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
      </Card>
      <Drawer
        size="large"
        open={!!id}
        onClose={() => setId(undefined)}
        title={`结果报告 ${id || ''}`}
        footer={<Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={() => setId(undefined)}>关闭</Button><Button disabled>导出报告</Button></Space>}
      >
        <ResultKpiStrip result={detail.data} />
        <Tabs className="section-gap" items={[
          { key: 'chart', label: '图表展示', children: <div className="panel"><ResultChartPanel result={detail.data} /></div> },
          { key: 'variables', label: '变量结果表格', children: <div className="panel"><ResultVariablesPanel result={detail.data} /></div> },
          { key: 'constraints', label: '约束检查', children: <div className="panel"><ResultConstraintsPanel result={detail.data} /></div> },
          { key: 'metrics', label: '关键指标', children: <div className="panel"><ResultMetricsPanel result={detail.data} /></div> },
          { key: 'explain', label: '业务解释', children: <div className="panel"><ResultExplanationPanel result={detail.data} /></div> },
          { key: 'json', label: 'JSON 结果', children: <div className="panel"><JsonViewer value={detail.data} /></div> },
        ]} />
      </Drawer>
    </>
  );
}
