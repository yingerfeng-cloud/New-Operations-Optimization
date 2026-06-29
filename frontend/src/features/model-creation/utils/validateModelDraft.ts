import type { ModelDraft } from '../stores/modelCreationStore';
import { validateFormulaDef } from '../../formula-editor/formulaValidator';

export interface DraftValidation { valid: boolean; sections: Record<string, { valid: boolean; errors: string[]; warnings?: string[] }> }

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

function componentId(component: Record<string, unknown>) {
  return String(component.type || component.component_id || component.code || component.name || '');
}

function dependencyErrors(draft: ModelDraft) {
  if (draft.basic_info.builder_mode !== 'component_based') return [];
  const enabled = new Set(draft.components.filter(component => component.enabled !== false).map(componentId).filter(Boolean));
  return draft.components.flatMap(component => {
    const id = componentId(component);
    const dependencies = [
      ...((Array.isArray(component.dependencies) ? component.dependencies : []) as string[]),
      ...((Array.isArray(component.depends_on) ? component.depends_on : []) as string[]),
    ].filter(Boolean);
    return dependencies.filter(item => !enabled.has(String(item))).map(item => `${id || '组件'} 缺少依赖 ${item}`);
  });
}

function parameterBindingErrors(draft: ModelDraft) {
  const componentBindingErrors = draft.components.flatMap((component, componentIndex) => {
    const bindings = Array.isArray(component.parameter_bindings) ? component.parameter_bindings as Array<Record<string, unknown>> : [];
    return bindings
      .filter(binding => binding.required === true && !hasValue(binding.source || binding.source_path || binding.runtime_key || binding.value || binding.model_parameter))
      .map((binding, index) => `组件 ${componentId(component) || componentIndex + 1} 参数绑定 ${binding.parameter || binding.parameter_code || binding.code || index + 1} 缺失`);
  });
  const runtimeErrors = draft.semantic.parameters
    .filter(parameter => (parameter.sourceType || parameter.source_type || 'runtime') === 'runtime')
    .filter(parameter => parameter.required !== false)
    .filter(parameter => !hasValue(draft.runtime_parameters[parameter.code]) && !hasValue(parameter.defaultValue ?? parameter.default))
    .map(parameter => `运行参数 ${parameter.name || parameter.code} ${parameter.code} 缺少必填值`);
  return [...componentBindingErrors, ...runtimeErrors];
}

function problemTypeErrors(draft: ModelDraft) {
  const variableTypes = draft.semantic.variables.map(variable => variable.variableType || (variable.domain === 'Binary' ? 'binary' : variable.domain === 'Integers' ? 'integer' : 'continuous'));
  const hasInteger = variableTypes.some(type => type === 'binary' || type === 'integer');
  const requested = String(draft.basic_info.solver || 'HiGHS');
  if (requested !== 'HiGHS') return [`当前求解器 ${requested} 尚未在前端兼容性矩阵中声明`];
  if (hasInteger && draft.formulas.some(formula => /piecewise|abs\(/i.test(formula.dsl_formula))) return ['整数变量与 piecewise/abs 组合需要后端特殊线性化确认'];
  return [];
}

export function validateModelDraft(d: ModelDraft): DraftValidation {
  const semanticErrors: string[] = [];
  if (!d.basic_info.name) semanticErrors.push('模型名称必填');
  if (!d.basic_info.model_code) semanticErrors.push('模型编码必填');
  if (!d.basic_info.scenario) semanticErrors.push('业务场景必填');
  if (!d.semantic.sets.length) semanticErrors.push('至少需要一个集合');
  if (!d.semantic.variables.length && d.basic_info.builder_mode === 'generic_linear') semanticErrors.push('通用线性 Builder 至少需要一个变量');

  const formulaErrors = d.formulas.flatMap(f => validateFormulaDef(f).errors.map(e => `${f.name}: ${e}`));
  if (d.basic_info.builder_mode === 'generic_linear' && !d.formulas.some(f => f.kind === 'objective')) formulaErrors.push('通用线性 Builder 至少需要一个目标公式');
  if (d.basic_info.builder_mode === 'generic_linear' && !d.advanced.generic_spec) formulaErrors.push('generic_spec 尚未编译');
  if ((d.advanced.generic_spec?.constraints as Array<Record<string, unknown>> | undefined)?.some(row => row.compile_status === 'unsupported')) formulaErrors.push('generic_spec 中存在无法编译的约束公式');

  const componentErrors = d.basic_info.builder_mode === 'component_based' && !d.components.length ? ['组件化 Builder 至少选择一个组件'] : dependencyErrors(d);
  const parameterErrors = parameterBindingErrors(d);
  const problemErrors = problemTypeErrors(d);
  const solverErrors = d.basic_info.solver === 'HiGHS' ? [] : [`求解器 ${d.basic_info.solver} 暂未声明兼容`];

  const sections = {
    semantic: { valid: semanticErrors.length === 0, errors: semanticErrors },
    formula: { valid: formulaErrors.length === 0, errors: formulaErrors },
    component_dependencies: { valid: componentErrors.length === 0, errors: componentErrors },
    parameter_bindings: { valid: parameterErrors.length === 0, errors: parameterErrors },
    problem_type: { valid: problemErrors.length === 0, errors: problemErrors },
    solver_compatibility: { valid: solverErrors.length === 0, errors: solverErrors },
  };
  return { valid: Object.values(sections).every(x => x.valid), sections };
}
