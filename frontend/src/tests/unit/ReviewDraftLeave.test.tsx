import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { DraftLeaveGuard } from '../../features/model-creation/components/DraftLeaveGuard';
import { createBlankDraft, useModelCreationStore } from '../../features/model-creation/stores/modelCreationStore';
import { renderWithQueryClient } from '../testUtils';

beforeEach(() => {
  useModelCreationStore.getState().initializeWorkspace({ mode: 'new', sessionId: 'review' }, createBlankDraft());
  useModelCreationStore.getState().updateDraft({ basic_info: { ...useModelCreationStore.getState().draft.basic_info, name: '未保存模型' } });
});

function renderEditor(save: () => Promise<unknown> = async () => { useModelCreationStore.getState().setWorkspace({ dirty: false }); }) {
  const router = createMemoryRouter([
    { path: '/edit', element: <><DraftLeaveGuard onSave={save} /><Link to="/tasks">离开编辑</Link></> },
    { path: '/tasks', element: <p>任务页面</p> },
  ], { initialEntries: ['/edit'] });
  renderWithQueryClient(<RouterProvider router={router} />);
  return router;
}

test('continue editing preserves draft and only explicit discard clears it', async () => {
  const router = renderEditor();
  fireEvent.click(screen.getByText('离开编辑'));
  expect(await screen.findByText('当前草稿尚未保存')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(router.state.location.pathname).toBe('/edit');
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('未保存模型');
  fireEvent.click(screen.getByText('离开编辑'));
  fireEvent.click(await screen.findByRole('button', { name: '放弃并离开' }));
  expect(await screen.findByText('任务页面')).toBeInTheDocument();
  expect(useModelCreationStore.getState().workspace.dirty).toBe(false);
});

test('failed save prevents navigation and successful retry leaves', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('503')).mockImplementationOnce(async () => { useModelCreationStore.getState().setWorkspace({ dirty: false }); });
  const router = renderEditor(save);
  fireEvent.click(screen.getByText('离开编辑'));
  fireEvent.click(await screen.findByRole('button', { name: '保存并离开' }));
  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/edit');
  expect(useModelCreationStore.getState().draft.basic_info.name).toBe('未保存模型');
  fireEvent.click(screen.getByRole('button', { name: '保存并离开' }));
  expect(await screen.findByText('任务页面')).toBeInTheDocument();
});

test('browser history navigation is guarded and clean drafts leave normally', async () => {
  const router = renderEditor();
  await act(async () => { await router.navigate('/tasks'); });
  expect(await screen.findByText('当前草稿尚未保存')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  act(() => useModelCreationStore.getState().setWorkspace({ dirty: false }));
  await act(async () => { await router.navigate('/tasks'); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
});
