import { Select } from 'antd';
import { useSectionNavigation, type SectionNavigationItem } from '../hooks/useSectionNavigation';

export type StepSectionItem = SectionNavigationItem;

export function StepSectionNav({
  items,
  containerId,
  scrollContainer = null,
  resetKey = 0,
  onActiveChange,
  onFocus,
}: {
  items: StepSectionItem[];
  containerId: string;
  scrollContainer?: HTMLElement | null;
  resetKey?: string | number;
  onActiveChange?: (key: string) => void;
  onFocus?: () => void;
}) {
  const { active, navigate } = useSectionNavigation({ items, containerId, scrollContainer, resetKey, onActiveChange });

  return (
    <nav className="step-section-nav" aria-label="步骤内章节导航">
      <Select className="step-section-nav-select" aria-label="选择章节" value={active} onChange={navigate} options={items.map(item => ({ value: item.key, label: item.label }))} />
      <div className="step-section-nav-links">
        {items.map(item => <button className={active === item.key ? 'active' : ''} type="button" key={item.key} onClick={() => navigate(item.key)}>{item.label}</button>)}
      </div>
      {onFocus && <button className="step-focus-trigger" type="button" onClick={onFocus}>聚焦编辑</button>}
    </nav>
  );
}
