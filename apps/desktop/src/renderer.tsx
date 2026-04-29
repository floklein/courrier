import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { api } from './lib/api-client';
import { queryClient } from './lib/query-client';
import { invalidateRemoteMailUpdate } from './lib/remote-mail-updates';
import { router } from './router';
import { ThemeProvider } from './theme/ThemeProvider';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found.');
}

document.documentElement.dataset.platform = window.courrier.platform;
api.mail.onRemoteChange((event) => {
  void invalidateRemoteMailUpdate(queryClient, event);
});

createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
