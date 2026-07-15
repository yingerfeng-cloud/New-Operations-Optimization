import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { getArrayDepth, ParameterEditor, parameterEditorKind } from '../../features/task-create/components/ParameterEditor';
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
  [[[1, 2]], 2],
  [[[[1]]], 3],
  [[[[[1]]]], 4],
])('detects array depth %#', (value, depth) => expect(getArrayDepth(value)).toBe(depth));

test('three-dimensional editor blocks insufficient nesting but accepts object-mapped structures', () => {
  const validity = vi.fn();
  const { unmount } = render(<ParameterEditor field={field(['station', 'unit', 'time'])} value={[[[1]]]} onChange={vi.fn()} onValidityChange={validity} />);
  fireEvent.change(screen.getByLabelText('机组出力高级结构化编辑'), { target: { value: '[1,2,3]' } });
  expect(validity).toHaveBeenLastCalledWith(expect.stringContaining('嵌套深度为 1，预期为 3'));
  unmount();
  const objectField = field(['station', 'unit', 'time'], 'object');
  const objectChange = vi.fn();
  render(<ParameterEditor field={objectField} value={{ S1: { U1: [1] } }} onChange={objectChange} onValidityChange={validity} />);
  fireEvent.change(screen.getByLabelText('机组出力高级结构化编辑'), { target: { value: '{"S1":{"U1":[2]}}' } });
  expect(objectChange).toHaveBeenLastCalledWith({ S1: { U1: [2] } });
});

test('structured editor syncs external values while preserving uncommitted invalid text', () => {
  const onChange = vi.fn();
  const structured = field(['station', 'unit', 'time']);
  const view = render(<ParameterEditor field={structured} value={[[[1]]]} onChange={onChange} />);
  const editor = screen.getByLabelText('机组出力高级结构化编辑');
  fireEvent.change(editor, { target: { value: '[[invalid]]' } });
  view.rerender(<ParameterEditor field={structured} value={[[[1]]]} onChange={onChange} />);
  expect(editor).toHaveValue('[[invalid]]');
  view.rerender(<ParameterEditor field={structured} value={[[[2]]]} onChange={onChange} />);
  expect(editor).toHaveValue(JSON.stringify([[[2]]], null, 2));
  fireEvent.change(editor, { target: { value: '[[invalid-again]]' } });
  view.rerender(<ParameterEditor field={{ ...structured }} value={[[[2]]]} onChange={onChange} />);
  expect(editor).toHaveValue(JSON.stringify([[[2]]], null, 2));
  fireEvent.change(editor, { target: { value: '[[[3]]]' } });
  expect(onChange).toHaveBeenLastCalledWith([[[3]]]);
});

test.each([
  [undefined, true], [null, true], ['', true], [[], true], [[[]], true], [{}, true], [{ a: '' }, true],
  [0, false], [false, false], [[0], false], [{ a: false }, false],
])('complex required emptiness %#', (value, empty) => expect(isRuntimeValueEmpty(value)).toBe(empty));
