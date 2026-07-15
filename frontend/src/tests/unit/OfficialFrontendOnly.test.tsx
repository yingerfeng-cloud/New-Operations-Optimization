import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Header } from '../../app/layout/Header';
import { navEntries } from '../../app/navigation';
import { SettingsPage } from '../../pages/Settings/SettingsPage';
import { renderWithQueryClient } from '../testUtils';
import { AudienceProvider } from '../../app/audience';

vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(async () => ({
      data: { ok: true, service: 'Power Semantic OR Platform', solver: 'HiGHS', highspy_installed: true },
    })),
  },
  unwrap: vi.fn(async (request: Promise<{ data: unknown }>) => (await request).data),
}));

test('header exposes only the React model creation entry', async () => {
  renderWithQueryClient(
    <AudienceProvider><MemoryRouter>
      <Header pathname="/" />
    </MemoryRouter></AudienceProvider>,
  );

  expect(screen.getByRole('button', { name: /新建模型/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Legacy/i })).not.toBeInTheDocument();
});

test('settings page documents frontend as React-only', () => {
  renderWithQueryClient(<SettingsPage />);
  const removedHtmlEntry = '/' + 'prototype' + '.html';

  fireEvent.click(screen.getByRole('button', { name: /部署信息/ }));
  expect(screen.getByText('正式前端')).toBeInTheDocument();
  expect(screen.getAllByText('frontend/').length).toBeGreaterThan(0);
  expect(screen.queryByText('/legacy')).not.toBeInTheDocument();
  expect(screen.queryByText(removedHtmlEntry)).not.toBeInTheDocument();
});

test('navigation descriptions do not advertise legacy entrypoints', () => {
  const text = navEntries.map(entry => `${entry.label} ${entry.description}`).join('\n');

  expect(text).not.toMatch(/legacy|prototype/i);
  expect(text).toContain('从业务问题出发选择模型');
});
