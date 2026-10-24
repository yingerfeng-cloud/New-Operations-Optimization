import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageHeader } from '../../components/PageHeader';
import { PageHeaderSlotsProvider, usePageHeaderSlots } from '../../components/PageHeader/slots';

function HeaderTarget() {
  const slots = usePageHeaderSlots();
  return <header><div ref={slots?.setTitleTarget} /></header>;
}

test('integrates the page title into its header and keeps help keyboard accessible', async () => {
  render(<PageHeaderSlotsProvider>
    <HeaderTarget />
    <PageHeader title="模型资产中心" shortTitle="模型资产" integrated description="管理模型版本与发布。" />
  </PageHeaderSlotsProvider>);
  expect(await screen.findByRole('heading', { name: '模型资产', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '模型资产中心' })).not.toBeInTheDocument();
  const help = screen.getByRole('button', { name: '模型资产使用说明' });
  fireEvent.click(help);
  await waitFor(() => expect(screen.getByText('管理模型版本与发布。')).toBeVisible());
  expect(help).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(help, { key: 'Escape' });
  await waitFor(() => expect(help).toHaveAttribute('aria-expanded', 'false'));
});

test('retains the original page header when no title slot is mounted', () => {
  render(<PageHeader title="模型资产中心" integrated description="管理模型版本与发布。" extra={<button>创建模型</button>} />);
  expect(screen.getByRole('heading', { name: '模型资产中心' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建模型' })).toBeInTheDocument();
});
