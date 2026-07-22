import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FocusEditor } from '../../features/model-creation/components/FocusEditor';

function renderEditor(overrides: Partial<React.ComponentProps<typeof FocusEditor>> = {}) {
  const props: React.ComponentProps<typeof FocusEditor> = {
    open: true,
    modelName: '调度模型',
    objectName: '模型语义',
    dirty: true,
    onClose: vi.fn(),
    onDiscard: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onValidate: vi.fn(),
    children: <input aria-label="语义字段" />,
    ...overrides,
  };
  render(<FocusEditor {...props} />);
  return props;
}

describe('FocusEditor exit lifecycle', () => {
  test('clean close exits directly', () => {
    const props = renderEditor({ dirty: false });
    fireEvent.click(screen.getByRole('button', { name: '退出聚焦' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  test('dirty close offers continue and discard', () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '退出聚焦' }));
    expect(screen.getByText('当前聚焦会话中仍有未保存修改。请选择保存、放弃或继续编辑。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '退出聚焦' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  test('save and exit waits for a successful save', async () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '退出聚焦' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并退出' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  test('save failure keeps editor and confirmation open', async () => {
    const props = renderEditor({ onSave: vi.fn().mockRejectedValue(new Error('网络保存失败')) });
    fireEvent.click(screen.getByRole('button', { name: '退出聚焦' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并退出' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '继续编辑' })).toBeInTheDocument();
  });

  test('Escape follows the protected dirty-close flow', async () => {
    const props = renderEditor();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存并退出' })).toBeVisible());
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
