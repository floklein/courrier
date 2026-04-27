import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const darkReaderScriptModule = 'virtual:darkreader-script';
const resolvedDarkReaderScriptModule = `\0${darkReaderScriptModule}`;

function darkReader() {
  return {
    name: 'courrier-darkreader-script',
    resolveId(id: string) {
      if (id === darkReaderScriptModule) {
        return resolvedDarkReaderScriptModule;
      }
      return null;
    },
    load(id: string) {
      if (id !== resolvedDarkReaderScriptModule) {
        return null;
      }
      const script = fs.readFileSync(require.resolve('darkreader'), 'utf8');
      return `export default ${JSON.stringify(script)};`;
    },
  };
}

// https://vitejs.dev/config
export default defineConfig(async () => {
  const tailwindcss = (await import('@tailwindcss/vite')).default;

  return {
    plugins: [react(), tailwindcss(), darkReader()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
