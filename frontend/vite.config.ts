import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const localPath = (url: URL) => decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const antdEsmEntry = localPath(new URL('./node_modules/antd/es/index.js', import.meta.url));
const antdIconsEsmEntry = localPath(new URL('./node_modules/@ant-design/icons/es/index.js', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    // The Vitest client optimizer otherwise selects Ant Design's CommonJS
    // entry, whose dynamic icon requires cannot be pre-bundled correctly.
    alias: mode === 'test'
      ? [
          { find: /^antd$/, replacement: antdEsmEntry },
          { find: /^@ant-design\/icons$/, replacement: antdIconsEsmEntry },
        ]
      : [],
  },
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
    // Vitest disables dependency optimization by default. Pre-bundle the
    // browser dependency graph once instead of reparsing Ant Design and the
    // editor libraries in every isolated jsdom test file.
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            'react',
            'react-dom',
            '@tanstack/react-query',
            'antd',
            '@ant-design/icons',
            '@uiw/react-codemirror',
            '@codemirror/autocomplete',
            '@codemirror/lang-python',
            '@codemirror/language',
            '@codemirror/lint',
            '@codemirror/search',
            '@codemirror/state',
            '@codemirror/view',
          ],
          // Keep router external so per-file partial mocks can use
          // importOriginal without optimized-module interop differences.
          exclude: ['react-router-dom'],
        },
      },
    },
    // Ant Design/jsdom page suites are CPU-heavy; two workers keep the
    // standard test command deterministic on developer workstations.
    maxWorkers: 2,
    exclude: ['src/tests/e2e/**', 'node_modules/**', 'dist/**'],
  }
}));
