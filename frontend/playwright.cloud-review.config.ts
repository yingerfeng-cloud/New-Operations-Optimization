import { defineConfig } from '@playwright/test';
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  testDir: './src/tests/e2e', testMatch: 'cloud_review_*.spec.ts', workers: 1,
  timeout: 180_000, expect: { timeout: 15_000 }, reporter: [['list']],
  outputDir: 'test-results/cloud-review',
  use: { baseURL: process.env.OPTIFORGE_REVIEW_URL || 'http://127.0.0.1:5179',
    channel: process.env.PW_CHANNEL || 'chrome', headless: true, viewport: { width: 1440, height: 1000 },
    actionTimeout: 15_000,
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
