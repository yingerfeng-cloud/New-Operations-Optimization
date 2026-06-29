import { useLocation, useNavigate } from 'react-router-dom';
import { navEntries, type NavEntry } from '../navigation';

interface NavGroup {
  label: NavEntry['group'];
  items: NavEntry[];
}

const navGroups = navEntries.reduce<NavGroup[]>((groups, entry) => {
  const group = groups.find(item => item.label === entry.group);
  if (group) {
    group.items.push(entry);
  } else {
    groups.push({ label: entry.group, items: [entry] });
  }
  return groups;
}, []);

export function Sidebar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const allItems = navGroups.flatMap(group => group.items);
  const matchesPath = (key: string) => {
    if (key === '/') return pathname === '/';
    return pathname === key || pathname.startsWith(`${key}/`);
  };
  const activeKey = allItems
    .filter(item => matchesPath(item.key))
    .sort((a, b) => b.key.length - a.key.length)[0]?.key;
  const selected = (key: string) => {
    if (key === '/') return pathname === '/';
    return activeKey === key;
  };
  const openItem = (key: string) => {
    nav(key);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">优</div>
        <div>
          安全生产运筹优化底座
          <small>Pyomo + HiGHS</small>
        </div>
      </div>
      <nav className="nav">
        {navGroups.map(group => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(item => (
              <button
                key={`${group.label}-${item.label}`}
                className={selected(item.key) ? 'active' : ''}
                type="button"
                onClick={() => openItem(item.key)}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
