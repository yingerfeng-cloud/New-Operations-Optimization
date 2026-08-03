import type { ModelDraft } from '../stores/modelCreationStore';
import { validateFormulaDef } from '../../formula-editor/formulaValidator';
import { bindingCode, hasBindingValue, isBindingComplete } from './bindingValidation';
import { analyzeDraftNonlinear } from './nonlinearDiagnostics';
import { systemTimeFieldCodes, validateDraftTimeDimension } from './timeDimensionDraft';
import { dimensionFieldConflict, extractDimensions } from './modelDimensions';
import { activeDraftForBuilderMode } from './builderModeTransition';
import { componentDependencyErrors } from '../../../utils/componentDependencies';

export interface DraftValidation { valid: boolean; sections: Record<string, { valid: boolean; errors: string[]; warnings?: string[] }> }

function componentId(component: Record<string, unknown>) {
  return String(component.type || component.component_id || component.code || component.name || '');
}

function dependencyErrors(draft: ModelDraft) {
  return draft.basic_info.builder_mode === 'component_based'
    ? componentDependencyErrors(draft.components)
    : [];
}

function parameterBindingErrors(draft: ModelDraft) {
  return draft.components.flatMap((component, componentIndex) => {
    const bindings = Array.isArray(component.parameter_bindings) ? component.parameter_bindings as Array<Record<string, unknown>> : [];
    return bindings
      .filter(binding => binding.required === true && !isBindingComplete(binding))
      .map((binding, index) => `组件 ${componentId(component) || componentIndex + 1} 参数绑定 ${bindingCode(binding, index)} 缺失`);
  });
}

function runtimeParameterErrors(draft: ModelDraft) {
  const systemFields = systemTimeFieldCodes(draft.time_dimension);
  return draft.semantic.parameters
    .filter(parameter => !systemFields.has(parameter.code))
    .filter(parameter => (parameter.sourceType || parameter.source_type || 'runtime') === 'runtime')
    .filter(parameter => parameter.required !== false)
    .filter(parameter => !hasBindingValue(draft.runtime_parameters[parameter.code]) && !hasBindingValue(parameter.defaultValue ?? parameter.default_value ?? parameter.default))
    .map(parameter => `运行参数 ${parameter.name || parameter.code} ${parameter.code} 缺少必填值`);
}

function functionMappingErrors(draft: ModelDraft) {
  return draft.components.flatMap(component => {
    const id = componentId(component);
    if (id !== 'function_mapping_2d_component') return [];
    const errors: string[] = [];
    if (!component.function_asset_id) errors.push('二维函数资产未绑定');
    if (!component.x) errors.push('二维函数输入 x 未绑定');
    if (!component.y) errors.push('二维函数输入 y 未绑定');
    if (!component.z) errors.push('二维函数输出 z 未绑定');
    if (component.solve_strategy === 'display_only') errors.push('display_only 不能作为发布求解组件');
    if (component.solve_strategy === 'triangulated_milp_exact') {
      const metadata = (component.metadata || {}) as Record<string, unknown>;
      const triangleCount = Number(metadata.triangle_count || 0);
      const indices = Array.isArray(component.indices) ? component.indices as Array<Record<string, unknown>> : [];
      const firstSet = String(indices[0]?.set || '');
      const timeCount = firstSet ? draft.runtime_parameters[firstSet] : undefined;
      const expandCount = Array.isArray(timeCount) ? timeCount.length * triangleCount : triangleCount;
      if (expandCount > 4000) errors.push(`二维 PWL 展开规模较大：${expandCount} 个三角形选择变量，请缩减点数或调度周期`);
    }
    return errors.map(error => `${id}: ${error}`);
  });
}

function problemTypeErrors(draft: ModelDraft) {
  const variableTypes = draft.semantic.variables.map(variable => variable.variableType || (variable.domain === 'Binary' ? 'binary' : variable.domain === 'Integers' ? 'integer' : 'continuous'));
  const hasInteger = variableTypes.some(type => type === 'binary' || type === 'integer');
  const requested = String(draft.basic_info.solver || 'HiGHS');
  if (!['HiGHS', 'Ipopt'].includes(requested)) return [`当前求解器 ${requested} 尚未在前端兼容性矩阵中声明`];
  if (requested === 'Ipopt') {
    if (hasInteger) return ['当前模型被识别为 MINLP，平台当前未开放生产级 MINLP 求解。请改用 McCormick、1D/2D PWL 等线性化策略。'];
    return functionMappingErrors(draft);
  }
  if (hasInteger && draft.formulas.some(formula => /piecewise|abs\(/i.test(formula.dsl_formula))) return ['整数变量与 piecewise/abs 组合需要后端特殊线性化确认'];
  const nonlinear = analyzeDraftNonlinear(draft);
  return [...functionMappingErrors(draft), ...nonlinear.blocking_items.map(item => item.message)];
}

function semanticIdentityErrors(draft: ModelDraft) {
  const errors: string[] = [];
  const groups = [
    ['集合', draft.semantic.sets],
    ['参数', draft.semantic.parameters],
    ['变量', draft.semantic.variables],
  ] as const;
  groups.forEach(([label, rows]) => {
    const codes = new Set<string>();
    rows.forEach((row, index) => {
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      if (!code) errors.push(`${label}第 ${index + 1} 项编码必填`);
      if (!name) errors.push(`${label} ${code || `第 ${index + 1} 项`}名称必填（用于模型解释）`);
      if (code && codes.has(code)) errors.push(`${label}编码重复：${code}`);
      if (code) codes.add(code);
    });
  });
  return errors;
}

export function validateModelDraft(sourceDraft: ModelDraft): DraftValidation {
  const d = activeDraftForBuilderMode(sourceDraft);
  const basicInfoErrors: string[] = [];
  if (!d.basic_info.name) basicInfoErrors.push('模型名称必填');
  if (!d.basic_info.model_code) basicInfoErrors.push('模型编码必填');
  if (!d.basic_info.scenario) basicInfoErrors.push('业务场景必填');

  const semanticStructureErrors: string[] = [];
  semanticStructureErrors.push(...semanticIdentityErrors(d));
  if (!d.semantic.sets.length && (d.semantic.parameters.some(item => extractDimensions(item as unknown as Record<string, unknown>).length) || d.semantic.variables.some(item => extractDimensions(item as unknown as Record<string, unknown>).length))) semanticStructureErrors.push('存在有维度参数或变量时至少需要一个集合');
  [...d.semantic.parameters, ...d.semantic.variables].forEach(item => {
    if (dimensionFieldConflict(item as unknown as Record<string, unknown>)) semanticStructureErrors.push(`${item.code} 的维度字段定义不一致`);
  });
  if (!d.semantic.variables.length && d.basic_info.builder_mode === 'generic_linear') semanticStructureErrors.push('通用线性 Builder 至少需要一个变量');

  const formulaErrors = d.formulas.flatMap(f => validateFormulaDef(f).errors.map(e => `${f.name || f.formula_id || '未命名公式'}: ${e}`));
  const formulaCodes = new Set<string>();
  const formulaNames = new Set<string>();
  d.formulas.forEach((formula, index) => {
    const code = String(formula.formula_id || '').trim();
    const name = String(formula.name || '').trim();
    if (!code) formulaErrors.push(`第 ${index + 1} 个公式编码必填`);
    if (!name) formulaErrors.push(`公式 ${code || `第 ${index + 1} 项`}名称必填（用于模型解释）`);
    if (code && formulaCodes.has(code)) formulaErrors.push(`公式编码必须唯一：${code}`);
    if (name && formulaNames.has(name)) formulaErrors.push(`公式名称必须唯一：${name}`);
    if (code) formulaCodes.add(code);
    if (name) formulaNames.add(name);
  });
  const activeObjectives = d.formulas.filter(f => f.kind === 'objective' && (f.solve_participation || 'solve_active') === 'solve_active');
  const objectiveMode = d.objective?.mode || (d.objective?.type === 'weighted_sum' ? 'weighted_sum' : 'single');
  if (d.basic_info.builder_mode === 'generic_linear' && !activeObjectives.length) formulaErrors.push('通用线性 Builder 至少需要一个参与求解的目标公式');
  if (d.basic_info.builder_mode === 'generic_linear' && objectiveMode === 'single' && activeObjectives.length !== 1) formulaErrors.push(`single 模式仅允许一个参与求解的目标，实际为 ${activeObjectives.length} 个`);
  activeObjectives.forEach(objective => {
    if (!['minimize', 'maximize'].includes(String(objective.objective_direction || ''))) formulaErrors.push(`${objective.name}: 必须明确选择 minimize 或 maximize`);
    if (objectiveMode === 'weighted_sum' && (typeof objective.weight !== 'number' || !Number.isFinite(objective.weight))) formulaErrors.push(`${objective.name}: weighted_sum 权重必须显式填写为有限数值`);
  });
  if (d.basic_info.builder_mode === 'generic_linear' && !d.advanced.generic_spec) formulaErrors.push('generic_spec 尚未编译');
  if (d.basic_info.builder_mode === 'generic_linear' && d.advanced.generic_spec && d.advanced.generic_spec.formula_compiler !== 'backend_authoritative_v2') formulaErrors.push('generic_spec 不是后端权威编译产物，请重新编译');
  if ((d.advanced.generic_spec?.constraints as Array<Record<string, unknown>> | undefined)?.some(row => row.compile_status === 'unsupported')) formulaErrors.push('generic_spec 中存在无法编译的约束公式');

  const componentErrors = d.basic_info.builder_mode === 'component_based' && !d.components.length ? ['组件化 Builder 至少选择一个组件'] : dependencyErrors(d);
  const parameterErrors = parameterBindingErrors(d);
  const runtimeErrors = runtimeParameterErrors(d);
  const problemErrors = problemTypeErrors(d);
  const solverErrors = ['HiGHS', 'Ipopt'].includes(d.basic_info.solver) ? [] : [`求解器 ${d.basic_info.solver} 暂未声明兼容`];
  const timeDimensionErrors = validateDraftTimeDimension(d);

  const sections = {
    basic_info: { valid: basicInfoErrors.length === 0, errors: basicInfoErrors },
    semantic_structure: { valid: semanticStructureErrors.length === 0, errors: semanticStructureErrors },
    time_dimension: { valid: timeDimensionErrors.length === 0, errors: timeDimensionErrors },
    component_dependencies: { valid: componentErrors.length === 0, errors: componentErrors },
    parameter_bindings: { valid: parameterErrors.length === 0, errors: parameterErrors },
    formula: { valid: formulaErrors.length === 0, errors: formulaErrors },
    runtime_parameters: { valid: runtimeErrors.length === 0, errors: runtimeErrors },
    problem_type: { valid: problemErrors.length === 0, errors: problemErrors },
    solver_compatibility: { valid: solverErrors.length === 0, errors: solverErrors },
  };
  return { valid: Object.values(sections).every(x => x.valid), sections };
}
