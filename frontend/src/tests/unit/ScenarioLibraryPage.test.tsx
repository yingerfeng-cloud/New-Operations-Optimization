import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ScenarioLibraryPage } from '../../pages/ScenarioLibrary/ScenarioLibraryPage';
import { renderWithQueryClient } from '../testUtils';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../api/models', () => ({
  getModels: async () => [
    { id: 'm1', name: '日前模型', scene: '日前机组组合优化', status: 'published', template_id: 'unit_commitment_day_ahead' },
    { id: 'm2', name: '水电模型', scene: '梯级水电日前调度', status: 'tested', template_id: 'cascade_hydro_dispatch' },
  ],
}));

function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ScenarioLibraryPage />
    </MemoryRouter>,
  );
}

test('renders React scenario library and navigates with scenario/model query', async () => {
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
  expect(navigate).toHaveBeenCalledWith('/models/create?scenarioId=cascade_hydro_day_ahead&modelId=cascade_hydro_dispatch_lp');
});
