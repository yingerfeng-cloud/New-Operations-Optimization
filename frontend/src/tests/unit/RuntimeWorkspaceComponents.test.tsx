import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ParameterBatchPasteModal } from '../../features/task-create/components/ParameterBatchPasteModal';
import { FullscreenMatrixEditor } from '../../features/task-create/components/FullscreenMatrixEditor';
import { RuntimeValidationDrawer } from '../../features/task-create/components/RuntimeValidationDrawer';

test('batch paste only imports valid matrix data', () => {
  const onImport = vi.fn();
  render(<ParameterBatchPasteModal open title="矩阵" mode="matrix" expectedRows={2} expectedColumns={2} onCancel={vi.fn()} onImport={onImport} />);
  fireEvent.change(screen.getByLabelText('矩阵批量输入'), { target: { value: '1\t2\n3\t4' } });
  fireEvent.click(screen.getByText('确认导入'));
  expect(onImport).toHaveBeenCalledWith([[1, 2], [3, 4]]);
});

test('fullscreen matrix saves edits and cancel does not save', () => {
  const onSave = vi.fn(); const onCancel = vi.fn();
  render(<FullscreenMatrixEditor open field={{ code: 'm', name: '矩阵', required: true, dimension: ['plant', 'time'] }} value={[[1, 2], [3, 4]]} rowLabels={['P1', 'P2']} columnLabels={['T1', 'T2']} onCancel={onCancel} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('矩阵 P1 T1'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('保存并返回'));
  expect(onSave).toHaveBeenCalled();
});

test('validation drawer navigates to the exact issue', () => {
  const onNavigate = vi.fn(); const issue = { code: 'load', name: '负荷', groupKey: 'forecast', groupLabel: '预测数据', message: '必填值为空', fixHint: '补充数据' };
  render(<RuntimeValidationDrawer open issues={[issue]} onClose={vi.fn()} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByText('前往处理'));
  expect(onNavigate).toHaveBeenCalledWith(issue);
});
