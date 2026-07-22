import { useCallback, useEffect, useRef, useState } from 'react';

export interface SectionNavigationItem {
  key: string;
  label: string;
  aliases?: string[];
}

function findTarget(container: HTMLElement | null, item: SectionNavigationItem) {
  if (!container) return null;
  const direct = container.querySelector<HTMLElement>(`#model-section-${item.key}, [data-section-key="${item.key}"]`);
  if (direct) return direct;
  const terms = [item.label, ...(item.aliases || [])];
  return [...container.querySelectorAll<HTMLElement>('h1,h2,h3,.ant-card-head-title,.ant-collapse-header,.ant-tabs-tab,.ant-alert-message')]
    .find(node => terms.some(term => node.textContent?.includes(term))) || null;
}

export function useSectionNavigation({
  items,
  containerId,
  scrollContainer,
  resetKey,
  onActiveChange,
}: {
  items: SectionNavigationItem[];
  containerId: string;
  scrollContainer: HTMLElement | null;
  resetKey: string | number;
  onActiveChange?: (key: string) => void;
}) {
  const [active, setActive] = useState(items[0]?.key || '');
  const navigationTimerRef = useRef<number | undefined>(undefined);

  const updateActive = useCallback((key: string) => {
    setActive(key);
    onActiveChange?.(key);
  }, [onActiveChange]);

  useEffect(() => {
    updateActive(items[0]?.key || '');
  }, [items, resetKey, updateActive]);

  useEffect(() => {
    if (!scrollContainer) return undefined;
    const onScroll = () => {
      const container = document.getElementById(containerId);
      const rootTop = scrollContainer.getBoundingClientRect().top;
      const threshold = rootTop + 132;
      const candidates = items
        .map(item => ({ item, target: findTarget(container, item) }))
        .filter((row): row is { item: SectionNavigationItem; target: HTMLElement } => Boolean(row.target));
      const current = candidates.filter(row => row.target.getBoundingClientRect().top <= threshold).at(-1) || candidates[0];
      if (current && current.item.key !== active) updateActive(current.item.key);
    };
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener('scroll', onScroll);
  }, [active, containerId, items, scrollContainer, updateActive]);

  useEffect(() => () => {
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
  }, []);

  const navigate = useCallback((key: string) => {
    const item = items.find(entry => entry.key === key);
    if (!item) return;
    updateActive(key);
    const target = findTarget(document.getElementById(containerId), item);
    if (!target) return;
    if (target.classList.contains('ant-tabs-tab') || target.classList.contains('ant-collapse-header')) target.click();
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = undefined;
      if (!scrollContainer) return target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      const rootRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      scrollContainer.scrollTo({ top: Math.max(0, scrollContainer.scrollTop + targetRect.top - rootRect.top - 120), behavior: 'smooth' });
    }, 30);
  }, [containerId, items, scrollContainer, updateActive]);

  return { active, navigate };
}
