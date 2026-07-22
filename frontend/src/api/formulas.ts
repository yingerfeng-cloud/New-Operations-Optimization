import type { FormulaCompileResult } from '../types/formula';
import { apiClient, unwrap } from './client';

export interface FormulaAnalyzePayload {
  formula: string;
  formula_type: 'constraint' | 'objective' | 'expression';
  participation: 'solve_active' | 'preview_only';
  ast_version: '1.0';
  formula_id?: string;
  objective_direction?: 'minimize' | 'maximize';
  scope: Array<{ alias: string; set: string }>;
  symbols: Record<string, unknown>;
  model_context?: Record<string, unknown>;
}

export const analyzeFormula = (payload: FormulaAnalyzePayload) =>
  unwrap<FormulaCompileResult>(apiClient.post('/api/formulas/analyze', payload, { suppressErrorToast: true }));

export const expandFormula = (payload: FormulaAnalyzePayload) =>
  unwrap<FormulaCompileResult>(apiClient.post('/api/formulas/expand', payload, { suppressErrorToast: true }));
