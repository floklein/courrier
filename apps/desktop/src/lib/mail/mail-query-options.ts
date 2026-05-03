import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../api-client';
import type { PagedMessages } from '../mail-types';

export const mailPreloadStaleTimeMs = 30_000;

export function authSessionQueryOptions() {
  return queryOptions({
    queryKey: ['auth', 'session'] as const,
    queryFn: api.auth.getSession,
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailFoldersQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: ['mail', accountId, 'folders'] as const,
    queryFn: () => api.mail.listFolders(accountId),
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailMessagesQueryOptions(
  accountId: string,
  folderId: string,
  searchQuery = '',
) {
  return infiniteQueryOptions({
    queryKey: ['mail', accountId, 'messages', folderId, searchQuery] as const,
    queryFn: ({ pageParam }) =>
      api.mail.listMessages(
        accountId,
        folderId,
        pageParam,
        searchQuery || undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PagedMessages) => lastPage.nextPageToken,
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailMessageQueryOptions(
  accountId: string,
  folderId: string,
  messageId: string | undefined,
) {
  return queryOptions({
    queryKey: ['mail', accountId, 'message', folderId, messageId] as const,
    queryFn: () => api.mail.getMessage(accountId, folderId, messageId ?? ''),
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailPeopleQueryOptions(accountId: string, query: string) {
  const normalizedQuery = query.trim();

  return queryOptions({
    queryKey: ['mail', accountId, 'people', normalizedQuery] as const,
    queryFn: () => api.mail.listPeople(accountId, normalizedQuery || undefined),
    staleTime: 5 * 60 * 1000,
  });
}
