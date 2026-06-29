import type { FormulaToken, SymbolKind } from '../../types/formula';
import type { ModelDraft } from '../model-creation/stores/modelCreationStore';
import type { FormulaSymbols } from './formulaParser';

export interface FormulaSymbolItem {
  code: string;
  name: string;
  type: SymbolKind;
  typeLabel: string;
  indices?: string[];
  indexNames?: string[];
  unit?: string;
  description?: string;
}

export interface FormulaDictionaryContext {
  semantic?: Partial<ModelDraft['semantic']>;
  components?: Array<Record<string, unknown>>;
  symbols?: FormulaSymbols;
}

const builtInSymbols: FormulaSymbolItem[] = [
  { code: 'M', name: 'Big-M 常数', type: 'parameter', typeLabel: '参数', unit: '', description: '用于逻辑约束线性化的足够大常数' },
];

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function normalizeIndices(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(item => String(item)).filter(Boolean);
}

function fromSymbols(symbols?: FormulaSymbols): FormulaSymbolItem[] {
  if (!symbols) return [];
  return [
    ...Object.entries(symbols.sets || {}).map(([code, label]) => ({
      code,
      name: typeof label === 'string' ? label : code,
      type: 'set' as const,
      typeLabel: '集合',
    })),
    ...Object.entries(symbols.parameters || {}).map(([code, item]) => ({
      code,
      name: item.label || code,
      type: 'parameter' as const,
      typeLabel: '参数',
      indices: item.indices,
      indexNames: item.indexNames,
      unit: item.unit,
      description: item.description,
    })),
    ...Object.entries(symbols.variables || {}).map(([code, item]) => ({
      code,
      name: item.label || code,
      type: 'variable' as const,
      typeLabel: '变量',
      indices: item.indices,
      indexNames: item.indexNames,
      unit: item.unit,
      description: item.description,
    })),
  ];
}

function fromSemantic(semantic?: Partial<ModelDraft['semantic']>): FormulaSymbolItem[] {
  if (!semantic) return [];
  return [
    ...(semantic.sets || []).map(item => ({
      code: item.code,
      name: item.name || item.code,
      type: 'set' as const,
      typeLabel: '集合',
      description: item.description,
    })),
    ...(semantic.parameters || []).map(item => ({
      code: item.code,
      name: item.name || item.code,
      type: 'parameter' as const,
      typeLabel: '参数',
      indices: item.indices || item.dimension,
      unit: item.unit,
      description: item.description,
    })),
    ...(semantic.variables || []).map(item => ({
      code: item.code,
      name: item.name || item.code,
      type: 'variable' as const,
      typeLabel: '变量',
      indices: item.indices || item.dimension,
      unit: item.unit,
      description: item.description,
    })),
  ];
}

function fromComponents(components?: Array<Record<string, unknown>>): FormulaSymbolItem[] {
  return (components || []).flatMap(component => [
    ...asArray(component.required_sets).map(item => ({
      code: String(item.code || item.key || ''),
      name: String(item.name || item.code || item.key || ''),
      type: 'set' as const,
      typeLabel: '集合',
      indices: normalizeIndices(item.dimension),
      description: String(item.description || ''),
    })),
    ...asArray(component.parameters).map(item => ({
      code: String(item.code || item.key || ''),
      name: String(item.name || item.code || item.key || ''),
      type: 'parameter' as const,
      typeLabel: '参数',
      indices: normalizeIndices(item.dimension),
      unit: String(item.unit || ''),
      description: String(item.description || ''),
    })),
    ...asArray(component.variables).map(item => ({
      code: String(item.code || item.key || ''),
      name: String(item.name || item.code || item.key || ''),
      type: 'variable' as const,
      typeLabel: '变量',
      indices: normalizeIndices(item.dimension),
      unit: String(item.unit || ''),
      description: String(item.description || ''),
    })),
  ]).filter(item => item.code);
}

export function getFormulaSymbolDictionary(context: FormulaDictionaryContext): FormulaSymbolItem[] {
  const merged = new Map<string, FormulaSymbolItem>();
  [...fromSemantic(context.semantic), ...fromComponents(context.components), ...fromSymbols(context.symbols), ...builtInSymbols].forEach(item => {
    const key = `${item.type}:${item.code}`;
    if (!merged.has(key)) merged.set(key, item);
  });
  return Array.from(merged.values());
}

export function dictionaryToSymbols(dictionary: FormulaSymbolItem[]): FormulaSymbols {
  return {
    sets: Object.fromEntries(dictionary.filter(item => item.type === 'set').map(item => [item.code, item.name])),
    parameters: Object.fromEntries(dictionary.filter(item => item.type === 'parameter').map(item => [item.code, {
      label: item.name,
      indices: item.indices,
      indexNames: item.indexNames,
      unit: item.unit,
      description: item.description,
    }])),
    variables: Object.fromEntries(dictionary.filter(item => item.type === 'variable').map(item => [item.code, {
      label: item.name,
      indices: item.indices,
      indexNames: item.indexNames,
      unit: item.unit,
      description: item.description,
    }])),
  };
}

export function symbolItemToToken(item: FormulaSymbolItem): FormulaToken {
  return {
    type: item.type,
    code: item.code,
    label: item.name,
    indices: item.indices,
    indexAliases: item.indices,
  };
}
