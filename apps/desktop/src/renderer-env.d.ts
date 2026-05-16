/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

import type { CourrierApi } from '@/preload';

declare global {
  interface Window {
    courrier: CourrierApi;
  }
}

export {};
