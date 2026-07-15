import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { DashboardPage } from '../../pages/Dashboard/DashboardPage';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../api/models', () => ({ getModels: async () => [] }));
vi.mock('../../api/components', () => ({ getComponents: async () => [] }));
vi.mock('../../api/templates', () => ({ getTemplates: async () => [] }));
vi.mock('../../api/tasks', () => ({ getTasks: async () => [] }));
vi.mock('../../api/solvers', () => ({
  getSolverStatus: async () => ({
    highs: { available: true, version: '1.0' },
    ipopt: { available: true, path: '/usr/bin/ipopt', version: 'Ipopt 3.x' },
    status: 'OK',
  }),
}));

test('dashboard keeps solver capabilities concise and routes details to runtime', async () => {
  renderWithQueryClient(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByText('求解能力摘要')).toBeInTheDocument();
  expect(await screen.findByText('HiGHS：可用')).toBeInTheDocument();
  expect(await screen.findByText('Ipopt：可用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看完整求解环境' })).toBeInTheDocument();
  expect(screen.queryByText('MINLP_RESERVED')).not.toBeInTheDocument();
});
