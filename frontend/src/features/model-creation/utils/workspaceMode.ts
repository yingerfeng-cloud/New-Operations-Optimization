import type { ModelAsset } from '../../../types/model';
import { getScenarioById, getScenarioModelById } from '../data/scenarioCatalog';
import { createBlankDraft, type ModelDraft, type ModelWorkspaceMode } from '../stores/modelCreationStore';
import { modelAssetToDraft } from './modelAssetToDraft';

const modes = new Set<ModelWorkspaceMode>(['new', 'template', 'edit', 'clone', 'version']);
const publishedStatuses = new Set(['published', '已发布']);

export interface WorkspaceRequest {
  mode: ModelWorkspaceMode;
  sourceModelId?: string;
  templateCode?: string;
  legacySource: boolean;
}

export function parseWorkspaceRequest(searchParams: URLSearchParams, routeModelId?: string): WorkspaceRequest {
  if (routeModelId) return { mode: 'edit', sourceModelId: routeModelId, legacySource: false };

  const requestedMode = searchParams.get('mode') as ModelWorkspaceMode | null;
  const sourceModelId = searchParams.get('source') || undefined;
  const explicitMode = requestedMode && modes.has(requestedMode) ? requestedMode : undefined;
  if (explicitMode) {
    return {
      mode: explicitMode,
      sourceModelId,
      templateCode: searchParams.get('template') || undefined,
      legacySource: false,
    };
  }

  if (sourceModelId) return { mode: 'edit', sourceModelId, legacySource: true };

  // Compatibility for old scenario-catalog URLs: the catalog only recommends a
  // backend template and never becomes a model-content source itself.
  const scenarioId = searchParams.get('scenarioId');
  const catalogModelId = searchParams.get('modelId');
  if (scenarioId && catalogModelId) {
    const templateCode = getScenarioModelById(scenarioId, catalogModelId)?.templateCode;
    if (templateCode) return { mode: 'template', templateCode, legacySource: false };
  }

  return { mode: 'new', legacySource: false };
}

export function effectiveAssetMode(mode: ModelWorkspaceMode, asset: ModelAsset): ModelWorkspaceMode {
  return mode === 'edit' && publishedStatuses.has(String(asset.status)) ? 'version' : mode;
}

export function assetToWorkspaceDraft(asset: ModelAsset, mode: ModelWorkspaceMode): ModelDraft {
  const source = modelAssetToDraft(asset);
  if (mode === 'clone') {
    const identity = createBlankDraft();
    return {
      ...source,
      basic_info: {
        ...source.basic_info,
        name: `${source.basic_info.name} 副本`,
        model_code: identity.basic_info.model_code,
      },
      advanced: {
        ...source.advanced,
        ui_metadata: {
          ...(source.advanced.ui_metadata || {}),
          cloned_from_model_id: asset.id,
        },
      },
    };
  }

  if (mode === 'version') {
    return {
      ...source,
      advanced: {
        ...source.advanced,
        ui_metadata: {
          ...(source.advanced.ui_metadata || {}),
          supersedes_model_id: asset.id,
          source_version: asset.version,
        },
      },
    };
  }

  return source;
}

export function scenarioNameForDraft(scenarioId: string) {
  return getScenarioById(scenarioId)?.name || '';
}

export const workspaceTitles: Record<ModelWorkspaceMode, string> = {
  new: '新建模型',
  template: '从模板创建模型',
  edit: '编辑模型草稿',
  clone: '复制模型',
  version: '创建模型新版本',
};
