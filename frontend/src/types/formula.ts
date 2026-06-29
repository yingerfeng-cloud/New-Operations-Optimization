export type FormulaToken = SymbolToken | OperatorToken | NumberToken | AggregateToken | FunctionToken;
export type SymbolKind = 'set' | 'parameter' | 'variable';
export interface SymbolToken { type: SymbolKind; code: string; label: string; indices?: string[]; indexAliases?: string[] }
export interface OperatorToken { type: 'operator'; code: string; label: string }
export interface NumberToken { type: 'number'; value: number; label?: string }
export interface FunctionToken { type: 'function'; fn: 'abs' | 'piecewise'; bodyTokens: FormulaToken[] }
export interface AggregateToken { type: 'aggregate'; fn: 'sum' | 'min' | 'max'; setCode: string; alias: string; bodyTokens: FormulaToken[] }
export interface FormulaDef { formula_id: string; name: string; kind: 'constraint' | 'objective'; solve_participation?: 'solve_active' | 'preview_only'; display_formula: string; dsl_formula: string; tokens: FormulaToken[]; foreach: string[]; referenced_sets: string[]; referenced_parameters: string[]; referenced_variables: string[]; free_indices: string[]; big_m?: boolean; compile_status: 'ready' | 'error' | 'unsupported'; compile_error?: string }
