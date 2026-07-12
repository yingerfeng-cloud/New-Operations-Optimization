import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { CommandSearch } from '../../app/layout/CommandSearch';

vi.mock('../../api/models', () => ({ getModels: vi.fn(async () => [{ id: 'M1', name: '模型甲', status: 'published' }]) }));
vi.mock('../../api/components', () => ({ getComponents: vi.fn(async () => [{ component_id: 'C1', name: '组件甲', status: 'ready' }]) }));
vi.mock('../../api/functionAssets', () => ({ getFunctionAssets: vi.fn(async () => []) }));
vi.mock('../../api/tasks', () => ({ getTasks: vi.fn(async () => [{ id: 'T1', name: '任务甲', status: 'RUNNING' }]) }));
vi.mock('../../api/results', () => ({ getResults: vi.fn(async () => []) }));

function Harness() {
  const [open, setOpen] = useState(true);
  const location = useLocation();
  return <><button onClick={() => setOpen(true)}>reopen</button><span data-testid="location">{location.pathname}</span><CommandSearch open={open} onClose={() => setOpen(false)} /></>;
}

test('visual and keyboard order share the same displayed array', async () => {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  const list = await screen.findByRole('listbox', { name: '搜索结果' });
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBeGreaterThan(2));
  const options = within(list).getAllByRole('option');
  expect(options[0]).toHaveTextContent('模型甲');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  const input = screen.getByLabelText('全局搜索');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('location')).toHaveTextContent('/scenarios');
});

test('closing and reopening clears query, results state, and active index', async () => {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  const input = await screen.findByLabelText('全局搜索');
  fireEvent.change(input, { target: { value: '不存在的关键词' } });
  await screen.findByText('没有匹配结果');
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
  const reopened = await screen.findByLabelText('全局搜索');
  expect(reopened).toHaveValue('');
  const first = (await screen.findAllByRole('option'))[0];
  expect(first).toHaveAttribute('aria-selected', 'true');
});

test('Enter with no results does not navigate', async () => {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  const input = await screen.findByLabelText('全局搜索');
  fireEvent.change(input, { target: { value: '不存在的关键词' } });
  await screen.findByText('没有匹配结果');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('location')).toHaveTextContent('/');
});
