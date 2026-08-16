import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ParameterEditor, parameterEditorKind } from '../../features/task-create/components/ParameterEditor';
import type { RuntimeField } from '../../features/time-dimension';

const makeField = (dimension: string[], type = 'number', values: Record<string, string[]> = {}): RuntimeField => ({ code: 'input', name: '运行数据', required: true, dimension, type, dimensionValues: values, defaultValue: 5 });

test('time sequence uses semantic labels and editable cells', () => {
  const change = vi.fn();
  render(<ParameterEditor field={makeField(['time'])} value={[1, 2]} expectedLength={2} timeSet="time" intervalMinutes={60} labelFormat="HH:mm" onChange={change} />);
  expect(screen.getByText('00:00')).toBeInTheDocument(); expect(screen.getByText('01:00')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('运行数据 01:00'), { target: { value: '9' } });
  expect(change).toHaveBeenCalled();
});

test('state sequence labels initial and post-period states', () => {
  render(<ParameterEditor field={makeField(['time_volume'])} value={[1, 2, 3]} expectedLength={3} stateTimeSet="time_volume" onChange={vi.fn()} />);
  expect(screen.getByText('初始状态')).toBeInTheDocument(); expect(screen.getByText('时段 2 后')).toBeInTheDocument();
});

test('one-dimensional object uses key-value editor with collection keys', () => {
  const field = makeField(['unit'], 'object', { unit: ['U1', 'U2'] }); const change = vi.fn();
  expect(parameterEditorKind(field)).toBe('keyvalue');
  render(<ParameterEditor field={field} value={{ U1: 100 }} onChange={change} />);
  expect(screen.getByDisplayValue('U1')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: /新.*增/ }));
  expect(change).toHaveBeenLastCalledWith({ U1: 100, U2: 0 });
});

test('infers key-value editor from object values and renders declared empty rows', () => {
  const field = { ...makeField(['unit'], '', { unit: ['U1', 'U2'] }), defaultValue: undefined, exampleValue: undefined };
  expect(parameterEditorKind(field, { U1: 100 })).toBe('keyvalue');
  const change = vi.fn();
  render(<ParameterEditor field={field} value={{ U1: 100 }} onChange={change} />);
  expect(screen.getByDisplayValue('U1')).toBeInTheDocument();
  expect(screen.getByDisplayValue('U2')).toBeInTheDocument();
  expect(screen.getByDisplayValue('100')).toBeInTheDocument();
});

test('matrix respects declared row and column dimension order', () => {
  render(<ParameterEditor field={makeField(['station', 'time'], 'number', { station: ['S1'], time: ['00:00', '01:00'] })} value={[[1, 2]]} timeSet="time" onChange={vi.fn()} />);
  expect(screen.getAllByText('S1').length).toBeGreaterThan(0); expect(screen.getAllByText('00:00').length).toBeGreaterThan(0); expect(screen.getAllByText('01:00').length).toBeGreaterThan(0);
  expect(screen.getByText('行：station')).toBeInTheDocument(); expect(screen.getByText('列：time')).toBeInTheDocument();
});

test('inline matrix headers stay in normal flow while the task drawer scrolls', () => {
  render(<ParameterEditor field={makeField(['station', 'time'], 'number', { station: ['S1'], time: ['00:00', '01:00'] })} value={[[1, 2]]} timeSet="time" onChange={vi.fn()} />);
  expect(document.querySelector('.parameter-matrix-table .ant-table-sticky-holder')).not.toBeInTheDocument();
});

test('mapped matrices retain values and extend the time axis for the selected horizon', () => {
  const change = vi.fn();
  const field = makeField(['unit', 'time'], 'dict', { unit: ['U1', 'U2'], time: ['0', '1', '2', '3'] });
  render(<ParameterEditor field={field} value={{ U1: [1, 0, 1, 1], U2: [1, 1, 1, 1] }} expectedLength={8} timeSet="time" onChange={change} />);
  expect(screen.getByLabelText('运行数据 U1 0')).toHaveValue('1');
  expect(screen.getByLabelText('运行数据 U1 7')).toBeInTheDocument();
  expect(screen.getByText('当前 time 维度为 4，应为 8；新增时段已显示，请补充相应数值。')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('运行数据 U1 7'), { target: { value: '1' } });
  expect(change).toHaveBeenLastCalledWith({ U1: [1, 0, 1, 1, '', '', '', 1], U2: [1, 1, 1, 1, '', '', '', ''] });
});

test('matrix display removes stale declared time columns after the horizon is shortened', () => {
  const field = makeField(['unit', 'time'], 'dict', { unit: ['U1', 'U2'], time: ['0', '1', '2', '3'] });
  render(<ParameterEditor field={field} value={{ U1: [1, 0, 1], U2: [1, 1, 1] }} expectedLength={3} timeSet="time" onChange={vi.fn()} />);
  expect(screen.getByLabelText('运行数据 U1 2')).toHaveValue('1');
  expect(screen.queryByLabelText('运行数据 U1 3')).not.toBeInTheDocument();
});
