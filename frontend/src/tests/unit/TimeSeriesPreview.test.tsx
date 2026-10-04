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

it('keeps an empty preview in the same container and notice style', () => {
  vi.useFakeTimers();
  render(<TimeSeriesPreview name="输入序列" unit="MW" labels={[]} values={[]} />);
  expect(screen.getByRole('region', { name: '输入序列曲线预览（MW）' })).toBeInTheDocument();
  expect(screen.getByText('暂无曲线预览')).toBeInTheDocument();
  expect(screen.getByText('填写数值后显示曲线预览。')).toBeInTheDocument();
  expect(document.querySelector('.time-series-preview .parameter-notice')).toBeInTheDocument();
  expect(screen.queryByTestId('mock-echarts')).not.toBeInTheDocument();
});

it('shows non-blocking data quality notices', () => {
  vi.useFakeTimers();
  render(<TimeSeriesPreview name="通用参数" labels={['T1', 'T2', 'T3']} values={[5, '', 'bad']} />);
  expect(screen.getByText('数据质量提示')).toBeInTheDocument();
  expect(screen.getByText(/存在 1 个空值/)).toBeInTheDocument();
  expect(screen.getByText(/不影响参数提交|不会自动阻止提交/)).toBeInTheDocument();
});

it('warns when a complete numeric series is constant without blocking submission', () => {
  vi.useFakeTimers();
  render(<TimeSeriesPreview name="电网接入上限曲线" unit="MW" labels={['T1', 'T2', 'T3']} values={[4, 4, 4]} />);
  expect(screen.getByText(/全序列数值相同/)).toBeInTheDocument();
  expect(screen.getByText(/不会自动阻止提交/)).toBeInTheDocument();
});
