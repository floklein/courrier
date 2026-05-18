import path from 'node:path';
import { defineConfig } from 'vite';
import { config as loadDotenvFile } from 'dotenv';

const desktopEnvironment = loadDotenvFile({
  path: path.join(__dirname, '.env'),
}).parsed ?? {};

const buildTimeEnvironment = Object.fromEntries(
  Object.keys(desktopEnvironment).map((key) => [
    `process.env.${key}`,
    JSON.stringify(process.env[key]),
  ]),
);

// https://vitejs.dev/config
export default defineConfig({
  define: buildTimeEnvironment,
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
