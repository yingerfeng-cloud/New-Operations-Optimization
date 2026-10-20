import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsPage } from '../../pages/Settings/SettingsPage';
import { renderWithQueryClient } from '../testUtils';

const api = vi.hoisted(() => ({
  config: { provider: 'volcengine_ark', enabled: true, model: 'before-import', base_url: 'https://ark.example/v3',
    api_key_configured: false, local_config_file: '/app/data/llm.local.json', persistence_path: '/app/data/runtime_store.json',
    temperature: 0.2, max_tokens: 4096, timeout_seconds: 60 },
  post: vi.fn(),
}));
vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(async (path: string) => ({ data: path === '/api/llm/config' ? api.config : { ok: true, dictionaries: {} } })),
    post: api.post,
  },
  unwrap: async (request: Promise<{ data: unknown }>) => (await request).data,
}));

test('settings imports the server local file and refreshes safe configuration without echoing a key', async () => {
  api.post.mockImplementation(async () => {
    api.config = { ...api.config, model: 'after-import', api_key_configured: true };
    return { data: api.config };
  });
  renderWithQueryClient(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: /大模型配置/ }));
  expect(await screen.findByText('/app/data/llm.local.json')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '从本机配置文件导入' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/llm/config/import-local'));
  expect(await screen.findByDisplayValue('after-import')).toBeInTheDocument();
  expect(screen.getByLabelText('API Key（已配置，留空则保持不变）')).toHaveValue('');
});
