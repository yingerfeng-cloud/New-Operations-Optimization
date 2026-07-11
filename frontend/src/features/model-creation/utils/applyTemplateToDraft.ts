import type { ModelTemplate } from '../../../types/template';
import type { ModelDraft } from '../stores/modelCreationStore';
import { normalizeModelDraft } from './normalizeModelDraft';
import { inferTimeDimensionConfig, normalizeTimeDimensionConfig } from './timeDimensionDraft';

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function applyTemplateToDraft(draft: ModelDraft, template: ModelTemplate, scenarioName: string): ModelDraft {
  const source = (template.model_draft || {}) as Partial<ModelDraft>;
  const candidate = {
    ...draft,
    ...source,
    basic_info: {
      ...draft.basic_info,
      name: template.name,
      model_code: template.code,
      scenario: scenarioName || draft.basic_info.scenario,
      builder_mode: (template.build_mode as ModelDraft['basic_info']['builder_mode']) || draft.basic_info.builder_mode,
      template_code: template.code,
    },
    semantic: { ...draft.semantic, ...(source.semantic || {}) },
  } as ModelDraft;
  candidate.advanced = { ...candidate.advanced, ui_metadata: { ...objectValue(template.ui_metadata), ...(candidate.advanced.ui_metadata || {}) } };
  const templateConfig = objectValue(template.ui_metadata).time_dimension
    || source.time_dimension
    || objectValue(objectValue(source.advanced).ui_metadata).time_dimension
    || objectValue(objectValue(source.semantic).ui_metadata).time_dimension;
  candidate.time_dimension = templateConfig ? normalizeTimeDimensionConfig(templateConfig, candidate.semantic.sets.map(item => item.code)) : inferTimeDimensionConfig(candidate);
  return normalizeModelDraft(candidate);
}
