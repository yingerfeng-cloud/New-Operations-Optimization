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

test.each([
  ['首页', '生产运筹工作台'], ['业务场景', '业务场景库'], ['求解任务', '任务调度中心'],
  ['结果分析', '结果报告库'], ['组件资产', '组件库管理'], ['函数与曲线', '函数/曲线资产中心'],
  ['模型服务', '模型服务治理与在线调用'], ['Skill 服务', 'Skill 服务中心'],
  ['求解环境', '求解运行环境'], ['系统配置', '系统配置'], ['Agent 工作台', 'Agent 工作台'],
])('integrates %s by default without losing actions or status', async (label, title) => {
  render(<PageHeaderSlotsProvider pageLabel={label}>
    <HeaderTarget />
    <PageHeader title={title} description="页面说明" status={<span>在线状态</span>} tags="标签" extra={<button>页面操作</button>} />
  </PageHeaderSlotsProvider>);
  expect(await screen.findByRole('heading', { name: label, level: 1 })).toBeInTheDocument();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '页面操作' })).toBeInTheDocument();
  expect(screen.getByText('在线状态')).toBeInTheDocument();
  expect(screen.getByText('标签')).toBeInTheDocument();
  expect(document.querySelector('.page-hero')).not.toBeInTheDocument();
});
