import {
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../lib/api-client';
import type {
  MailFolder,
  MailMessageDetail,
  PagedMessages,
} from '../lib/mail-types';
import { parseMailPath } from '../lib/mail/mail-utils';

export function useMailClientState() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { folderId, messageId } = parseMailPath(pathname);
  const [searchQuery, setSearchQuery] = useState('');
  const foldersQuery = useQuery({
    queryKey: ['mail', 'folders'],
    queryFn: api.mail.listFolders,
  });
  const folders = (foldersQuery.data ?? []) as MailFolder[];
  const currentFolder =
    folders.find((folder) => folder.id === folderId) ??
    folders.find((folder) => folder.wellKnownName === folderId) ??
    folders[0];
  const resolvedFolderId = currentFolder?.id ?? folderId;
  const messagesQuery = useInfiniteQuery({
    queryKey: ['mail', 'messages', resolvedFolderId, searchQuery],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.mail.listMessages(
        resolvedFolderId,
        pageParam,
        searchQuery || undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PagedMessages) => lastPage.nextPageUrl,
    enabled: Boolean(currentFolder),
  });
  const messages =
    messagesQuery.data?.pages.flatMap((page: PagedMessages) => page.messages) ??
    [];
  const messageQuery = useQuery({
    queryKey: ['mail', 'message', resolvedFolderId, messageId],
    queryFn: () => api.mail.getMessage(resolvedFolderId, messageId ?? ''),
    enabled: Boolean(currentFolder && messageId),
  });
  const selectedMessage = messageQuery.data as MailMessageDetail | undefined;

  return {
    currentFolder,
    folderId,
    folders,
    foldersQuery,
    messageId,
    messageQuery,
    messages,
    messagesQuery,
    resolvedFolderId,
    searchQuery,
    selectedMessage,
    setSearchQuery,
  };
}
