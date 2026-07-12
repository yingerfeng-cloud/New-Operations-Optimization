import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Sidebar } from '../../app/layout/Sidebar';

function Probe() { return <span data-testid="path">{useLocation().pathname}</span>; }
const renderSidebar = (path = '/', collapsed = false) => render(<MemoryRouter initialEntries={[path]}><Sidebar collapsed={collapsed} /><Probe /></MemoryRouter>);

test('renders the product information architecture and removes model creation from persistent navigation', () => {
  renderSidebar();
  ['首页', '业务建模', '优化运行', '智能与服务', '专家工具'].forEach(label => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  expect(screen.queryByTitle('新建模型')).not.toBeInTheDocument();
  expect(screen.getByTitle('模型资产')).toBeInTheDocument();
  expect(screen.getByTitle('函数与曲线')).toBeInTheDocument();
});

test('keeps expert routes independently highlighted', () => {
  renderSidebar('/runtime');
  expect(screen.getByTitle('求解环境')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByTitle('系统配置')).not.toHaveAttribute('aria-current');
});

test('navigates and preserves semantic current state', () => {
  renderSidebar('/');
  fireEvent.click(screen.getByTitle('函数与曲线'));
  expect(screen.getByTestId('path')).toHaveTextContent('/functions');
  expect(screen.getByTitle('函数与曲线')).toHaveAttribute('aria-current', 'page');
});

test('collapsed sidebar keeps accessible titles and hides visual labels', () => {
  renderSidebar('/', true);
  expect(screen.getByTitle('求解任务')).toBeInTheDocument();
  expect(screen.queryByText('优化运行')).not.toBeInTheDocument();
});
