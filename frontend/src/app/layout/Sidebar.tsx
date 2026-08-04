import { Segmented, Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { navEntries, type NavEntry, type NavGroup } from '../navigation';
import { useAudience } from '../audience';
import { PLATFORM_ENGLISH_NAME, PLATFORM_FORMAL_NAME, PLATFORM_SHORT_NAME } from '../brand';

interface SidebarProps {
  collapsed?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}

const groupOrder: NavGroup[] = ['首页', '业务建模', '优化运行', '智能与服务', '专家工具'];
export function Sidebar({ collapsed = false, mobile = false, onNavigate }: SidebarProps) {
  const { audience, setAudience } = useAudience();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const matchesPath = (key: string) => key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(`${key}/`);
  const activeKey = navEntries.filter(item => matchesPath(item.key)).sort((a, b) => b.key.length - a.key.length)[0]?.key;
  const selected = (entry: NavEntry) => entry.key === '/' ? pathname === '/' : activeKey === entry.key;
  const visibleEntries = navEntries.filter(entry => entry.audience === 'all' || entry.audience === 'business' || audience === 'expert');
  const navGroups = groupOrder.map(label => ({ label, items: visibleEntries.filter(entry => entry.group === label) })).filter(group => group.items.length > 0);

  const openItem = (key: string) => {
    nav(key);
    onNavigate?.();
  };

  const brandMark = <div className="brand-mark" aria-label={PLATFORM_FORMAL_NAME}>{PLATFORM_SHORT_NAME}</div>;

  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}${mobile ? ' sidebar-mobile' : ''}`} aria-label="主导航">
      <div className="brand">
        {collapsed ? <Tooltip title={`${PLATFORM_FORMAL_NAME} · ${PLATFORM_ENGLISH_NAME}`} placement="right">{brandMark}</Tooltip> : brandMark}
        {!collapsed && <div className="brand-copy" title={PLATFORM_FORMAL_NAME}>
          <span className="brand-wordmark" aria-label={PLATFORM_ENGLISH_NAME}>
            <span className="brand-wordmark-main">Opti</span><span className="brand-wordmark-accent">Forge</span>
          </span>
        </div>}
      </div>
      {mobile && <Segmented block aria-label="平台视图" value={audience} onChange={value => setAudience(value as 'business' | 'expert')} options={[{ label: '业务视图', value: 'business' }, { label: '专家视图', value: 'expert' }]} />}
      <nav className="nav" aria-label="平台功能">
        {navGroups.map(group => (
          <div className="nav-group" key={group.label}>
            {!collapsed && <div className="nav-group-label">{group.label}</div>}
            {group.items.map(item => {
              const button = (
                <button
                  key={item.key}
                  className={selected(item) ? 'active' : ''}
                  type="button"
                  onClick={() => openItem(item.key)}
                  title={item.label}
                  aria-current={selected(item) ? 'page' : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {!collapsed && <span className="nav-label">{item.label}</span>}
                </button>
              );
              return collapsed ? <Tooltip key={item.key} title={item.label} placement="right">{button}</Tooltip> : button;
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
