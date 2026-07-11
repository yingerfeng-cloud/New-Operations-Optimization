import type { ModelDraft } from '../stores/modelCreationStore';

function normalizeProblemType(value: unknown) {
  const text = String(value || '').toUpperCase();
  if (text.includes('MINLP')) return 'MINLP_RESERVED';
  if (text.includes('MILP') || text.includes('MIP') || text.includes('INTEGER')) return 'MILP';
  if (text.includes('NLP')) return 'NLP';
  if (text.includes('LP') || text.includes('LINEAR')) return 'LP';
  return undefined;
}

function metadataProblemType(value: Record<string, unknown>) {
  return normalizeProblemType(
    value.problemType ||
    value.problem_type ||
    value.model_problem_type ||
    (value.metadata as Record<string, unknown> | undefined)?.problemType ||
    (value.metadata as Record<string, unknown> | undefined)?.problem_type,
  );
}

export function inferModelProblemType(draft: ModelDraft): 'LP' | 'MILP' | 'NLP' | 'MINLP_RESERVED' {
  const modelCode = String(draft.basic_info.model_code || '');
  if (modelCode.startsWith('cascade_hydro_dispatch')) {
    return String(draft.runtime_parameters.hydro_power_mode || 'linear') === 'linear' ? 'LP' : 'MILP';
  }
  const componentTypes = draft.components.map(component => metadataProblemType(component)).filter(Boolean);
  if (componentTypes.includes('MILP')) return 'MILP';

  const draftMetadataType = metadataProblemType({
    ...(draft.advanced || {}),
    ...(draft.advanced.generic_spec || {}),
    ...(draft.advanced.component_spec || {}),
  });
  if (draftMetadataType === 'MILP') return 'MILP';

  const hasIntegerVariable = draft.semantic.variables.some(variable => {
    const type = String(variable.variableType || variable.domain || '').toLowerCase();
    return type.includes('binary') || type.includes('integer') || type === 'bool';
  });
  const solver = String(draft.basic_info.solver || '').toLowerCase();
  const hasNlpHint = solver === 'ipopt' || draft.formulas.some(formula => /(\w+\[[^\]]+\]|\w+)\s*(\*|\/|\*\*|\^)\s*(\w+\[[^\]]+\]|\w+)/.test(formula.dsl_formula));
  if (hasNlpHint && hasIntegerVariable) return 'MINLP_RESERVED';
  if (hasNlpHint) return 'NLP';
  if (hasIntegerVariable) return 'MILP';

  return (componentTypes[0] as 'LP' | 'MILP' | 'NLP' | 'MINLP_RESERVED' | undefined) || draftMetadataType || 'LP';
}
