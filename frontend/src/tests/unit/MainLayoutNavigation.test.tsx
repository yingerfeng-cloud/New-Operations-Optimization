import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { MainLayout } from '../../app/layout/MainLayout';

vi.mock('../../app/layout/Header', () => ({ Header: () => <header>顶栏</header> }));
vi.mock('../../app/layout/Sidebar', () => ({ Sidebar: () => <aside>导航</aside> }));

function Navigation() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate('/models/create')}>进入建模</button>
    <button onClick={() => navigate('/models/create?mode=template', { replace: true })}>切换创建方式</button>
    <button onClick={() => navigate('/models/SAVED/edit', { replace: true })}>保存后的草稿地址</button>
    <Routes><Route element={<MainLayout />}>
      <Route path="scenarios" element={<div>场景内容</div>} />
      <Route path="models/create" element={<div>表单内容</div>} />
      <Route path="models/:id/edit" element={<div>同一份已保存草稿</div>} />
    </Route></Routes>
  </>;
}

test('starts a newly entered page at the top without scrolling in-page choices', () => {
  render(<MemoryRouter initialEntries={['/scenarios']}><Navigation /></MemoryRouter>);
  const content = document.querySelector<HTMLElement>('.main-content')!;
  content.scrollTop = 360;
  content.scrollLeft = 20;
  fireEvent.click(screen.getByRole('button', { name: '进入建模' }));
  expect(content.scrollTop).toBe(0);
  expect(content.scrollLeft).toBe(0);
  content.scrollTop = 160;
  fireEvent.click(screen.getByRole('button', { name: '切换创建方式' }));
  expect(content.scrollTop).toBe(160);
});

test('preserves position when autosave only replaces the draft address', () => {
  render(<MemoryRouter initialEntries={['/models/create']}><Navigation /></MemoryRouter>);
  const content = document.querySelector<HTMLElement>('.main-content')!;
  content.scrollTop = 240;
  fireEvent.click(screen.getByRole('button', { name: '保存后的草稿地址' }));
  expect(content.scrollTop).toBe(240);
  expect(screen.getByText('同一份已保存草稿')).toBeInTheDocument();
});
