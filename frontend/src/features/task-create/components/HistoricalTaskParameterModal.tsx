import { Alert, Descriptions, Modal, Radio, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getTask, getTasks } from '../../../api/tasks';
import type { SolveTask } from '../../../types/task';
import { extractHistoricalParameters, isCompatibleHistoricalTask, type HistoryApplyMode } from '../utils/runtimeParameterHistory';

export function HistoricalTaskParameterModal({ open, modelId, modelFamily, currentHorizon, onCancel, onApply }: {
  open: boolean; modelId: string; modelFamily?: string; currentHorizon?: number; onCancel: () => void; onApply: (task: SolveTask, parameters: Record<string, unknown>, mode: HistoryApplyMode) => void;
}) {
  const [selectedId, setSelectedId] = useState(''); const [mode, setMode] = useState<HistoryApplyMode>('fill-empty');
  useEffect(() => { if (!open) { setSelectedId(''); setMode('fill-empty'); } }, [open]);
  const tasks = useQuery({ queryKey: ['historical-runtime-tasks', modelId], queryFn: getTasks, enabled: open && !!modelId });
  const detail = useQuery({ queryKey: ['historical-runtime-task', selectedId], queryFn: () => getTask(selectedId), enabled: open && !!selectedId });
  const rows = useMemo(() => (tasks.data || []).filter(task => isCompatibleHistoricalTask(task, modelId, modelFamily)), [modelFamily, modelId, tasks.data]);
  const selected = detail.data;
  const historicalHorizon = Number(selected?.horizon || selected?.trace && (selected.trace as Record<string, unknown>).horizon || 0) || undefined;
  const incompatible = Boolean(currentHorizon && historicalHorizon && currentHorizon !== historicalHorizon);
  return <Modal width={760} title="从历史任务载入运行参数" open={open} onCancel={onCancel} okText="确认载入" cancelText="取消" okButtonProps={{ disabled: !selected || incompatible }} onOk={() => selected && onApply(selected, extractHistoricalParameters(selected), mode)}>
    <Table size="small" loading={tasks.isPending} rowKey="id" rowSelection={{ type: 'radio', selectedRowKeys: selectedId ? [selectedId] : [], onChange: keys => setSelectedId(String(keys[0] || '')) }} pagination={{ pageSize: 6 }} dataSource={rows} columns={[{ title: '任务', dataIndex: 'id', width: 150 }, { title: '完成时间', dataIndex: 'finished_at', render: value => value || '—' }, { title: 'horizon', dataIndex: 'horizon', render: value => value || '—' }, { title: '求解器', dataIndex: 'solver' }, { title: '数据来源', render: () => '历史任务' }]} />
    <Radio.Group className="section-gap-tight" value={mode} onChange={event => setMode(event.target.value)} options={[{ label: '仅填充当前空值', value: 'fill-empty' }, { label: '覆盖当前参数', value: 'overwrite' }]} />
    {selected && <Descriptions className="section-gap-tight" size="small" bordered column={2} items={[{ key: 'time', label: '任务时间', children: selected.finished_at || selected.created_at }, { key: 'solver', label: '求解器', children: selected.solver || '—' }, { key: 'horizon', label: '历史 horizon', children: historicalHorizon || '—' }, { key: 'count', label: '可读取参数', children: Object.keys(extractHistoricalParameters(selected)).length }]} />}
    {incompatible && <Alert className="section-gap-tight" type="error" showIcon title="horizon 不兼容" description={`当前为 ${currentHorizon} 点，历史任务为 ${historicalHorizon} 点；请重新选择兼容任务。`} />}
    {!rows.length && !tasks.isPending && <Alert type="info" showIcon title="没有可复用的同模型成功任务" />}
  </Modal>;
}
