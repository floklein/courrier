import {
  Navigate,
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { MailClient } from './ui/MailClient';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/mail/$folderId" params={{ folderId: 'inbox' }} replace />,
});

const mailFolderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mail/$folderId',
  component: MailClient,
});

const mailMessageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mail/$folderId/$messageId',
  component: MailClient,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  mailFolderRoute,
  mailMessageRoute,
]);

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
