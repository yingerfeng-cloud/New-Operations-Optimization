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

function activateSectionTarget(target: HTMLElement) {
  const tab = target.classList.contains('ant-tabs-tab')
    ? target
    : target.querySelector<HTMLElement>('.ant-tabs-tab');
  if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();

  const collapse = target.classList.contains('ant-collapse-header')
    ? target
    : target.querySelector<HTMLElement>('.ant-collapse-header')
      || target.closest('.ant-collapse')?.querySelector<HTMLElement>('.ant-collapse-header');
  if (collapse && collapse.getAttribute('aria-expanded') !== 'true') collapse.click();
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
  const navigationReleaseTimerRef = useRef<number | undefined>(undefined);
  const navigationLockRef = useRef(false);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const updateActive = useCallback((key: string) => {
    activeRef.current = key;
    setActive(key);
    onActiveChange?.(key);
  }, [onActiveChange]);

  useEffect(() => {
    navigationLockRef.current = false;
    if (navigationReleaseTimerRef.current !== undefined) {
      window.clearTimeout(navigationReleaseTimerRef.current);
      navigationReleaseTimerRef.current = undefined;
    }
    updateActive(items[0]?.key || '');
  }, [items, resetKey, updateActive]);

  useEffect(() => {
    if (!scrollContainer) return undefined;
    const onScroll = () => {
      if (navigationLockRef.current) return;
      const container = document.getElementById(containerId);
      const rootTop = scrollContainer.getBoundingClientRect().top;
      const threshold = rootTop + 132;
      const candidates = items
        .map(item => ({ item, target: findTarget(container, item) }))
        .filter((row): row is { item: SectionNavigationItem; target: HTMLElement } => Boolean(row.target));
      const visible = candidates.filter(row => row.target.getBoundingClientRect().top <= threshold);
      let current = visible.at(-1) || candidates[0];
      if (visible.length > 1) {
        const lastTop = visible.at(-1)?.target.getBoundingClientRect().top ?? Number.NaN;
        const tied = visible.filter(row => Math.abs(row.target.getBoundingClientRect().top - lastTop) < 4);
        current = tied.find(row => row.item.key === activeRef.current) || current;
      }
      if (current && current.item.key !== activeRef.current) updateActive(current.item.key);
    };
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener('scroll', onScroll);
  }, [containerId, items, scrollContainer, updateActive]);

  useEffect(() => () => {
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
    if (navigationReleaseTimerRef.current !== undefined) window.clearTimeout(navigationReleaseTimerRef.current);
  }, []);

  const navigate = useCallback((key: string) => {
    const item = items.find(entry => entry.key === key);
    if (!item) return;
    updateActive(key);
    const target = findTarget(document.getElementById(containerId), item);
    if (!target) return;
    navigationLockRef.current = true;
    if (navigationReleaseTimerRef.current !== undefined) window.clearTimeout(navigationReleaseTimerRef.current);
    navigationReleaseTimerRef.current = window.setTimeout(() => {
      navigationReleaseTimerRef.current = undefined;
      navigationLockRef.current = false;
    }, 1000);
    activateSectionTarget(target);
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = undefined;
      if (!scrollContainer) return target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      const rootRect = scrollContainer.getBoundingClientRect();
      const currentTarget = findTarget(document.getElementById(containerId), item) || target;
      const targetRect = currentTarget.getBoundingClientRect();
      scrollContainer.scrollTo({ top: Math.max(0, scrollContainer.scrollTop + targetRect.top - rootRect.top - 120), behavior: 'smooth' });
    }, 30);
  }, [containerId, items, scrollContainer, updateActive]);

  return { active, navigate };
}
