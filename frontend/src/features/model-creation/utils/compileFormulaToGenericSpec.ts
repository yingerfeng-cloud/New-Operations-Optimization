import type { FormulaDef } from '../../../types/formula';
import { splitRelation } from '../../formula-editor/formulaParser';
import { validateFormula } from '../../formula-editor/formulaValidator';

type Term = { var: string; key: string[]; foreach?: string[]; coef?: number; coef_param?: string; param_key?: string[]; sign?: string };
type ParamTerm = { param: string; key: string[]; coef?: number; sign?: string };
type LinearExpr = { terms: Term[]; paramTerms: ParamTerm[]; constant: number };
type SemanticSpec = {
  sets?: { code: string; values?: unknown[] }[];
  parameters?: { code: string; default?: unknown; defaultValue?: unknown; dimension?: string[]; indices?: string[] }[];
  variables?: { code: string; dimension?: string[]; indices?: string[]; domain?: string; variableType?: string; lowerBound?: string | number; upperBound?: string | number }[];
};

const ref = (text: string) => /^(\w+)(?:\[([^\]]+)\])?$/.exec(text.trim());
const keyList = (value?: string) => value?.split(',').map(x => x.trim()).filter(Boolean) || [];
const variableDomain = (variable: NonNullable<SemanticSpec['variables']>[number]) => variable.domain || (variable.variableType === 'binary' ? 'Binary' : variable.variableType === 'integer' ? 'Integers' : 'NonNegativeReals');

function splitTopLevel(expression: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && expression.startsWith(delimiter, index)) {
      parts.push(expression.slice(start, index).trim());
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}

function splitAdditive(expression: string): Array<{ raw: string; sign: number }> {
  const normalized = expression.trim();
  const parts: Array<{ raw: string; sign: number }> = [];
  let depth = 0;
  let start = 0;
  let sign = 1;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === '+' || char === '-') && index > start) {
      parts.push({ raw: normalized.slice(start, index).trim(), sign });
      sign = char === '-' ? -1 : 1;
      start = index + 1;
    }
  }
  const tail = normalized.slice(start).trim();
  if (tail) parts.push({ raw: tail, sign });
  return parts.length ? parts : [{ raw: normalized, sign: 1 }];
}

function negateTerm(term: Term): Term {
  if (term.coef_param) return { ...term, sign: term.sign === '-' ? undefined : '-' };
  return { ...term, coef: -1 * Number(term.coef ?? 1) };
}

function negateParamTerm(term: ParamTerm): ParamTerm {
  return { ...term, sign: term.sign === '-' ? undefined : '-' };
}

function applySignToTerm(term: Term, sign: number): Term {
  return sign < 0 ? negateTerm(term) : term;
}

function applySignToParamTerm(term: ParamTerm, sign: number): ParamTerm {
  return sign < 0 ? negateParamTerm(term) : term;
}

function addForeach(expr: LinearExpr, loops: string[]): LinearExpr {
  return {
    ...expr,
    terms: expr.terms.map(term => ({ ...term, foreach: [...(term.foreach || []), ...loops] })),
  };
}

function mergeExpr(parts: LinearExpr[]): LinearExpr {
  return {
    terms: parts.flatMap(part => part.terms),
    paramTerms: parts.flatMap(part => part.paramTerms),
    constant: parts.reduce((sum, part) => sum + part.constant, 0),
  };
}

function compileExpr(expression: string, variables: Set<string>, parameters: Set<string>): LinearExpr {
  const trimmed = expression.trim();
  const aggregate = /^sum\((.*?)(\s+for\s+\w+\s+in\s+\w+(?:\s+for\s+\w+\s+in\s+\w+)*)\)$/s.exec(trimmed);
  if (aggregate) {
    const loops = [...aggregate[2].matchAll(/for\s+\w+\s+in\s+(\w+)/g)].map(match => match[1]);
    return addForeach(compileExpr(aggregate[1].trim(), variables, parameters), loops);
  }
  const additive = splitAdditive(trimmed);
  if (additive.length > 1 || additive[0].sign < 0) {
    return mergeExpr(additive.map(part => {
      const expr = compileExpr(part.raw, variables, parameters);
      return {
        terms: expr.terms.map(term => applySignToTerm(term, part.sign)),
        paramTerms: expr.paramTerms.map(term => applySignToParamTerm(term, part.sign)),
        constant: expr.constant * part.sign,
      };
    }));
  }
  const factors = splitTopLevel(trimmed, '*');
  const refs = factors.map(ref);
  const variable = refs.find(match => match && variables.has(match[1]));
  const coefficient = refs.find(match => match && parameters.has(match[1]));
  const numericFactors = factors.map(Number).filter(value => !Number.isNaN(value));
  const numeric = numericFactors.reduce((product, value) => product * value, 1);
  if (variable) {
    if (refs.filter(match => match && variables.has(match[1])).length > 1) throw new Error(`变量乘变量属于非线性项: ${trimmed}`);
    return {
      terms: [{
        var: variable[1],
        key: keyList(variable[2]),
        ...(coefficient ? { coef_param: coefficient[1], param_key: keyList(coefficient[2]) } : { coef: numeric }),
      }],
      paramTerms: [],
      constant: 0,
    };
  }
  if (coefficient) return { terms: [], paramTerms: [{ param: coefficient[1], key: keyList(coefficient[2]), coef: numeric }], constant: 0 };
  const constant = Number(trimmed);
  if (!Number.isNaN(constant)) return { terms: [], paramTerms: [], constant };
  throw new Error(`无法编译线性表达式: ${trimmed}`);
}

function rhsFields(expr: LinearExpr): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (expr.paramTerms.length === 1 && expr.constant === 0 && Number(expr.paramTerms[0].coef ?? 1) === 1 && expr.paramTerms[0].sign !== '-') {
    fields.rhs_param = expr.paramTerms[0].param;
    fields.rhs_key = expr.paramTerms[0].key;
  } else {
    if (expr.paramTerms.length) fields.rhs_terms = expr.paramTerms;
    fields.rhs = expr.constant;
  }
  return fields;
}

function defaultSetValues(code: string, values?: unknown[]): unknown[] {
  if (values?.length) return values;
  if (code === 'time') return Array.from({ length: 24 }, (_, index) => index);
  if (code === 'time_volume') return Array.from({ length: 25 }, (_, index) => index);
  return [];
}

export function compileFormulaToGenericSpec(formulas: FormulaDef[], semantic: SemanticSpec, objectiveSense: 'minimize' | 'maximize' = 'minimize') {
  const variables = new Set((semantic.variables || []).map(v => v.code));
  const parameters = new Set((semantic.parameters || []).map(p => p.code));
  const constraints: Record<string, unknown>[] = []; const objectiveTerms: Term[] = [];
  for (const formula of formulas) {
    const check = validateFormula(formula.dsl_formula, formula.kind, formula.tokens, {}, formula.foreach.length ? formula.foreach : formula.free_indices);
    if (!check.valid) throw new Error(`${formula.name}: ${check.errors.join('；')}`);
    if (formula.kind === 'objective') {
      const expr = compileExpr(formula.dsl_formula, variables, parameters);
      if (expr.paramTerms.length || expr.constant) throw new Error(`${formula.name}: 目标函数暂不支持纯参数项或常数项`);
      objectiveTerms.push(...expr.terms);
      continue;
    }
    const relation = splitRelation(formula.dsl_formula)!;
    const lhs = compileExpr(relation.lhs, variables, parameters);
    const rhs = compileExpr(relation.rhs, variables, parameters);
    const movedTerms = [...lhs.terms, ...rhs.terms.map(negateTerm)];
    const row: Record<string, unknown> = {
      name: formula.name,
      foreach: formula.foreach.length ? formula.foreach : formula.free_indices,
      terms: movedTerms,
      sense: relation.sense,
      dsl_formula: formula.dsl_formula,
      formula: formula.dsl_formula,
      compile_status: 'compiled',
      ...rhsFields({
        terms: [],
        paramTerms: [...rhs.paramTerms, ...lhs.paramTerms.map(negateParamTerm)],
        constant: rhs.constant - lhs.constant,
      }),
    };
    if (!movedTerms.length) throw new Error(`${formula.name}: 约束左端缺少可编译变量项`);
    constraints.push(row);
  }
  if (!objectiveTerms.length) throw new Error('至少需要一个可编译目标函数');
  return {
    sets: Object.fromEntries((semantic.sets || []).map(s => [s.code, defaultSetValues(s.code, s.values)])),
    parameters: Object.fromEntries((semantic.parameters || []).map(p => [p.code, p.defaultValue ?? p.default ?? 0])),
    variables: (semantic.variables || []).map(v => ({
      name: v.code,
      indices: v.indices || v.dimension || [],
      domain: variableDomain(v),
      ...(v.lowerBound !== undefined ? { lb: Number(v.lowerBound) } : {}),
      ...(v.upperBound !== undefined && v.upperBound !== '' ? { ub: Number(v.upperBound) } : {}),
    })),
    constraints,
    objective: { sense: objectiveSense, terms: objectiveTerms },
    sense: objectiveSense,
  };
}
