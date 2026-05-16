import path from 'node:path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      external: [
        '@azure/msal-node-extensions',
        '@azure/msal-node-runtime',
        'keytar',
      ],
    },
  },
});
