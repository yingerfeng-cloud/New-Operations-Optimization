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
  syncSkillSchema: vi.fn(),
  createAgentSkill: vi.fn(),
  getSkillInvocations: vi.fn(),
}));

vi.mock('../../api/skills', () => ({
  getSkills: apiMocks.getSkills,
  getSkill: apiMocks.getSkill,
  runSkill: apiMocks.runSkill,
  enableSkill: apiMocks.enableSkill,
  disableSkill: apiMocks.disableSkill,
  syncSkillSchema: apiMocks.syncSkillSchema,
  createAgentSkill: apiMocks.createAgentSkill,
  getSkillInvocations: apiMocks.getSkillInvocations,
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
  const React = await import('react');
  const h = React.createElement;
  const noop = vi.fn();
  const textFrom = (value: unknown) => {
    if (value === null || value === undefined || value === false) return null;
    return value as React.ReactNode;
  };
  const Button = ({ children, disabled, loading, onClick, icon }: any) =>
    h('button', { type: 'button', disabled: disabled || loading, onClick }, icon, children);
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
  const TextArea = ({ rows, value, onChange }: any) => h('textarea', { rows, value, onChange });
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
  const message = { success: noop, error: noop, warning: noop, info: noop, destroy: noop, loading: vi.fn(() => noop) };
  return { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Space, Statistic, Table, Tabs, Tag, Typography, message };
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
  apiMocks.syncSkillSchema.mockImplementation(async (name: string) => ({ ...baseSkill, skill_name: name }));
  apiMocks.createAgentSkill.mockResolvedValue({ skill: baseSkill, agent_skill: { name: 'storage_dispatch' } });
  apiMocks.getSkillInvocations.mockResolvedValue([
    { invocation_id: 'INV-1', status: 'SUCCESS', duration_seconds: 0.2, created_at: '2026-07-08T01:00:00Z' },
  ]);
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

  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{bad json' } });
  fireEvent.click(screen.getByRole('button', { name: '运行测试' }));
  expect(await screen.findByText(/ERROR/)).toBeInTheDocument();
});

test('supports enable disable sync schema and create agent actions', async () => {
  renderPage();
  const enabledRow = (await screen.findByText('储能调度')).closest('tr')!;
  fireEvent.click(within(enabledRow).getByRole('button', { name: /停\s*用/ }));
  await waitFor(() => expect(apiMocks.disableSkill.mock.calls[0]?.[0]).toBe('run_storage_dispatch'));

  const disabledRow = screen.getByText('经济调度').closest('tr')!;
  fireEvent.click(within(disabledRow).getByRole('button', { name: /启\s*用/ }));
  await waitFor(() => expect(apiMocks.enableSkill.mock.calls[0]?.[0]).toBe('run_economic_dispatch'));

  fireEvent.click(within(enabledRow).getByRole('button', { name: /同步/ }));
  await waitFor(() => expect(apiMocks.syncSkillSchema.mock.calls[0]?.[0]).toBe('run_storage_dispatch'));

  fireEvent.click(within(enabledRow).getByRole('button', { name: /生成 Agent/ }));
  await waitFor(() => expect(apiMocks.createAgentSkill.mock.calls[0]?.[0]).toBe('run_storage_dispatch'));
});
