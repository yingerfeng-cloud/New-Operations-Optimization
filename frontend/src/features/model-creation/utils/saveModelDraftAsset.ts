import type { ModelAsset } from '../../../types/model';
import type { ModelDraft } from '../stores/modelCreationStore';
import { inferModelProblemType } from './inferModelProblemType';
import { normalizeModelDraft } from './normalizeModelDraft';
import { validateModelDraft } from './validateModelDraft';

function mergeByCode(base: unknown, additions: unknown, preferredKey: 'code' | 'name' = 'code') {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const append = (items: unknown) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const row = item as Record<string, unknown>;
      const code = String(row.code || row.name || row.key || '');
      if (!code || seen.has(code)) return;
      rows.push(preferredKey === 'name' ? { ...row, name: row.name || row.code || row.key || code } : { ...row, code: row.code || row.name || row.key || code });
      seen.add(code);
    });
  };
  append(base);
  append(additions);
  return rows;
}

function componentItems(draft: ModelDraft, key: string) {
  return draft.components.flatMap(component => {
    if (component.enabled === false) return [];
    const definition = component.definition;
    if (!definition || typeof definition !== 'object') return [];
    const rows = (definition as Record<string, unknown>)[key];
    return Array.isArray(rows) ? rows.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
  });
}

function componentSpecItemFromDraft(component: Record<string, unknown>) {
  const componentType = component.type || component.component_id || component.code;
  const config = component.config && typeof component.config === 'object' ? { ...(component.config as Record<string, unknown>) } : {};
  const row: Record<string, unknown> = { type: componentType };
  const configFields = ['function_asset_id', 'curve_asset_id', 'x', 'y', 'z', 'indices', 'solve_strategy', 'constraint_id', 'generated_constraints', 'metadata'];
  if (componentType === 'function_mapping_component' || componentType === 'piecewise_linear_curve' || componentType === 'function_mapping_2d_component') {
    configFields.forEach(field => {
      if (field in component) row[field] = component[field];
      else if (field in config) row[field] = config[field];
    });
  }
  if (Object.keys(config).length) row.config = config;
  return row;
}

export function buildComponentSpecFromDraft(normalizedDraft: ModelDraft) {
  const current = normalizedDraft.advanced.component_spec || {};
  const enabledComponents = normalizedDraft.components
    .filter(component => component.enabled !== false)
    .map(componentSpecItemFromDraft);
  const objective = normalizedDraft.objective || {};
  return {
    ...current,
    model_code: normalizedDraft.basic_info.model_code || current.model_code,
    build_mode: 'component_based',
    name: normalizedDraft.basic_info.name || current.name,
    sets: mergeByCode(normalizedDraft.semantic.sets || current.sets, componentItems(normalizedDraft, 'required_sets')),
    parameters: mergeByCode(normalizedDraft.semantic.parameters || current.parameters, componentItems(normalizedDraft, 'parameters')),
    variables: mergeByCode(normalizedDraft.semantic.variables || current.variables, componentItems(normalizedDraft, 'variables'), 'name'),
    components: enabledComponents,
    objective: { ...(current.objective as Record<string, unknown> | undefined), ...objective },
    ui_metadata: {
      ...((current.ui_metadata && typeof current.ui_metadata === 'object' ? current.ui_metadata : {}) as Record<string, unknown>),
      time_dimension: normalizedDraft.time_dimension,
    },
  };
}

export function buildModelDraftPayload(draft: ModelDraft) {
  const normalized = normalizeModelDraft(draft);
  const componentSpec = buildComponentSpecFromDraft(normalized);
  const existingUiMetadata = normalized.advanced.ui_metadata || {};
  const semanticSpec = {
    ...normalized.semantic,
    ui_metadata: { ...(normalized.semantic.ui_metadata || {}), time_dimension: normalized.time_dimension },
  };
  const currentGenericSpec = normalized.advanced.generic_spec || {};
  const genericSpec = Object.keys(currentGenericSpec).length ? {
    ...currentGenericSpec,
    ui_metadata: {
      ...((currentGenericSpec.ui_metadata && typeof currentGenericSpec.ui_metadata === 'object' ? currentGenericSpec.ui_metadata : {}) as Record<string, unknown>),
      time_dimension: normalized.time_dimension,
    },
  } : {};
  return {
    name: normalized.basic_info.name,
    scene: normalized.basic_info.scenario,
    template_id: normalized.basic_info.model_code,
    build_mode: normalized.basic_info.builder_mode,
    solver: normalized.basic_info.solver,
    ui_metadata: { ...existingUiMetadata, time_dimension: normalized.time_dimension },
    model_draft: normalized as unknown as Record<string, unknown>,
    semantic_spec: semanticSpec,
    generic_spec: genericSpec,
    component_spec: componentSpec,
    parameters: normalized.runtime_parameters,
    model_problem_type: inferModelProblemType(normalized),
  };
}

export async function saveModelDraftAsset(
  draft: ModelDraft,
  currentDraftModelId: string | undefined,
  deps: {
    createModel: (payload: ReturnType<typeof buildModelDraftPayload>) => Promise<ModelAsset>;
    updateModel: (id: string, payload: ReturnType<typeof buildModelDraftPayload>) => Promise<ModelAsset>;
  },
  requireValid = false,
) {
  const normalized = normalizeModelDraft(draft);
  if (requireValid && !validateModelDraft(normalized).valid) throw new Error('发布前校验未通过');
  const payload = buildModelDraftPayload(normalized);
  return currentDraftModelId ? deps.updateModel(currentDraftModelId, payload) : deps.createModel(payload);
}
