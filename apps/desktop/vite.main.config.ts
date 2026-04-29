import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
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
