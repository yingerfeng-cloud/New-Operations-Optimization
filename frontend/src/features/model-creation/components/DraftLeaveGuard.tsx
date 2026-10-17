import { Alert, Button, Modal, Space } from 'antd';
import { useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useModelCreationStore } from '../stores/modelCreationStore';

export function DraftLeaveDialog({ open, onContinue, onLeave, onDiscard, onSave }: {
  open: boolean; onContinue: () => void; onLeave: () => void; onDiscard: () => void; onSave: () => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveAndLeave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave();
      if (useModelCreationStore.getState().workspace.dirty) throw new Error('保存期间有新的修改，请再次保存或继续编辑。');
      onLeave();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '草稿保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };
  return <Modal open={open} title="当前草稿尚未保存" closable={!saving} maskClosable={false} onCancel={onContinue} footer={
    <Space wrap>
      <Button disabled={saving} onClick={onContinue}>继续编辑</Button>
      <Button danger disabled={saving} onClick={onDiscard}>放弃并离开</Button>
      <Button type="primary" loading={saving} onClick={saveAndLeave}>保存并离开</Button>
    </Space>
  }>
    <p>离开前可以保存当前草稿，或明确放弃本次修改。</p>
    {error && <Alert type="error" showIcon title="保存失败" description={error} />}
  </Modal>;
}

export function DraftLeaveGuard({ onSave }: { onSave: () => Promise<unknown> }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const { workspace } = useModelCreationStore.getState();
    return workspace.initialized && workspace.dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
  });
  if (blocker.state !== 'blocked') return null;
  return <DraftLeaveDialog open onSave={onSave} onContinue={() => blocker.reset()} onLeave={() => blocker.proceed()} onDiscard={() => {
    useModelCreationStore.getState().reset();
    blocker.proceed();
  }} />;
}
