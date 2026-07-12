import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ParameterEditor, parameterEditorKind } from '../../features/task-create/components/ParameterEditor';
import { isRuntimeValueEmpty, type RuntimeField } from '../../features/time-dimension';

const field = (dimension: string[], type = ''): RuntimeField => ({ code: 'unit_output', name: '机组出力', required: true, dimension, type });

test('selects editors strictly by dimension count', () => {
  expect(parameterEditorKind(field(['time']))).toBe('sequence');
  expect(parameterEditorKind(field(['station', 'time']))).toBe('matrix');
  expect(parameterEditorKind(field(['station', 'unit', 'time']))).toBe('structured');
});

test('three-dimensional JSON preserves nested structure and reports invalid JSON', () => {
  const onChange = vi.fn();
  const onValidityChange = vi.fn();
  render(<ParameterEditor field={field(['station', 'unit', 'time'])} value={[[[1, 2]]]} onChange={onChange} onValidityChange={onValidityChange} />);
  const editor = screen.getByLabelText('机组出力高级结构化编辑');
  fireEvent.change(editor, { target: { value: '[[[3,4],[5,6]]]' } });
  expect(onChange).toHaveBeenLastCalledWith([[[3, 4], [5, 6]]]);
  fireEvent.change(editor, { target: { value: '[[invalid]]' } });
  expect(onValidityChange).toHaveBeenLastCalledWith('请输入有效 JSON');
});

test.each([
  [undefined, true], [null, true], ['', true], [[], true], [[[]], true], [{}, true], [{ a: '' }, true],
  [0, false], [false, false], [[0], false], [{ a: false }, false],
])('complex required emptiness %#', (value, empty) => expect(isRuntimeValueEmpty(value)).toBe(empty));
