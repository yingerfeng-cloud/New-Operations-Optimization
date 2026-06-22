import '@testing-library/jest-dom/vitest';
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addListener:()=>{},removeListener:()=>{},addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>false})});
class ResizeObserverMock { observe(){} unobserve(){} disconnect(){} }
Object.defineProperty(globalThis,'ResizeObserver',{writable:true,value:ResizeObserverMock});
