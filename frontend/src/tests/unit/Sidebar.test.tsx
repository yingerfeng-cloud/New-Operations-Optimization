import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Sidebar } from '../../app/layout/Sidebar';

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="current-path">{pathname}</div>;
}

function renderSidebar(pathname: string) {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

test('selects model creation without also selecting model center', () => {
  renderSidebar('/models/create');

  expect(screen.getByTitle('模型创建')).toHaveClass('active');
  expect(screen.getByTitle('模型资产中心')).not.toHaveClass('active');
});

test('keeps runtime environment and system settings as separate active items', () => {
  renderSidebar('/runtime');

  expect(screen.getByTitle('求解运行环境')).toHaveClass('active');
  expect(screen.getByTitle('系统配置')).not.toHaveClass('active');
});

test('selects system settings without also selecting runtime environment', () => {
  renderSidebar('/settings');

  expect(screen.getByTitle('系统配置')).toHaveClass('active');
  expect(screen.getByTitle('求解运行环境')).not.toHaveClass('active');
});

test('renders function assets navigation item', () => {
  renderSidebar('/');

  expect(screen.getByTitle('函数/曲线资产中心')).toBeInTheDocument();
});

test('navigates to function assets page from sidebar', () => {
  renderSidebar('/');

  fireEvent.click(screen.getByTitle('函数/曲线资产中心'));

  expect(screen.getByTestId('current-path')).toHaveTextContent('/functions');
});

test('selects function assets item on functions route', () => {
  renderSidebar('/functions');

  expect(screen.getByTitle('函数/曲线资产中心')).toHaveClass('active');
});
