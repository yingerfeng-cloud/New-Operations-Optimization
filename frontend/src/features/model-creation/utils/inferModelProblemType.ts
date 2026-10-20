import type { ModelDraft } from '../stores/modelCreationStore';
import { analyzeDraftNonlinear } from './nonlinearDiagnostics';

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
  const hasExactPwl = draft.components.some(component => component.enabled !== false && ['function_mapping_component', 'piecewise_linear_curve'].includes(String(component.type || component.component_id)) && component.solve_strategy !== 'display_only');
  const withPwl = (value: 'LP' | 'MILP' | 'NLP' | 'MINLP_RESERVED') => hasExactPwl && value === 'LP' ? 'MILP' : hasExactPwl && value === 'NLP' ? 'MINLP_RESERVED' : value;
  const declaredType = metadataProblemType({
    problem_type: (draft.basic_info as unknown as Record<string, unknown>).problem_type,
    ...(draft.semantic.ui_metadata || {}),
    ...(draft.advanced.ui_metadata || {}),
  });
  if (declaredType) return withPwl(declaredType as 'LP' | 'MILP' | 'NLP' | 'MINLP_RESERVED');

  const diagnosis = (
    draft.advanced.component_spec?.problem_type_diagnosis
    || draft.advanced.generic_spec?.problem_type_diagnosis
    || draft.advanced.ui_metadata?.problem_type_diagnosis
    || {}
  ) as Record<string, unknown>;
  const diagnosedType = normalizeProblemType(diagnosis.effective_problem_type || diagnosis.inferred_problem_type || diagnosis.recommended_problem_type);
  if (diagnosedType) return withPwl(diagnosedType as 'LP' | 'MILP' | 'NLP' | 'MINLP_RESERVED');

  const hasIntegerVariable = draft.semantic.variables.some(variable => {
    const type = String(variable.variableType || variable.domain || '').toLowerCase();
    return type.includes('binary') || type.includes('integer') || type === 'bool';
  });
  const solver = String(draft.basic_info.solver || '').toLowerCase();
  const nonlinearReport = analyzeDraftNonlinear(draft);
  const hasNlpHint = solver === 'ipopt' || nonlinearReport.relationships.some(item =>
    !item.converted && ['bilinear', 'division', 'high_order_power', 'general_nonlinear_function'].includes(item.nonlinear_type),
  );
  if (hasNlpHint && (hasIntegerVariable || hasExactPwl)) return 'MINLP_RESERVED';
  if (hasNlpHint) return 'NLP';
  if (hasIntegerVariable || hasExactPwl) return 'MILP';

  const componentTypes = draft.components.map(component => metadataProblemType(component)).filter(Boolean);
  if (componentTypes.includes('MINLP_RESERVED')) return 'MINLP_RESERVED';
  if (componentTypes.includes('NLP')) return 'NLP';
  if (componentTypes.includes('MILP')) return 'MILP';

  const compiledType = metadataProblemType({
    ...(draft.advanced || {}),
    ...(draft.advanced.generic_spec || {}),
    ...(draft.advanced.component_spec || {}),
  });
  if (compiledType) return compiledType;

  const solveStrategies = [
    draft.runtime_parameters.hydro_power_mode,
    ...draft.components.flatMap(component => [component.solve_strategy, component.linearization_strategy]),
  ].map(value => String(value || '').toLowerCase());
  if (solveStrategies.some(value => value.includes('pwl_') || value.includes('piecewise_') || value.includes('sos2') || ['segment_binary', 'binary_segment_milp', 'convex_combination_lp'].includes(value))) return 'MILP';
  return 'LP';
}
