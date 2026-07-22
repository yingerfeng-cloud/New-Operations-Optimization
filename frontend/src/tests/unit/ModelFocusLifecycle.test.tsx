import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useFocusEditorContext } from '../../features/model-creation/hooks/useFocusEditorContext';

describe('model focus context', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  test('captures and restores step, scroll, active tab, collapse and focus', () => {
    document.body.innerHTML = `<main><div id="model-step-content"><button id="origin">原字段</button><button class="ant-tabs-tab ant-tabs-tab-active" data-node-key="parameters"></button><div class="ant-collapse-item ant-collapse-item-active" data-node-key="advanced"><button class="ant-collapse-header"></button></div></div></main>`;
    const scrollContainer = document.querySelector('main')!;
    scrollContainer.scrollTop = 320;
    const origin = document.getElementById('origin') as HTMLButtonElement;
    origin.focus();
    const tabClick = vi.spyOn(document.querySelector<HTMLElement>('.ant-tabs-tab')!, 'click');
    const collapseClick = vi.spyOn(document.querySelector<HTMLElement>('.ant-collapse-header')!, 'click');
    const restoreStep = vi.fn();
    const { result } = renderHook(() => useFocusEditorContext({ scrollContainer, stepIndex: 2, sectionKey: 'constraints', onRestoreStep: restoreStep }));
    act(() => result.current.capture());
    document.querySelector<HTMLElement>('.ant-collapse-item')!.classList.remove('ant-collapse-item-active');
    scrollContainer.scrollTop = 0;
    origin.blur();
    act(() => result.current.restore());
    expect(result.current.getContext()).toMatchObject({ scrollTop: 320, stepIndex: 2, sectionKey: 'constraints', activeTab: 'parameters', expandedKeys: ['advanced'], focusedElementId: 'origin' });
    expect(restoreStep).toHaveBeenCalledWith(2);
    expect(tabClick).toHaveBeenCalledOnce();
    expect(collapseClick).toHaveBeenCalledOnce();
    expect(scrollContainer.scrollTop).toBe(320);
    expect(document.activeElement).toBe(origin);
  });
});
