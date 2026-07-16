import { ApiOutlined, BugOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAgentSkill,
  disableSkill,
  enableSkill,
  getSkill,
  getSkillInvocations,
  getSkills,
  runSkill,
  syncSkillSchema,
  type PlatformSkill,
  type SkillInputField,
} from '../../api/skills';
import { getAgentSkill } from '../../api/agents';
import { JsonViewer } from '../../components/JsonViewer';
import { PageHeader } from '../../components/PageHeader';

function text(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function statusColor(value?: unknown) {
  const normalized = String(value || '').toLowerCase();
  if (['enabled', 'published', 'success'].includes(normalized)) return 'green';
  if (['disabled', 'failed', 'offline'].includes(normalized)) return 'red';
  return 'blue';
}

function sampleFromSchema(schema?: SkillInputField[]) {
  const payload: Record<string, unknown> = {};
  for (const item of schema || []) {
    const key = item.key;
    if (!key) continue;
    const value = item.sample_value ?? item.default_value;
    if (value !== undefined && value !== null) payload[key] = value;
  }
  return payload;
}

function outputRows(output?: Record<string, unknown>) {
  const variables = Array.isArray(output?.variables) ? output.variables : [];
  return variables.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function parseJsonObject(value: string) {
  const parsed: unknown = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON must be an object');
  return parsed as Record<string, unknown>;
}

export function SkillCenterPage() {
  const qc = useQueryClient();
  const [selectedName, setSelectedName] = useState<string>();
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugPayload, setDebugPayload] = useState('{}');
  const [debugResult, setDebugResult] = useState<Record<string, unknown>>();
  const skills = useQuery({ queryKey: ['platform-skills'], queryFn: getSkills });
  const selected = useQuery({ queryKey: ['platform-skill', selectedName], queryFn: () => getSkill(selectedName!), enabled: !!selectedName });
  const agentDetail = useQuery({ queryKey: ['agent-skill-v2', selected.data?.agent_skill_name], queryFn: () => getAgentSkill(String(selected.data?.agent_skill_name)), enabled: Boolean(selected.data?.agent_skill_name) });
  const invocations = useQuery({ queryKey: ['skill-invocations', selectedName], queryFn: () => getSkillInvocations(selectedName!), enabled: !!selectedName });

  const rows = skills.data || [];
  const stats = useMemo(() => {
    const enabled = rows.filter(item => item.skill_status === 'enabled').length;
    const agentBound = rows.filter(item => item.agent_enabled || item.has_agent_package).length;
    const calls24h = rows.reduce((sum, item) => sum + Number(item.calls24h || 0), 0);
    const failed24h = rows.reduce((sum, item) => sum + Number(item.failed24h || 0), 0);
    const abnormal = rows.filter(item => item.callable === false && item.skill_status === 'enabled').length;
    const avg = rows.length ? Math.round(rows.reduce((sum, item) => sum + Number(item.avg_duration_ms || 0), 0) / rows.length) : 0;
    return { total: rows.length, enabled, disabled: rows.length - enabled, agentBound, calls24h, failed24h, avg, abnormal };
  }, [rows]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-skills'] });
    if (selectedName) {
      qc.invalidateQueries({ queryKey: ['platform-skill', selectedName] });
      qc.invalidateQueries({ queryKey: ['skill-invocations', selectedName] });
    }
  };

  const enableMutation = useMutation({ mutationFn: enableSkill, onSuccess: () => { message.success('Skill 已启用'); refresh(); } });
  const disableMutation = useMutation({ mutationFn: disableSkill, onSuccess: () => { message.success('Skill 已停用'); refresh(); } });
  const syncMutation = useMutation({ mutationFn: syncSkillSchema, onSuccess: () => { message.success('Schema 已同步'); refresh(); } });
  const agentMutation = useMutation({ mutationFn: createAgentSkill, onSuccess: () => { message.success('Agent Skill 已生成'); refresh(); } });
  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedName) throw new Error('请选择 Skill');
      return runSkill(selectedName, parseJsonObject(debugPayload), { mode: 'sync', explain: true });
    },
    onSuccess: data => {
      setDebugResult(data);
      refresh();
      message.success('Skill 测试调用完成');
    },
    onError: error => {
      const errorText = error instanceof Error ? error.message : String(error);
      setDebugResult({ status: 'ERROR', error: errorText });
    },
  });

  const openDebug = (skill: PlatformSkill) => {
    setSelectedName(skill.skill_name);
    setDebugPayload(JSON.stringify(sampleFromSchema(skill.input_schema), null, 2));
    setDebugResult(undefined);
    setDebugOpen(true);
  };

  const columns: ColumnsType<PlatformSkill> = [
    {
      title: 'Skill',
      width: 250,
      render: (_, row) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{row.display_name || row.name || row.skill_name}</Typography.Text>
          <Typography.Text type="secondary">{row.skill_name}</Typography.Text>
        </Space>
      ),
    },
    { title: '绑定模型', width: 240, render: (_, row) => <span>{text(row.model_id)}<br /><Typography.Text type="secondary">{text(row.model_code)} / {text(row.model_version || row.version)}</Typography.Text></span> },
    { title: '状态', width: 110, render: (_, row) => <Tag color={statusColor(row.skill_status)}>{text(row.skill_status)}</Tag> },
    { title: 'Agent', width: 180, render: (_, row) => <Space orientation="vertical" size={2}><Tag color={row.agent_enabled ? 'green' : 'default'}>{row.agent_enabled ? '已绑定' : '未绑定'}</Tag><Typography.Text type="secondary">{text(row.agent_skill_name || row.agent_package_status)}</Typography.Text></Space> },
    { title: 'Schema', width: 120, render: (_, row) => `${row.input_parameter_count ?? row.input_schema?.length ?? 0} / ${row.output_field_count ?? outputRows(row.output_schema).length}` },
    { title: '最近调用', width: 170, render: (_, row) => text(row.last_invocation_at) },
    { title: '成功率', width: 100, render: (_, row) => row.success_rate === null || row.success_rate === undefined ? '-' : `${Math.round(Number(row.success_rate) * 100)}%` },
    {
      title: '操作',
      fixed: 'right',
      width: 330,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => setSelectedName(row.skill_name)}>详情</Button>
          <Button size="small" icon={<BugOutlined />} onClick={() => openDebug(row)}>测试</Button>
          <Button size="small" onClick={() => (row.skill_status === 'enabled' ? disableMutation : enableMutation).mutate(row.skill_name)}>{row.skill_status === 'enabled' ? '停用' : '启用'}</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => syncMutation.mutate(row.skill_name)}>同步</Button>
          <Button size="small" icon={<LinkOutlined />} onClick={() => agentMutation.mutate(row.skill_name)}>生成 Agent</Button>
        </Space>
      ),
    },
  ];

  const detail = selected.data;

  return (
    <>
      <PageHeader
        title="Skill 服务中心"
        description="集中治理平台 Skill、Schema、Agent 绑定、在线调试和调用记录。"
        status={<Tag color="blue">/api/skills</Tag>}
        extra={<Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>}
      />
      <div className="skill-metric-grid">
        <Card><Statistic title="Skill 总数" value={stats.total} /></Card>
        <Card><Statistic title="已启用" value={stats.enabled} /></Card>
        <Card><Statistic title="已停用" value={stats.disabled} /></Card>
        <Card><Statistic title="Agent 绑定" value={stats.agentBound} /></Card>
        <Card><Statistic title="近 24h 调用" value={stats.calls24h} /></Card>
        <Card><Statistic title="近 24h 失败" value={stats.failed24h} /></Card>
        <Card><Statistic title="平均耗时 ms" value={stats.avg} /></Card>
        <Card><Statistic title="异常 Skill" value={stats.abnormal} /></Card>
      </div>
      <Card className="content-card section-gap" title="Skill 列表">
        <Table<PlatformSkill>
          rowKey="skill_name"
          loading={skills.isLoading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1500 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>
      <Drawer width={760} title={detail?.display_name || detail?.skill_name || 'Skill 详情'} open={!!selectedName} onClose={() => setSelectedName(undefined)}>
        {detail ? (
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                    <Descriptions bordered size="small" column={2} items={[
                      { key: 'skill_name', label: 'skill_name', children: detail.skill_name },
                      { key: 'display_name', label: 'display_name', children: detail.display_name || detail.name },
                      { key: 'model_id', label: 'model_id', children: detail.model_id },
                      { key: 'model_code', label: 'model_code', children: detail.model_code },
                      { key: 'status', label: 'status', children: <Tag color={statusColor(detail.skill_status)}>{detail.skill_status}</Tag> },
                      { key: 'owner', label: 'owner', children: text(detail.owner) },
                      { key: 'endpoint', label: 'endpoint', children: detail.endpoint },
                      { key: 'method', label: 'method', children: detail.method },
                      { key: 'policy', label: 'execution_policy', children: detail.execution_policy },
                      { key: 'review', label: 'requires_human_review', children: detail.requires_human_review ? 'true' : 'false' },
                    ]} />
                    <Alert showIcon type="warning" title="本结果仅用于辅助分析，不构成自动控制指令，需经人工复核后方可用于生产调度。" />
                  </Space>
                ),
              },
              {
                key: 'input',
                label: '输入 Schema',
                children: <Table rowKey={row => String(row.key)} size="small" pagination={false} dataSource={detail.input_schema || []} columns={[
                  { title: '参数', dataIndex: 'key' },
                  { title: '名称', dataIndex: 'name' },
                  { title: '类型', dataIndex: 'type' },
                  { title: '必填', dataIndex: 'required', render: (value: unknown) => value === false ? <Tag>可选</Tag> : <Tag color="red">必填</Tag> },
                  { title: '单位', dataIndex: 'unit' },
                  { title: '维度', dataIndex: 'dimension', render: (value: unknown) => Array.isArray(value) ? value.join(', ') : '-' },
                ]} />,
              },
              {
                key: 'output',
                label: '输出 Schema',
                children: <JsonViewer value={detail.output_schema || {}} />,
              },
              {
                key: 'agent',
                label: 'Agent 绑定',
                children: <Space orientation="vertical" size={12} style={{ width: '100%' }}><JsonViewer value={{ agent_enabled: detail.agent_enabled, agent_skill_name: detail.agent_skill_name, has_agent_package: detail.has_agent_package, agent_package_status: detail.agent_package_status }} />{agentDetail.data && <><Descriptions bordered size="small" column={2} items={[{ key: 'schema', label: 'schema_version', children: agentDetail.data.schema_version }, { key: 'state', label: 'state', children: agentDetail.data.state }, { key: 'profile', label: 'explanation_profile', children: agentDetail.data.explanation_profile }, { key: 'validation', label: 'validation', children: agentDetail.data.validation?.status }]} /><JsonViewer value={{ business_domain: agentDetail.data.business_domain, supported_intents: agentDetail.data.supported_intents, business_goals: agentDetail.data.business_goals, positive_examples: agentDetail.data.positive_examples, negative_examples: agentDetail.data.negative_examples, do_not_invoke_examples: agentDetail.data.do_not_invoke_examples }} /></>}</Space>,
              },
              {
                key: 'invocations',
                label: '调用记录',
                children: <Table size="small" rowKey={row => String(row.invocation_id || row.task_id)} loading={invocations.isFetching} dataSource={invocations.data || []} columns={[
                  { title: '调用 ID', render: (_, row: Record<string, unknown>) => text(row.invocation_id) },
                  { title: '状态', dataIndex: 'status' },
                  { title: '耗时', render: (_, row: Record<string, unknown>) => text(row.duration_seconds) },
                  { title: '时间', dataIndex: 'created_at' },
                ]} />,
              },
            ]}
          />
        ) : null}
      </Drawer>
      <Modal
        width={860}
        title={selectedName ? `在线测试：${selectedName}` : '在线测试'}
        open={debugOpen}
        onCancel={() => setDebugOpen(false)}
        footer={[
          <Button key="sample" onClick={() => setDebugPayload(JSON.stringify(sampleFromSchema(detail?.input_schema), null, 2))}>填充示例参数</Button>,
          <Button key="run" type="primary" loading={runMutation.isPending} onClick={() => runMutation.mutate()}>运行测试</Button>,
        ]}
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert showIcon type="info" icon={<ApiOutlined />} title="测试调用会执行真实 Skill；高风险生产参数请先人工复核。" />
          <Input.TextArea rows={10} value={debugPayload} onChange={event => setDebugPayload(event.target.value)} />
          {debugResult && <Card size="small" title="原始返回"><JsonViewer value={debugResult} /></Card>}
        </Space>
      </Modal>
      {skills.isError && <Alert className="section-gap" showIcon type="error" title="Skill 列表加载失败" />}
    </>
  );
}
