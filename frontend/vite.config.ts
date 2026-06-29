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
          if (id.indexOf('antd') >= 0 || id.indexOf('@ant-design') >= 0 || id.indexOf('rc-') >= 0) return 'vendor-antd';
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
    fileParallelism: false,
    maxWorkers: 1,
    exclude: ['src/tests/e2e/**', 'node_modules/**', 'dist/**'],
  }
});
