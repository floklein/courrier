import path from 'node:path';
import { defineConfig } from 'vite';
import { config as loadDotenvFile } from 'dotenv';

loadDotenvFile({ path: path.join(__dirname, '.env') });

const publicEnvironment = {
  'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID),
  'process.env.MICROSOFT_CLIENT_ID': JSON.stringify(
    process.env.MICROSOFT_CLIENT_ID,
  ),
};

// https://vitejs.dev/config
export default defineConfig({
  define: publicEnvironment,
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
