import { cleanup as cleanupLiveRegion } from '@atlaskit/pragmatic-drag-and-drop-live-region';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '../components/ui/tooltip';
import { api } from '../lib/api-client';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
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
  const queryClient = useQueryClient();
  const { folderId, messageId } = parseMailPath(pathname);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyMessageId, setReplyMessageId] = useState<string>();
  const [isMailDragActive, setIsMailDragActive] = useState(false);
  const manuallyMarkedUnreadMessageId = useRef<string | undefined>(undefined);
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
  const isReadingMessage = Boolean(messageId);
  const actionInvalidationKeys = {
    folders: ['mail', 'folders'] as const,
    messages: ['mail', 'messages'] as const,
  };
  const markReadMutation = useMutation({
    mutationFn: ({
      message,
      isRead,
    }: {
      message: MailMessageSummary;
      isRead: boolean;
    }) => api.mail.markMessageReadState(message.id, isRead),
    onMutate: async ({ message, isRead }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      updateCachedMessageReadState(queryClient, message.id, isRead);
    },
    onSettled: async (_data, _error, { message }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: actionInvalidationKeys.folders }),
        queryClient.invalidateQueries({ queryKey: actionInvalidationKeys.messages }),
        queryClient.invalidateQueries({
          queryKey: ['mail', 'message', resolvedFolderId, message.id],
        }),
      ]);
    },
  });
  const moveMutation = useMutation({
    mutationFn: ({
      message,
      destinationFolderId,
    }: {
      message: MailMessageSummary;
      destinationFolderId: string;
    }) => api.mail.moveMessage(message.id, destinationFolderId),
    onSuccess: async (_data, { message }) => {
      handleMessageRemoved(message);
      await invalidateMailLists();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ message }: { message: MailMessageSummary }) =>
      api.mail.deleteMessage(message.id),
    onSuccess: async (_data, { message }) => {
      handleMessageRemoved(message);
      await invalidateMailLists();
    },
  });
  const isActionPending =
    markReadMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending;

  useEffect(() => cleanupLiveRegion, []);

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

  useEffect(() => {
    setSearchQuery('');
    setReplyMessageId(undefined);
    manuallyMarkedUnreadMessageId.current = undefined;
  }, [resolvedFolderId]);

  useEffect(() => {
    if (
      !selectedMessage ||
      selectedMessage.isRead ||
      manuallyMarkedUnreadMessageId.current === selectedMessage.id
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      markReadMutation.mutate({
        message: selectedMessage,
        isRead: true,
      });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [markReadMutation, selectedMessage]);

  function handleMarkMessageReadState(
    message: MailMessageSummary,
    isRead: boolean,
  ) {
    manuallyMarkedUnreadMessageId.current = isRead ? undefined : message.id;
    markReadMutation.mutate({ message, isRead });
  }

  function handleMoveMessage(
    message: MailMessageSummary,
    destinationFolderId: string,
  ) {
    moveMutation.mutate({ message, destinationFolderId });
  }

  function handleDeleteMessage(message: MailMessageSummary) {
    deleteMutation.mutate({ message });
  }

  function handleReplyToMessage(message: MailMessageSummary) {
    setReplyMessageId(message.id);

    if (message.id === messageId) {
      return;
    }

    void navigate({
      to: '/mail/$folderId/$messageId',
      params: {
        folderId: encodeRouteId(resolvedFolderId),
        messageId: encodeRouteId(message.id),
      },
      replace: true,
    });
  }

  function handleCloseReply() {
    setReplyMessageId(undefined);
  }

  function handleSearch(query: string) {
    setSearchQuery(query);
  }

  function handleMessageRemoved(message: MailMessageSummary) {
    removeCachedMessage(queryClient, message.id);
    setReplyMessageId((current) => (current === message.id ? undefined : current));

    if (message.id !== messageId) {
      return;
    }

    const nextMessage = messages.find((item) => item.id !== message.id);

    if (nextMessage) {
      void navigate({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: encodeRouteId(resolvedFolderId),
          messageId: encodeRouteId(nextMessage.id),
        },
        replace: true,
      });
      return;
    }

    void navigate({
      to: '/mail/$folderId',
      params: { folderId: encodeRouteId(resolvedFolderId) },
      replace: true,
    });
  }

  async function invalidateMailLists() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: actionInvalidationKeys.folders }),
      queryClient.invalidateQueries({ queryKey: actionInvalidationKeys.messages }),
    ]);
  }

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
          isActionPending={isActionPending}
          onMoveMessage={handleMoveMessage}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <MessageList
          folderId={resolvedFolderId}
          folderLabel={currentFolder?.label ?? 'Inbox'}
          folders={folders}
          messages={messages}
          selectedMessageId={messageId}
          isLoading={messagesQuery.isPending || foldersQuery.isPending}
          error={messagesQuery.error as Error | null}
          hasNextPage={Boolean(messagesQuery.hasNextPage)}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          isActionPending={isActionPending}
          onLoadMore={() => {
            void messagesQuery.fetchNextPage();
          }}
          onDeleteMessage={handleDeleteMessage}
          onDragActiveChange={setIsMailDragActive}
          onMarkMessageReadState={handleMarkMessageReadState}
          onMoveMessage={handleMoveMessage}
          onReplyToMessage={handleReplyToMessage}
          onSearch={handleSearch}
          searchQuery={searchQuery}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <ReadingPane
          folderId={resolvedFolderId}
          folders={folders}
          isActionPending={isActionPending}
          message={selectedMessage}
          replyMessageId={replyMessageId}
          isLoading={messageQuery.isPending && Boolean(messageId)}
          error={messageQuery.error as Error | null}
          isMailDragActive={isMailDragActive}
          onCloseReply={handleCloseReply}
          onDeleteMessage={handleDeleteMessage}
          onMarkMessageReadState={handleMarkMessageReadState}
          onMoveMessage={handleMoveMessage}
          onReplyToMessage={handleReplyToMessage}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
      </main>
    </TooltipProvider>
  );
}

function updateCachedMessageReadState(
  queryClient: ReturnType<typeof useQueryClient>,
  messageId: string,
  isRead: boolean,
) {
  queryClient.setQueriesData<InfiniteData<PagedMessages>>(
    { queryKey: ['mail', 'messages'] },
    (data) => {
      if (!data) {
        return data;
      }

      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          messages: page.messages.map((message) =>
            message.id === messageId ? { ...message, isRead } : message,
          ),
        })),
      };
    },
  );
  queryClient.setQueriesData<MailMessageDetail>(
    { queryKey: ['mail', 'message'] },
    (message) =>
      message?.id === messageId
        ? {
            ...message,
            isRead,
          }
        : message,
  );
}

function removeCachedMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  messageId: string,
) {
  queryClient.setQueriesData<InfiniteData<PagedMessages>>(
    { queryKey: ['mail', 'messages'] },
    (data) => {
      if (!data) {
        return data;
      }

      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          messages: page.messages.filter((message) => message.id !== messageId),
        })),
      };
    },
  );
  queryClient.removeQueries({ queryKey: ['mail', 'message'], exact: false });
}
