import { createInitialDraft } from '../../features/model-creation/stores/modelCreationStore';
import { activeDraftForBuilderMode, transitionBuilderMode } from '../../features/model-creation/utils/builderModeTransition';
import { buildModelDraftPayload } from '../../features/model-creation/utils/saveModelDraftAsset';

test('switching from component builder to generic builder deactivates and snapshots components', () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{ component_id: 'function_mapping_2d_component', function_asset_id: 'surface_1' }];
  draft.advanced.component_spec = { components: [{ type: 'function_mapping_2d_component' }] };

  const generic = transitionBuilderMode(draft, 'generic_linear');

  expect(generic.basic_info.builder_mode).toBe('generic_linear');
  expect(generic.components).toEqual([]);
  expect(generic.advanced.component_spec).toBeUndefined();
  expect(generic.advanced.builder_mode_drafts?.component_based?.components).toEqual(draft.components);

  const restored = transitionBuilderMode(generic, 'component_based');
  expect(restored.components).toEqual(draft.components);
  expect(restored.advanced.component_spec).toEqual(draft.advanced.component_spec);
});

test('generic payload never serializes stale active components', () => {
  const draft = createInitialDraft();
  draft.basic_info.builder_mode = 'generic_linear';
  draft.components = [{ component_id: 'power_balance', enabled: true }];
  draft.advanced.component_spec = { components: [{ type: 'power_balance' }] };

  const active = activeDraftForBuilderMode(draft);
  const payload = buildModelDraftPayload(draft);

  expect(active.components).toEqual([]);
  expect(payload.model_draft.components).toEqual([]);
  expect(payload.component_spec.components).toEqual([]);
  expect(payload.component_spec.build_mode).toBe('generic_linear');
});
