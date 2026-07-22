import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';
import { FormulaEditor } from '../../features/formula-editor/FormulaEditor';
import { formulaCompletionOptions } from '../../features/formula-editor/FormulaCodeEditor';

const { analyzeFormulaMock } = vi.hoisted(() => ({ analyzeFormulaMock: vi.fn() }));
vi.mock('../../api/formulas', () => ({ analyzeFormula: analyzeFormulaMock, expandFormula: analyzeFormulaMock }));

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

async function setFormula(value: string) {
  const editor = screen.getByLabelText('公式表达式');
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error('CodeMirror editor view not found');
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
}

const compiledResult = (expression: string) => ({
  success: true, ast_version: '1.0', compiler_version: '2.0.0', normalized_expression: expression, expression_class: 'linear', diagnostics: [], references: [],
  scope: [{ alias: 'time', set: 'time' }], participation: 'solve_active',
  compiled_fragment: { type: 'constraint', constraints: [{ source_formula_id: 'test-id', split_sequence: 1, sense: '>=', scope: [{ alias: 'time', set: 'time' }], terms: [{ var: 'p_grid', key: ['time'], coef: 1 }], rhs: 0 }] },
  estimated_expansion: { constraint_count: 1, term_count: 1, exact: true }, status: 'compile_valid',
  checks: { syntax: 'passed', symbol_dimension_unit: 'passed', classification: 'linear', compile: 'passed' },
});

test('solve_active formula cannot be applied until authoritative compilation succeeds', async () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  const expression = 'sum(unit_output[u,t] for u in unit) >= load_forecast[t]';
  await setFormula(expression);
  expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled();
  analyzeFormulaMock.mockResolvedValueOnce(compiledResult(expression));
  fireEvent.click(screen.getByRole('button', { name: '后端编译与展开' }));
  await screen.findByText(/后端权威编译通过/);
  await waitFor(() => expect(screen.getByRole('button', { name: '应用公式' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '应用公式' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    dsl_formula: expression,
    compile_status: 'compile_valid',
    authoritative_artifact: expect.objectContaining({ compiler_version: '2.0.0' }),
  }));
});

test('inserts variable at cursor and applies', async () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  fireEvent.click(screen.getByRole('tab', { name: '变量' }));
  fireEvent.click(screen.getByRole('button', { name: /上网功率/ }));
  const expression = 'p_grid[time] >= load[time]';
  await setFormula(expression);
  analyzeFormulaMock.mockResolvedValueOnce(compiledResult(expression));
  fireEvent.click(screen.getByRole('button', { name: '后端编译与展开' }));
  await screen.findByText(/后端权威编译通过/);
  await waitFor(() => expect(screen.getByRole('button', { name: '应用公式' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '应用公式' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ referenced_variables: expect.arrayContaining(['p_grid']) }));
});

test('empty formula cannot be applied', () => {
  const onChange = vi.fn();
  render(<FormulaEditor onChange={onChange} symbols={symbols} />);
  expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled();
  expect(screen.getByText('表达式不能为空')).toBeInTheDocument();
});

test('uses the professional code editor and supports focus mode', () => {
  render(<FormulaEditor symbols={symbols} />);
  expect(screen.getByTestId('formula-code-editor')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全屏聚焦' }));
  expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument();
  expect(screen.getByText(/Ctrl\+Space 补全/)).toBeInTheDocument();
});

test('destroys the CodeMirror view exactly once when the editor unmounts', () => {
  const destroySpy = vi.spyOn(EditorView.prototype, 'destroy');
  try {
    const { unmount } = render(<FormulaEditor symbols={symbols} />);
    expect(EditorView.findFromDOM(screen.getByLabelText('公式表达式'))).not.toBeNull();
    unmount();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  } finally {
    destroySpy.mockRestore();
  }
});

test('completion dictionary includes model symbols and safe DSL functions', () => {
  const options = formulaCompletionOptions(symbols);
  expect(options).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'p_grid', apply: 'p_grid[time]' }),
    expect.objectContaining({ label: 'load', apply: 'load[time]' }),
    expect.objectContaining({ label: 'sum' }),
  ]));
});

test('protects unsaved edits with three explicit exit choices', async () => {
  render(<FormulaEditor symbols={symbols} />);
  await setFormula('p_grid[time] >= load[time]');
  fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  expect(screen.getByText('存在未保存的公式修改')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存并退出' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '放弃修改' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '继续编辑' })).toBeInTheDocument();
});

test('undefined variable has clear error', async () => {
  render(<FormulaEditor symbols={symbols} />);
  await setFormula('unknown_var[t] >= load_forecast[t]');
  expect(screen.getByText('引用变量不存在：unknown_var')).toBeInTheDocument();
});

test('objective cannot contain relation operator', async () => {
  render(<FormulaEditor symbols={symbols} />);
  fireEvent.click(screen.getByRole('radio', { name: '目标函数' }));
  await setFormula('p_grid[time] >= load[time]');
  expect(screen.getByText('目标函数不能包含关系符')).toBeInTheDocument();
});

test('constraint requires relation operator', async () => {
  render(<FormulaEditor symbols={symbols} />);
  await setFormula('p_grid[time] + load[time]');
  expect(screen.getByText('约束表达式必须包含 >=、<=、== 或 !=')).toBeInTheDocument();
});

test('shows four-stage authoritative backend compile result', async () => {
  analyzeFormulaMock.mockResolvedValueOnce({
    success: true,
    ast_version: '1.0',
    compiler_version: '2.0.0',
    normalized_expression: 'p_grid[time] >= load[time]',
    expression_class: 'linear',
    diagnostics: [{ code: 'FORMULA_TRACE', severity: 'info', stage: 'compile', message: '定位到公式源片段', start: 0, end: 6 }],
    references: [],
    scope: [{ alias: 'time', set: 'time' }],
    participation: 'solve_active',
    compiled_fragment: { type: 'constraint', constraints: [{ source_formula_id: 'test-id', split_sequence: 1, sense: '>=', terms: [{ var: 'p_grid', key: ['time'], coef: 1 }], rhs: 0 }] },
    estimated_expansion: { constraint_count: 1, term_count: 1, exact: false },
    status: 'compile_valid',
    checks: { syntax: 'passed', symbol_dimension_unit: 'passed', classification: 'linear', compile: 'passed' },
  });
  render(<FormulaEditor symbols={symbols} />);
  await setFormula('p_grid[time] >= load[time]');
  fireEvent.click(screen.getByRole('button', { name: '后端编译与展开' }));
  await waitFor(() => expect(screen.getByText('后端权威编译通过，可参与求解')).toBeInTheDocument());
  expect(screen.getByText(/语法：passed；符号\/维度\/单位：passed；类型：linear；编译：passed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '定位到公式源片段' }));
  const view = EditorView.findFromDOM(screen.getByLabelText('公式表达式'))!;
  expect(view.state.selection.main.from).toBe(0);
  expect(view.state.selection.main.to).toBe(6);
});

test('editing a compiled formula immediately invalidates the authoritative artifact', async () => {
  const expression = 'p_grid[time] >= load[time]';
  analyzeFormulaMock.mockResolvedValueOnce(compiledResult(expression));
  render(<FormulaEditor symbols={symbols} />);
  await setFormula(expression);
  fireEvent.click(screen.getByRole('button', { name: '后端编译与展开' }));
  await screen.findByText(/后端权威编译通过/);
  await waitFor(() => expect(screen.getByRole('button', { name: '应用公式' })).toBeEnabled());
  await setFormula('p_grid[time] >= 2 * load[time]');
  expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled();
  expect(screen.getByText('请先执行权威编译')).toBeInTheDocument();
});
