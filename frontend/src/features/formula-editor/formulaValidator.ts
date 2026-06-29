import type { FormulaDef, FormulaToken } from '../../types/formula';
import { splitRelation, type FormulaSymbols } from './formulaParser';
import { collectReferences } from './formulaDsl';

export interface FormulaValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFormula(
  dsl: string,
  kind: 'constraint' | 'objective',
  tokens: FormulaToken[] = [],
  symbols: FormulaSymbols = {},
  foreach: string[] = [],
): FormulaValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = dsl.trim();

  if (!text) errors.push('表达式不能为空');
  const relation = splitRelation(text);
  if (kind === 'constraint' && !relation) errors.push('约束表达式必须包含 >=、<=、== 或 !=');
  if (kind === 'objective' && relation) errors.push('目标函数不能包含关系符');
  if (relation?.sense === '!=') errors.push('!= 需要离散化，当前线性编译器不支持');
  if (/\b(abs|max|min|piecewise)\s*\(/.test(text) && !/^\s*(max|min)\([^)]*\sfor\s/.test(text)) {
    errors.push('科学函数或分段函数需要先线性化');
  }

  const vars = new Set<string>();
  const visit = (items: FormulaToken[]) => items.forEach(token => {
    if (token.type === 'variable') vars.add(token.code);
    else if (token.type === 'aggregate' || token.type === 'function') visit(token.bodyTokens);
  });
  visit(tokens);
  for (const a of vars) {
    for (const b of vars) {
      const ref = `${a}(?:\\[[^\\]]+\\])?`;
      const ref2 = `${b}(?:\\[[^\\]]+\\])?`;
      if (new RegExp(`${ref}\\s*[*/]\\s*${ref2}`).test(text)) {
        errors.push('变量乘除变量属于非线性表达');
        break;
      }
    }
  }

  const refs = collectReferences(tokens);
  const setCodes = new Set(Object.keys(symbols.sets || {}));
  const parameterCodes = new Set(Object.keys(symbols.parameters || {}));
  const variableCodes = new Set(Object.keys(symbols.variables || {}));
  if (setCodes.size || parameterCodes.size || variableCodes.size) {
    refs.referenced_sets.forEach(code => {
      if (!setCodes.has(code)) errors.push(`引用集合不存在：${code}`);
    });
    refs.referenced_parameters.forEach(code => {
      if (!parameterCodes.has(code)) errors.push(`引用参数不存在：${code}`);
    });
    refs.referenced_variables.forEach(code => {
      if (!variableCodes.has(code)) errors.push(`引用变量不存在：${code}`);
    });
  }

  const foreachSet = new Set(foreach);
  refs.free_indices.forEach(code => {
    if (!foreachSet.has(code)) errors.push(`自由索引未被作用范围覆盖：${code}`);
  });
  tokens.forEach(token => {
    if (token.type === 'aggregate' && !token.setCode) errors.push('聚合索引未定义');
  });
  if (/\b(piecewise|Big-?M|M)\b/i.test(text)) {
    warnings.push('已识别 piecewise / Big-M 线性化线索，请确认后端编译器支持该形式');
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export const validateFormulaDef = (formula: FormulaDef) => validateFormula(
  formula.dsl_formula,
  formula.kind,
  formula.tokens,
  {},
  formula.foreach.length ? formula.foreach : formula.free_indices,
);
