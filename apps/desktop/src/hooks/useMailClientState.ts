import {
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import type {
  MailFolder,
  MailMessageDetail,
  PagedMessages,
} from '../lib/mail-types';
import {
  mailFoldersQueryOptions,
  mailMessageQueryOptions,
  mailMessagesQueryOptions,
} from '../lib/mail/mail-query-options';
import { parseMailPath } from '../lib/mail/mail-utils';

export function useMailClientState(accountId: string) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { folderId, messageId } = parseMailPath(pathname);
  const [searchQuery, setSearchQuery] = useState('');
  const foldersQuery = useQuery(mailFoldersQueryOptions(accountId));
  const folders = (foldersQuery.data ?? []) as MailFolder[];
  const currentFolder =
    folders.find((folder) => folder.id === folderId) ??
    folders.find((folder) => folder.wellKnownName === folderId) ??
    folders[0];
  const resolvedFolderId = currentFolder?.id ?? folderId;
  const messagesQuery = useInfiniteQuery({
    ...mailMessagesQueryOptions(accountId, resolvedFolderId, searchQuery),
    enabled: Boolean(currentFolder),
  });
  const messages =
    messagesQuery.data?.pages.flatMap((page: PagedMessages) => page.messages) ??
    [];
  const messageQuery = useQuery({
    ...mailMessageQueryOptions(accountId, resolvedFolderId, messageId),
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
