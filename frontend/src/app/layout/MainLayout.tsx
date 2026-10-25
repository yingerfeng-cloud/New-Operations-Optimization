import { Drawer } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PageHeaderSlotsProvider } from '../../components/PageHeader/slots';
import { titleForPath } from '../navigation';

const COLLAPSE_KEY = 'optiforge.sidebar.collapsed';

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
  const navigationType = useNavigationType();
  const { mobile, medium } = useViewport();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [manualCollapsed, setManualCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const collapsed = manualCollapsed || (medium && localStorage.getItem(COLLAPSE_KEY) === null);
  const isAgentWorkbench = pathname.startsWith('/agents');
  const contentRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = pathname;
    const savedDraftAddress = navigationType === 'REPLACE' && previousPath === '/models/create'
      && /^\/models\/[^/]+\/edit$/.test(pathname);
    if (previousPath === pathname || savedDraftAddress) return;
    if (!contentRef.current) return;
    contentRef.current.scrollTop = 0;
    contentRef.current.scrollLeft = 0;
  }, [pathname, navigationType]);

  useEffect(() => setDrawerOpen(false), [pathname]);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setManualCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, String(next));
  };

  return (
    <PageHeaderSlotsProvider pageLabel={titleForPath(pathname).label}><div className={`app-shell app${collapsed && !mobile ? ' app-sidebar-collapsed' : ''}${mobile ? ' app-mobile' : ''}`}>
      {!mobile && <Sidebar collapsed={collapsed} />}
      <main className={`main${isAgentWorkbench ? ' main-agent-workbench' : ''}`}>
        <Header
          pathname={pathname}
          mobile={mobile}
          medium={medium}
          sidebarCollapsed={collapsed}
          onOpenMenu={() => setDrawerOpen(true)}
          onToggleSidebar={toggleCollapsed}
        />
        <section className="main-content content" ref={contentRef}>
          <div className="platform-page"><Outlet /></div>
        </section>
      </main>
      <Drawer
        className="mobile-nav-drawer"
        title="平台导航"
        placement="left"
        size="min(88vw, 340px)"
        open={mobile && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
      >
        <Sidebar mobile onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
    </div></PageHeaderSlotsProvider>
  );
}
