import type { ModelDraft } from '../stores/modelCreationStore';
import { applyTimeDimensionToDraft, inferTimeDimensionConfig, normalizeTimeDimensionConfig } from './timeDimensionDraft';

export function normalizeModelDraft(draft: ModelDraft): ModelDraft {
  const config = draft.time_dimension
    ? normalizeTimeDimensionConfig(draft.time_dimension, draft.semantic.sets.map(item => item.code))
    : inferTimeDimensionConfig(draft);
  return applyTimeDimensionToDraft({ ...draft, time_dimension: config }, config);
}
