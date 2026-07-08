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

test('P4 dashboard shows capability matrix and demo entries', async () => {
  renderWithQueryClient(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByText('平台能力矩阵')).toBeInTheDocument();
  expect(screen.getByText('MINLP_RESERVED')).toBeInTheDocument();
  expect(screen.getByText('梯级水电优化调度')).toBeInTheDocument();
  expect(screen.getByText('非线性水电出力 NLP 演示')).toBeInTheDocument();
});
