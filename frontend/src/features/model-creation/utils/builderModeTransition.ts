import type { BuildMode } from '../../../types/model';
import type { ModelDraft } from '../stores/modelCreationStore';

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

export function transitionBuilderMode(draft: ModelDraft, nextMode: BuildMode): ModelDraft {
  if (draft.basic_info.builder_mode === nextMode) return draft;

  const modeDrafts = { ...(draft.advanced.builder_mode_drafts || {}) };
  let components = draft.components;
  let componentSpec = draft.advanced.component_spec;

  if (nextMode === 'generic_linear') {
    if (draft.components.length || draft.advanced.component_spec) {
      modeDrafts.component_based = {
        components: cloneValue(draft.components),
        component_spec: cloneValue(draft.advanced.component_spec),
      };
    }
    components = [];
    componentSpec = undefined;
  } else if (nextMode === 'component_based' && !draft.components.length) {
    const snapshot = modeDrafts.component_based;
    if (snapshot) {
      components = cloneValue(snapshot.components);
      componentSpec = cloneValue(snapshot.component_spec);
    }
  }

  return {
    ...draft,
    basic_info: { ...draft.basic_info, builder_mode: nextMode },
    components,
    advanced: {
      ...draft.advanced,
      component_spec: componentSpec,
      builder_mode_drafts: modeDrafts,
    },
  };
}

export function activeDraftForBuilderMode(draft: ModelDraft): ModelDraft {
  if (draft.basic_info.builder_mode !== 'generic_linear') return draft;
  if (!draft.components.length && !draft.advanced.component_spec) return draft;
  return {
    ...draft,
    components: [],
    advanced: { ...draft.advanced, component_spec: undefined },
  };
}
