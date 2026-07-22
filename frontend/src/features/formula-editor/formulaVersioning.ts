import type { AuthoritativeFormulaArtifact, FormulaDef, FormulaVersionSnapshot, FormulaVersionState } from '../../types/formula';

function versionInput(formula: FormulaDef) {
  return JSON.stringify({
    expression: formula.dsl_formula,
    scope: formula.scope || [],
    participation: formula.solve_participation || 'solve_active',
    direction: formula.objective_direction,
    weight: formula.weight,
  });
}

export function formulaExpressionHash(formula: FormulaDef): string {
  let hash = 0x811c9dc5;
  for (const character of versionInput(formula)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function currentVersionState(formula: FormulaDef): FormulaVersionState {
  const expressionHash = formulaExpressionHash(formula);
  const previous = formula.version_state;
  if (!previous) return { current_revision: 1, expression_hash: expressionHash };
  if (previous.expression_hash === expressionHash) return previous;
  return {
    ...previous,
    current_revision: Math.max(1, previous.current_revision) + 1,
    expression_hash: expressionHash,
    compiled_expression_hash: undefined,
    compiler_version: undefined,
    compiled_at: undefined,
  };
}

export function formulaVersionSnapshot(formula: FormulaDef, savedAt = new Date().toISOString()): FormulaVersionSnapshot {
  const state = currentVersionState(formula);
  return {
    revision: state.current_revision,
    expression_hash: state.expression_hash,
    expression: formula.dsl_formula,
    scope: formula.scope || [],
    participation: formula.solve_participation || 'solve_active',
    direction: formula.objective_direction,
    weight: formula.weight,
    compile_status: formula.compile_status,
    saved_at: savedAt,
    compiler_version: formula.compiler_version,
  };
}

export function withCurrentFormulaVersion(formula: FormulaDef): FormulaDef {
  return { ...formula, version_state: currentVersionState(formula) };
}

export function markFormulaCompiled(formula: FormulaDef, artifact?: AuthoritativeFormulaArtifact): FormulaDef {
  const current = withCurrentFormulaVersion(formula);
  if (!artifact) return current;
  const compiledAt = artifact.compiled_at || new Date().toISOString();
  const snapshot = formulaVersionSnapshot({ ...current, compiler_version: artifact.compiler_version }, compiledAt);
  return {
    ...current,
    compiler_version: artifact.compiler_version,
    last_compiled_version: snapshot,
    version_state: {
      ...current.version_state!,
      last_compiled_revision: current.version_state!.current_revision,
      compiled_expression_hash: current.version_state!.expression_hash,
      compiler_version: artifact.compiler_version,
      compiled_at: compiledAt,
    },
  };
}

export function markFormulaSaved(formula: FormulaDef, savedAt = new Date().toISOString()): FormulaDef {
  const current = withCurrentFormulaVersion(formula);
  return {
    ...current,
    last_saved_version: formulaVersionSnapshot(current, savedAt),
    version_state: { ...current.version_state!, last_saved_revision: current.version_state!.current_revision },
  };
}

export function markFormulaApplied(formula: FormulaDef, appliedAt = new Date().toISOString()): FormulaDef {
  const current = withCurrentFormulaVersion(formula);
  return {
    ...current,
    applied_version: formulaVersionSnapshot(current, appliedAt),
    version_state: { ...current.version_state!, applied_revision: current.version_state!.current_revision },
  };
}
