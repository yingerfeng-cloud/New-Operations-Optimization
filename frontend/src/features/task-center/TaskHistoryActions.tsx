import { Alert, Button, Modal, Space, message } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { replayTask, recalculateTask } from '../../api/taskHistory';
import { getFunctionUpdates } from '../../api/functionUpdates';
import type { SolveTask } from '../../types/task';

export function TaskHistoryActions({ task, onCreated }: { task: SolveTask; onCreated: (task: SolveTask) => void }) {
  const [modal, holder] = Modal.useModal();
  const replay = useMutation({ mutationFn: () => replayTask(task.id), onSuccess: onCreated });
  const original = useMutation({ mutationFn: () => replayTask(task.id, 'original_environment'), onSuccess: onCreated });
  const latest = useMutation({ mutationFn: async () => {
    const id = task.resolved_model_id || task.model_id;
    if (!id) throw new Error('历史任务没有具体模型版本，请先选择模型。');
    const updates = await getFunctionUpdates(id);
    const revisions = Object.fromEntries(updates.dependencies.map(row => [row.function_id, row.latest_revision]));
    if (!Object.keys(revisions).length) { message.info('此任务没有函数依赖，可使用历史重放。'); return; }
    let key: string;
    const storageKey = `optiforge-recalculate:${task.id}:${JSON.stringify(revisions)}`;
    try { key = localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, key); } catch { key = crypto.randomUUID(); }
    modal.confirm({ title: '采用以下函数修订创建新任务？', content: <div><p>{JSON.stringify(revisions)}</p><p>保留历史任务和原正式模型。兼容检查和测试通过后，候选模型可在模型页应用。</p></div>,
      okText: '重新计算', onOk: async () => { const created = await recalculateTask(task.id, revisions, key); onCreated(created); } });
  } });
  return <Space>{holder}<Button loading={replay.isPending} onClick={() => replay.mutate()}>当前内核按历史输入重算</Button><Button loading={original.isPending} onClick={() => original.mutate()}>原环境历史重放</Button>{original.isError && <Alert type="warning" title="原环境未提供恢复能力，请使用当前内核重算；这不能作为严格历史复现。" />}<Button loading={latest.isPending} onClick={() => latest.mutate()}>按最新函数重新计算</Button></Space>;
}
