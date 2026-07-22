import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProviders } from '../../app/providers';
import { ConfigurationMissingState, EmptyState, ErrorState, PageLoading, SearchEmptyState, TaskProcessingState } from '../../components/PageStates';

const mount = (node: React.ReactNode) => render(<AppProviders>{node}</AppProviders>);

it('exposes accessible loading and processing states', () => {
  mount(<><PageLoading /><TaskProcessingState status="求解" /></>);
  expect(screen.getByRole('status', { name: '' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('任务正在求解')).toBeInTheDocument();
});

it('provides actionable error and empty states', async () => {
  const retry = vi.fn();
  mount(<><ErrorState retry={retry} /><EmptyState title="没有任务" /><SearchEmptyState query="abc" /><ConfigurationMissingState /></>);
  await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByText('没有任务')).toBeInTheDocument();
  expect(screen.getByText('没有找到“abc”')).toBeInTheDocument();
});
