import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { FormulaEditor } from '../../features/formula-editor/FormulaEditor';

const symbols = {
  variables: {
    unit_output: { label: '机组出力', indices: ['u', 't'] },
    p_grid: { label: '上网功率', indices: ['time'] },
  },
  parameters: {
    load_forecast: { label: '负荷预测', indices: ['t'] },
    load: { label: '负荷', indices: ['time'] },
  },
  sets: { unit: '机组', time: '时段' },
};

test('direct formula input can be applied', () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  fireEvent.change(screen.getByLabelText('公式表达式'), { target: { value: 'sum(unit_output[u,t] for u in unit) >= load_forecast[t]' } });
  fireEvent.click(screen.getByRole('button', { name: '应用公式' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    dsl_formula: 'sum(unit_output[u,t] for u in unit) >= load_forecast[t]',
    compile_status: 'ready',
  }));
});

test('inserts variable at cursor and applies', () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  fireEvent.click(screen.getByRole('tab', { name: '变量' }));
  fireEvent.click(screen.getByRole('button', { name: /上网功率/ }));
  fireEvent.change(screen.getByLabelText('公式表达式'), { target: { value: 'p_grid[time] >= load[time]' } });
  fireEvent.click(screen.getByRole('button', { name: '应用公式' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ referenced_variables: expect.arrayContaining(['p_grid']) }));
});

test('empty formula cannot be applied', () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled();
  expect(screen.getByText('表达式不能为空')).toBeInTheDocument();
});

test('undefined variable has clear error', () => {
  render(<FormulaEditor symbols={symbols} />);
  fireEvent.change(screen.getByLabelText('公式表达式'), { target: { value: 'unknown_var[t] >= load_forecast[t]' } });
  expect(screen.getByText('引用变量不存在：unknown_var')).toBeInTheDocument();
});

test('objective cannot contain relation operator', () => {
  render(<FormulaEditor symbols={symbols} />);
  fireEvent.click(screen.getByRole('radio', { name: '目标函数' }));
  fireEvent.change(screen.getByLabelText('公式表达式'), { target: { value: 'p_grid[time] >= load[time]' } });
  expect(screen.getByText('目标函数不能包含关系符')).toBeInTheDocument();
});

test('constraint requires relation operator', () => {
  render(<FormulaEditor symbols={symbols} />);
  fireEvent.change(screen.getByLabelText('公式表达式'), { target: { value: 'p_grid[time] + load[time]' } });
  expect(screen.getByText('约束表达式必须包含 >=、<=、== 或 !=')).toBeInTheDocument();
});
