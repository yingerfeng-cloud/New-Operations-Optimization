import type { FormulaDef } from '../../../types/formula';
import type { ModelDraft } from '../stores/modelCreationStore';
import { extractDimensions } from './modelDimensions';
import { markFormulaApplied } from '../../formula-editor/formulaVersioning';

const variableDomain = (variable: ModelDraft['semantic']['variables'][number]) => variable.domain
  || (variable.variableType === 'binary' ? 'Binary' : variable.variableType === 'integer' ? 'Integers' : 'NonNegativeReals');

export function composeAuthoritativeGenericSpec(draft: ModelDraft): Record<string, unknown> {
  const active = draft.formulas.filter(formula => (formula.solve_participation || 'solve_active') === 'solve_active');
  const objectives = active.filter(formula => formula.kind === 'objective');
  const objectiveMode = draft.objective?.mode || (draft.objective?.type === 'weighted_sum' ? 'weighted_sum' : 'single');
  const globalDirection = draft.objective?.global_direction || (draft.objective?.sense === 'maximize' ? 'maximize' : 'minimize');
  if (!['single', 'weighted_sum'].includes(objectiveMode)) throw new Error(`不支持的目标模式：${objectiveMode}`);
  if (!['minimize', 'maximize'].includes(globalDirection)) throw new Error(`不支持的全局目标方向：${globalDirection}`);
  if (objectiveMode === 'single' && objectives.length !== 1) throw new Error(`single 模式且仅允许一个 solve_active 目标，实际为 ${objectives.length} 条。`);
  if (objectiveMode === 'weighted_sum' && objectives.length < 1) throw new Error('weighted_sum 模式至少需要一个 solve_active 目标。');
  const missing = active.filter(formula => formula.compile_status !== 'compile_valid' || !formula.authoritative_artifact?.compiled_fragment);
  if (missing.length) throw new Error(`以下公式缺少当前后端权威编译产物：${missing.map(item => item.name).join('、')}`);

  const constraints = active.filter(formula => formula.kind === 'constraint').flatMap(formula => {
    const rows = formula.authoritative_artifact?.compiled_fragment.constraints as Array<Record<string, unknown>> | undefined;
    if (!rows?.length) throw new Error(`${formula.name} 的权威产物不包含约束片段。`);
    return rows.map((row, index) => ({
      ...row,
      name: rows.length > 1 ? `${formula.name}__${index + 1}` : formula.name,
      formula_id: formula.formula_id,
      source_formula_id: formula.formula_id,
      split_sequence: row.split_sequence || index + 1,
      ast_version: formula.authoritative_artifact?.ast_version,
      compiler_version: formula.authoritative_artifact?.compiler_version,
      compiled_fragment_version: '1.0',
      compile_status: 'compile_valid',
    }));
  });

  const normalizedObjectives = objectives.map(objectiveFormula => {
    const objectiveFragment = objectiveFormula.authoritative_artifact!.compiled_fragment;
    const objectiveTerms = (objectiveFragment.terms as Array<Record<string, unknown>> | undefined) || [];
    if (!objectiveTerms.length) throw new Error(`${objectiveFormula.name} 的权威产物不包含目标项。`);
    const originalDirection = String(objectiveFragment.direction || objectiveFormula.objective_direction || '');
    if (!['minimize', 'maximize'].includes(originalDirection)) throw new Error(`${objectiveFormula.name} 缺少明确的目标方向。`);
    const weight = objectiveMode === 'weighted_sum' ? objectiveFormula.weight : 1;
    if (typeof weight !== 'number' || !Number.isFinite(weight)) throw new Error(`${objectiveFormula.name} 的权重必须显式填写为有限数值。`);
    const effectiveSign = originalDirection === globalDirection ? 1 : -1;
    return { objectiveFormula, objectiveTerms, originalDirection, weight, effectiveSign, effectiveWeight: weight * effectiveSign };
  });

  const appliedFormulas = new Map(active.map(formula => {
    const applied = markFormulaApplied(formula);
    return [formula.formula_id, applied] as const;
  }));

  const parameters = Object.fromEntries(draft.semantic.parameters.map(parameter => [
    parameter.code,
    parameter.defaultValue ?? parameter.default_value ?? parameter.default ?? parameter.fixed_value ?? 0,
  ]));
  return {
    formula_ast_version: '1.0',
    formula_compiler: 'backend_authoritative_v2',
    compiled_fragment_version: '1.0',
    model_context: { time_dimension: draft.time_dimension },
    objective_mode: objectiveMode,
    global_direction: globalDirection,
    formula_artifacts: active.map(source => {
      const formula = appliedFormulas.get(source.formula_id)!;
      return ({
      formula_id: formula.formula_id,
      name: formula.name,
      kind: formula.kind,
      input_signature: formula.authoritative_artifact!.input_signature,
      ast_version: formula.authoritative_artifact!.ast_version,
      compiler_version: formula.authoritative_artifact!.compiler_version,
      normalized_expression: formula.authoritative_artifact!.normalized_expression,
      expression_class: formula.authoritative_artifact!.expression_class,
      source_trace: formula.authoritative_artifact!.source_trace,
      version_state: formula.version_state,
    }); }),
    sets: Object.fromEntries(draft.semantic.sets.map(set => [set.code, set.values || []])),
    parameters,
    variables: draft.semantic.variables.map(variable => ({
      name: variable.code,
      indices: extractDimensions(variable as unknown as Record<string, unknown>),
      domain: variableDomain(variable),
      ...(variable.lowerBound !== undefined && variable.lowerBound !== '' ? { lb: Number(variable.lowerBound) } : {}),
      ...(variable.upperBound !== undefined && variable.upperBound !== '' ? { ub: Number(variable.upperBound) } : {}),
    })),
    constraints,
    objective: {
      mode: objectiveMode,
      sense: globalDirection,
      global_direction: globalDirection,
      terms: normalizedObjectives.flatMap(({ objectiveFormula, objectiveTerms, originalDirection, weight, effectiveSign, effectiveWeight }) => objectiveTerms.map(term => ({
          ...term,
          weight: effectiveWeight,
          objective_weight: weight,
          original_direction: originalDirection,
          global_direction: globalDirection,
          effective_sign: effectiveSign,
          formula_id: objectiveFormula.formula_id,
          source_formula_id: objectiveFormula.formula_id,
          ast_version: objectiveFormula.authoritative_artifact!.ast_version,
          compiler_version: objectiveFormula.authoritative_artifact!.compiler_version,
          compiled_fragment_version: '1.0',
        }))),
      normalization_summary: normalizedObjectives.map(({ objectiveFormula, originalDirection, weight, effectiveSign, effectiveWeight }) => ({
        formula_id: objectiveFormula.formula_id,
        name: objectiveFormula.name,
        original_direction: originalDirection,
        global_direction: globalDirection,
        weight,
        effective_sign: effectiveSign,
        effective_weight: effectiveWeight,
      })),
    },
    sense: globalDirection,
    preview_formulas: draft.formulas.filter(formula => formula.solve_participation === 'preview_only').map(sourceFormula),
    disabled_formulas: draft.formulas.filter(formula => formula.solve_participation === 'disabled').map(sourceFormula),
  };
}

function sourceFormula(formula: FormulaDef) {
  return {
    formula_id: formula.formula_id,
    name: formula.name,
    kind: formula.kind,
    dsl_formula: formula.dsl_formula,
    participation: formula.solve_participation,
    compile_status: formula.solve_participation,
  };
}
