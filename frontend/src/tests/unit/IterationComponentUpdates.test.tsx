import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ComponentUpdatesPanel } from '../../features/model-center/ComponentUpdatesPanel';
import { renderWithQueryClient } from '../testUtils';
import type { ModelAsset } from '../../types/model';

vi.mock('../../api/componentUpdates', () => ({ getComponentUpdates: async () => ({ dependencies: [] }), testComponentUpdates: vi.fn(), applyComponentUpdates: vi.fn() }));
vi.mock('../../api/tasks', () => ({ getTask: async () => ({ id: 'T', status: 'SUCCESS' }) }));
vi.mock('../../api/models', () => ({ getModel: async () => ({ id: 'A2', status: 'trial', content_hash: 'edited', tested_content_hash: 'tested', tested_model_id: 'A2' }) }));

test('restored component update cannot apply stale success evidence', async () => {
  localStorage.setItem('optiforge-component-update:A', JSON.stringify({ key: 'K', selections: { C1: 'C2' }, candidateId: 'A2', taskId: 'T' }));
  const model = { id: 'A', name: 'A' } as ModelAsset;
  renderWithQueryClient(<MemoryRouter><ComponentUpdatesPanel model={model} /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: '应用组件更新' })).toBeDisabled();
  localStorage.clear();
});
