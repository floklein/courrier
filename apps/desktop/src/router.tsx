import {
  Navigate,
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { MailFolder } from './lib/mail-types';
import {
  authSessionQueryOptions,
  mailFoldersQueryOptions,
  mailMessageQueryOptions,
  mailMessagesQueryOptions,
} from './lib/mail/mail-query-options';
import { queryClient } from './lib/query-client';
import { decodeRouteId } from './lib/route-ids';
import { ComposeWindow } from './ui/app/ComposeWindow';
import { MailClient } from './ui/app/MailClient';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
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
  loader: ({ context, params }) =>
    preloadMailRoute(context.queryClient, decodeRouteId(params.folderId)),
  component: MailClient,
});

const mailMessageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mail/$folderId/$messageId',
  loader: ({ context, params }) =>
    preloadMailRoute(
      context.queryClient,
      decodeRouteId(params.folderId),
      decodeRouteId(params.messageId),
    ),
  component: MailClient,
});

const composeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compose',
  component: ComposeWindow,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  mailFolderRoute,
  mailMessageRoute,
  composeRoute,
]);

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  context: {
    queryClient,
  },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

async function preloadMailRoute(
  routeQueryClient: QueryClient,
  folderId: string | undefined,
  messageId?: string,
) {
  const session = await routeQueryClient
    .ensureQueryData(authSessionQueryOptions())
    .catch(() => undefined);

  if (session?.status !== 'authenticated' || !folderId) {
    return;
  }

  const folders = await routeQueryClient
    .ensureQueryData(mailFoldersQueryOptions())
    .catch(() => undefined);
  const currentFolder = resolveFolder(folders ?? [], folderId);

  if (!currentFolder) {
    return;
  }

  await Promise.all([
    routeQueryClient
      .ensureInfiniteQueryData(mailMessagesQueryOptions(currentFolder.id))
      .catch(() => undefined),
    messageId
      ? routeQueryClient
          .ensureQueryData(mailMessageQueryOptions(currentFolder.id, messageId))
          .catch(() => undefined)
      : Promise.resolve(),
  ]);
}

function resolveFolder(folders: MailFolder[], folderId: string) {
  return (
    folders.find((folder) => folder.id === folderId) ??
    folders.find((folder) => folder.wellKnownName === folderId)
  );
}
