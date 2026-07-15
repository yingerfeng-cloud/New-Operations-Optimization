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

test('matrix respects declared row and column dimension order', () => {
  render(<ParameterEditor field={makeField(['station', 'time'], 'number', { station: ['S1'], time: ['00:00', '01:00'] })} value={[[1, 2]]} timeSet="time" onChange={vi.fn()} />);
  expect(screen.getAllByText('S1').length).toBeGreaterThan(0); expect(screen.getAllByText('00:00').length).toBeGreaterThan(0); expect(screen.getAllByText('01:00').length).toBeGreaterThan(0);
  expect(screen.getByText('行：station')).toBeInTheDocument(); expect(screen.getByText('列：time')).toBeInTheDocument();
});
