import { artifactFromResult, formulaAnalyzePayload, formulaCompileSignature, isAuthoritativeArtifactCurrent } from '../../features/formula-editor/authoritativeCompilation';
import type { FormulaCompileResult, FormulaDef } from '../../types/formula';

const formula: FormulaDef = {
  formula_id: 'balance', name: '平衡', kind: 'constraint', dsl_formula: 'p[t] >= load[t]', display_formula: '',
  tokens: [], foreach: ['time'], free_indices: ['t'], referenced_sets: [], referenced_parameters: [], referenced_variables: [], compile_status: 'compile_valid',
};
const context = { symbols: { variables: [{ code: 'p', dimension: ['time'] }] }, model_context: { time_dimension: { policy: 'fixed', default_horizon: 3 } } };
const result = { status: 'compile_valid', compiler_version: '2', ast_version: '1.0', scope: [{ alias: 't', set: 'time' }], compiled_fragment: { type: 'constraint', constraints: [] }, diagnostics: [] } as unknown as FormulaCompileResult;

test.each(['strict', 'skip_first'] as const)('requests and apply gates share normalized %s context', boundary_strategy => {
  const source = { ...formula, boundary_strategy };
  const editorContext = { ...context, model_context: { ...context.model_context, boundary_strategy } };
  const compiled = { ...source, authoritative_artifact: artifactFromResult(source, editorContext, result) };
  expect(isAuthoritativeArtifactCurrent(compiled, context)).toBe(true);
  expect(formulaAnalyzePayload(source, context).model_context).toEqual(editorContext.model_context);
  expect(formulaCompileSignature(source, context)).toBe(formulaCompileSignature(source, editorContext));
  for (const changed of [{ ...compiled, dsl_formula: 'p[t] == load[t]' }, { ...compiled, boundary_strategy: boundary_strategy === 'strict' ? 'skip_first' as const : 'strict' as const }]) {
    expect(isAuthoritativeArtifactCurrent(changed, context)).toBe(false);
  }
  expect(isAuthoritativeArtifactCurrent(compiled, { ...context, symbols: { variables: [{ code: 'q', dimension: ['time'] }] } })).toBe(false);
  expect(isAuthoritativeArtifactCurrent(compiled, { ...context, model_context: { time_dimension: { policy: 'fixed', default_horizon: 4 } } })).toBe(false);
});

test('object key order does not change the compile signature', () => {
  expect(formulaCompileSignature(formula, { symbols: { a: 1, b: 2 } })).toBe(formulaCompileSignature(formula, { symbols: { b: 2, a: 1 } }));
});
