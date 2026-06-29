export interface FunctionAsset {
  function_id: string;
  name: string;
  function_type: 'piecewise_1d' | 'piecewise_2d' | 'formula';
  input_schema?: Array<Record<string, unknown>>;
  output_schema?: Record<string, unknown>;
  group_keys?: string[];
  interpolation?: string;
  points: number[][];
  domain?: { x_min?: number; x_max?: number; breakpoint_count?: number; [key: string]: unknown };
  monotonicity?: string | null;
  convexity?: string | null;
  solve_strategy?: 'display_only' | 'convex_combination_lp' | 'binary_segment_milp';
  status?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  validation_status?: 'valid' | 'warning' | 'invalid';
  validation_errors?: Array<Record<string, unknown>>;
  validation_warnings?: Array<Record<string, unknown>>;
  referenced_by?: Array<Record<string, unknown>>;
}

export interface FunctionAssetValidation {
  valid: boolean;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  validation_status?: 'valid' | 'warning' | 'invalid';
  validation_errors?: Array<Record<string, unknown>>;
  validation_warnings?: Array<Record<string, unknown>>;
  domain: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

export interface FunctionAssetPreview {
  function_id: string;
  values: Array<{ x: number; y: number }>;
  domain: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  validation_status?: 'valid' | 'warning' | 'invalid';
}
