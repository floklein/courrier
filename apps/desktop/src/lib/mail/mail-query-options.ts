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

export function mailFoldersQueryOptions() {
  return queryOptions({
    queryKey: ['mail', 'folders'] as const,
    queryFn: api.mail.listFolders,
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailMessagesQueryOptions(folderId: string, searchQuery = '') {
  return infiniteQueryOptions({
    queryKey: ['mail', 'messages', folderId, searchQuery] as const,
    queryFn: ({ pageParam }) =>
      api.mail.listMessages(
        folderId,
        pageParam,
        searchQuery || undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PagedMessages) => lastPage.nextPageUrl,
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailMessageQueryOptions(
  folderId: string,
  messageId: string | undefined,
) {
  return queryOptions({
    queryKey: ['mail', 'message', folderId, messageId] as const,
    queryFn: () => api.mail.getMessage(folderId, messageId ?? ''),
    staleTime: mailPreloadStaleTimeMs,
  });
}

export function mailPeopleQueryOptions(query: string) {
  const normalizedQuery = query.trim();

  return queryOptions({
    queryKey: ['mail', 'people', normalizedQuery] as const,
    queryFn: () => api.mail.listPeople(normalizedQuery || undefined),
    staleTime: 5 * 60 * 1000,
  });
}
