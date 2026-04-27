import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TooltipProvider } from '../components/ui/tooltip';
import { api } from '../lib/api-client';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  PagedMessages,
} from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { FolderRail } from './FolderRail';
import { MessageList } from './MessageList';
import { parseMailPath } from './mail-utils';
import { ReadingPane } from './ReadingPane';

export function AuthenticatedMailClient({
  session,
}: {
  session: Extract<AuthSession, { status: 'authenticated' }>;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const { folderId, messageId } = parseMailPath(pathname);
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
    queryKey: ['mail', 'messages', resolvedFolderId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.mail.listMessages(resolvedFolderId, pageParam),
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
  const isReadingMessage = Boolean(messageId);

  useEffect(() => {
    if (!currentFolder || messageId || !messages[0]) {
      return;
    }

    navigate({
      to: '/mail/$folderId/$messageId',
      params: {
        folderId: encodeRouteId(resolvedFolderId),
        messageId: encodeRouteId(messages[0].id),
      },
      replace: true,
    });
  }, [currentFolder, messageId, messages, navigate, resolvedFolderId]);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="grid h-full min-h-0 grid-cols-[240px_minmax(320px,420px)_minmax(0,1fr)] bg-background max-lg:grid-cols-[76px_minmax(300px,380px)_minmax(0,1fr)] max-md:grid-cols-[72px_minmax(0,1fr)]">
        <FolderRail
          accountEmail={session.account.username}
          accountName={session.account.name ?? session.account.username}
          currentFolderId={resolvedFolderId}
          folders={folders}
          isLoading={foldersQuery.isPending}
          error={foldersQuery.error as Error | null}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <MessageList
          folderId={resolvedFolderId}
          folderLabel={currentFolder?.label ?? 'Inbox'}
          messages={messages}
          selectedMessageId={messageId}
          isLoading={messagesQuery.isPending || foldersQuery.isPending}
          error={messagesQuery.error as Error | null}
          hasNextPage={Boolean(messagesQuery.hasNextPage)}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          onLoadMore={() => {
            void messagesQuery.fetchNextPage();
          }}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <ReadingPane
          folderId={resolvedFolderId}
          message={selectedMessage}
          isLoading={messageQuery.isPending && Boolean(messageId)}
          error={messageQuery.error as Error | null}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
      </main>
    </TooltipProvider>
  );
}
