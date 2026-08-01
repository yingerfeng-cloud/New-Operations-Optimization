import { describe, expect, test } from 'vitest';
import type { ModelAsset } from '../../types/model';
import {
  canRepublish,
  isImmutableVersion,
  lifecycleAction,
  lifecycleActions,
  lifecycleHint,
  lifecycleStatusText,
  testActionLabel,
} from '../../features/model-center/modelLifecycle';

function model(status: ModelAsset['status'], extra: Partial<ModelAsset> = {}): ModelAsset {
  return {
    ...extra,
    id: 'model-lifecycle',
    name: '生命周期测试模型',
    scene: 'lifecycle_test',
    version: 'v1.0',
    status,
    solver: 'HiGHS',
    problem_type: 'LP',
    build_mode: 'generic_linear',
    updated_at: '2026-07-30 10:00:00',
  };
}

describe('model asset lifecycle', () => {
  test('a developing model must pass testing before lifecycle actions become available', () => {
    expect(lifecycleAction(model('developing'))).toBeUndefined();
    expect(lifecycleStatusText('developing')).toBe('草稿');
    expect(lifecycleHint(model('developing'))).toContain('可直接编辑');
  });

  test('a published model is immutable and validation does not imply a status change', () => {
    const published = model('published', { published_at: '2026-07-30 10:00:00' });
    expect(lifecycleAction(published)).toBe('offline');
    expect(isImmutableVersion(published)).toBe(true);
    expect(testActionLabel(published)).toBe('验证运行（状态不变）');
  });

  test('trial and offline versions cannot be edited in place', () => {
    expect(isImmutableVersion(model('trial'))).toBe(true);
    expect(isImmutableVersion(model('offline'))).toBe(true);
    expect(lifecycleHint(model('trial'))).toContain('退回草稿后修改');
    expect(lifecycleHint(model('offline'))).toContain('创建新版本');
  });

  test('a trial model can be formally published but cannot be taken offline', () => {
    expect(lifecycleActions(model('trial'))).toEqual(['promote']);
    expect(lifecycleAction(model('trial'))).toBe('promote');
  });

  test('an offline version can only be republished when the tested revision still matches', () => {
    const valid = model('offline', { content_hash: 'same', tested_content_hash: 'same' });
    const stale = model('offline', { content_hash: 'new', tested_content_hash: 'old' });

    expect(canRepublish(valid)).toBe(true);
    expect(lifecycleAction(valid)).toBe('republish');
    expect(canRepublish(stale)).toBe(false);
    expect(lifecycleAction(stale)).toBeUndefined();
    expect(lifecycleHint(stale)).toContain('重新测试');
    expect(testActionLabel(stale)).toBe('重新测试（进入试运行）');
  });
});
