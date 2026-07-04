import { Alert, Card, Collapse, Descriptions, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { apiClient, unwrap } from '../../api/client';

interface SettingsPageProps {
  variant?: 'settings' | 'runtime';
}

type HealthStatus = 'ok' | 'warn' | 'error' | 'checking';

interface HealthResponse {
  ok?: boolean;
  service?: string;
  solver?: string;
  pyomo_installed?: boolean;
  highspy_installed?: boolean;
}

const endpointDefs = [
  { key: 'backend', title: '后端 API', endpoint: '/api/health' },
  { key: 'agent', title: 'Agent 服务', endpoint: '/api/agent/status' },
  { key: 'functionAssets', title: 'Function Asset API', endpoint: '/api/function-assets' },
  { key: 'models', title: '模型服务', endpoint: '/api/models' },
  { key: 'tasks', title: '任务服务', endpoint: '/api/tasks' },
] as const;

async function checkEndpoint(endpoint: string) {
  try {
    const data = await unwrap<unknown>(apiClient.get(endpoint, { suppressErrorToast: true, timeout: 5000 }));
    return { ok: true, data, error: '' };
  } catch (error) {
    return { ok: false, data: undefined, error: error instanceof Error ? error.message : '接口不可用' };
  }
}

function HealthItem({ title, status, desc }: { title: string; status: HealthStatus; desc: string }) {
  const color = status === 'ok' ? 'green' : status === 'warn' ? 'amber' : status === 'checking' ? 'blue' : 'red';
  const tagColor = status === 'ok' ? 'green' : status === 'warn' ? 'orange' : status === 'checking' ? 'blue' : 'red';
  const statusText = status === 'ok' ? '正常' : status === 'warn' ? '待确认' : status === 'checking' ? '检查中' : '异常';
  const value = status === 'ok' ? '在线' : status === 'warn' ? '配置中' : status === 'checking' ? '检测中' : '不可用';
  return (
    <MetricCard
      title={<span>{title} <Tag color={tagColor}>{statusText}</Tag></span>}
      value={value}
      description={desc}
      tone={color}
    />
  );
}

export function SettingsPage({ variant = 'settings' }: SettingsPageProps) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
  const isRuntime = variant === 'runtime';
  const { data, isFetching } = useQuery({
    queryKey: ['system-health-probes'],
    queryFn: async () => {
      const entries = await Promise.all(endpointDefs.map(async def => ({ ...def, ...(await checkEndpoint(def.endpoint)) })));
      const health = entries.find(item => item.key === 'backend')?.data as HealthResponse | undefined;
      return { entries, health };
    },
    retry: false,
    refetchInterval: import.meta.env.MODE === 'test' ? false : 30000,
  });
  const endpointStatus = (key: string): HealthStatus => {
    if (!data) return isFetching ? 'checking' : 'warn';
    return data.entries.find(item => item.key === key)?.ok ? 'ok' : 'error';
  };
  const endpointDesc = (key: string, fallback: string) => {
    const entry = data?.entries.find(item => item.key === key);
    if (!entry) return fallback;
    return entry.ok ? `${entry.endpoint} 可访问` : `${entry.endpoint} 不可访问：${entry.error}`;
  };
  const solverStatus: HealthStatus = !data
    ? (isFetching ? 'checking' : 'warn')
    : !data.entries.find(item => item.key === 'backend')?.ok
      ? 'error'
      : data.health?.pyomo_installed === false || data.health?.highspy_installed === false
        ? 'error'
        : data.health?.ok ? 'ok' : 'warn';
  const solverDesc = data?.health
    ? `${data.health.solver || 'HiGHS'} / Pyomo ${data.health.pyomo_installed === false ? '不可用' : '可用'} / highspy ${data.health.highspy_installed === false ? '不可用' : '可用'}`
    : '等待 /api/health 返回求解器状态';
  const backendOk = endpointStatus('backend') === 'ok';

  if (isRuntime) {
    return (
      <>
        <PageHeader
          title="求解运行环境"
          description="查看求解器、后端 API、运行入口和 React 前端托管状态。"
          status={<Tag color="blue">HiGHS</Tag>}
        />
        <MetricGrid>
          <HealthItem title="后端 API" status={endpointStatus('backend')} desc={endpointDesc('backend', apiBase)} />
          <HealthItem title="求解器" status={solverStatus} desc={solverDesc} />
          <HealthItem title="任务服务" status={endpointStatus('tasks')} desc={endpointDesc('tasks', '/api/tasks')} />
          <MetricCard title="前端入口" value="Vite" description="React 开发入口 / 生产构建目录" tone="neutral" />
        </MetricGrid>
        {!backendOk && <Alert className="section-gap" type="warning" showIcon title="后端接口当前不可用" description="求解运行环境状态来自真实接口探测，请确认 FastAPI 已启动。" />}
        <Card className="content-card section-gap" title="求解器运行参数">
          <Descriptions column={2} bordered>
            <Descriptions.Item label="默认求解器">{data?.health?.solver || 'HiGHS'}</Descriptions.Item>
            <Descriptions.Item label="运行方式">{solverDesc}</Descriptions.Item>
            <Descriptions.Item label="线性规划">LP / MILP</Descriptions.Item>
            <Descriptions.Item label="运行状态">{solverStatus === 'ok' ? '可用' : solverStatus === 'checking' ? '检查中' : '不可用或待确认'}</Descriptions.Item>
          </Descriptions>
        </Card>
        <Card className="content-card section-gap" title="运行入口">
          <Descriptions column={2} bordered>
            <Descriptions.Item label="API 地址">{apiBase}</Descriptions.Item>
            <Descriptions.Item label="FastAPI 生产入口">http://localhost:8000/</Descriptions.Item>
            <Descriptions.Item label="React 开发入口">http://localhost:5173</Descriptions.Item>
            <Descriptions.Item label="正式前端">frontend/</Descriptions.Item>
            <Descriptions.Item label="生产构建目录">frontend/dist</Descriptions.Item>
          </Descriptions>
        </Card>
        <Collapse
          className="section-gap"
          items={[
            { key: 'env', label: '环境变量与启动说明', children: <Descriptions bordered column={1} items={[{ key: 'api', label: 'VITE_API_BASE_URL', children: apiBase }, { key: 'frontend', label: '前端入口', children: 'npm run dev / npm run build' }]} /> },
            { key: 'diagnostics', label: '运行诊断', children: <Descriptions bordered column={1} items={[{ key: 'solver', label: '求解器连通性', children: '当前求解器为 HiGHS，适用于 LP / MILP 线性问题。' }, { key: 'nlp', label: '非线性问题', children: '变量乘变量或一般 NLP 需线性化或切换求解策略。' }]} /> },
          ]}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="系统配置"
        description="查看 API 连接、求解器、模型服务、Agent 服务、函数资产和生产入口状态。"
        status={<Tag color="blue">HiGHS</Tag>}
      />
      <div className="settings-status-grid">
        <HealthItem title="后端 API" status={endpointStatus('backend')} desc={endpointDesc('backend', apiBase)} />
        <HealthItem title="求解器" status={solverStatus} desc={solverDesc} />
        <HealthItem title="模型服务" status={endpointStatus('models')} desc={endpointDesc('models', '/api/models')} />
        <HealthItem title="Agent 服务" status={endpointStatus('agent')} desc={endpointDesc('agent', '/api/agent/status')} />
        <HealthItem title="Function Asset API" status={endpointStatus('functionAssets')} desc={endpointDesc('functionAssets', '/api/function-assets')} />
      </div>
      {!backendOk && <Alert className="section-gap" type="warning" showIcon title="系统状态未能全部确认" description="健康状态现在直接来自后端接口探测，不再硬编码为正常。" />}
      <Card className="content-card section-gap" title="运行配置">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="API 地址">{apiBase}</Descriptions.Item>
          <Descriptions.Item label="求解器">HiGHS</Descriptions.Item>
          <Descriptions.Item label="React 开发入口">http://localhost:5173</Descriptions.Item>
          <Descriptions.Item label="FastAPI 生产入口">http://localhost:8000/</Descriptions.Item>
          <Descriptions.Item label="正式前端">frontend/</Descriptions.Item>
          <Descriptions.Item label="生产构建目录">frontend/dist</Descriptions.Item>
        </Descriptions>
      </Card>
      <Collapse
        className="section-gap"
        defaultActiveKey={['solver', 'model']}
        items={[
          { key: 'solver', label: '求解器配置', children: <Descriptions bordered column={1} items={[{ key: 'solver', label: '默认求解器', children: 'HiGHS' }, { key: 'runtime', label: '运行方式', children: 'Pyomo + highspy' }]} /> },
          { key: 'model', label: '大模型配置', children: <Descriptions bordered column={1} items={[{ key: 'mode', label: 'Agent 模式', children: '未配置大模型时使用规则引擎完成基础意图识别' }, { key: 'provider', label: 'Provider', children: '按后端环境变量读取' }]} /> },
          { key: 'entry', label: '运行入口', children: <Descriptions bordered column={1} items={[{ key: 'frontend', label: '前端入口', children: 'http://localhost:5173' }, { key: 'backend', label: '后端入口', children: 'http://localhost:8000' }]} /> },
          { key: 'build', label: '构建信息', children: <Descriptions bordered column={1} items={[{ key: 'src', label: '源码目录', children: 'frontend/' }, { key: 'dist', label: '构建目录', children: 'frontend/dist' }]} /> },
        ]}
      />
    </>
  );
}
