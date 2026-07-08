import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsPage } from '../../pages/Settings/SettingsPage';
import { renderWithQueryClient } from '../testUtils';

vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(async () => ({
      data: { ok: true, service: 'Power Semantic OR Platform', solver: 'HiGHS', highspy_installed: true, pyomo_installed: true },
    })),
  },
  unwrap: vi.fn(async (request: Promise<{ data: unknown }>) => (await request).data),
}));

const solverStatus = vi.hoisted(() => ({
  value: {
    highs: { available: true, version: '1.7.0' },
    ipopt: { available: true, path: '/usr/local/bin/ipopt', version: 'Ipopt 3.14' },
  } as {
    highs: { available: boolean; version?: string | null };
    ipopt: { available: boolean; path?: string | null; version?: string | null; message?: string | null };
  },
}));

vi.mock('../../api/solvers', () => ({
  getSolverStatus: vi.fn(async () => solverStatus.value),
}));

test('求解器状态页面展示 HiGHS 和 Ipopt 状态', async () => {
  renderWithQueryClient(<SettingsPage variant="runtime" />);

  expect(await screen.findByText('HiGHS 状态')).toBeInTheDocument();
  expect(screen.getByText('Ipopt 路径')).toBeInTheDocument();
  expect(await screen.findByText('/usr/local/bin/ipopt')).toBeInTheDocument();
  expect(screen.getByText('Ipopt 3.14')).toBeInTheDocument();
});

test('Ipopt 不可用时展示明确提示', async () => {
  solverStatus.value = {
    highs: { available: true, version: '1.7.0' },
    ipopt: { available: false, path: null, version: null, message: 'Ipopt executable not found. NLP solving is unavailable.' },
  };

  renderWithQueryClient(<SettingsPage variant="runtime" />);

  expect(await screen.findByText('Ipopt 不可用')).toBeInTheDocument();
  expect(screen.getByText('Ipopt executable not found. NLP solving is unavailable.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText(/HiGHS 可用 \/ Ipopt 不可用/).length).toBeGreaterThan(0));
});
