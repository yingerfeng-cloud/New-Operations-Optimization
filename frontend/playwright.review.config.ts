import { defineConfig } from '@playwright/test';
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  testDir: './src/tests/e2e', testMatch: ['review_recovery.spec.ts', 'review_incremental.spec.ts'], workers: 1,
  timeout: 120_000, expect: { timeout: 15_000 },
  reporter: [['list']], outputDir: 'test-results/review',
  use: {
    baseURL: process.env.OPTIFORGE_REVIEW_URL || 'http://127.0.0.1:18018',
    channel: process.env.PW_CHANNEL || 'chrome',
    headless: true, viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
});
