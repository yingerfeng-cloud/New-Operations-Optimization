import { describe, expect, test } from 'vitest';
import {
  componentFormulaCompileContext,
  formulaFromRow,
  normalizeComponentForEditor,
  normalizeFormulaParticipation,
  normalizeFormulaRowForSave,
} from '../../features/component-library/ComponentEditor';
import { collectReferences } from '../../features/formula-editor/formulaDsl';
import { parseFormulaDsl } from '../../features/formula-editor/formulaParser';
import { validateFormula } from '../../features/formula-editor/formulaValidator';
import { formulaAnalyzePayload } from '../../features/formula-editor/authoritativeCompilation';
import type { ComponentDef } from '../../types/component';


describe('component formula compatibility contract', () => {
  test.each([
    ['solve_active', 'solve_active'],
    ['preview_only', 'preview_only'],
    ['disabled', 'disabled'],
    ['display_only', 'preview_only'],
    ['remark_only', 'preview_only'],
    ['none', 'disabled'],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(normalizeFormulaParticipation({ solve_participation: raw })).toBe(expected);
  });

  test('saves participation booleans and synchronizes all expression fields', () => {
    expect(normalizeFormulaRowForSave({
      expression: 'x >= 5',
      solve_participation: 'none',
      enabled: true,
      participates_in_solve: true,
    })).toMatchObject({
      dsl_formula: 'x >= 5',
      formula: 'x >= 5',
      expression: 'x >= 5',
      solve_participation: 'disabled',
      participates_in_solve: false,
      enabled: false,
    });
  });

  test('hydrates the newest DSL field and preserves structured scope', () => {
    const formula = formulaFromRow({
      constraint_id: 'balance',
      dsl_formula: 'state[t+1] == state[t]',
      formula: 'old_formula',
      expression: 'older_expression',
      indices: [{ set: 'time', alias: 't' }],
      boundary_strategy: 'skip_last',
    }, 'constraint');
    expect(formula.dsl_formula).toBe('state[t+1] == state[t]');
    expect(formula.scope).toEqual([{ set: 'time', alias: 't' }]);
    expect(formula.foreach).toEqual(['time']);
    expect(formula.free_indices).toEqual(['t']);
    expect(formula.boundary_strategy).toBe('skip_last');
  });

  test('component switching derives isolated editor state', () => {
    const componentA = { component_id: 'a', name: 'A', status: 'draft', version: '1', generated_constraints: [{ expression: 'a >= 1' }], parameters: [{ code: 'a_limit' }] } satisfies ComponentDef;
    const componentB = { component_id: 'b', name: 'B', status: 'draft', version: '1', generated_constraints: [{ expression: 'b >= 2' }], parameters: [{ code: 'b_limit' }] } satisfies ComponentDef;
    expect(normalizeComponentForEditor(componentA)?.generated_constraints).toEqual([{ expression: 'a >= 1', name: 'A' }]);
    expect(normalizeComponentForEditor(componentB)?.generated_constraints).toEqual([{ expression: 'b >= 2', name: 'B' }]);
    expect(normalizeComponentForEditor(componentB)?.parameters).toEqual([{ code: 'b_limit' }]);
  });
});


test('component compile context supplies deterministic time and state-time samples', () => {
  const context = componentFormulaCompileContext(
    [{ code: 'time', type: 'time_period' }, { code: 'state_time', type: 'state_time', base_set: 'time' }],
    [{ code: 'input', dimension: ['time'] }],
    [{ code: 'state', dimension: ['state_time'] }],
  );
  expect(context.symbols.sets).toMatchObject({
    time: { values: [0, 1] },
    state_time: { values: [0, 1, 2] },
  });
  expect(context.model_context).toMatchObject({
    component_compile_sample_only: true,
    time_dimension: { time_set: 'time', state_time_set: 'state_time' },
  });

  const formula = formulaFromRow({
    constraint_id: 'state',
    dsl_formula: 'state[t+1] == state[t] + input[t]',
    indices: [{ set: 'time', alias: 't' }],
    boundary_strategy: 'skip_last',
  }, 'constraint');
  expect(formulaAnalyzePayload(formula, context).model_context).toMatchObject({ boundary_strategy: 'skip_last' });
});


test.each(['log', 'exp', 'sqrt'])('%s is parsed as a nonlinear function, not a parameter', functionName => {
  const symbols = { sets: {}, parameters: {}, variables: { x: { label: 'x' } } };
  const dsl = `${functionName}(x) <= 10`;
  const tokens = parseFormulaDsl(dsl, symbols);
  const references = collectReferences(tokens);
  const result = validateFormula(dsl, 'constraint', tokens, symbols, []);
  expect(tokens[0]).toMatchObject({ type: 'function', fn: functionName });
  expect(references.referenced_parameters).not.toContain(functionName);
  expect(result.valid).toBe(true);
  expect(result.warnings.join('')).toContain('不能直接进入 LP/MILP');
});
