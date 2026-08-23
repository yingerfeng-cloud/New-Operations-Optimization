import type { ModelAsset } from '../../types/model';

export type ModelLifecycleStatus = 'developing' | 'trial' | 'published' | 'offline' | 'publish_failed' | 'unknown';
export type ModelLifecycleAction = 'promote' | 'offline' | 'republish';

const statuses: Record<string, ModelLifecycleStatus> = {
  developing: 'developing',
  trial: 'trial',
  published: 'published',
  offline: 'offline',
  publish_failed: 'publish_failed',
};

export function lifecycleStatus(value: unknown): ModelLifecycleStatus {
  return statuses[String(value || '').trim()] || 'unknown';
}

export function lifecycleStatusText(value: unknown) {
  const status = lifecycleStatus(value);
  return {
    developing: '草稿',
    trial: '试运行',
    published: '已发布',
    offline: '已下线',
    publish_failed: '发布失败',
    unknown: String(value || '-'),
  }[status];
}

export function canRepublish(model: ModelAsset) {
  return lifecycleStatus(model.status) === 'offline'
    && Boolean(model.tested_content_hash)
    && Boolean(model.content_hash)
    && model.tested_content_hash === model.content_hash;
}

export function lifecycleHint(model: ModelAsset) {
  const status = lifecycleStatus(model.status);
  return {
    developing: '当前是草稿，可直接编辑；测试通过后会进入试运行验收。',
    trial: model.published_at
      ? '该历史版本正在重新验收：仅允许按具体 model_id 调试，不开放正式 API Skill 或 Agent Skill；如需修改，请创建新版本。'
      : '试运行是发布前的不可变验收基线：仅允许按具体 model_id 调试，不开放正式 API Skill 或 Agent Skill；可正式发布，也可退回草稿后修改。',
    published: '已发布版本通过稳定 model_code 和正式 Skill 承担生产调用；修改时会基于当前版本生成同一模型族的新草稿。',
    offline: canRepublish(model)
      ? '已下线版本作为历史基线保留；可恢复为正式版本，或创建新版本后继续修改。'
      : '已下线版本作为历史基线保留；可创建新版本，原版本重新测试进入试运行后才能恢复。',
    publish_failed: '发布失败的草稿可继续编辑，修复后重新测试。',
    unknown: '当前状态不在标准生命周期中，请通过受控操作推进。',
  }[status];
}

export function lifecycleAction(model: ModelAsset): ModelLifecycleAction | undefined {
  return lifecycleActions(model)[0];
}

export function lifecycleActions(model: ModelAsset): ModelLifecycleAction[] {
  const status = lifecycleStatus(model.status);
  if (status === 'trial') return ['promote'];
  if (status === 'published') return ['offline'];
  if (status === 'offline' && canRepublish(model)) return ['republish'];
  return [];
}

export function lifecycleActionLabel(action: ModelLifecycleAction) {
  if (action === 'offline') return '下线模型';
  if (action === 'republish') return '恢复为正式版本';
  return '正式发布';
}

export function isImmutableVersion(model: ModelAsset) {
  const status = lifecycleStatus(model.status);
  return Boolean(model.published_at) || status === 'trial' || status === 'published' || status === 'offline';
}

export function testActionLabel(model: ModelAsset) {
  const status = lifecycleStatus(model.status);
  if (status === 'published') return '验证运行（状态不变）';
  if (status === 'trial') return '重新测试';
  if (status === 'offline') return '重新测试（进入试运行）';
  return '测试运行';
}
