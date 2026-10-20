import { createBlankDraft, useModelCreationStore } from '../../features/model-creation/stores/modelCreationStore';
import { readWorkspaceRecovery, listWorkspaceRecoveries, recoveryUrl, writeWorkspaceRecovery } from '../../features/model-creation/utils/workspaceRecovery';

test('partial semantic content and editor position recover without a second draft identity', () => {
  const draft = createBlankDraft();
  draft.basic_info = { ...draft.basic_info, name: '半成品', scenario: '合成场景' };
  draft.semantic.sets = [{ code: 'site', values: ['B', 'A'] }];
  draft.semantic.parameters = [{ code: 'cost', dimension: ['site'] }];
  const state = useModelCreationStore.getState();
  state.initializeWorkspace({ mode: 'new', sessionId: 'new:::' }, draft, 1);
  state.setDraft({ ...draft, runtime_parameters: { cost: [10, 20] } });
  useModelCreationStore.setState({ section: 'parameters' });
  const record = readWorkspaceRecovery('new:::')!;
  expect(record.draft.formulas).toEqual([]);
  expect(record.draft.runtime_parameters.cost).toEqual([10, 20]);
  expect(record.step).toBe(1);
  expect(record.section).toBe('parameters');
  expect(record.currentDraftModelId).toBeUndefined();
  useModelCreationStore.getState().restoreWorkspace(record);
  expect(useModelCreationStore.getState().workspace.sessionId).toBe('new:::');
  expect(useModelCreationStore.getState().draft.runtime_parameters.cost).toEqual([10, 20]);
  expect(listWorkspaceRecoveries()).toHaveLength(1);
  expect(recoveryUrl(record)).toBe('/models/create?mode=new');
});

test('unsubmitted local content is isolated by source and explicit reset discards its recovery', () => {
  const state = useModelCreationStore.getState();
  const draft = createBlankDraft(); draft.basic_info.name = 'A 本机修改';
  state.initializeWorkspace({ mode: 'edit', sourceModelId: 'A', currentAssetId: 'A', sessionId: 'edit:A::' }, draft);
  state.setDraft(draft);
  const a = readWorkspaceRecovery('edit:A::')!;
  state.initializeWorkspace({ mode: 'edit', sourceModelId: 'B', currentAssetId: 'B', sessionId: 'edit:B::' }, createBlankDraft());
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('');
  expect(readWorkspaceRecovery('edit:A::')!.draft.basic_info.name).toBe('A 本机修改');
  expect(recoveryUrl(a)).toBe('/models/A/edit');
  useModelCreationStore.getState().reset();
  expect(readWorkspaceRecovery('edit:B::')).toBeUndefined();
  expect(readWorkspaceRecovery('edit:A::')).toBeDefined();
});

test('storage failures are observable and corrupt records are not restored', () => {
  localStorage.setItem('optiforge-model-workspaces:v1', '{bad');
  expect(readWorkspaceRecovery('new:::')).toBeUndefined();
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try {
    expect(writeWorkspaceRecovery({ schema_version: 1, updatedAt: '', draft: createBlankDraft(), step: 0, workspace: { mode: 'new', sessionId: 'new:::', initialized: true, dirty: true } })).toBe(false);
  } finally { spy.mockRestore(); }
});
