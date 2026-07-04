import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ResultCenterPage } from '../../pages/ResultCenter/ResultCenterPage';
import type { SolveResult } from '../../types/result';
import { renderWithQueryClient } from '../testUtils';

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="mock-chart">chart</div> }));

const resultSample: SolveResult = {
  task_id: 'OPT-SUCCESS',
  status: 'SUCCESS',
  objective_value: 123.45,
  metrics: { objective_value: 123.45, total_cost: 123.45, gap: '0.00%' },
  summary: { objective_value: 123.45, total_cost: 123.45 },
  variables: { p_grid: [10, 12, 14], soc: [5, 6, 7] },
  constraints: { balance: 'passed' },
  business_output: { dispatch_series: [{ time: 1, p_grid: 10 }, { time: 2, p_grid: 12 }] },
  business_explanation: { summary: '结果显示负荷平衡约束满足。', risk_notes: ['关注高峰时段备用。'], next_actions: ['复核输入负荷。'] },
};

vi.mock('../../api/results', () => ({
  getResults: async () => [resultSample],
  getResult: async () => resultSample,
}));

function renderPage() {
  return renderWithQueryClient(<ResultCenterPage />);
}

test('renders result center and structured report detail', async () => {
  renderPage();
  expect(screen.getByText('结果报告库')).toBeInTheDocument();
  expect(await screen.findByText('OPT-SUCCESS')).toBeInTheDocument();
  expect(screen.getByText('最优目标值')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '查看报告' }));

  await waitFor(() => expect(screen.getByText('objective_value')).toBeInTheDocument());
  fireEvent.click(screen.getByText('变量表'));
  expect(screen.getByText('p_grid')).toBeInTheDocument();
  fireEvent.click(screen.getByText('约束检查'));
  expect(screen.getByText('balance')).toBeInTheDocument();
  fireEvent.click(screen.getByText('结论摘要'));
  expect(screen.getByText('结果显示负荷平衡约束满足。')).toBeInTheDocument();
}, 20000);
