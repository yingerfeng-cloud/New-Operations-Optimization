import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { writable: true, value: true });
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addListener:()=>{},removeListener:()=>{},addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>false})});
class ResizeObserverMock { observe(){} unobserve(){} disconnect(){} }
Object.defineProperty(globalThis,'ResizeObserver',{writable:true,value:ResizeObserverMock});
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
afterEach(() => cleanup());
