import type { Page } from '@playwright/test';

export async function mockApi(page: Page) {
  await page.route('http://127.0.0.1:5178/api/**', async route => {
    const url = route.request().url();
    let body: unknown = [];
    if (url.endsWith('/api/health')) body = { ok: true };
    else if (url.includes('/api/templates/')) body = { code: 'economic_dispatch', name: '经济调度', scenario: 'economic_dispatch', build_mode: 'generic_linear', model_draft: {} };
    else if (url.endsWith('/api/templates')) body = [{ code: 'economic_dispatch', name: '经济调度', scenario: 'economic_dispatch' }];
    else if (url.endsWith('/api/models')) body = [{ id: 'm1', name: '示例模型', scene: 'power', version: 'v1', status: 'developing', solver: 'HiGHS', problem_type: 'LP', build_mode: 'generic_linear', updated_at: '2026-06-22' }];
    else if (url.endsWith('/api/components/catalog')) body = [{ component_id: 'power_balance', name: '功率平衡', status: 'published', enabled: true, implemented: true, version: '1.0' }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
