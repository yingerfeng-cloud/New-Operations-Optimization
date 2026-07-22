import { expandFormula, type FormulaAnalyzePayload } from '../../api/formulas';
import type { AuthoritativeFormulaArtifact, FormulaCompileResult, FormulaDef } from '../../types/formula';

export interface AuthoritativeCompileContext {
  symbols: Record<string, unknown>;
  model_context?: Record<string, unknown>;
}

const scopeOf = (formula: FormulaDef) => formula.scope?.length
  ? formula.scope
  : formula.free_indices.map((alias, index) => ({ alias, set: formula.foreach[index] || alias }));

export function formulaCompileSignature(formula: FormulaDef, context: AuthoritativeCompileContext): string {
  return JSON.stringify({
    formula: formula.dsl_formula,
    formula_type: formula.kind,
    participation: formula.solve_participation || 'solve_active',
    objective_direction: formula.objective_direction,
    weight: formula.weight,
    scope: scopeOf(formula),
    symbols: context.symbols,
    model_context: context.model_context || {},
  });
}

export function isAuthoritativeArtifactCurrent(formula: FormulaDef, context: AuthoritativeCompileContext): boolean {
  return Boolean(
    formula.authoritative_artifact
    && formula.compile_status === 'compile_valid'
    && formula.authoritative_artifact.input_signature === formulaCompileSignature(formula, context)
    && formula.authoritative_artifact.compiled_fragment,
  );
}

export function formulaAnalyzePayload(formula: FormulaDef, context: AuthoritativeCompileContext): FormulaAnalyzePayload {
  return {
    formula: formula.dsl_formula,
    formula_type: formula.kind,
    participation: formula.solve_participation === 'preview_only' || formula.solve_participation === 'disabled' ? 'preview_only' : 'solve_active',
    ast_version: '1.0',
    formula_id: formula.formula_id,
    objective_direction: formula.kind === 'objective' ? formula.objective_direction : undefined,
    scope: scopeOf(formula),
    symbols: context.symbols,
    model_context: context.model_context,
  };
}

export function artifactFromResult(formula: FormulaDef, context: AuthoritativeCompileContext, result: FormulaCompileResult): AuthoritativeFormulaArtifact | undefined {
  if (result.status !== 'compile_valid' || !result.compiled_fragment || !result.compiler_version) return undefined;
  const compiledFormula = { ...formula, scope: result.scope };
  const fragmentRows = result.compiled_fragment.type === 'constraint'
    ? (result.compiled_fragment.constraints as Array<Record<string, unknown>> | undefined) || []
    : [result.compiled_fragment];
  return {
    formula_id: formula.formula_id,
    input_signature: formulaCompileSignature(compiledFormula, context),
    ast_version: result.ast_version,
    compiler_version: result.compiler_version,
    normalized_expression: result.normalized_expression,
    expression_class: result.expression_class,
    ast: result.ast,
    compiled_fragment: result.compiled_fragment,
    source_trace: fragmentRows.map(row => ({
      source_formula_id: formula.formula_id,
      split_sequence: row.split_sequence || 1,
      scope: row.scope || result.scope,
    })),
    diagnostics: result.diagnostics,
    scope: result.scope,
    compiled_at: new Date().toISOString(),
  };
}

export function authoritativeArtifactState(formula: FormulaDef, context: AuthoritativeCompileContext) {
  return {
    has_artifact: Boolean(formula.authoritative_artifact),
    compile_status: formula.compile_status,
    has_compiled_fragment: Boolean(formula.authoritative_artifact?.compiled_fragment),
    expected_signature: formulaCompileSignature(formula, context),
    artifact_signature: formula.authoritative_artifact?.input_signature,
  };
}

export async function compileFormulaAuthoritatively(formula: FormulaDef, context: AuthoritativeCompileContext) {
  const result = await expandFormula(formulaAnalyzePayload(formula, context));
  return { result, artifact: artifactFromResult(formula, context, result) };
}
