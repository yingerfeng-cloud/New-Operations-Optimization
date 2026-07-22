import { useEffect, useRef } from 'react';

export interface FocusEditorContext {
  scrollTop: number;
  stepIndex: number;
  sectionKey?: string;
  activeTab?: string;
  expandedKeys: string[];
  focusedElementId?: string;
}

function nodeKey(element: Element | null) {
  return element?.getAttribute('data-node-key') || undefined;
}

export function useFocusEditorContext({ scrollContainer, stepIndex, sectionKey, onRestoreStep }: {
  scrollContainer: HTMLElement | null;
  stepIndex: number;
  sectionKey?: string;
  onRestoreStep: (step: number) => void;
}) {
  const contextRef = useRef<FocusEditorContext | undefined>(undefined);
  const frameRefs = useRef<number[]>([]);
  const restoreTimerRef = useRef<number | undefined>(undefined);

  const capture = () => {
    const content = document.getElementById('model-step-content');
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let focusedElementId = focused?.id || focused?.dataset.focusRestoreId;
    if (focused && !focusedElementId) {
      focusedElementId = `model-focus-${Date.now()}`;
      focused.dataset.focusRestoreId = focusedElementId;
    }
    contextRef.current = {
      scrollTop: scrollContainer?.scrollTop || 0,
      stepIndex,
      sectionKey,
      activeTab: nodeKey(content?.querySelector('.ant-tabs-tab-active') || null),
      expandedKeys: [...(content?.querySelectorAll('.ant-collapse-item-active[data-node-key]') || [])].map(node => nodeKey(node)).filter(Boolean) as string[],
      focusedElementId,
    };
  };

  const restore = () => {
    const context = contextRef.current;
    if (!context) return;
    onRestoreStep(context.stepIndex);
    const applyContext = () => {
      const content = document.getElementById('model-step-content');
      if (context.activeTab) content?.querySelector<HTMLElement>(`.ant-tabs-tab[data-node-key="${context.activeTab}"]`)?.click();
      context.expandedKeys.forEach(key => {
        const item = content?.querySelector<HTMLElement>(`.ant-collapse-item[data-node-key="${key}"]`);
        if (item && !item.classList.contains('ant-collapse-item-active')) item.querySelector<HTMLElement>('.ant-collapse-header')?.click();
      });
      if (scrollContainer) scrollContainer.scrollTop = context.scrollTop;
      const focusTarget = context.focusedElementId
        ? document.getElementById(context.focusedElementId) || document.querySelector<HTMLElement>(`[data-focus-restore-id="${context.focusedElementId}"]`)
        : null;
      focusTarget?.focus();
    };
    frameRefs.current.push(requestAnimationFrame(() => {
      frameRefs.current.push(requestAnimationFrame(() => {
        applyContext();
        if (restoreTimerRef.current !== undefined) window.clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = window.setTimeout(() => {
          restoreTimerRef.current = undefined;
          applyContext();
        }, 450);
      }));
    }));
  };

  useEffect(() => () => {
    frameRefs.current.forEach(frame => cancelAnimationFrame(frame));
    if (restoreTimerRef.current !== undefined) window.clearTimeout(restoreTimerRef.current);
  }, []);
  return { capture, restore, getContext: () => contextRef.current };
}
