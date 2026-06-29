import type { ModelTemplate } from '../../../types/template';
import type { ModelDraft } from '../stores/modelCreationStore';
import { normalizeModelDraft } from './normalizeModelDraft';

export function applyTemplateToDraft(draft: ModelDraft, template: ModelTemplate, scenarioName: string): ModelDraft {
  const source = (template.model_draft || {}) as Partial<ModelDraft>;
  return normalizeModelDraft({
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
  });
}
