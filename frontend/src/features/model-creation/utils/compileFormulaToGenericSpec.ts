import type { FormulaDef } from '../../../types/formula';
import { splitRelation } from '../../formula-editor/formulaParser';
import { validateFormulaDef } from '../../formula-editor/formulaValidator';

type Term = { var: string; key: string[]; foreach?: string[]; coef?: number; coef_param?: string; param_key?: string[]; sign?: string };
const ref = (text: string) => /^(\w+)(?:\[([^\]]+)\])?$/.exec(text.trim());
function compileExpr(expression: string, variables: Set<string>, parameters: Set<string>): Term[] {
  const aggregate = /^sum\((.*?)(\s+for\s+\w+\s+in\s+\w+(?:\s+for\s+\w+\s+in\s+\w+)*)\)$/s.exec(expression.trim());
  if (aggregate) {
    const loops = [...aggregate[2].matchAll(/for\s+\w+\s+in\s+(\w+)/g)].map(match => match[1]);
    return compileExpr(aggregate[1].trim(), variables, parameters).map(term => ({ ...term, foreach: [...(term.foreach || []), ...loops] }));
  }
  const parts = expression.replace(/\s-\s/g, ' + -').split(/\s+\+\s+/);
  return parts.map(raw => {
    let product = raw.trim(); let sign = 1;
    if (product.startsWith('-')) { sign = -1; product = product.slice(1).trim(); }
    const factors = product.split(/\s*\*\s*/);
    const variable = factors.map(ref).find(match => match && variables.has(match[1]));
    if (!variable) throw new Error(`线性项缺少决策变量: ${raw}`);
    const coefficient = factors.map(ref).find(match => match && parameters.has(match[1]));
    const numeric = factors.map(Number).find(value => !Number.isNaN(value));
    return { var: variable[1], key: variable[2]?.split(',').map(x => x.trim()) || [], ...(coefficient ? { coef_param: coefficient[1], param_key: coefficient[2]?.split(',').map(x => x.trim()) || [], ...(sign < 0 ? { sign: '-' } : {}) } : { coef: sign * (numeric ?? 1) }) };
  });
}
export function compileFormulaToGenericSpec(formulas: FormulaDef[], semantic: { sets?: { code: string; values?: unknown[] }[]; parameters?: { code: string; default?: unknown }[]; variables?: { code: string; dimension?: string[]; domain?: string }[] }, objectiveSense: 'minimize' | 'maximize' = 'minimize') {
  const variables = new Set((semantic.variables || []).map(v => v.code));
  const parameters = new Set((semantic.parameters || []).map(p => p.code));
  const constraints: Record<string, unknown>[] = []; const objectiveTerms: Term[] = [];
  for (const formula of formulas) {
    const check = validateFormulaDef(formula);
    if (!check.valid) throw new Error(`${formula.name}: ${check.errors.join('；')}`);
    if (formula.kind === 'objective') { objectiveTerms.push(...compileExpr(formula.dsl_formula, variables, parameters)); continue; }
    const relation = splitRelation(formula.dsl_formula)!;
    const row: Record<string, unknown> = { name: formula.name, foreach: formula.foreach.length ? formula.foreach : formula.free_indices, terms: compileExpr(relation.lhs, variables, parameters), sense: relation.sense };
    const rhsRef = ref(relation.rhs);
    if (rhsRef && parameters.has(rhsRef[1])) { row.rhs_param = rhsRef[1]; row.rhs_key = rhsRef[2]?.split(',').map(x => x.trim()) || []; }
    else if (!Number.isNaN(Number(relation.rhs))) row.rhs = Number(relation.rhs);
    else throw new Error(`${formula.name}: 约束右端必须是常数或单个参数`);
    constraints.push(row);
  }
  if (!objectiveTerms.length) throw new Error('至少需要一个可编译目标函数');
  return { sets: Object.fromEntries((semantic.sets || []).map(s => [s.code, s.values || []])), parameters: Object.fromEntries((semantic.parameters || []).map(p => [p.code, p.default ?? 0])), variables: (semantic.variables || []).map(v => ({ name: v.code, indices: v.dimension || [], domain: v.domain || 'NonNegativeReals' })), constraints, objective: { sense: objectiveSense, terms: objectiveTerms }, sense: objectiveSense };
}
