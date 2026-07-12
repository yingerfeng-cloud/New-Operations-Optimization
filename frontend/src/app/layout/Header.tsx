import { Button, Dropdown, Space, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, unwrap } from '../../api/client';
import { titleForPath } from '../navigation';
import { CommandSearch } from './CommandSearch';

interface HealthResponse { ok: boolean; service?: string; solver?: string; pyomo_installed?: boolean; highspy_installed?: boolean }
interface HeaderProps { pathname: string; mobile?: boolean; medium?: boolean; sidebarCollapsed?: boolean; onOpenMenu?: () => void; onToggleSidebar?: () => void }

export function Header({ pathname, mobile = false, medium = false, sidebarCollapsed = false, onOpenMenu = () => undefined, onToggleSidebar = () => undefined }: HeaderProps) {
  const nav = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 30000;
  const { data, isError, isFetching } = useQuery({ queryKey: ['health'], queryFn: () => unwrap<HealthResponse>(apiClient.get('/api/health')), refetchInterval });
  const backendOnline = Boolean(data?.ok);
  const current = titleForPath(pathname);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const statusText = backendOnline ? `平台在线 · ${data?.solver || 'HiGHS'}` : isError ? '平台连接异常' : isFetching ? '正在检查平台状态' : '状态待检查';
  const statusItems = [
    { key: 'backend', label: `后端服务：${backendOnline ? '在线' : '离线'}` },
    { key: 'solver', label: `当前求解器：${data?.solver || 'HiGHS'}` },
    { key: 'runtime', label: `求解环境：${data?.highspy_installed === false ? '未就绪' : '已就绪'}` },
  ];

  return (
    <>
      <header className="top-header">
        <div className="top-search-area">
          {mobile && <Button type="text" icon={<MenuOutlined />} onClick={onOpenMenu} aria-label="打开主导航" />}
          {medium && <Tooltip title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}><Button type="text" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={onToggleSidebar} aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} /></Tooltip>}
          <span className="current-page-chip">{current.label}</span>
          <button className="global-search" type="button" onClick={() => setSearchOpen(true)} aria-label="打开全局搜索">
            <SearchOutlined /><span>{mobile ? '搜索' : '搜索模型、场景、任务或报告'}</span><kbd>{mobile ? '' : 'Ctrl K'}</kbd>
          </button>
        </div>
        <div className="top-actions">
          <Space size={8}>
            {!mobile && <Dropdown menu={{ items: statusItems }} trigger={['click']}><button className={`status-pill ${backendOnline ? 'status-pill-green' : isError ? 'status-pill-red' : 'status-pill-amber'}`} type="button">{statusText}</button></Dropdown>}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/models/create')}>{mobile ? '' : '新建模型'}</Button>
          </Space>
        </div>
      </header>
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
