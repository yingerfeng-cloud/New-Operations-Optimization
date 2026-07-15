import { act, render, screen } from '@testing-library/react';
import { TimeSeriesPreview } from '../../features/task-create/components/TimeSeriesPreview';

it('debounces generic series preview and exposes statistics', () => {
  vi.useFakeTimers();
  const { rerender } = render(<TimeSeriesPreview name="输入序列" unit="MW" labels={['T1', 'T2', 'T3']} values={[1, 2, 3]} />);
  expect(screen.getByText('输入序列曲线预览（MW）')).toBeInTheDocument();
  rerender(<TimeSeriesPreview name="输入序列" unit="MW" labels={['T1', 'T2', 'T3']} values={[2, 4, 6]} />);
  act(() => vi.advanceTimersByTime(299));
  expect(screen.getByText('3')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText('4')).toBeInTheDocument();
});

it('shows non-blocking data quality notices', () => {
  vi.useFakeTimers();
  render(<TimeSeriesPreview name="通用参数" labels={['T1', 'T2', 'T3']} values={[5, '', 'bad']} />);
  expect(screen.getByText(/存在 1 个空值/)).toBeInTheDocument();
  expect(screen.getByText(/不影响参数提交|不会自动阻止提交/)).toBeInTheDocument();
});
