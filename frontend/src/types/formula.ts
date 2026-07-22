export type FormulaToken = SymbolToken | OperatorToken | NumberToken | AggregateToken | FunctionToken;
export type SymbolKind = 'set' | 'parameter' | 'variable';
export interface SymbolToken { type: SymbolKind; code: string; label: string; indices?: string[]; indexAliases?: string[] }
export interface OperatorToken { type: 'operator'; code: string; label: string }
export interface NumberToken { type: 'number'; value: number; label?: string }
export interface FunctionToken { type: 'function'; fn: 'abs' | 'piecewise'; bodyTokens: FormulaToken[] }
export interface AggregateToken { type: 'aggregate'; fn: 'sum' | 'min' | 'max'; setCode: string; alias: string; bodyTokens: FormulaToken[] }
export type FormulaDiagnosticStage = 'syntax' | 'symbol' | 'dimension' | 'unit' | 'classification' | 'compile';
export interface FormulaDiagnostic { code: string; severity: 'error' | 'warning' | 'info'; stage: FormulaDiagnosticStage; message: string; start: number; end: number; symbolCode?: string; expected?: unknown; actual?: unknown; fixHint?: string }
export interface FormulaCompileResult {
  success: boolean;
  ast_version: string;
  compiler_version?: string;
  ast?: Record<string, unknown>;
  normalized_expression: string;
  expression_class: 'constant' | 'linear' | 'quadratic' | 'bilinear' | 'piecewise_linear' | 'general_nonlinear' | 'logical' | 'unsupported';
  diagnostics: FormulaDiagnostic[];
  references: Array<Record<string, unknown>>;
  scope: Array<{ alias: string; set: string }>;
  participation: 'solve_active' | 'preview_only';
  compiled_fragment?: Record<string, unknown>;
  estimated_expansion: { constraint_count: number; term_count: number; exact: boolean };
  status: 'draft' | 'syntax_valid' | 'semantic_valid' | 'compile_valid' | 'compile_failed' | 'preview_only';
  checks: { syntax: string; symbol_dimension_unit: string; classification: string; compile: string };
}
export interface AuthoritativeFormulaArtifact {
  formula_id: string;
  input_signature: string;
  ast_version: string;
  compiler_version: string;
  normalized_expression: string;
  expression_class: FormulaCompileResult['expression_class'];
  ast?: Record<string, unknown>;
  compiled_fragment: Record<string, unknown>;
  source_trace: Array<Record<string, unknown>>;
  diagnostics: FormulaDiagnostic[];
  scope: Array<{ alias: string; set: string }>;
  compiled_at: string;
}
export interface FormulaVersionSnapshot { revision: number; expression_hash: string; expression: string; scope: Array<{ alias: string; set: string }>; participation: 'solve_active' | 'preview_only' | 'disabled'; direction?: 'minimize' | 'maximize'; weight?: number; compile_status: FormulaDef['compile_status']; saved_at: string; compiler_version?: string }
export interface FormulaVersionState { current_revision: number; last_saved_revision?: number; last_compiled_revision?: number; applied_revision?: number; published_revision?: number; expression_hash: string; compiled_expression_hash?: string; compiler_version?: string; compiled_at?: string }
export interface FormulaDef { formula_id: string; name: string; kind: 'constraint' | 'objective'; solve_participation?: 'solve_active' | 'preview_only' | 'disabled'; objective_direction?: 'minimize' | 'maximize'; weight?: number; priority?: number; business_group?: string; created_at?: string; updated_at?: string; display_formula: string; dsl_formula: string; tokens: FormulaToken[]; foreach: string[]; scope?: Array<{ alias: string; set: string }>; referenced_sets: string[]; referenced_parameters: string[]; referenced_variables: string[]; free_indices: string[]; big_m?: boolean; compile_status: 'ready' | 'error' | 'unsupported' | 'draft' | 'stale' | 'syntax_valid' | 'semantic_valid' | 'compile_valid' | 'compile_failed' | 'preview_only' | 'disabled'; compile_error?: string; diagnostics?: FormulaDiagnostic[]; ast_version?: string; compiler_version?: string; authoritative_artifact?: AuthoritativeFormulaArtifact; migration_status?: 'migrated' | 'needs_review' | 'unsupported' | 'preview_only'; version_state?: FormulaVersionState; last_saved_version?: FormulaVersionSnapshot; last_compiled_version?: FormulaVersionSnapshot; applied_version?: FormulaVersionSnapshot; published_version?: FormulaVersionSnapshot }
