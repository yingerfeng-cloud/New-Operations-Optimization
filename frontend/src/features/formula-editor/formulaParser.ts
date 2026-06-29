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

  const pattern = /(>=|<=|==|!=|[+\-*/=()])|([A-Za-z_]\w*)(?:\[([^\]]+)\])?|(\d+(?:\.\d+)?)/g;
  const out: FormulaToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match[1]) {
      if (!['(', ')'].includes(match[1])) out.push({ type: 'operator', code: match[1], label: match[1] });
      continue;
    }
    if (match[4]) {
      out.push({ type: 'number', value: Number(match[4]) });
      continue;
    }

    const code = match[2];
    const nextChar = text[pattern.lastIndex];
    if (keywords.has(code) || (aggregateNames.has(code) && nextChar === '(')) continue;

    const aliases = match[3]?.split(',').map(item => item.trim()).filter(Boolean);
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
