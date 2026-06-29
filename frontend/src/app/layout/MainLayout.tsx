import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function MainLayout() {
  const { pathname } = useLocation();

  return (
    <div className="app-shell app">
      <Sidebar />
      <main className="main">
        <Header pathname={pathname} />
        <section className="main-content content">
          <div className="platform-page">
            <Outlet />
          </div>
        </section>
      </main>
    </div>
  );
}
