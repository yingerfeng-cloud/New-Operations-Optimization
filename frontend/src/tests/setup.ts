import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { message, notification } from 'antd';
import { cleanupTestEnv } from './test-utils';

vi.mock('echarts-for-react', async () => {
  const React = await import('react');
  return {
    default: ({ option }: { option?: unknown }) => (
    React.createElement('div', { 'data-testid': 'mock-echarts', 'data-option': JSON.stringify(option || {}) })
    ),
  };
});

vi.mock('echarts', () => ({
  default: {},
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
  use: vi.fn(),
  registerTheme: vi.fn(),
}));

vi.mock('antd', async importOriginal => {
  const actual = await importOriginal<typeof import('antd')>();
  const messageApi = {
    ...actual.message,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
  };
  const notificationApi = {
    ...actual.notification,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
  };
  return { ...actual, message: messageApi, notification: notificationApi };
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { writable: true, value: true });

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
}));
Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMediaMock });
Object.defineProperty(globalThis, 'matchMedia', { writable: true, value: matchMediaMock });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverMock {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverMock });
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverMock });
Object.defineProperty(globalThis, 'IntersectionObserver', { writable: true, value: IntersectionObserverMock });
Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: IntersectionObserverMock });
Object.defineProperty(window, 'scrollTo', { writable: true, value: vi.fn() });

class FileReaderMock {
  result: string | ArrayBuffer | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  readAsText(file: Blob) {
    file.text()
      .then(text => {
        this.result = text;
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
      })
      .catch(() => this.onerror?.({ target: this } as unknown as ProgressEvent<FileReader>));
  }
}
Object.defineProperty(globalThis, 'FileReader', { writable: true, value: FileReaderMock });
Object.defineProperty(window.URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:mock-url') });
Object.defineProperty(window.URL, 'revokeObjectURL', { writable: true, value: vi.fn() });

const nativeGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: (element: Element) => nativeGetComputedStyle(element),
});
const nativeConsoleError = console.error;
const nativeConsoleWarn = console.warn;
const testProcess = (globalThis as unknown as { process?: { stderr?: { write: (...args: unknown[]) => boolean } } }).process;
const nativeStderrWrite = testProcess?.stderr?.write.bind(testProcess.stderr);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const text = args.map(item => String(item)).join(' ');
  if (text.includes('Could not parse CSS stylesheet')) return;
  if (text.includes('not wrapped in act') && text.includes('Notification')) return;
  if (text.includes('Warning: [antd: notification]')) return;
  nativeConsoleError(...args);
});
vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
  const text = args.map(item => String(item)).join(' ');
  if (text.includes('Could not parse CSS stylesheet')) return;
  if (text.includes('not wrapped in act') && text.includes('Notification')) return;
  if (text.includes('Warning: [antd: notification]')) return;
  nativeConsoleWarn(...args);
});
if (testProcess?.stderr && nativeStderrWrite) {
  vi.spyOn(testProcess.stderr, 'write').mockImplementation((chunk: unknown, ...args: unknown[]) => {
    if (String(chunk).includes('Could not parse CSS stylesheet')) return true;
    return nativeStderrWrite(chunk, ...args);
  });
}
afterEach(() => {
  message.destroy();
  notification.destroy();
  cleanupTestEnv();
});
