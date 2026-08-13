import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { ScenarioLibraryPage } from '../../pages/ScenarioLibrary/ScenarioLibraryPage';
import { renderWithQueryClient } from '../testUtils';

const defaultScenarioItems = [
  { code: 'day_ahead_unit_commitment', label: '日前机组组合优化', description: '日前计划', status: 'published', enabled: true, sort_order: 10 },
  { code: 'cascade_hydro_day_ahead', label: '梯级水电日前调度', description: '梯级水库调度', status: 'published', enabled: true, sort_order: 20 },
  { code: 'power_market_trading', label: '电力市场交易', description: '市场交易', status: 'published', enabled: true, sort_order: 30 },
  { code: 'carbon_emission_optimization', label: '碳排放优化', description: '低碳调度', status: 'trial', enabled: true, sort_order: 40 },
] as const;

const navigate = vi.hoisted(() => vi.fn());
const testState = vi.hoisted(() => ({
  models: [
    { id: 'm1', name: '日前模型', scenario_id: 'day_ahead_unit_commitment', scene: '日前机组组合优化', status: 'published', is_active_version: true, template_id: 'unit_commitment_day_ahead', build_mode: 'generic_linear' },
    { id: 'm2', name: '水电模型', scenario_id: 'cascade_hydro_day_ahead', scene: '梯级水电日前调度', status: 'trial', template_id: 'cascade_hydro_dispatch', build_mode: 'component_based' },
  ] as Array<Record<string, unknown>>,
  scenarioItems: [] as Array<{ code: string; label: string; description?: string; status?: string; enabled: boolean; sort_order: number }>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../api/models', () => ({
  getModels: async () => testState.models,
}));

vi.mock('../../api/systemConfig', () => ({
  getSystemConfig: async () => ({ dictionaries: { business_scenarios: testState.scenarioItems } }),
}));

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ScenarioLibraryPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  testState.models = [
    { id: 'm1', name: '日前模型', scenario_id: 'day_ahead_unit_commitment', scene: '日前机组组合优化', status: 'published', is_active_version: true, template_id: 'unit_commitment_day_ahead', build_mode: 'generic_linear' },
    { id: 'm2', name: '水电模型', scenario_id: 'cascade_hydro_day_ahead', scene: '梯级水电日前调度', status: 'trial', template_id: 'cascade_hydro_dispatch', build_mode: 'component_based' },
  ];
  testState.scenarioItems = defaultScenarioItems.map(item => ({ ...item }));
});

test('renders configured scenarios and opens the actual model asset', async () => {
  renderPage();
  expect(screen.getByText('业务场景库')).toBeInTheDocument();
  expect((await screen.findAllByText('日前机组组合优化')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('梯级水电日前调度').length).toBeGreaterThan(0);
  expect(screen.getAllByText('电力市场交易').length).toBeGreaterThan(0);
  expect(screen.getAllByText('碳排放优化').length).toBeGreaterThan(0);

  fireEvent.click(screen.getAllByText('梯级水电日前调度')[0]);
  expect(screen.queryByText('日前模型')).not.toBeInTheDocument();
  expect(screen.getByText('水电模型')).toBeInTheDocument();

  const card = screen.getByTestId('scenario-card-cascade_hydro_day_ahead');
  fireEvent.click(within(card).getByRole('button', { name: '进入建模' }));
  expect(navigate).toHaveBeenCalledWith('/models/create?mode=version&source=m2');
});

test('page-level modeling entry starts blank instead of silently selecting the first scenario template', async () => {
  renderPage();
  await screen.findByTestId('scenario-card-day_ahead_unit_commitment');
  const button = screen.getAllByRole('button', { name: '进入建模' })[0];
  fireEvent.click(button);
  expect(navigate).toHaveBeenCalledWith('/models/create?mode=new');
});

test('shows real published count zero without static fallback', async () => {
  testState.models = [];
  renderPage();
  expect(await screen.findAllByText('已发布模型')).not.toHaveLength(0);
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: '创建空白模型' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText('该场景尚未关联模型资产').length).toBeGreaterThan(0);
});

test('all disabled scenarios render a safe configuration state', async () => {
  testState.models = [];
  testState.scenarioItems = defaultScenarioItems.map((scenario, index) => ({ ...scenario, enabled: false, sort_order: index }));
  renderPage();
  expect(await screen.findByText('暂无可用业务场景')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '进入建模' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '查看系统配置' }));
  expect(navigate).toHaveBeenCalledWith('/settings');
});
