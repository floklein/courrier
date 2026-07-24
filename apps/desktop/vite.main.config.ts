import path from 'node:path';
import { defineConfig } from 'vite';
import { config as loadDotenvFile } from 'dotenv';

loadDotenvFile({
  path: path.join(__dirname, '.env'),
});

const desktopEnvironmentKeys = [
  'MICROSOFT_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_PUBSUB_TOPIC',
  'RELAY_PUBLIC_URL',
  'RELAY_ADMIN_TOKEN',
] as const;

const buildTimeEnvironment = Object.fromEntries(
  desktopEnvironmentKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [
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
