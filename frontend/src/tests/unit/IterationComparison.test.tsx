import { screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { renderWithQueryClient } from '../testUtils';
import { UpdateComparisonPanel } from '../../features/model-center/UpdateComparisonPanel';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/client', () => ({ apiClient: { get: state.get }, unwrap: async (value: Promise<unknown>) => value }));

test('unit mismatch displays observed values without manufacturing a delta', async () => {
  state.get.mockResolvedValue({ comparable: true, message: '相同输入；逐项检查单位', metrics: [], constraints: [],
    decisions: [{ key: 'x[0]', name: '供给', unit: 'kW', change: '定义或单位变化', comparable: false, delta: null, before: { value: 10 }, after: { value: 10000 } }] });
  renderWithQueryClient(<UpdateComparisonPanel candidateId="C" />);
  const row = (await screen.findByText('供给 · x[0]')).closest('tr')!;
  expect(within(row).getByText('10')).toBeInTheDocument();
  expect(within(row).getByText('10000')).toBeInTheDocument();
  expect(within(row).getByText('不可比')).toBeInTheDocument();
});

test('missing historical result states the limitation', async () => {
  state.get.mockResolvedValue({ comparable: false, message: '无可比旧结果，不能宣称收益提升', metrics: [], decisions: [], constraints: [] });
  renderWithQueryClient(<UpdateComparisonPanel candidateId="Missing" />);
  expect(await screen.findByText('无可比旧结果，不能宣称收益提升')).toBeVisible();
});
