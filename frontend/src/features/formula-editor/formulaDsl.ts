import type { FormulaToken } from '../../types/formula';
import { parseFormulaDsl, type FormulaSymbols } from './formulaParser';

const opLabel: Record<string, string> = { '>=': '≥', '<=': '≤', '==': '=', '=': '=', '!=': '≠', '+': '+', '-': '−', '*': '×', '/': '÷' };

export function tokenToDsl(token: FormulaToken): string {
  if (token.type === 'aggregate') return `${token.fn}(${tokensToDsl(token.bodyTokens)} for ${token.alias} in ${token.setCode})`;
  if (token.type === 'function') return `${token.fn}(${tokensToDsl(token.bodyTokens)})`;
  if (token.type === 'operator') return token.code === '=' ? '==' : token.code;
  if (token.type === 'number') return String(token.value);
  const aliases = token.indexAliases || token.indices || [];
  return `${token.code}${aliases.length ? `[${aliases.join(',')}]` : ''}`;
}

export function tokenToDisplay(token: FormulaToken): string {
  if (token.type === 'aggregate') return `${token.fn === 'sum' ? 'Σ' : token.fn}(${token.setCode} ${token.alias})：[${tokensToDisplay(token.bodyTokens)}]`;
  if (token.type === 'function') return `${token.fn}(${tokensToDisplay(token.bodyTokens)})`;
  if (token.type === 'operator') return opLabel[token.code] || token.code;
  if (token.type === 'number') return String(token.value);
  const aliases = token.indexAliases || token.indices || [];
  return `${token.label || token.code}${aliases.length ? `[${aliases.join(',')}]` : ''}`;
}

export const tokensToDsl = (tokens: FormulaToken[]) => tokens.map(tokenToDsl).join(' ').replace(/\s+([\],)])/g, '$1');
export const tokensToDisplay = (tokens: FormulaToken[]) => tokens.map(tokenToDisplay).join(' ');

export function collectReferences(tokens: FormulaToken[]) {
  const sets = new Set<string>();
  const parameters = new Set<string>();
  const variables = new Set<string>();
  const indices = new Set<string>();
  const coveredAliases = new Set<string>();

  const visit = (list: FormulaToken[]) => list.forEach(token => {
    if (token.type === 'aggregate') {
      sets.add(token.setCode);
      coveredAliases.add(token.alias);
      coveredAliases.add(token.setCode);
      visit(token.bodyTokens);
      return;
    }
    if (token.type === 'function') {
      visit(token.bodyTokens);
      return;
    }
    if (token.type === 'set') {
      sets.add(token.code);
      return;
    }
    if (token.type === 'parameter') {
      parameters.add(token.code);
      (token.indices || token.indexAliases || []).forEach(index => indices.add(index));
      return;
    }
    if (token.type === 'variable') {
      variables.add(token.code);
      (token.indices || token.indexAliases || []).forEach(index => indices.add(index));
    }
  });

  visit(tokens);
  return {
    referenced_sets: [...sets],
    referenced_parameters: [...parameters],
    referenced_variables: [...variables],
    referenced_indices: [...indices],
    aggregated_indices: [...coveredAliases],
    free_indices: [...indices].filter(index => !coveredAliases.has(index)),
  };
}

export function renderFormulaReadable(dsl: string, context: FormulaSymbols = {}): string {
  return tokensToDisplay(parseFormulaDsl(dsl, context));
}

export function normalizeReadableFormula(displayFormula: string, context: FormulaSymbols = {}): string {
  let dsl = displayFormula;
  const entries = [
    ...Object.entries(context.variables || {}),
    ...Object.entries(context.parameters || {}),
    ...Object.entries(context.sets || {}).map(([code, label]) => [code, { label }] as const),
  ].sort((a, b) => (b[1].label || b[0]).length - (a[1].label || a[0]).length);
  for (const [code, item] of entries) {
    const label = item.label || code;
    if (label !== code) dsl = dsl.replaceAll(label, code);
  }
  return dsl.replaceAll('≤', '<=').replaceAll('≥', '>=').replaceAll('≠', '!=').replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-').replace(/\s+/g, ' ').trim();
}
