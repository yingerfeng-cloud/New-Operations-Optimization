import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './src/tests/e2e', workers: 1, timeout: 60_000, expect: { timeout: 15_000 }, use: { baseURL: 'http://127.0.0.1:5178', channel: 'chrome' }, webServer: { command: 'npx vite --host 127.0.0.1 --port 5178 --strictPort', port: 5178, reuseExistingServer: true } });
