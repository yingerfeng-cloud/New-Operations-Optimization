import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { apiClient, unwrap } from '../../api/client';
import { getSolverStatus } from '../../api/solvers';
import { getLlmConfig, getSystemConfig, resetSystemConfig, testLlmConfig, updateLlmConfig, updateSystemDictionaries } from '../../api/systemConfig';
import type { DictionaryItem, LlmConfig, SystemDictionaries } from '../../types/systemConfig';
import type { TableProps } from 'antd';

interface SettingsPageProps {
  variant?: 'settings' | 'runtime';
}

type HealthStatus = 'ok' | 'warn' | 'error' | 'checking';
type SettingsSection = 'overview' | 'dictionaries' | 'llm' | 'runtime';
type DictionaryField = { key: number; name: number };

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

const sectionItems: Array<{ key: SettingsSection; label: string; desc: string }> = [
  { key: 'overview', label: '状态总览', desc: '接口、求解器和服务连通性' },
  { key: 'dictionaries', label: '字典配置', desc: '业务场景、组件领域和分类' },
  { key: 'llm', label: '大模型配置', desc: 'Agent LLM Provider 与模型参数' },
  { key: 'runtime', label: '部署信息', desc: '前后端地址与构建信息' },
];

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

function StatusOverview({ endpointStatus, endpointDesc, apiBase, solverStatus, solverDesc, backendOk }: {
  endpointStatus: (key: string) => HealthStatus;
  endpointDesc: (key: string, fallback: string) => string;
  apiBase: string;
  solverStatus: HealthStatus;
  solverDesc: string;
  backendOk: boolean;
}) {
  const tagColor = (status: HealthStatus) => status === 'ok' ? 'green' : status === 'warn' ? 'orange' : status === 'checking' ? 'blue' : 'red';
  const statusText = (status: HealthStatus) => status === 'ok' ? '正常' : status === 'warn' ? '待确认' : status === 'checking' ? '检查中' : '异常';
  const rows = [
    { key: 'backend', name: '后端 API', status: endpointStatus('backend'), desc: endpointDesc('backend', apiBase) },
    { key: 'solver', name: '求解器', status: solverStatus, desc: solverDesc },
    { key: 'models', name: '模型服务', status: endpointStatus('models'), desc: endpointDesc('models', '/api/models') },
    { key: 'agent', name: 'Agent 服务', status: endpointStatus('agent'), desc: endpointDesc('agent', '/api/agent/status') },
    { key: 'functionAssets', name: 'Function Asset API', status: endpointStatus('functionAssets'), desc: endpointDesc('functionAssets', '/api/function-assets') },
  ];
  const okCount = rows.filter(row => row.status === 'ok').length;
  const issueCount = rows.length - okCount;
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div className="settings-summary-grid">
        <div className="settings-summary-item">
          <span>在线服务</span>
          <strong>{okCount}</strong>
        </div>
        <div className="settings-summary-item">
          <span>需处理项</span>
          <strong>{issueCount}</strong>
        </div>
        <div className="settings-summary-item">
          <span>API 地址</span>
          <strong>{apiBase}</strong>
        </div>
      </div>
      <Card className="content-card" title="服务连通性">
        <Table
          className="settings-compact-table"
          pagination={false}
          rowKey="key"
          dataSource={rows}
          columns={[
            { title: '服务', dataIndex: 'name', width: 180 },
            { title: '状态', dataIndex: 'status', width: 120, render: (status: HealthStatus) => <Tag color={tagColor(status)}>{statusText(status)}</Tag> },
            { title: '说明', dataIndex: 'desc' },
          ]}
        />
      </Card>
      {!backendOk && <Alert className="section-gap" type="warning" showIcon title="系统状态未能全部确认" description="健康状态来自后端接口探测，请确认 FastAPI 已启动。" />}
    </Space>
  );
}

function dictionaryColumns(remove: (index: number | number[]) => void, parentOptions?: Array<{ value: string; label: string }>): TableProps<DictionaryField>['columns'] {
  return [
    { title: '编码', width: 180, render: (_: unknown, row: DictionaryField) => <Form.Item name={[row.name, 'code']} rules={[{ required: true }]}><Input placeholder="code" /></Form.Item> },
    { title: '名称', width: 180, render: (_: unknown, row: DictionaryField) => <Form.Item name={[row.name, 'label']} rules={[{ required: true }]}><Input placeholder="显示名称" /></Form.Item> },
    ...(parentOptions ? [{ title: '所属领域', width: 180, render: (_: unknown, row: DictionaryField) => <Form.Item name={[row.name, 'parent_code']}><Select allowClear options={parentOptions} placeholder="选择领域" /></Form.Item> }] : []),
    { title: '启用', width: 90, render: (_: unknown, row: DictionaryField) => <Form.Item name={[row.name, 'enabled']} valuePropName="checked"><Switch /></Form.Item> },
    { title: '排序', width: 100, render: (_: unknown, row: DictionaryField) => <Form.Item name={[row.name, 'sort_order']}><InputNumber min={0} precision={0} /></Form.Item> },
    { title: '操作', width: 80, render: (_: unknown, row: DictionaryField) => <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(row.name)} /> },
  ];
}

function DictionaryTable({ name, addLabel, parentOptions }: { name: keyof SystemDictionaries; addLabel: string; parentOptions?: Array<{ value: string; label: string }> }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Table<DictionaryField>
            className="settings-form-table"
            pagination={false}
            rowKey="key"
            dataSource={fields as DictionaryField[]}
            columns={dictionaryColumns(remove, parentOptions)}
            scroll={{ x: parentOptions ? 820 : 660 }}
          />
          <Button icon={<PlusOutlined />} onClick={() => add({ code: '', label: '', parent_code: parentOptions?.[0]?.value || '', enabled: true, sort_order: (fields.length + 1) * 10 })}>{addLabel}</Button>
        </Space>
      )}
    </Form.List>
  );
}

function DictionaryConfigPanel({ dictionaries, loading }: { dictionaries?: SystemDictionaries; loading: boolean }) {
  const [form] = Form.useForm<SystemDictionaries>();
  const qc = useQueryClient();
  useEffect(() => {
    if (dictionaries) form.setFieldsValue(dictionaries);
  }, [dictionaries, form]);
  const domainRows = Form.useWatch('component_domains', form) || dictionaries?.component_domains || [];
  const domainOptions = domainRows.filter(item => item?.enabled !== false).map(item => ({ value: item.code, label: item.label || item.code })).filter(item => item.value);
  const save = useMutation({
    mutationFn: (value: SystemDictionaries) => updateSystemDictionaries(value),
    onSuccess: () => {
      message.success('字典配置已保存');
      qc.invalidateQueries({ queryKey: ['system-config'] });
      qc.invalidateQueries({ queryKey: ['components'] });
    },
  });
  const reset = useMutation({
    mutationFn: resetSystemConfig,
    onSuccess: () => {
      message.success('系统配置已恢复默认');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
  });
  return (
    <Form form={form} layout="vertical" onFinish={save.mutate} initialValues={dictionaries}>
      <Card className="content-card" title="业务场景字典" extra={<Button icon={<ReloadOutlined />} onClick={() => reset.mutate()} loading={reset.isPending}>恢复默认</Button>}>
        <DictionaryTable name="business_scenarios" addLabel="新增业务场景" />
      </Card>
      <Card className="content-card section-gap" title="组件领域字典">
        <DictionaryTable name="component_domains" addLabel="新增领域" />
      </Card>
      <Card className="content-card section-gap" title="组件分类字典">
        <DictionaryTable name="component_categories" addLabel="新增分类" parentOptions={domainOptions} />
      </Card>
      <div className="settings-action-bar">
        <Button htmlType="submit" type="primary" loading={save.isPending || loading}>保存字典配置</Button>
      </div>
    </Form>
  );
}

function LlmConfigPanel({ config }: { config?: LlmConfig }) {
  const [form] = Form.useForm<Partial<LlmConfig> & { api_key?: string; clear_api_key?: boolean }>();
  const qc = useQueryClient();
  useEffect(() => {
    if (config) form.setFieldsValue({ ...config, api_key: '' });
  }, [config, form]);
  const save = useMutation({
    mutationFn: (value: Partial<LlmConfig> & { api_key?: string; clear_api_key?: boolean }) => updateLlmConfig(value),
    onSuccess: () => {
      message.success('大模型配置已保存');
      form.setFieldValue('api_key', '');
      qc.invalidateQueries({ queryKey: ['llm-config'] });
      qc.invalidateQueries({ queryKey: ['agent-status'] });
    },
  });
  const test = useMutation({
    mutationFn: testLlmConfig,
    onSuccess: result => {
      if (result.ok) message.success(result.enabled ? '大模型连接测试通过' : '大模型已停用，规则引擎可用');
      else message.warning(result.message || '大模型连接测试未通过');
    },
  });
  const provider = Form.useWatch('provider', form) || config?.provider;
  const providerOptions = (config?.supported_providers || ['disabled', 'openai_compatible', 'volcengine_ark']).map(value => ({ value, label: value }));
  return (
    <Card className="content-card" title="大模型配置">
      <Form form={form} layout="vertical" onFinish={save.mutate}>
        <Row gutter={16}>
          <Col xs={24} md={8}><Form.Item name="provider" label="Provider" rules={[{ required: true }]}><Select options={providerOptions} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="enabled" label="启用大模型" valuePropName="checked"><Switch disabled={provider === 'disabled'} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="model" label="模型 / Endpoint ID"><Input disabled={provider === 'disabled'} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="base_url" label="Base URL"><Input disabled={provider === 'disabled'} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="temperature" label="Temperature"><InputNumber min={0} max={2} step={0.1} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="max_tokens" label="Max Tokens"><InputNumber min={128} max={32000} precision={0} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="timeout_seconds" label="超时秒数"><InputNumber min={1} max={120} /></Form.Item></Col>
          <Col xs={24} md={16}><Form.Item name="api_key" label={`API Key${config?.api_key_configured ? '（已配置，留空则保持不变）' : ''}`}><Input.Password autoComplete="new-password" disabled={provider === 'disabled'} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="clear_api_key" label="清除已保存 Key" valuePropName="checked"><Switch disabled={!config?.api_key_configured} /></Form.Item></Col>
        </Row>
        <Descriptions className="section-gap" bordered column={2}>
          <Descriptions.Item label="配置来源">{config?.config_source || '-'}</Descriptions.Item>
          <Descriptions.Item label="Key 状态">{config?.api_key_configured ? '已配置' : '未配置'}</Descriptions.Item>
          <Descriptions.Item label="持久化文件">{config?.persistence_path || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{config?.last_updated_at || '-'}</Descriptions.Item>
        </Descriptions>
        <div className="settings-action-bar">
          <Button onClick={() => test.mutate()} loading={test.isPending}>测试连接</Button>
          <Button htmlType="submit" type="primary" loading={save.isPending}>保存大模型配置</Button>
        </div>
      </Form>
    </Card>
  );
}

function RuntimeConfigPanel({ apiBase, solverDesc, solverData }: { apiBase: string; solverDesc: string; solverData: Awaited<ReturnType<typeof getSolverStatus>> | undefined }) {
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon title="部署信息为只读" description="这里展示的是当前前后端入口、构建目录和求解器状态。实际端口、API Base URL、生产路径由启动脚本、环境变量和部署配置决定，不适合在浏览器页面内直接修改。" />
      <Card className="content-card" title="部署入口">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="API 地址">{apiBase}</Descriptions.Item>
          <Descriptions.Item label="求解器">{solverDesc}</Descriptions.Item>
          <Descriptions.Item label="React 开发入口">http://localhost:5173</Descriptions.Item>
          <Descriptions.Item label="FastAPI 生产入口">http://localhost:8000/</Descriptions.Item>
          <Descriptions.Item label="正式前端">frontend/</Descriptions.Item>
          <Descriptions.Item label="生产构建目录">frontend/dist</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card className="content-card" title="求解器配置">
        <Descriptions bordered column={1}>
          <Descriptions.Item label="HiGHS">{`${solverData?.highs?.available ? '可用' : '不可用'} / ${solverData?.highs?.version || '-'}`}</Descriptions.Item>
          <Descriptions.Item label="Ipopt">{`${solverData?.ipopt?.available ? '可用' : '不可用'} / ${solverData?.ipopt?.path || '-'} / ${solverData?.ipopt?.version || solverData?.ipopt?.message || '-'}`}</Descriptions.Item>
          <Descriptions.Item label="运行方式">Pyomo + highspy + optional Ipopt executable</Descriptions.Item>
          <Descriptions.Item label="NLP 文档">docs/nlp-solver.md</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export function SettingsPage({ variant = 'settings' }: SettingsPageProps) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
  const isRuntime = variant === 'runtime';
  const [activeSection, setActiveSection] = useState<SettingsSection>('overview');
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
  const { data: solverData, isFetching: solverFetching } = useQuery({
    queryKey: ['solver-status'],
    queryFn: getSolverStatus,
    retry: false,
    refetchInterval: import.meta.env.MODE === 'test' ? false : 30000,
  });
  const systemConfig = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
    enabled: !isRuntime,
    retry: false,
  });
  const llmConfig = useQuery({
    queryKey: ['llm-config'],
    queryFn: getLlmConfig,
    enabled: !isRuntime,
    retry: false,
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
  const solverStatus: HealthStatus = !data || !solverData
    ? (isFetching || solverFetching ? 'checking' : 'warn')
    : !data.entries.find(item => item.key === 'backend')?.ok
      ? 'error'
      : solverData.highs?.available === false
        ? 'error'
        : solverData.ipopt?.available ? 'ok' : 'warn';
  const solverDesc = solverData
    ? `HiGHS ${solverData.highs?.available ? '可用' : '不可用'} / Ipopt ${solverData.ipopt?.available ? '可用' : '不可用'}`
    : '等待 /api/solvers/status 返回求解器状态';
  const backendOk = endpointStatus('backend') === 'ok';

  if (isRuntime) {
    return (
      <>
        <PageHeader title="求解运行环境" description="查看求解器、后端 API、运行入口和 React 前端托管状态。" status={<Tag color="blue">HiGHS</Tag>} />
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
            <Descriptions.Item label="HiGHS 状态">{solverData?.highs?.available ? '可用' : '不可用'}</Descriptions.Item>
            <Descriptions.Item label="HiGHS 版本">{solverData?.highs?.version || '-'}</Descriptions.Item>
            <Descriptions.Item label="Ipopt 状态">{solverData?.ipopt?.available ? '可用' : '不可用'}</Descriptions.Item>
            <Descriptions.Item label="Ipopt 路径">{solverData?.ipopt?.path || '-'}</Descriptions.Item>
            <Descriptions.Item label="Ipopt 版本">{solverData?.ipopt?.version || '-'}</Descriptions.Item>
            <Descriptions.Item label="NLP 文档">docs/nlp-solver.md</Descriptions.Item>
          </Descriptions>
          {solverData?.ipopt?.available === false && <Alert className="section-gap" type="warning" showIcon title="Ipopt 不可用" description={solverData.ipopt.message || 'NLP 求解不可用，LP/MILP 仍走 HiGHS。'} />}
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
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="系统配置"
        description="维护平台字典、大模型 Provider、运行入口和服务连通性。"
        status={<Tag color={backendOk ? 'green' : 'orange'}>{backendOk ? '在线' : '待确认'}</Tag>}
      />
      <div className="settings-workbench">
        <nav className="settings-subnav" aria-label="系统配置二级菜单">
          {sectionItems.map(section => (
            <button key={section.key} type="button" className={activeSection === section.key ? 'active' : ''} onClick={() => setActiveSection(section.key)}>
              <strong>{section.label}</strong>
              <span>{section.desc}</span>
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          {activeSection === 'overview' && <StatusOverview endpointStatus={endpointStatus} endpointDesc={endpointDesc} apiBase={apiBase} solverStatus={solverStatus} solverDesc={solverDesc} backendOk={backendOk} />}
          {activeSection === 'dictionaries' && <DictionaryConfigPanel dictionaries={systemConfig.data?.dictionaries} loading={systemConfig.isLoading} />}
          {activeSection === 'llm' && <LlmConfigPanel config={llmConfig.data} />}
          {activeSection === 'runtime' && <RuntimeConfigPanel apiBase={apiBase} solverDesc={solverDesc} solverData={solverData} />}
        </section>
      </div>
    </>
  );
}
