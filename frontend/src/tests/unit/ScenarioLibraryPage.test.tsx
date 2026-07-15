import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { ScenarioLibraryPage } from '../../pages/ScenarioLibrary/ScenarioLibraryPage';
import { scenarioCatalog } from '../../features/model-creation/data/scenarioCatalog';
import { renderWithQueryClient } from '../testUtils';

const navigate = vi.hoisted(() => vi.fn());
const testState = vi.hoisted(() => ({
  models: [
    { id: 'm1', name: '日前模型', scene: '日前机组组合优化', status: 'published', template_id: 'unit_commitment_day_ahead' },
    { id: 'm2', name: '水电模型', scene: '梯级水电日前调度', status: 'tested', template_id: 'cascade_hydro_dispatch' },
  ] as Array<Record<string, unknown>>,
  scenarioItems: undefined as undefined | Array<{ code: string; label: string; enabled: boolean; sort_order: number }>,
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
    { id: 'm1', name: '日前模型', scene: '日前机组组合优化', status: 'published', template_id: 'unit_commitment_day_ahead' },
    { id: 'm2', name: '水电模型', scene: '梯级水电日前调度', status: 'tested', template_id: 'cascade_hydro_dispatch' },
  ];
  testState.scenarioItems = undefined;
});

test('renders React scenario library and navigates to an explicit backend-template mode', async () => {
  renderPage();
  expect(screen.getByText('业务场景库')).toBeInTheDocument();
  expect(screen.getAllByText('日前机组组合优化').length).toBeGreaterThan(0);
  expect(screen.getAllByText('梯级水电日前调度').length).toBeGreaterThan(0);
  expect(screen.getAllByText('电力市场交易').length).toBeGreaterThan(0);
  expect(screen.getAllByText('碳排放优化').length).toBeGreaterThan(0);

  fireEvent.click(screen.getAllByText('梯级水电日前调度')[0]);
  expect(screen.queryByText('日前机组组合优化模型')).not.toBeInTheDocument();
  expect(screen.getByText('梯级水电日前调度模型')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: '进入建模' })[1]);
  expect(navigate).toHaveBeenCalledWith('/models/create?mode=template&template=cascade_hydro_dispatch');
});

test('shows real published count zero without static fallback', async () => {
  testState.models = [];
  renderPage();
  expect(await screen.findAllByText('已发布模型')).not.toHaveLength(0);
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/推荐模型/).length).toBeGreaterThan(0);
});

test('all disabled scenarios render a safe configuration state', async () => {
  testState.models = [];
  testState.scenarioItems = scenarioCatalog.map((scenario, index) => ({ code: scenario.id, label: scenario.name, enabled: false, sort_order: index }));
  renderPage();
  expect(await screen.findByText('暂无可用业务场景')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '进入建模' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '查看系统配置' }));
  expect(navigate).toHaveBeenCalledWith('/settings');
});
