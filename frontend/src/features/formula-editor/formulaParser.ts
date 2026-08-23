import type { FormulaToken, SymbolKind } from '../../types/formula';

export interface FormulaSymbolMeta {
  label?: string;
  indices?: string[];
  indexNames?: string[];
  unit?: string;
  description?: string;
}

export interface FormulaSymbols {
  sets?: Record<string, string>;
  parameters?: Record<string, FormulaSymbolMeta>;
  variables?: Record<string, FormulaSymbolMeta>;
}

const aggregateNames = new Set(['sum', 'min', 'max']);
const functionNames = new Set(['abs', 'piecewise', 'log', 'exp', 'sqrt']);
const keywords = new Set(['for', 'in']);

function findTopLevelRelation(dsl: string) {
  let depth = 0;
  for (let index = 0; index < dsl.length; index += 1) {
    const char = dsl[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0) {
      const op = ['>=', '<=', '==', '!='].find(item => dsl.startsWith(item, index));
      if (op) return { index, op };
    }
  }
  return undefined;
}

function parseAggregate(text: string, symbols: FormulaSymbols): FormulaToken[] | undefined {
  const aggregate = /^(sum|min|max)\((.*)\s+for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\)$/s.exec(text.trim());
  if (!aggregate) return undefined;
  return [{
    type: 'aggregate',
    fn: aggregate[1] as 'sum' | 'min' | 'max',
    setCode: aggregate[4],
    alias: aggregate[3],
    bodyTokens: parseFormulaDsl(aggregate[2], symbols),
  }];
}

function findClosingParenthesis(text: string, openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function parseFormulaDsl(input: string, symbols: FormulaSymbols = {}): FormulaToken[] {
  const text = input.trim();
  if (!text) return [];

  const relation = findTopLevelRelation(text);
  if (relation) {
    return [
      ...parseFormulaDsl(text.slice(0, relation.index), symbols),
      { type: 'operator', code: relation.op, label: relation.op },
      ...parseFormulaDsl(text.slice(relation.index + relation.op.length), symbols),
    ];
  }

  const aggregate = parseAggregate(text, symbols);
  if (aggregate) return aggregate;

  const out: FormulaToken[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    const operator = /^(>=|<=|==|!=|[+\-*/=,])/.exec(rest)?.[1];
    if (operator) {
      out.push({ type: 'operator', code: operator, label: operator });
      cursor += operator.length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest)?.[0];
    if (number) {
      out.push({ type: 'number', value: Number(number) });
      cursor += number.length;
      continue;
    }

    const identifier = /^([A-Za-z_]\w*)(?:\[([^\]]+)\])?/.exec(rest);
    if (!identifier) {
      cursor += 1;
      continue;
    }
    const code = identifier[1];
    const indicesText = identifier[2];
    const afterIdentifier = cursor + identifier[0].length;
    if (!indicesText && text[afterIdentifier] === '(' && (aggregateNames.has(code) || functionNames.has(code))) {
      const closeIndex = findClosingParenthesis(text, afterIdentifier);
      if (closeIndex !== -1) {
        const callText = text.slice(cursor, closeIndex + 1);
        const nestedAggregate = aggregateNames.has(code) ? parseAggregate(callText, symbols) : undefined;
        if (nestedAggregate) {
          out.push(...nestedAggregate);
        } else if (functionNames.has(code)) {
          out.push({
            type: 'function',
            fn: code as 'abs' | 'piecewise' | 'log' | 'exp' | 'sqrt',
            bodyTokens: parseFormulaDsl(text.slice(afterIdentifier + 1, closeIndex), symbols),
          });
        } else {
          out.push(...parseFormulaDsl(text.slice(afterIdentifier + 1, closeIndex), symbols));
        }
        cursor = closeIndex + 1;
        continue;
      }
    }
    cursor = afterIdentifier;
    if (keywords.has(code)) continue;

    const aliases = indicesText?.split(',').map(item => item.trim()).filter(Boolean);
    let kind: SymbolKind = aliases?.length ? 'variable' : 'parameter';
    let def = symbols.parameters?.[code];
    if (symbols.variables?.[code]) {
      kind = 'variable';
      def = symbols.variables[code];
    } else if (symbols.parameters?.[code]) {
      kind = 'parameter';
      def = symbols.parameters[code];
    } else if (symbols.sets?.[code]) {
      kind = 'set';
    }
    out.push({
      type: kind,
      code,
      label: def?.label || symbols.sets?.[code] || code,
      indices: def?.indices || aliases,
      indexAliases: aliases,
    });
  }
  return out;
}

export function splitRelation(dsl: string) {
  const relation = findTopLevelRelation(dsl);
  if (!relation) return undefined;
  return {
    lhs: dsl.slice(0, relation.index).trim(),
    sense: relation.op,
    rhs: dsl.slice(relation.index + relation.op.length).trim(),
  };
}
