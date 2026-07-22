import type { FormulaDef } from '../../types/formula';
import { dependencyAnalysis, filterFormulas, formulaSnapshot, moveFormula } from '../../features/formula-editor/formulaManagement';

const formula = (overrides: Partial<FormulaDef>): FormulaDef => ({
  formula_id: crypto.randomUUID(),
  name: '功率平衡',
  kind: 'constraint',
  solve_participation: 'solve_active',
  display_formula: '',
  dsl_formula: 'power[t] >= load[t]',
  tokens: [],
  foreach: ['time'],
  referenced_sets: ['time'],
  referenced_parameters: ['load'],
  referenced_variables: ['power'],
  free_indices: ['t'],
  compile_status: 'compile_valid',
  ...overrides,
});

test('formula management searches names expressions variables parameters status and group', () => {
  const rows = [
    formula({ formula_id: 'a', business_group: '平衡约束' }),
    formula({ formula_id: 'b', name: '备用约束', dsl_formula: 'reserve[t] >= reserve_req[t]', referenced_variables: ['reserve'], referenced_parameters: ['reserve_req'], business_group: '安全约束', compile_status: 'compile_failed' }),
  ];
  expect(filterFormulas(rows, { keyword: 'reserve_req' }).map(item => item.formula_id)).toEqual(['b']);
  expect(filterFormulas(rows, { status: 'compile_valid' }).map(item => item.formula_id)).toEqual(['a']);
  expect(filterFormulas(rows, { group: '安全约束' }).map(item => item.formula_id)).toEqual(['b']);
});

test('formula management reorders and snapshots without changing stable ids', () => {
  const rows = [formula({ formula_id: 'a' }), formula({ formula_id: 'b' })];
  expect(moveFormula(rows, 'b', -1).map(item => item.formula_id)).toEqual(['b', 'a']);
  expect(formulaSnapshot(rows[0]).expression).toBe('power[t] >= load[t]');
});

test('dependency analysis finds orphan symbols objective gaps and duplicate constraints', () => {
  const rows = [
    formula({ formula_id: 'a' }),
    formula({ formula_id: 'b', name: '重复功率平衡' }),
    formula({ formula_id: 'goal', kind: 'objective', dsl_formula: 'cost[t]', referenced_variables: ['cost'], referenced_parameters: [], referenced_sets: [] }),
  ];
  const result = dependencyAnalysis(rows, {
    sets: [{ code: 'time' }, { code: 'unit' }],
    parameters: [{ code: 'load' }, { code: 'unused_param' }],
    variables: [{ code: 'power' }, { code: 'cost' }, { code: 'orphan' }],
  });
  expect(result.unusedVariables).toEqual(['orphan']);
  expect(result.unusedParameters).toEqual(['unused_param']);
  expect(result.unusedSets).toEqual(['unit']);
  expect(result.variablesOutsideObjective).toContain('power');
  expect(result.duplicateConstraintGroups).toEqual([['a', 'b']]);
});

test('filters 100 formulas against a 200-symbol workload within an interactive threshold', () => {
  const rows = Array.from({ length: 100 }, (_, index) => formula({
    formula_id: `f-${index}`,
    name: `约束 ${index}`,
    referenced_variables: Array.from({ length: 100 }, (__, symbol) => `v${symbol}`),
    referenced_parameters: Array.from({ length: 100 }, (__, symbol) => `p${symbol}`),
  }));
  const started = performance.now();
  const result = filterFormulas(rows, { keyword: 'p99', kind: 'constraint' });
  const duration = performance.now() - started;
  expect(result).toHaveLength(100);
  expect(duration).toBeLessThan(100);
});
