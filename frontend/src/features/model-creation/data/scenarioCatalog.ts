import type { ModelAsset } from '../../../types/model';
import type { ScenarioCatalogItem, ScenarioStatus } from '../../../types/scenario';
import type { DictionaryItem } from '../../../types/systemConfig';

export const DEFAULT_SCENARIO_ID = 'day_ahead_unit_commitment';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validStatus(value: unknown): ScenarioStatus {
  const status = String(value || '').toLowerCase();
  return ['draft', 'trial', 'published', 'offline'].includes(status) ? status as ScenarioStatus : 'draft';
}

export function scenariosFromDictionary(items?: DictionaryItem[]): ScenarioCatalogItem[] {
  return (items || [])
    .filter(item => item.enabled !== false)
    .map(item => ({
      id: item.code,
      name: item.label || item.code,
      description: item.description || '',
      status: validStatus(item.status),
      sortOrder: item.sort_order ?? 9999,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _sortOrder, ...item }) => item);
}

export function modelScenarioId(model: Record<string, unknown>): string {
  const semantic = record(model.semantic_spec);
  const modelDraft = record(model.model_draft);
  const basicInfo = record(modelDraft.basic_info);
  const uiMetadata = record(model.ui_metadata);
  const semanticMetadata = record(semantic.ui_metadata);
  return String(
    model.scenario_id
    || basicInfo.scenario_id
    || semantic.scenario_id
    || uiMetadata.scenario_id
    || semanticMetadata.scenario_id
    || '',
  ).trim();
}

export function modelBelongsToScenario(model: Record<string, unknown>, scenario: ScenarioCatalogItem) {
  const scenarioId = modelScenarioId(model);
  if (scenarioId) return scenarioId === scenario.id;
  // Read-only compatibility for user-created pre-v2 assets. New writes always use scenario_id.
  return [model.scene, model.scenario].some(value => {
    const text = String(value || '').trim();
    return text === scenario.id || text === scenario.name;
  });
}

export function recommendScenarioModels(models: ModelAsset[], scenario: ScenarioCatalogItem): ModelAsset[] {
  return models
    .filter(model => modelBelongsToScenario(model, scenario))
    .filter(model => model.status === 'published' && model.is_active_version !== false)
    .sort((left, right) => {
      const priority = Number(right.recommendation_priority || 0) - Number(left.recommendation_priority || 0);
      if (priority) return priority;
      const active = Number(Boolean(right.is_active_version)) - Number(Boolean(left.is_active_version));
      if (active) return active;
      const rightTime = String(right.published_at || right.tested_at || right.updated_at || '');
      const leftTime = String(left.published_at || left.tested_at || left.updated_at || '');
      return rightTime.localeCompare(leftTime) || right.id.localeCompare(left.id);
    });
}

export function scenarioNameFromDictionary(id: string, items?: DictionaryItem[]) {
  return items?.find(item => item.code === id && item.enabled !== false)?.label || '';
}
