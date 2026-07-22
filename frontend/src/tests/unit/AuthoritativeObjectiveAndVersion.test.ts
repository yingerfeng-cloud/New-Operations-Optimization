import { describe, expect, test } from 'vitest';
import type { FormulaDef } from '../../types/formula';
import { composeAuthoritativeGenericSpec } from '../../features/model-creation/utils/composeAuthoritativeGenericSpec';
import { createBlankDraft } from '../../features/model-creation/stores/modelCreationStore';
import { formulaExpressionHash, markFormulaApplied, markFormulaCompiled, markFormulaSaved, withCurrentFormulaVersion } from '../../features/formula-editor/formulaVersioning';

function objective(id: string, direction: 'minimize' | 'maximize', weight?: number): FormulaDef {
  const expression = `sum(power[t] for t in time)`;
  return {
    formula_id: id,
    name: id,
    kind: 'objective',
    objective_direction: direction,
    weight,
    solve_participation: 'solve_active',
    display_formula: expression,
    dsl_formula: expression,
    tokens: [],
    foreach: [],
    scope: [],
    referenced_sets: ['time'],
    referenced_parameters: [],
    referenced_variables: ['power'],
    free_indices: [],
    compile_status: 'compile_valid',
    compiler_version: '2.0.0',
    authoritative_artifact: {
      formula_id: id,
      input_signature: id,
      ast_version: '1.0',
      compiler_version: '2.0.0',
      normalized_expression: expression,
      expression_class: 'linear',
      compiled_fragment: { type: 'objective', direction, terms: [{ var: 'power', key: ['time'], coef: 1, coefficient: { numeric: 1, factors: [] }, aggregate_scope: [{ alias: 't', set: 'time' }] }] },
      source_trace: [{ source_formula_id: id }],
      diagnostics: [],
      scope: [],
      compiled_at: '2026-07-18T00:00:00.000Z',
    },
  };
}

function draftWithObjectives(formulas: FormulaDef[], mode: 'single' | 'weighted_sum', globalDirection: 'minimize' | 'maximize' = 'minimize') {
  const draft = createBlankDraft();
  draft.semantic.sets = [{ code: 'time', values: [0] }];
  draft.semantic.variables = [{ code: 'power', dimension: ['time'], domain: 'NonNegativeReals' }];
  draft.formulas = formulas;
  draft.objective = { mode, global_direction: globalDirection };
  return draft;
}

describe('authoritative objective composition', () => {
  test('single rejects multiple active objectives', () => {
    expect(() => composeAuthoritativeGenericSpec(draftWithObjectives([objective('one', 'minimize'), objective('two', 'maximize')], 'single'))).toThrow(/single/);
  });

  test('weighted_sum normalizes mixed directions and records the transformation', () => {
    const spec = composeAuthoritativeGenericSpec(draftWithObjectives([objective('cost', 'minimize', 2), objective('revenue', 'maximize', 3)], 'weighted_sum')) as any;
    expect(spec.objective.sense).toBe('minimize');
    expect(spec.objective.terms.map((term: any) => term.weight)).toEqual([2, -3]);
    expect(spec.objective.normalization_summary).toEqual([
      expect.objectContaining({ formula_id: 'cost', original_direction: 'minimize', effective_sign: 1, effective_weight: 2 }),
      expect.objectContaining({ formula_id: 'revenue', original_direction: 'maximize', effective_sign: -1, effective_weight: -3 }),
    ]);
  });

  test('weighted_sum accepts explicit zero but rejects missing and non-finite weights', () => {
    expect(() => composeAuthoritativeGenericSpec(draftWithObjectives([objective('zero', 'minimize', 0)], 'weighted_sum'))).not.toThrow();
    for (const weight of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => composeAuthoritativeGenericSpec(draftWithObjectives([objective('bad', 'minimize', weight)], 'weighted_sum'))).toThrow(/有限数值/);
    }
  });

  test('global maximize reverses minimize objectives', () => {
    const spec = composeAuthoritativeGenericSpec(draftWithObjectives([objective('benefit', 'maximize', 2), objective('cost', 'minimize', 4)], 'weighted_sum', 'maximize')) as any;
    expect(spec.objective.terms.map((term: any) => term.weight)).toEqual([2, -4]);
    expect(spec.sense).toBe('maximize');
  });
});

describe('formula revision persistence', () => {
  test('tracks current, saved, compiled and applied revisions with expression hashes', () => {
    const base = withCurrentFormulaVersion(objective('versioned', 'minimize', 1));
    expect(base.version_state).toMatchObject({ current_revision: 1, expression_hash: formulaExpressionHash(base) });
    const saved = markFormulaSaved(base, '2026-07-18T01:00:00.000Z');
    const compiled = markFormulaCompiled(saved, saved.authoritative_artifact);
    const applied = markFormulaApplied(compiled, '2026-07-18T02:00:00.000Z');
    expect(applied.version_state).toMatchObject({ current_revision: 1, last_saved_revision: 1, last_compiled_revision: 1, applied_revision: 1, compiler_version: '2.0.0' });
    expect(applied.applied_version?.expression_hash).toBe(applied.version_state?.expression_hash);

    const edited = withCurrentFormulaVersion({ ...applied, dsl_formula: '2 * sum(power[t] for t in time)' });
    expect(edited.version_state).toMatchObject({ current_revision: 2, last_saved_revision: 1, last_compiled_revision: 1, applied_revision: 1, compiled_expression_hash: undefined });
    expect(edited.version_state?.expression_hash).not.toBe(applied.version_state?.expression_hash);
  });
});
