import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const runtimeStorePath = join(tmpdir(), `optiforge-review-${randomUUID()}.json`);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './src/tests/e2e', testMatch: 'review_recovery.spec.ts', grep: /@real/, workers: 1,
  timeout: 120_000, expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-review', open: 'never' }]],
  outputDir: 'test-results/review',
  use: {
    baseURL: 'http://127.0.0.1:5178',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    headless: true, viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'python -m tests.review_browser_backend', cwd: '..', port: 8000,
      reuseExistingServer: false, timeout: 120_000,
      env: {
        PORT: '8000', RUNTIME_STORE_PATH: runtimeStorePath, OPTIFORGE_RUNTIME_STORE: runtimeStorePath,
        OPTIFORGE_SYNC_JOBS: 'true', LLM_ENABLED: 'false', OPTIMIZATION_PLATFORM_API_TOKEN: 'synthetic-review-token',
        AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK: 'true',
      },
    },
    { command: 'npx vite --host 127.0.0.1 --port 5178 --strictPort', port: 5178, reuseExistingServer: false },
  ],
});
