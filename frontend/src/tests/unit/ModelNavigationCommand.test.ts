import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { executeModelNavigationCommand } from '../../features/model-creation/navigation/modelNavigationCommand';
import { modelValidationIssues } from '../../features/model-creation/utils/workflowGuard';

describe('model navigation command', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  test('opens collapse and tab before focusing an exact field', async () => {
    document.body.innerHTML = `<div id="target"><div class="ant-collapse-item" data-node-key="advanced-detail"><button class="ant-collapse-header"></button></div><button class="ant-tabs-tab" data-node-key="parameters"></button><section data-section-key="parameters"><label data-field-code="load"><input /></label></section></div>`;
    const container = document.getElementById('target')!;
    const collapse = container.querySelector<HTMLElement>('.ant-collapse-header')!;
    const tab = container.querySelector<HTMLElement>('.ant-tabs-tab')!;
    const collapseClick = vi.spyOn(collapse, 'click');
    const tabClick = vi.spyOn(tab, 'click');
    const result = await executeModelNavigationCommand({ requestId: '1', stepIndex: 1, sectionKey: 'parameters', collapseKeys: ['advanced-detail'], tabKey: 'parameters', fieldCode: 'load' }, container);
    expect(collapseClick).toHaveBeenCalledOnce();
    expect(tabClick).toHaveBeenCalledOnce();
    expect(result).toBe('exact');
    expect(document.activeElement).toBe(container.querySelector('input'));
  });

  test('returns explicit section fallback and missing outcomes', async () => {
    document.body.innerHTML = '<div id="target"><section data-section-key="time"><button>配置</button></section></div>';
    const container = document.getElementById('target')!;
    await expect(executeModelNavigationCommand({ requestId: '2', stepIndex: 1, sectionKey: 'time', fieldCode: 'absent' }, container)).resolves.toBe('section');
    await expect(executeModelNavigationCommand({ requestId: '3', stepIndex: 1, sectionKey: 'unknown' }, container)).resolves.toBe('missing');
  });
});

test('validation issues expose an explicit location contract', () => {
  const issues = modelValidationIssues({ valid: false, sections: { semantic_structure: { valid: false, errors: ['参数 load 缺少维度'] }, solver_compatibility: { valid: false, errors: ['求解器不兼容'] } } }, [
    { title: '基础信息', description: '', sectionKeys: ['basic_info'] },
    { title: '模型语义', description: '', sectionKeys: ['semantic_structure'] },
    { title: '数学展开', description: '', sectionKeys: ['formula'] },
    { title: '运行参数', description: '', sectionKeys: ['runtime_parameters'] },
    { title: '校验发布', description: '', sectionKeys: ['solver_compatibility'] },
  ]);
  expect(issues[0]).toMatchObject({ code: 'semantic_structure.0', severity: 'error', precision: 'exact', location: { stepIndex: 1, sectionKey: 'parameters', tabKey: 'parameters', collapseKeys: ['advanced-detail'], fieldCode: 'load', objectId: 'load' } });
  expect(issues[1]).toMatchObject({ precision: 'section', location: { stepIndex: 4, sectionKey: 'compatibility' } });
});
