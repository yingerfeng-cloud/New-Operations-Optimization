import { describe, expect, test } from 'vitest';
import type { ModelAsset } from '../../types/model';
import { assetToWorkspaceDraft, effectiveAssetMode, parseWorkspaceRequest, workspaceTitles } from '../../features/model-creation/utils/workspaceMode';

function asset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    id: 'MODEL-A',
    name: '模型 A',
    scene: '日前机组组合优化',
    version: 'v1',
    status: 'draft',
    solver: 'HiGHS',
    problem_type: 'LP',
    build_mode: 'generic_linear',
    updated_at: '2026-07-13',
    template_id: 'model_a',
    model_draft: {
      basic_info: { name: '模型 A', model_code: 'model_a', scenario: '日前机组组合优化', builder_mode: 'generic_linear', solver: 'HiGHS' },
      semantic: { sets: [{ code: 'time' }], parameters: [{ code: 'load' }], variables: [{ code: 'p', variableType: 'continuous' }] },
      components: [{ component_id: 'balance' }],
      formulas: [{ formula_id: 'f1', name: '平衡', kind: 'constraint', display_formula: 'p=load', dsl_formula: 'p=load', tokens: [], foreach: [], referenced_sets: [], referenced_parameters: [], referenced_variables: [], free_indices: [], compile_status: 'ready' }],
      runtime_parameters: { load: [1] },
      parameter_groups: {},
      advanced: {},
    },
    ...overrides,
  };
}

describe('model workspace route contract', () => {
  test('new, template, edit, clone and version are explicit modes with distinct titles', () => {
    expect(parseWorkspaceRequest(new URLSearchParams('mode=new')).mode).toBe('new');
    expect(parseWorkspaceRequest(new URLSearchParams('mode=template&template=unit_commitment_day_ahead'))).toEqual(expect.objectContaining({ mode: 'template', templateCode: 'unit_commitment_day_ahead' }));
    expect(parseWorkspaceRequest(new URLSearchParams(), 'MODEL-A')).toEqual(expect.objectContaining({ mode: 'edit', sourceModelId: 'MODEL-A' }));
    expect(parseWorkspaceRequest(new URLSearchParams('mode=clone&source=MODEL-A')).mode).toBe('clone');
    expect(parseWorkspaceRequest(new URLSearchParams('mode=version&source=MODEL-A')).mode).toBe('version');
    expect(new Set(Object.values(workspaceTitles)).size).toBe(5);
  });

  test('legacy source is normalized and a published edit becomes version mode', () => {
    expect(parseWorkspaceRequest(new URLSearchParams('source=MODEL-A'))).toEqual(expect.objectContaining({ mode: 'edit', legacySource: true }));
    expect(effectiveAssetMode('edit', asset({ status: 'published' }))).toBe('version');
    expect(effectiveAssetMode('edit', asset({ status: 'tested' }))).toBe('edit');
  });

  test('old scenario links only resolve a recommended backend template', () => {
    expect(parseWorkspaceRequest(new URLSearchParams('scenarioId=cascade_hydro_day_ahead&modelId=cascade_hydro_dispatch_lp')))
      .toEqual(expect.objectContaining({ mode: 'template', templateCode: 'cascade_hydro_dispatch' }));
  });
});

describe('asset workspace transformations', () => {
  test('edit restores the specified asset as the only content source', () => {
    const draft = assetToWorkspaceDraft(asset(), 'edit');
    expect(draft.basic_info.name).toBe('模型 A');
    expect(draft.semantic.sets).toEqual([expect.objectContaining({ code: 'time' })]);
    expect(draft.components).toEqual([expect.objectContaining({ component_id: 'balance' })]);
    expect(draft.runtime_parameters).toEqual({ load: [1] });
  });

  test('clone copies complete content but creates a new identity and no version link', () => {
    const draft = assetToWorkspaceDraft(asset(), 'clone');
    expect(draft.basic_info.name).toBe('模型 A 副本');
    expect(draft.basic_info.model_code).toMatch(/^model_/);
    expect(draft.basic_info.model_code).not.toBe('model_a');
    expect(draft.semantic.sets).toHaveLength(1);
    expect(draft.advanced.ui_metadata).toEqual(expect.objectContaining({ cloned_from_model_id: 'MODEL-A' }));
    expect(draft.advanced.ui_metadata).not.toHaveProperty('supersedes_model_id');
  });

  test('version preserves model code and records its superseded source', () => {
    const draft = assetToWorkspaceDraft(asset({ status: 'published' }), 'version');
    expect(draft.basic_info.model_code).toBe('model_a');
    expect(draft.advanced.ui_metadata).toEqual(expect.objectContaining({ supersedes_model_id: 'MODEL-A', source_version: 'v1' }));
  });
});
