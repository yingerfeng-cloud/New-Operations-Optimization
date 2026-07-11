import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FormulaDef } from '../../../types/formula';
import type { BuildMode } from '../../../types/model';
import type { ModelTemplate } from '../../../types/template';
import {
  BLANK_MODEL_ID,
  DEFAULT_SCENARIO_ID,
  getDefaultScenario,
  getDefaultScenarioModel,
  getScenarioById,
  getScenarioModelById,
} from '../data/scenarioCatalog';
import { migrateModelDraft } from '../utils/timeDimensionDraft';

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
  basic_info: { name: string; model_code: string; scenario: string; builder_mode: BuildMode; solver: string; template_code?: string; modeling_skeleton?: string };
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

export function createInitialDraft(): ModelDraft {
  const scenario = getDefaultScenario();
  const model = getDefaultScenarioModel();
  return {
    basic_info: {
      name: model.name,
      model_code: model.code,
      scenario: scenario.name,
      builder_mode: model.builderMode,
      solver: 'HiGHS',
      template_code: model.templateCode,
      modeling_skeleton: 'dispatch_optimization',
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

function createDraftForSelection(current: ModelDraft, scenarioId: string, modelId: string): ModelDraft {
  const scenario = getScenarioById(scenarioId) || getDefaultScenario();
  const selectedModel = getScenarioModelById(scenario.id, modelId) || scenario.models[0];
  const isBlankModel = modelId === BLANK_MODEL_ID;
  return {
    basic_info: {
      name: isBlankModel ? '' : selectedModel.name,
      model_code: isBlankModel ? '' : selectedModel.code,
      scenario: scenario.name,
      builder_mode: isBlankModel ? 'component_based' : selectedModel.builderMode,
      solver: current.basic_info.solver || 'HiGHS',
      template_code: isBlankModel ? undefined : selectedModel.templateCode,
      modeling_skeleton: current.basic_info.modeling_skeleton || 'dispatch_optimization',
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

interface State {
  draft: ModelDraft;
  modelDraft: ModelDraft;
  step: number;
  selectedScenarioId: string;
  selectedModelId: string;
  builderMode: BuildMode;
  loadedTemplate: ModelTemplate | null;
  validationResult: ModelDraftValidationResult | null;
  currentDraftModelId?: string;
  setStep: (n: number) => void;
  updateDraft: (patch: Partial<ModelDraft>) => void;
  setDraft: (d: ModelDraft) => void;
  setCurrentDraftModelId: (id?: string) => void;
  selectCatalogModel: (scenarioId: string, modelId?: string) => void;
  setLoadedTemplate: (template: ModelTemplate | null) => void;
  setValidationResult: (result: ModelDraftValidationResult | null) => void;
  reset: () => void;
}

const selectedDefaultModel = getDefaultScenarioModel();

export const useModelCreationStore = create<State>()(persist((set) => ({
  draft: createInitialDraft(),
  modelDraft: createInitialDraft(),
  step: 0,
  selectedScenarioId: DEFAULT_SCENARIO_ID,
  selectedModelId: selectedDefaultModel.id,
  builderMode: selectedDefaultModel.builderMode,
  loadedTemplate: null,
  validationResult: null,
  currentDraftModelId: undefined,
  setStep: step => set({ step }),
  updateDraft: patch => set(state => {
    const draft = patchDraft(state.draft, patch);
    return { draft, modelDraft: draft, builderMode: draft.basic_info.builder_mode };
  }),
  setDraft: draft => set({ draft, modelDraft: draft, builderMode: draft.basic_info.builder_mode }),
  setCurrentDraftModelId: currentDraftModelId => set({ currentDraftModelId }),
  selectCatalogModel: (scenarioId, modelId) => set(state => {
    const scenario = getScenarioById(scenarioId) || getDefaultScenario();
    const selectedModelId = modelId || scenario.models[0]?.id || BLANK_MODEL_ID;
    const draft = createDraftForSelection(state.draft, scenario.id, selectedModelId);
    return {
      draft,
      modelDraft: draft,
      selectedScenarioId: scenario.id,
      selectedModelId,
      builderMode: draft.basic_info.builder_mode,
      loadedTemplate: null,
      validationResult: null,
      currentDraftModelId: undefined,
    };
  }),
  setLoadedTemplate: loadedTemplate => set({ loadedTemplate }),
  setValidationResult: validationResult => set({ validationResult }),
  reset: () => {
    const draft = createInitialDraft();
    return set({
      draft,
      modelDraft: draft,
      step: 0,
      selectedScenarioId: DEFAULT_SCENARIO_ID,
      selectedModelId: selectedDefaultModel.id,
      builderMode: selectedDefaultModel.builderMode,
      loadedTemplate: null,
      validationResult: null,
      currentDraftModelId: undefined,
    });
  },
}), {
  name: 'copt-model-creation-draft',
  version: 1,
  migrate: persisted => {
    const state = (persisted || {}) as Partial<State>;
    const fallback = createInitialDraft();
    const draft = migrateModelDraft(state.draft || state.modelDraft, fallback);
    return { ...state, draft, modelDraft: draft, builderMode: draft.basic_info.builder_mode } as State;
  },
}));
