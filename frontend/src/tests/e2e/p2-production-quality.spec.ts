import { expect, test } from '@playwright/test';

test('core shell controls remain keyboard accessible', async ({ page }) => {
  await page.route(/^http:\/\/127\.0\.0\.1:5178\/api\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().url().includes('/health') || route.request().url().includes('/status') ? '{}' : '[]' }));
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  const search = page.getByRole('button', { name: '打开全局搜索' });
  await search.focus();
  await expect(search).toBeFocused();
  await search.press('Enter');
  const input = page.getByRole('textbox', { name: '全局搜索' });
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).not.toBeVisible();
});

test('mobile navigation exposes readable mode and touch controls', async ({ page }) => {
  await page.route(/^http:\/\/127\.0\.0\.1:5178\/api\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().url().includes('/health') || route.request().url().includes('/status') ? '{}' : '[]' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开主导航' }).click();
  await expect(page.getByLabel('平台视图')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '平台功能' })).toBeVisible();
});
