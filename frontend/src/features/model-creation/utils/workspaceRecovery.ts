import type { ModelDraft, ModelWorkspaceContext } from '../stores/modelCreationStore';

export interface WorkspaceTestSnapshot { modelId: string; snapshot: string; contentHash?: string }
export interface WorkspaceRecovery {
  schema_version: 1;
  updatedAt: string;
  workspace: ModelWorkspaceContext;
  draft: ModelDraft;
  step: number;
  section?: string;
  currentDraftModelId?: string;
  lastSavedSnapshot?: string;
  lastSavedContentHash?: string;
  testSnapshot?: WorkspaceTestSnapshot;
}
const key = 'optiforge-model-workspaces:v1';
export const editWorkspaceKey = (id: string) => `edit:${id}::`;
function records(): Record<string, WorkspaceRecovery> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function valid(value?: WorkspaceRecovery): value is WorkspaceRecovery {
  return value?.schema_version === 1 && typeof value.workspace?.sessionId === 'string' && !!value.draft?.basic_info
    && Array.isArray(value.draft.semantic?.sets) && Array.isArray(value.draft.semantic?.parameters)
    && Array.isArray(value.draft.semantic?.variables) && Array.isArray(value.draft.components) && Array.isArray(value.draft.formulas);
}
export function readWorkspaceRecovery(sessionId: string): WorkspaceRecovery | undefined {
  const value = records()[sessionId];
  return valid(value) ? value : undefined;
}
export function listWorkspaceRecoveries(): WorkspaceRecovery[] {
  return Object.values(records()).filter(valid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function recoveryUrl(value: WorkspaceRecovery): string {
  if (value.currentDraftModelId) return `/models/${encodeURIComponent(value.currentDraftModelId)}/edit?resume=1`;
  const query = new URLSearchParams({ mode: value.workspace.mode, resume: '1' });
  if (value.workspace.sourceModelId) query.set('source', value.workspace.sourceModelId);
  if (value.workspace.templateCode) query.set('template', value.workspace.templateCode);
  const scenario = value.workspace.sessionId.split(':').at(-1);
  if (scenario) query.set('scenario', scenario);
  return `/models/create?${query}`;
}
export function forgetWorkspaceRecovery(sessionId: string) {
  try { const all = records(); delete all[sessionId]; localStorage.setItem(key, JSON.stringify(all)); } catch { /* An unavailable backup is reported on the next save. */ }
}
export function writeWorkspaceRecovery(value: WorkspaceRecovery): boolean {
  try {
    const all = records(); all[value.workspace.sessionId] = value;
    const recent = Object.values(all).filter(valid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(recent.map(row => [row.workspace.sessionId, row]))));
    return true;
  } catch { return false; }
}
