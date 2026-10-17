import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';
import { numericSeries } from '../../features/result-center/ResultPanels';
import { ResultCenterPage } from '../../pages/ResultCenter/ResultCenterPage';
import { renderWithQueryClient } from '../testUtils';

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock('../../api/results', () => ({ getResults: api.list, getResult: api.detail }));
vi.mock('../../api/models', () => ({ getModel: async () => ({}) }));
beforeEach(() => { api.list.mockReset(); api.detail.mockReset(); window.history.replaceState({}, '', '/results'); });

test('numeric time never becomes the measurement and field order is irrelevant', () => {
  for (const rows of [
    [{ time: 0, power: 100 }, { time: 1, power: 200 }, { time: 2, power: 300 }],
    [{ power: 100, time: 0 }, { power: 200, time: 1 }, { power: 300, time: 2 }],
    [{ time: '00:00', power: 100 }, { time: '00:15', power: 200 }, { time: '00:30', power: 300 }],
  ]) {
    const series = numericSeries({ variables: { power: { rows } } });
    expect(series[0].values).toEqual([100, 200, 300]);
    expect(series[0].labels).toEqual(rows.map(row => String(row.time)));
  }
});

test('explicit axes, groups and units select and label multiple measures', () => {
  const series = numericSeries({ timeseries: [{ name: '出力', rows: [{ at: 1, site: 'A', power: 10, temperature: 20 }, { at: 2, site: 'A', power: 11, temperature: 21 }, { at: 1, site: 'B', power: 30, temperature: 40 }, { at: 2, site: 'B', power: 31, temperature: 41 }], x_field: 'at', y_fields: ['power'], group_field: 'site', unit: 'MW', x_label: '时段' }] });
  expect(series.map(item => item.values)).toEqual([[10, 11], [30, 31]]);
  expect(series.map(item => item.unit)).toEqual(['MW', 'MW']);
  expect(series[0].name).toContain('A');
});

test('first read failure shows retry and only successful empty reads show empty state', async () => {
  api.list.mockRejectedValueOnce(new Error('503')).mockResolvedValue([]);
  renderWithQueryClient(<ResultCenterPage />);
  expect(await screen.findByText('结果列表加载失败')).toBeInTheDocument();
  expect(screen.queryByText('暂无结果报告')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByText('暂无结果报告')).toBeInTheDocument();
});

test('cached read failure retains old rows and shows last update and recovery', async () => {
  api.list.mockResolvedValue([{ task_id: 'OLD-REPORT', objective_value: 10 }]);
  const { queryClient } = renderWithQueryClient(<ResultCenterPage />);
  expect(await screen.findByText('OLD-REPORT')).toBeInTheDocument();
  api.list.mockRejectedValue(new Error('timeout'));
  await queryClient.invalidateQueries({ queryKey: ['results'] });
  expect(await screen.findByText('结果列表未能更新')).toBeInTheDocument();
  expect(screen.getByText('OLD-REPORT')).toBeInTheDocument();
  expect(screen.getByText(/最后更新时间/)).toBeInTheDocument();
  api.list.mockResolvedValue([{ task_id: 'NEW-REPORT' }]);
  fireEvent.click(screen.getByRole('button', { name: '重试更新' }));
  expect(await screen.findByText('NEW-REPORT')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('结果列表未能更新')).not.toBeInTheDocument());
});

test('missing result detail has an actionable failure state', async () => {
  window.history.replaceState({}, '', '/results?task=MISSING');
  api.list.mockResolvedValue([]);
  api.detail.mockRejectedValue(new Error('404'));
  renderWithQueryClient(<ResultCenterPage />);
  expect(await screen.findByText('结果报告加载失败')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
});
