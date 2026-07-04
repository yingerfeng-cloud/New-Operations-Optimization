import { defineConfig } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

const channel = process.env.PW_CHANNEL || undefined;
const executablePath = !channel ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined : undefined;

export default defineConfig({
  testDir: './src/tests/e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['html', { outputFolder: 'playwright-report-real-backend', open: 'never' }], ['list']],
  outputDir: 'test-results/real-backend',
  use: {
    baseURL: 'http://127.0.0.1:5178',
    trace: 'on',
    screenshot: 'on',
    ...(channel ? { channel } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: [
    {
      // Requires the Python backend environment with pyomo and highspy installed.
      command: 'python ../server.py',
      port: 8000,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { PORT: '8000', COPT_SYNC_JOBS: 'true' },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5178 --strictPort',
      port: 5178,
      reuseExistingServer: true,
    },
  ],
});
