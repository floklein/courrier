import type { CourrierApi } from './preload';

declare global {
  interface Window {
    courrier: CourrierApi;
  }
}

export {};
