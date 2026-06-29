import { Button, Input, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiClient, unwrap } from '../../api/client';
import { titleForPath } from '../navigation';

interface HealthResponse {
  ok: boolean;
  service?: string;
  solver?: string;
  pyomo_installed?: boolean;
  highspy_installed?: boolean;
}

export function Header({ pathname }: { pathname: string }) {
  const nav = useNavigate();
  const refetchInterval = import.meta.env.MODE === 'test' ? false : 30000;
  const { data, isError, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap<HealthResponse>(apiClient.get('/api/health')),
    refetchInterval,
  });
  const legacyBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
  const legacyHref = `${legacyBaseUrl}/legacy`;
  const backendOnline = Boolean(data?.ok);
  const current = titleForPath(pathname);

  return (
    <header className="top-header">
      <div className="top-search-area">
        <span className="current-page-chip">{current.label}</span>
        <Input
          className="global-search"
          prefix={<SearchOutlined />}
          placeholder="搜索模型、组件、任务或报告"
          allowClear
        />
      </div>
      <div className="top-actions">
        <Space size={10} wrap>
          <span className={`status-pill ${backendOnline ? 'status-pill-green' : isError ? 'status-pill-red' : 'status-pill-amber'}`}>
            后端状态：{backendOnline ? '在线' : isError ? '离线' : isFetching ? '检查中' : '未检测'}
          </span>
          <span className={`status-pill ${data?.highspy_installed === false ? 'status-pill-red' : 'status-pill-blue'}`}>
            当前求解器：{data?.solver || 'HiGHS'}
          </span>
          <Button href={legacyHref} target="_blank">Legacy</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/models/create')}>新建模型</Button>
        </Space>
      </div>
    </header>
  );
}
