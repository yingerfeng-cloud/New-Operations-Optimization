import { Button, Modal, Space, message } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';

export function FocusEditor({
  open,
  modelName,
  objectName,
  dirty,
  children,
  onClose,
  onDiscard,
  onSave,
  onValidate,
}: {
  open: boolean;
  modelName: string;
  objectName: string;
  dirty: boolean;
  children: ReactNode;
  onClose: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void> | void;
  onValidate: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setConfirmOpen(false);
  }, [open]);

  const requestClose = () => {
    if (dirty) setConfirmOpen(true);
    else onClose();
  };
  const save = async (exitAfterSave: boolean) => {
    setSaving(true);
    try {
      await onSave();
      if (exitAfterSave) {
        setConfirmOpen(false);
        onClose();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '草稿保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        className="focus-editor-modal"
        title={<div><strong>{modelName || '未命名模型'}</strong><span>{objectName}</span></div>}
        open={open}
        width="calc(100vw - 32px)"
        style={{ top: 16 }}
        onCancel={requestClose}
        mask={{ closable: true }}
        keyboard
        footer={<Space wrap><Button onClick={onValidate}>校验</Button><Button loading={saving} onClick={() => void save(false)}>保存草稿</Button><Button type="primary" onClick={requestClose}>退出聚焦</Button></Space>}
      >
        <div className="focus-editor-body">{children}</div>
      </Modal>
      <Modal
        className="focus-editor-exit-confirm"
        title="退出聚焦编辑？"
        open={confirmOpen}
        closable={false}
        mask={{ closable: false }}
        keyboard={false}
        footer={(
          <Space wrap>
            <Button onClick={() => setConfirmOpen(false)}>继续编辑</Button>
            <Button danger onClick={() => { setConfirmOpen(false); onDiscard(); }}>放弃修改</Button>
            <Button type="primary" loading={saving} onClick={() => void save(true)}>保存并退出</Button>
          </Space>
        )}
      >
        当前聚焦会话中仍有未保存修改。请选择保存、放弃或继续编辑。
      </Modal>
    </>
  );
}
