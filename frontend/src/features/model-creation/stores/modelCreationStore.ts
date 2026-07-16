import { create } from 'zustand';
import type { FormulaDef } from '../../../types/formula';
import type { BuildMode } from '../../../types/model';
import type { ModelTemplate } from '../../../types/template';

export type ModelWorkspaceMode = 'new' | 'template' | 'edit' | 'clone' | 'version';

export interface ModelWorkspaceContext {
  mode: ModelWorkspaceMode;
  sourceModelId?: string;
  templateCode?: string;
  modelFamilyId?: string;
  currentAssetId?: string;
  sessionId: string;
  initialized: boolean;
  dirty: boolean;
}

export type TimeDimensionPolicy = 'not_applicable' | 'fixed' | 'runtime_variable' | 'data_derived';

export interface TimeDimensionConfig {
  schema_version: 1;
  enabled: boolean;
  policy: TimeDimensionPolicy;
  default_horizon?: number;
  time_set?: string;
  state_time_set?: string | null;
  editable?: boolean;
  min_horizon?: number;
  max_horizon?: number;
  horizon_step?: number;
  allowed_horizons?: number[];
  interval_minutes?: number;
  delta_t?: number;
  interval_minutes_by_horizon?: Record<string, number>;
  delta_t_by_horizon?: Record<string, number>;
  derive_from?: string | null;
  label_set?: string | null;
  label_generation?: 'none' | 'auto';
  label_format?: 'HH:mm' | 'sequence';
}

export interface ModelDraft {
  basic_info: { name: string; model_code: string; scenario: string; scenario_id?: string; builder_mode: BuildMode; solver: string; template_code?: string; modeling_skeleton?: string };
  semantic: {
    ui_metadata?: Record<string, unknown>;
    sets: Array<{
      code: string;
      name?: string;
      description?: string;
      dimensionType?: string;
      sourceType?: 'runtime' | 'static' | 'ledger' | 'system';
      source_type?: 'runtime' | 'static' | 'ledger' | 'system';
      defaultSize?: number;
      values?: unknown[];
      horizon?: number;
      type?: string;
      base_set?: string;
      generation_rule?: string;
      managed_by?: string;
    }>;
    parameters: Array<{
      code: string;
      name?: string;
      unit?: string;
      indices?: string[];
      dimension?: string[];
      dimensions?: string[];
      index_sets?: string[];
      sourceType?: 'runtime' | 'static' | 'ledger' | 'system';
      source_type?: 'runtime' | 'static' | 'ledger' | 'system';
      defaultValue?: unknown;
      default_value?: unknown;
      default?: unknown;
      exampleValue?: unknown;
      required?: boolean;
      description?: string;
    }>;
    variables: Array<{
      code: string;
      name?: string;
      variableType?: 'continuous' | 'binary' | 'integer';
      indices?: string[];
      dimension?: string[];
      dimensions?: string[];
      index_sets?: string[];
      lowerBound?: string | number;
      upperBound?: string | number;
      unit?: string;
      description?: string;
      domain?: string;
    }>;
  };
  components: Array<Record<string, unknown>>;
  objective?: Record<string, unknown>;
  formulas: FormulaDef[];
  time_dimension: TimeDimensionConfig;
  runtime_parameters: Record<string, unknown>;
  parameter_groups: Record<string, Record<string, unknown>>;
  advanced: { generic_spec?: Record<string, unknown>; component_spec?: Record<string, unknown>; ui_metadata?: Record<string, unknown> };
}

export interface ModelDraftValidationResult {
  valid: boolean;
  sections?: Record<string, { errors?: string[]; warnings?: string[] }>;
}

const createBaseSemantic = (): ModelDraft['semantic'] => ({
  sets: [],
  parameters: [],
  variables: [],
});

const createParameterGroups = (): ModelDraft['parameter_groups'] => ({
  runtime: {},
  static: {},
  ledger: {},
  system: {},
  objective_weights: {},
});

function createSessionId() {
  return `workspace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createModelCode() {
  return `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createBlankDraft(options: { generateCode?: boolean } = {}): ModelDraft {
  return {
    basic_info: {
      name: '',
      model_code: options.generateCode === false ? '' : createModelCode(),
      scenario: '',
      scenario_id: undefined,
      builder_mode: 'generic_linear',
      solver: 'HiGHS',
      template_code: undefined,
      modeling_skeleton: undefined,
    },
    semantic: createBaseSemantic(),
    components: [],
    formulas: [],
    time_dimension: { schema_version: 1, enabled: false, policy: 'not_applicable', editable: false },
    runtime_parameters: {},
    parameter_groups: createParameterGroups(),
    advanced: {},
  };
}

/** @deprecated Prefer createBlankDraft. Kept for utility and test compatibility. */
export function createInitialDraft(): ModelDraft {
  return createBlankDraft();
}

export const initialDraft: ModelDraft = createInitialDraft();

function patchDraft(current: ModelDraft, patch: Partial<ModelDraft>): ModelDraft {
  return {
    ...current,
    ...patch,
    basic_info: patch.basic_info ? { ...current.basic_info, ...patch.basic_info } : current.basic_info,
    semantic: patch.semantic ? { ...current.semantic, ...patch.semantic } : current.semantic,
    advanced: patch.advanced ? { ...current.advanced, ...patch.advanced } : current.advanced,
  };
}

interface State {
  draft: ModelDraft;
  modelDraft: ModelDraft;
  workspace: ModelWorkspaceContext;
  step: number;
  builderMode: BuildMode;
  loadedTemplate: ModelTemplate | null;
  validationResult: ModelDraftValidationResult | null;
  currentDraftModelId?: string;
  setStep: (n: number) => void;
  updateDraft: (patch: Partial<ModelDraft>) => void;
  setDraft: (d: ModelDraft) => void;
  initializeWorkspace: (context: Omit<ModelWorkspaceContext, 'initialized' | 'dirty'>, draft: ModelDraft, step?: number) => void;
  setWorkspace: (patch: Partial<ModelWorkspaceContext>) => void;
  setCurrentDraftModelId: (id?: string) => void;
  setLoadedTemplate: (template: ModelTemplate | null) => void;
  setValidationResult: (result: ModelDraftValidationResult | null) => void;
  reset: () => void;
}

function createWorkspace(mode: ModelWorkspaceMode = 'new'): ModelWorkspaceContext {
  return { mode, sessionId: createSessionId(), initialized: false, dirty: false };
}

const blankDraft = createBlankDraft();

export const useModelCreationStore = create<State>()((set) => ({
  draft: blankDraft,
  modelDraft: blankDraft,
  workspace: createWorkspace(),
  step: 0,
  builderMode: blankDraft.basic_info.builder_mode,
  loadedTemplate: null,
  validationResult: null,
  currentDraftModelId: undefined,
  setStep: step => set({ step }),
  updateDraft: patch => set(state => {
    const draft = patchDraft(state.draft, patch);
    return { draft, modelDraft: draft, builderMode: draft.basic_info.builder_mode, workspace: { ...state.workspace, dirty: true } };
  }),
  setDraft: draft => set(state => ({ draft, modelDraft: draft, builderMode: draft.basic_info.builder_mode, workspace: { ...state.workspace, dirty: true } })),
  initializeWorkspace: (context, draft, step = 0) => set({
    draft,
    modelDraft: draft,
    workspace: { ...context, initialized: true, dirty: false },
    step,
    builderMode: draft.basic_info.builder_mode,
    loadedTemplate: null,
    validationResult: null,
    currentDraftModelId: context.currentAssetId,
  }),
  setWorkspace: patch => set(state => ({ workspace: { ...state.workspace, ...patch } })),
  setCurrentDraftModelId: currentDraftModelId => set(state => ({ currentDraftModelId, workspace: { ...state.workspace, currentAssetId: currentDraftModelId } })),
  setLoadedTemplate: loadedTemplate => set({ loadedTemplate }),
  setValidationResult: validationResult => set({ validationResult }),
  reset: () => {
    const draft = createBlankDraft();
    return set({
      draft,
      modelDraft: draft,
      workspace: { ...createWorkspace('new'), initialized: true },
      step: 0,
      builderMode: draft.basic_info.builder_mode,
      loadedTemplate: null,
      validationResult: null,
      currentDraftModelId: undefined,
    });
  },
}));
