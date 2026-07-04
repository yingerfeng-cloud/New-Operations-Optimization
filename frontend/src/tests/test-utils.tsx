import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, PropsWithChildren } from 'react';
import { vi } from 'vitest';
import axios from 'axios';

const testQueryClients = new Set<QueryClient>();
const originalFetch = globalThis.fetch;

type Mockable = {
  mockClear?: () => void;
  mockReset?: () => void;
};

export function createTestQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  testQueryClients.add(client);
  return client;
}

export function clearTestQueryClients() {
  for (const client of testQueryClients) {
    client.cancelQueries();
    client.clear();
  }
  testQueryClients.clear();
}

function resetFetchMock() {
  const currentFetch = globalThis.fetch as unknown as Mockable | undefined;
  if (currentFetch?.mockReset) {
    currentFetch.mockReset();
    return;
  }
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

function resetAxiosMocks() {
  const maybeAxios = axios as unknown as Mockable;
  maybeAxios.mockClear?.();
  for (const key of ['get', 'post', 'put', 'patch', 'delete', 'request', 'create']) {
    const member = (axios as unknown as Record<string, Mockable | undefined>)[key];
    member?.mockClear?.();
  }
}

function removeAntdPortals() {
  document
    .querySelectorAll(
      [
        '.ant-drawer-root',
        '.ant-modal-root',
        '.ant-message',
        '.ant-notification',
        '.ant-dropdown',
        '.ant-select-dropdown',
        '.ant-picker-dropdown',
        '.ant-tooltip',
      ].join(', '),
    )
    .forEach(node => node.remove());
}

export function cleanupTestEnv() {
  cleanup();
  clearTestQueryClients();
  removeAntdPortals();
  try {
    vi.clearAllTimers();
  } catch {
    // Some tests already restored real timers.
  }
  vi.useRealTimers();
  resetFetchMock();
  resetAxiosMocks();
  vi.clearAllMocks();
  removeAntdPortals();
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.body.className = '';
  document.documentElement.removeAttribute('style');
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const result = render(ui, { wrapper: Wrapper, ...options });
  return { ...result, queryClient };
}

export const renderWithQueryClient = renderWithProviders;
