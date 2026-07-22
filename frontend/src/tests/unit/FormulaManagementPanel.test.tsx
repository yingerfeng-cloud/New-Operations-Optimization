import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { FormulaDef } from '../../types/formula';
import { FormulaManagementPanel } from '../../features/formula-editor/FormulaManagementPanel';

const { analyzeFormulaMock } = vi.hoisted(() => ({ analyzeFormulaMock: vi.fn() }));
vi.mock('../../api/formulas', () => ({ analyzeFormula: analyzeFormulaMock, expandFormula: analyzeFormulaMock }));

const row = (overrides: Partial<FormulaDef>): FormulaDef => ({
  formula_id: 'balance', name: '功率平衡', kind: 'constraint', solve_participation: 'solve_active',
  business_group: '平衡约束', display_formula: '', dsl_formula: 'power[t] >= load[t]', tokens: [],
  foreach: ['time'], scope: [{ alias: 't', set: 'time' }], referenced_sets: ['time'], referenced_parameters: ['load'],
  referenced_variables: ['power'], free_indices: ['t'], compile_status: 'draft', ...overrides,
});

const formulas = [row({}), row({ formula_id: 'reserve', name: '备用约束', business_group: '安全约束', dsl_formula: 'reserve[t] >= reserve_req[t]', referenced_variables: ['reserve'], referenced_parameters: ['reserve_req'] })];
const semantic = { sets: [{ code: 'time' }], parameters: [{ code: 'load' }, { code: 'reserve_req' }], variables: [{ code: 'power' }, { code: 'reserve' }] };
const symbols = { sets: { time: '时段' }, parameters: { load: { indices: ['time'] }, reserve_req: { indices: ['time'] } }, variables: { power: { indices: ['time'] }, reserve: { indices: ['time'] } } };

test('management panel filters, copies, toggles and batch compiles formulas', async () => {
  const onChange = vi.fn();
  analyzeFormulaMock.mockResolvedValue({
    success: true, ast_version: '1.0', compiler_version: '2.0.0', normalized_expression: '', expression_class: 'linear', diagnostics: [], references: [],
    scope: [{ alias: 't', set: 'time' }], participation: 'solve_active', estimated_expansion: { constraint_count: 1, term_count: 2, exact: false },
    compiled_fragment: { type: 'constraint', constraints: [{ source_formula_id: 'reserve', split_sequence: 1, sense: '>=', scope: [{ alias: 't', set: 'time' }], terms: [{ var: 'reserve', key: ['t'], coef: 1 }], rhs: 0 }] },
    status: 'compile_valid', checks: { syntax: 'passed', symbol_dimension_unit: 'passed', classification: 'linear', compile: 'passed' },
  });
  render(<FormulaManagementPanel formulas={formulas} semantic={semantic} symbols={symbols} onChange={onChange} onEdit={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('搜索公式'), { target: { value: 'reserve_req' } });
  expect(screen.getByText('备用约束')).toBeInTheDocument();
  expect(screen.queryByText('功率平衡')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /复\s*制/ }));
  expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: '备用约束（副本）', compile_status: 'draft' })]));
  fireEvent.click(screen.getByRole('button', { name: /停\s*用/ }));
  expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ formula_id: 'reserve', solve_participation: 'disabled' })]));
  fireEvent.click(screen.getByRole('button', { name: /批量权威编译/ }));
  await waitFor(() => expect(analyzeFormulaMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ formula_id: 'reserve', compile_status: 'compile_valid', compiler_version: '2.0.0' })])));
});
