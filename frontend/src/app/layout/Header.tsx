import { Badge, Button, Dropdown, Popover, Segmented, Space, Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { BellOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, unwrap } from '../../api/client';
import { getTasks } from '../../api/tasks';
import { isTaskFailed } from '../../features/task-center/taskStatus';
import type { SolveTask } from '../../types/task';
import { titleForPath } from '../navigation';
import { useAudience } from '../audience';

const CommandSearch = lazy(() => import('./CommandSearch').then(module => ({ default: module.CommandSearch })));

interface HealthResponse { ok: boolean; service?: string; solver?: string; pyomo_installed?: boolean; highspy_installed?: boolean }
interface HeaderProps { pathname: string; mobile?: boolean; medium?: boolean; sidebarCollapsed?: boolean; onOpenMenu?: () => void; onToggleSidebar?: () => void }

const taskTimestamp = (task: SolveTask) => Date.parse(String(task.created_at || '')) || 0;
const taskFailureReason = (task: SolveTask) => typeof task.error === 'string'
  ? task.error
  : String((task.error as Record<string, unknown> | undefined)?.message || task.risk || '请查看任务诊断详情');

export function Header({ pathname, mobile = false, medium = false, sidebarCollapsed = false, onOpenMenu = () => undefined, onToggleSidebar = () => undefined }: HeaderProps) {
  const nav = useNavigate();
  const { audience, setAudience } = useAudience();
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskInboxOpen, setTaskInboxOpen] = useState(false);
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 30000;
  const { data, isError, isFetching } = useQuery({ queryKey: ['health'], queryFn: () => unwrap<HealthResponse>(apiClient.get('/api/health')), refetchInterval });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: getTasks, refetchInterval: import.meta.env.MODE === 'test' ? false : 15000 });
  const backendOnline = Boolean(data?.ok);
  const current = titleForPath(pathname);
  const failedTasks = [...(tasks.data || [])].filter(task => isTaskFailed(task.status)).sort((a, b) => taskTimestamp(b) - taskTimestamp(a));

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
  const openTask = (task?: SolveTask) => {
    setTaskInboxOpen(false);
    nav(task ? `/tasks?task=${encodeURIComponent(task.id)}` : '/tasks');
  };
  const taskInbox = (
    <div className="task-inbox-panel">
      <header>
        <div><strong>任务消息</strong><span>{failedTasks.length ? `${failedTasks.length} 条待处理` : '暂无待处理任务'}</span></div>
        {failedTasks.length > 0 && <Tag color="red">异常</Tag>}
      </header>
      {failedTasks.length > 0 ? (
        <div className="task-inbox-list">
          {failedTasks.slice(0, 5).map(task => (
            <button type="button" key={task.id} onClick={() => openTask(task)}>
              <span><strong>{task.model || task.scene || '优化任务'}</strong><small>{taskFailureReason(task)}</small></span>
              <time>{task.created_at ? new Date(task.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</time>
            </button>
          ))}
        </div>
      ) : <div className="task-inbox-empty">当前没有失败、无解或超时任务</div>}
      <Button type="text" block onClick={() => openTask()}>查看全部任务</Button>
    </div>
  );

  return (
    <>
      <header className="top-header">
        <div className="top-search-area">
          {mobile && <Button type="text" icon={<MenuOutlined />} onClick={onOpenMenu} aria-label="打开主导航" />}
          {!mobile && <Tooltip title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}><Button className="sidebar-toggle" type="text" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={onToggleSidebar} aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} /></Tooltip>}
          {!mobile && <span className="current-page-chip">{current.label}</span>}
          <button className="global-search" type="button" onClick={() => setSearchOpen(true)} aria-label="打开全局搜索">
            <SearchOutlined /><span>{mobile ? '搜索' : '搜索模型、场景、任务或报告'}</span><kbd>{mobile ? '' : 'Ctrl K'}</kbd>
          </button>
        </div>
        <div className="top-actions">
          <Space size={8}>
            <Popover content={taskInbox} trigger="click" placement="bottomRight" open={taskInboxOpen} onOpenChange={setTaskInboxOpen}>
              <Tooltip title={failedTasks.length ? `${failedTasks.length} 个异常任务待处理` : '任务消息'}>
                <Badge count={failedTasks.length} size="small" overflowCount={99}>
                  <button className={`task-inbox-trigger${failedTasks.length ? ' has-alert' : ''}`} type="button" aria-label={failedTasks.length ? `异常任务提醒，${failedTasks.length} 条` : '任务消息'}>
                    <BellOutlined />
                  </button>
                </Badge>
              </Tooltip>
            </Popover>
            {!mobile && <Segmented aria-label="平台视图" size="small" value={audience} onChange={value => setAudience(value as 'business' | 'expert')} options={[{ label: '业务视图', value: 'business' }, { label: '专家视图', value: 'expert' }]} />}
            {!mobile && <Dropdown menu={{ items: statusItems }} trigger={['click']}><button className={`status-pill ${backendOnline ? 'status-pill-green' : isError ? 'status-pill-red' : 'status-pill-amber'}`} type="button">{statusText}</button></Dropdown>}
            {!mobile && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/models/create')}>新建模型</Button>}
          </Space>
        </div>
      </header>
      {searchOpen && <Suspense fallback={null}><CommandSearch open onClose={() => setSearchOpen(false)} /></Suspense>}
    </>
  );
}
