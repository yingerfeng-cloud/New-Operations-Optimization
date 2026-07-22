import { Drawer } from 'antd';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

const COLLAPSE_KEY = 'copt.sidebar.collapsed';

function useViewport() {
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { width, mobile: width < 1024, medium: width >= 1024 && width < 1440 };
}

export function MainLayout() {
  const { pathname } = useLocation();
  const { mobile, medium } = useViewport();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [manualCollapsed, setManualCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const collapsed = manualCollapsed || (medium && localStorage.getItem(COLLAPSE_KEY) === null);

  useEffect(() => setDrawerOpen(false), [pathname]);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setManualCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, String(next));
  };

  return (
    <div className={`app-shell app${collapsed && !mobile ? ' app-sidebar-collapsed' : ''}${mobile ? ' app-mobile' : ''}`}>
      {!mobile && <Sidebar collapsed={collapsed} />}
      <main className="main">
        <Header
          pathname={pathname}
          mobile={mobile}
          medium={medium}
          sidebarCollapsed={collapsed}
          onOpenMenu={() => setDrawerOpen(true)}
          onToggleSidebar={toggleCollapsed}
        />
        <section className="main-content content">
          <div className="platform-page"><Outlet /></div>
        </section>
      </main>
      <Drawer
        className="mobile-nav-drawer"
        title="平台导航"
        placement="left"
        width="min(88vw, 340px)"
        open={mobile && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
      >
        <Sidebar mobile onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
    </div>
  );
}
