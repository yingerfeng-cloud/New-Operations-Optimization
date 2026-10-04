import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { SkillCenterPage } from '../../pages/SkillCenter/SkillCenterPage';
import { renderWithQueryClient } from '../testUtils';
import type { PlatformSkill } from '../../api/skills';

const apiMocks = vi.hoisted(() => ({
  skills: [] as PlatformSkill[],
  getSkills: vi.fn(),
  getSkill: vi.fn(),
  runSkill: vi.fn(),
  enableSkill: vi.fn(),
  disableSkill: vi.fn(),
  createAgentSkill: vi.fn(),
  getSkillInvocations: vi.fn(),
  getSkillVersions: vi.fn(),
  generateModelSkill: vi.fn(),
  validateSkill: vi.fn(),
  updateSkill: vi.fn(),
  getAgentSkill: vi.fn(),
  enableAgentSkill: vi.fn(),
  disableAgentSkill: vi.fn(),
}));

vi.mock('../../api/skills', () => ({
  getSkills: apiMocks.getSkills,
  getSkill: apiMocks.getSkill,
  runSkill: apiMocks.runSkill,
  enableSkill: apiMocks.enableSkill,
  disableSkill: apiMocks.disableSkill,
  createAgentSkill: apiMocks.createAgentSkill,
  getSkillInvocations: apiMocks.getSkillInvocations,
  getSkillVersions: apiMocks.getSkillVersions,
  generateModelSkill: apiMocks.generateModelSkill,
  validateSkill: apiMocks.validateSkill,
  updateSkill: apiMocks.updateSkill,
}));

vi.mock('../../api/agents', () => ({
  getAgentSkill: apiMocks.getAgentSkill,
  enableAgentSkill: apiMocks.enableAgentSkill,
  disableAgentSkill: apiMocks.disableAgentSkill,
}));

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  const Icon = ({ children }: any) => React.createElement('span', null, children);
  return {
    ApiOutlined: Icon,
    BugOutlined: Icon,
    LinkOutlined: Icon,
    ReloadOutlined: Icon,
  };
});

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  const React = await import('react');
  const h = React.createElement;
  const noop = vi.fn();
  const textFrom = (value: unknown) => {
    if (value === null || value === undefined || value === false) return null;
    return value as React.ReactNode;
  };
  const Button = ({ children, disabled, loading, onClick, icon }: any) =>
    h('button', { type: 'button', disabled: disabled || loading, onClick }, icon, children);
  const Checkbox = ({ children, checked, onChange }: any) =>
    h('label', null, h('input', { type: 'checkbox', checked, onChange }), children);
  const Space = ({ children, style }: any) => h('div', { style }, children);
  const Tag = ({ children }: any) => h('span', null, children);
  const Card = ({ children, title, className }: any) => h('section', { className }, title ? h('h3', null, title) : null, children);
  const Statistic = ({ title, value }: any) => h('div', { className: 'ant-statistic' }, h('span', null, title), h('strong', null, value));
  const Descriptions = ({ items = [] }: any) =>
    h('dl', null, items.map((item: any) => h('div', { key: item.key }, h('dt', null, item.label), h('dd', null, textFrom(item.children)))));
  const Drawer = ({ open, title, children }: any) => (open ? h('section', { role: 'dialog' }, h('h2', null, title), children) : null);
  const Modal = ({ open, title, children, footer }: any) => (open ? h('section', { role: 'dialog' }, h('h2', null, title), children, h('footer', null, footer)) : null);
  const Tabs = ({ items = [] }: any) =>
    h('div', null, items.map((item: any) => h('section', { key: item.key }, h('button', { type: 'button' }, item.label), item.children)));
  const Alert = ({ title, message, description, className }: any) =>
    h('div', { role: 'alert', className }, textFrom(title), textFrom(message), textFrom(description));
  const TextArea = ({ rows, value, onChange, ...rest }: any) => h('textarea', { rows, value, onChange, ...rest });
  const Input = Object.assign(({ value, onChange }: any) => h('input', { value, onChange }), { TextArea });
  const Table = ({ dataSource = [], columns = [], rowKey }: any) =>
    h(
      'table',
      null,
      h(
        'tbody',
        null,
        dataSource.map((row: any, rowIndex: number) =>
          h(
            'tr',
            { key: typeof rowKey === 'function' ? rowKey(row) : row[rowKey] || rowIndex },
            columns.map((column: any, columnIndex: number) => {
              const raw = column.dataIndex ? row[column.dataIndex] : undefined;
              const rendered = typeof column.render === 'function' ? column.render(raw, row, rowIndex) : raw;
              return h('td', { key: column.key || column.dataIndex || columnIndex }, rendered);
            }),
          ),
        ),
      ),
    );
  const Typography = {
    Text: ({ children, strong }: any) => (strong ? h('strong', null, children) : h('span', null, children)),
    Paragraph: ({ children, className }: any) => h('p', { className }, children),
    Title: ({ children }: any) => h('h3', null, children),
  };
  const App = ({ children }: any) => children;
  const message = { success: noop, error: noop, warning: noop, info: noop, destroy: noop, loading: vi.fn(() => noop) };
  const ConfigProvider = ({ children }: any) => children;
  const notification = { ...message };
  return { ...actual, Alert, App: actual.App, Button, Card, Checkbox, ConfigProvider: actual.ConfigProvider, Descriptions, Drawer, Input, Modal, Space, Statistic, Table, Tabs, Tag, Typography, message, notification };
});

const baseSkill: PlatformSkill = {
  skill_name: 'run_storage_dispatch',
  display_name: '储能调度',
  model_id: 'MODEL-POWER-STORAGE-DISPATCH',
  model_code: 'storage_dispatch',
  model_version: 'v1.0',
  skill_status: 'enabled',
  callable: true,
  agent_enabled: true,
  agent_skill_name: 'storage_dispatch',
  has_agent_package: true,
  agent_package_status: 'enabled',
  input_parameter_count: 4,
  output_field_count: 3,
  calls24h: 2,
  failed24h: 1,
  avg_duration_ms: 120,
  success_rate: 0.5,
  last_invocation_at: '2026-07-08T01:00:00Z',
  endpoint: '/api/skills/run_storage_dispatch/run',
  method: 'POST',
  execution_policy: 'advisory_only',
  requires_human_review: true,
  input_schema: [
    { key: 'electricity_price', name: '电价', sample_value: [300, 500], required: true, type: 'array' },
    { key: 'storage_capacity', name: '储能容量', sample_value: 100, required: true, type: 'number' },
  ],
  output_schema: { variables: [{ key: 'storage_charge', name: '充电功率' }] },
};

const disabledSkill: PlatformSkill = {
  ...baseSkill,
  skill_name: 'run_economic_dispatch',
  display_name: '经济调度',
  model_id: 'MODEL-POWER-ECONOMIC-DISPATCH',
  model_code: 'economic_dispatch',
  skill_status: 'disabled',
  callable: false,
  agent_enabled: false,
  has_agent_package: false,
  agent_package_status: 'not_created',
  calls24h: 3,
  failed24h: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.skills = [baseSkill, disabledSkill];
  apiMocks.getSkills.mockImplementation(async () => apiMocks.skills);
  apiMocks.getSkill.mockImplementation(async (name: string) => apiMocks.skills.find(item => item.skill_name === name) || baseSkill);
  apiMocks.runSkill.mockResolvedValue({ status: 'SUCCESS', objective_value: 10 });
  apiMocks.enableSkill.mockImplementation(async (name: string) => ({ ...disabledSkill, skill_name: name, skill_status: 'enabled' }));
  apiMocks.disableSkill.mockImplementation(async (name: string) => ({ ...baseSkill, skill_name: name, skill_status: 'disabled' }));
  apiMocks.createAgentSkill.mockResolvedValue({ skill: baseSkill, agent_skill: { name: 'storage_dispatch' } });
  apiMocks.getAgentSkill.mockResolvedValue({ name: 'storage_dispatch', state: 'enabled', enabled: true, validation: { status: 'valid' } });
  apiMocks.enableAgentSkill.mockResolvedValue({ name: 'storage_dispatch', state: 'enabled', enabled: true, validation: { status: 'valid' } });
  apiMocks.disableAgentSkill.mockResolvedValue({ name: 'storage_dispatch', state: 'disabled', enabled: false, validation: { status: 'valid' } });
  apiMocks.getSkillInvocations.mockResolvedValue([
    { invocation_id: 'INV-1', status: 'SUCCESS', duration_seconds: 0.2, created_at: '2026-07-08T01:00:00Z' },
  ]);
  apiMocks.getSkillVersions.mockResolvedValue([]);
  apiMocks.generateModelSkill.mockImplementation(async (_modelId: string) => ({
    ...baseSkill,
    generated: true,
    definition_revision: 1,
    definition: { schema_version: '2.0', skill_name: baseSkill.skill_name, explanation_spec: { schema_version: '2.0', metrics: [] } },
  }));
  apiMocks.validateSkill.mockResolvedValue({ status: 'valid', score: 100, errors: [], warnings: [] });
  apiMocks.updateSkill.mockImplementation(async (_name: string, body: Record<string, unknown>) => ({
    ...baseSkill,
    generated: true,
    definition_revision: 2,
    definition: body.definition,
  }));
});

function renderPage() {
  return renderWithQueryClient(<SkillCenterPage />);
}

test('renders skill list and real 24h stats', async () => {
  renderPage();
  expect(await screen.findByText('储能调度')).toBeInTheDocument();
  expect(screen.getByText('经济调度')).toBeInTheDocument();
  expect(screen.getByText('近 24h 调用').closest('.ant-statistic')).toHaveTextContent('5');
  expect(screen.getByText('近 24h 失败').closest('.ant-statistic')).toHaveTextContent('1');
});

test('opens detail drawer and loads invocation records', async () => {
  renderPage();
  const row = (await screen.findByText('储能调度')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /详\s*情/ }));

  expect(await screen.findByText('基础信息')).toBeInTheDocument();
  expect(apiMocks.getSkill).toHaveBeenCalledWith('run_storage_dispatch');
  expect(apiMocks.getSkillInvocations).toHaveBeenCalledWith('run_storage_dispatch');
  fireEvent.click(screen.getByText('调用记录'));
  expect(await screen.findByText('INV-1')).toBeInTheDocument();
});

test('runs skill test with sample payload and reports invalid JSON', async () => {
  renderPage();
  const row = (await screen.findByText('储能调度')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /测试/ }));
  expect(await screen.findByText('在线测试：run_storage_dispatch')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '运行测试' }));
  await waitFor(() => expect(apiMocks.runSkill).toHaveBeenCalledWith(
    'run_storage_dispatch',
    { electricity_price: [300, 500], storage_capacity: 100 },
    { mode: 'sync', explain: true },
  ));
  expect((await screen.findAllByText(/SUCCESS/)).length).toBeGreaterThan(0);

  fireEvent.change(screen.getByLabelText('Skill 测试参数 JSON'), { target: { value: '{bad json' } });
  fireEvent.click(screen.getByRole('button', { name: '运行测试' }));
  expect(await screen.findByText(/ERROR/)).toBeInTheDocument();
});

test('supports platform state and Agent management actions', async () => {
  renderPage();
  const enabledRow = (await screen.findByText('储能调度')).closest('tr')!;
  fireEvent.click(within(enabledRow).getByRole('button', { name: '停用' }));
  await waitFor(() => expect(apiMocks.disableSkill.mock.calls[0]?.[0]).toBe('run_storage_dispatch'));

  const disabledRow = screen.getByText('经济调度').closest('tr')!;
  fireEvent.click(within(disabledRow).getByRole('button', { name: /启\s*用/ }));
  await waitFor(() => expect(apiMocks.enableSkill.mock.calls[0]?.[0]).toBe('run_economic_dispatch'));

  fireEvent.click(within(enabledRow).getByRole('button', { name: 'Agent 管理' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重新生成 Agent 包' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '重新生成 Agent 包' }));
  await waitFor(() => expect(apiMocks.createAgentSkill.mock.calls[0]?.[0]).toBe('run_storage_dispatch'));
});

test('shows generated Agent drafts as pending enablement and enables them explicitly', async () => {
  const draftSkill = {
    ...baseSkill,
    agent_enabled: false,
    agent_package_status: 'draft',
  } as PlatformSkill;
  apiMocks.skills = [draftSkill];
  apiMocks.getSkill.mockResolvedValue(draftSkill);
  apiMocks.enableAgentSkill.mockImplementation(async (name: string) => {
    apiMocks.skills = [{ ...draftSkill, agent_enabled: true, agent_package_status: 'enabled' }];
    return { name, state: 'enabled', enabled: true, validation: { status: 'valid' } };
  });

  renderPage();
  const row = (await screen.findByText('储能调度')).closest('tr')!;
  expect(within(row).getByText('待启用')).toBeInTheDocument();
  expect(screen.getByText('Agent 绑定').closest('.ant-statistic')).toHaveTextContent('0');

  fireEvent.click(within(row).getByRole('button', { name: 'Agent 管理' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '启用 Agent' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '启用 Agent' }));
  await waitFor(() => expect(apiMocks.enableAgentSkill).toHaveBeenCalledWith('storage_dispatch'));
});

test('generates a complete skill and supports validated manual revisions', async () => {
  const generated = {
    ...baseSkill,
    generated: true,
    definition_revision: 1,
    definition_hash: 'definition-v1',
    binding_policy: 'fixed',
    definition_validation: { status: 'valid', score: 100, errors: [], warnings: [] },
    definition: {
      schema_version: '2.0',
      skill_name: baseSkill.skill_name,
      description: 'generated from model contract',
      explanation_spec: { schema_version: '2.0', metrics: [] },
    },
  } as PlatformSkill;
  apiMocks.skills = [generated];
  apiMocks.getSkill.mockResolvedValue(generated);
  apiMocks.getSkillVersions.mockResolvedValue([{ revision: 1, source: 'contract_compiler', created_at: '2026-07-08T01:00:00Z' }]);

  renderPage();
  const row = (await screen.findByText('储能调度')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /^重新生成完整 Skill$/ }));
  await waitFor(() => expect(apiMocks.generateModelSkill).toHaveBeenCalledWith(
    'MODEL-POWER-STORAGE-DISPATCH',
    { use_llm: false, status: 'enabled' },
  ));

  const textArea = await screen.findByLabelText('SkillDefinition JSON');
  const editedDefinition = { ...generated.definition, description: 'human reviewed' };
  fireEvent.change(textArea, { target: { value: JSON.stringify(editedDefinition) } });
  fireEvent.click(screen.getByRole('button', { name: '校验人工修改' }));
  await waitFor(() => expect(apiMocks.validateSkill).toHaveBeenCalledWith(baseSkill.skill_name, editedDefinition));
  fireEvent.click(screen.getByRole('button', { name: '保存为新修订' }));
  await waitFor(() => expect(apiMocks.updateSkill).toHaveBeenCalledWith(baseSkill.skill_name, { definition: editedDefinition }));
});
