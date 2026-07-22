import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf('node_modules') === -1) return undefined;
          // Let Rollup keep Ant Design components with their lazy route graph.
          // A single forced vendor chunk made every Ant component used anywhere
          // in the application part of the initial-page preload.
          if (id.indexOf('echarts') >= 0) return 'vendor-echarts';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    css: false,
    globals: true,
    testTimeout: 40000,
    hookTimeout: 40000,
    teardownTimeout: 10000,
    // File-level API mocks and Zustand/module state must not leak into the
    // next suite. Keep two-way parallelism, but give every file a fresh graph.
    isolate: true,
    fileParallelism: true,
    pool: 'threads',
    // Ant Design/jsdom page suites are CPU-heavy; two workers keep the
    // standard test command deterministic on developer workstations.
    maxWorkers: 2,
    exclude: ['src/tests/e2e/**', 'node_modules/**', 'dist/**'],
  }
});
