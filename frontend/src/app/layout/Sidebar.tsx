import { Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { navEntries, type NavEntry, type NavGroup } from '../navigation';

interface SidebarProps {
  collapsed?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}

const groupOrder: NavGroup[] = ['首页', '业务建模', '优化运行', '智能与服务', '专家工具'];
const navGroups = groupOrder
  .map(label => ({ label, items: navEntries.filter(entry => entry.group === label) }))
  .filter(group => group.items.length > 0);

export function Sidebar({ collapsed = false, mobile = false, onNavigate }: SidebarProps) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const matchesPath = (key: string) => key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(`${key}/`);
  const activeKey = navEntries.filter(item => matchesPath(item.key)).sort((a, b) => b.key.length - a.key.length)[0]?.key;
  const selected = (entry: NavEntry) => entry.key === '/' ? pathname === '/' : activeKey === entry.key;

  const openItem = (key: string) => {
    nav(key);
    onNavigate?.();
  };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}${mobile ? ' sidebar-mobile' : ''}`} aria-label="主导航">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">优</div>
        {!collapsed && <div className="brand-copy">安全生产运筹优化平台<small>安全 · 高效 · 可解释</small></div>}
      </div>
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
