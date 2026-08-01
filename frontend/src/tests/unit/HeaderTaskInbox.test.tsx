import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { AudienceProvider } from '../../app/audience';
import { Header } from '../../app/layout/Header';
import { renderWithQueryClient } from '../testUtils';

const taskState = vi.hoisted(() => ({
  tasks: [
    { id: 'task-failed-1', status: 'FAILED', model: '异常模型 A', created_at: '2026-07-29T23:35:00', error: '求解器不可用' },
    { id: 'task-failed-2', status: 'INFEASIBLE', model: '异常模型 B', created_at: '2026-07-16T22:31:00', error: '模型不可行' },
  ],
}));

vi.mock('../../api/tasks', () => ({
  getTasks: vi.fn(async () => taskState.tasks),
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(async () => ({
      data: { ok: true, service: 'Power Semantic OR Platform', solver: 'HiGHS', highspy_installed: true },
    })),
  },
  unwrap: vi.fn(async (request: Promise<{ data: unknown }>) => (await request).data),
}));

function renderHeader() {
  return renderWithQueryClient(
    <AudienceProvider>
      <MemoryRouter>
        <Header pathname="/" />
      </MemoryRouter>
    </AudienceProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

test('failed task messages can be handled without deleting task history', async () => {
  renderHeader();
  const trigger = await screen.findByRole('button', { name: '异常任务提醒，2 条' });
  fireEvent.click(trigger);

  fireEvent.click(await screen.findByRole('button', { name: '将异常模型 A标记为已处理' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '异常任务提醒，1 条' })).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: '全部处理' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '任务消息' })).toBeInTheDocument());
  expect(screen.getByText('异常消息均已处理，任务记录仍保留在任务中心')).toBeInTheDocument();

  cleanup();
  renderHeader();
  await waitFor(() => expect(screen.getByRole('button', { name: '任务消息' })).toBeInTheDocument());
});
