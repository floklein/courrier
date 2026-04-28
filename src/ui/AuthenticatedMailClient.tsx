import {
  announce,
  cleanup as cleanupLiveRegion,
} from '@atlaskit/pragmatic-drag-and-drop-live-region';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { TooltipProvider } from '../components/ui/tooltip';
import { api } from '../lib/api-client';
import type { ComposeWindowDraft } from '../lib/compose-window';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  PagedMessages,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { FolderRail } from './FolderRail';
import { MailComposer } from './MailComposer';
import { MessageList } from './MessageList';
import { useComposeStore } from './compose-store';
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
  const [isOpeningComposeWindow, setIsOpeningComposeWindow] = useState(false);
  const [isMailDragActive, setIsMailDragActive] = useState(false);
  const isComposingNew = useComposeStore((state) => state.isOpen);
  const closeCompose = useComposeStore((state) => state.close);
  const openCompose = useComposeStore((state) => state.open);
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
      const snapshot = createMailCacheSnapshot(queryClient);
      updateCachedMessageReadState(queryClient, message.id, isRead);
      updateCachedFolderCounts(queryClient, {
        folderId: message.folderId,
        unreadDelta: getReadStateUnreadDelta(message.isRead, isRead),
      });

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
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
    onMutate: async ({ message, destinationFolderId }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);

      handleMessageRemoved(message);
      updateCachedFolderCounts(queryClient, {
        folderId: message.folderId,
        totalDelta: -1,
        unreadDelta: message.isRead ? 0 : -1,
      });
      updateCachedFolderCounts(queryClient, {
        folderId: destinationFolderId,
        totalDelta: 1,
        unreadDelta: message.isRead ? 0 : 1,
      });

      const destinationFolder = folders.find(
        (folder) => folder.id === destinationFolderId,
      );

      if (destinationFolder) {
        announce(`Moved "${message.subject}" to ${destinationFolder.label}.`);
      }

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateMailLists();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ message }: { message: MailMessageSummary }) =>
      api.mail.deleteMessage(message.id),
    onMutate: async ({ message }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const trashFolder = folders.find(
        (folder) => folder.wellKnownName === 'deleteditems',
      );

      handleMessageRemoved(message);
      updateCachedFolderCounts(queryClient, {
        folderId: message.folderId,
        totalDelta: -1,
        unreadDelta: message.isRead ? 0 : -1,
      });

      if (trashFolder && trashFolder.id !== message.folderId) {
        updateCachedFolderCounts(queryClient, {
          folderId: trashFolder.id,
          totalDelta: 1,
          unreadDelta: message.isRead ? 0 : 1,
        });
      }

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateMailLists();
    },
  });
  const sendMessageMutation = useMutation({
    mutationFn: (input: SendMailInput) => api.mail.sendMessage(input),
    onSuccess: async () => {
      closeCompose();
      await invalidateMailLists();
    },
  });
  const replyToMessageMutation = useMutation({
    mutationFn: (input: ReplyToMessageInput) => api.mail.replyToMessage(input),
    onSuccess: async () => {
      setReplyMessageId(undefined);
      await invalidateMailLists();
    },
  });
  const isActionPending =
    markReadMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending ||
    sendMessageMutation.isPending ||
    replyToMessageMutation.isPending;
  const isSendingMessage =
    sendMessageMutation.isPending || replyToMessageMutation.isPending;

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
    closeCompose();
    manuallyMarkedUnreadMessageId.current = undefined;
  }, [closeCompose, resolvedFolderId]);

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
    closeCompose();
    replyToMessageMutation.reset();
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
    replyToMessageMutation.reset();
    setReplyMessageId(undefined);
  }

  function handleComposeMessage() {
    sendMessageMutation.reset();
    setReplyMessageId(undefined);
    openCompose();
  }

  function handleCloseCompose() {
    sendMessageMutation.reset();
    closeCompose();
  }

  function handleSendMessage(input: SendMailInput) {
    sendMessageMutation.mutate(input);
  }

  async function handleMoveComposeToWindow(draft: ComposeWindowDraft) {
    setIsOpeningComposeWindow(true);

    try {
      await api.window.openComposeWindow(draft);
      closeCompose();
    } finally {
      setIsOpeningComposeWindow(false);
    }
  }

  function handleReplyToMessageBody(input: ReplyToMessageInput) {
    replyToMessageMutation.mutate(input);
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
          onComposeMessage={handleComposeMessage}
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
          isSendingMessage={isSendingMessage}
          replyError={replyToMessageMutation.error as Error | null}
          isLoading={messageQuery.isPending && Boolean(messageId)}
          error={messageQuery.error as Error | null}
          isMailDragActive={isMailDragActive}
          onCloseReply={handleCloseReply}
          onDeleteMessage={handleDeleteMessage}
          onMarkMessageReadState={handleMarkMessageReadState}
          onMoveMessage={handleMoveMessage}
          onReplyToMessage={handleReplyToMessage}
          onReplyToMessageBody={handleReplyToMessageBody}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
        {isComposingNew && (
          <NewMessageComposerOverlay
            isSending={isSendingMessage || isOpeningComposeWindow}
            error={sendMessageMutation.error as Error | null}
            onClose={handleCloseCompose}
            onMoveToWindow={(draft) => {
              void handleMoveComposeToWindow(draft);
            }}
            onSend={handleSendMessage}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

function NewMessageComposerOverlay({
  isSending,
  error,
  onClose,
  onMoveToWindow,
  onSend,
}: {
  isSending: boolean;
  error: Error | null;
  onClose: () => void;
  onMoveToWindow: (draft: ComposeWindowDraft) => void;
  onSend: (input: SendMailInput) => void;
}) {
  const draftSubject = useComposeStore((state) => state.draft.subject);
  const isMinimized = useComposeStore((state) => state.isMinimized);
  const setDraft = useComposeStore((state) => state.setDraft);
  const setMinimized = useComposeStore((state) => state.setMinimized);
  const minimizedTitle = draftSubject.trim() || 'New message';

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex items-end justify-end max-sm:inset-x-2">
      <div
        role="dialog"
        aria-label="New message"
        className={cn(
          'pointer-events-auto w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-card shadow-2xl max-sm:w-full',
          isMinimized && 'hidden',
        )}
      >
        <MailComposer
          mode="new"
          initialDraft={useComposeStore.getState().draft}
          isSending={isSending}
          error={error}
          className="h-[min(640px,calc(100vh-6rem))]"
          onClose={onClose}
          onDraftChange={setDraft}
          onMinimize={() => setMinimized(true)}
          onMoveToWindow={onMoveToWindow}
          onReply={() => undefined}
          onSend={onSend}
        />
      </div>
      {isMinimized && (
        <div className="pointer-events-none flex w-full justify-end">
          <Button
            type="button"
            variant="outline"
            className="pointer-events-auto h-11 w-[min(360px,calc(100vw-1rem))] justify-start border bg-card px-3 text-left shadow-lg"
            onClick={() => setMinimized(false)}
          >
            <PenLine data-icon="inline-start" />
            <span className="min-w-0 flex-1 truncate">{minimizedTitle}</span>
            <span className="text-xs font-normal text-muted-foreground">
              Draft
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}

function updateCachedMessageReadState(
  queryClient: QueryClient,
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
  queryClient: QueryClient,
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

function updateCachedFolderCounts(
  queryClient: QueryClient,
  {
    folderId,
    totalDelta = 0,
    unreadDelta = 0,
  }: {
    folderId: string;
    totalDelta?: number;
    unreadDelta?: number;
  },
) {
  if (totalDelta === 0 && unreadDelta === 0) {
    return;
  }

  queryClient.setQueryData<MailFolder[]>(['mail', 'folders'], (folders) =>
    folders?.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            totalCount: clampCount(folder.totalCount + totalDelta),
            unreadCount: clampCount(folder.unreadCount + unreadDelta),
          }
        : folder,
    ),
  );
}

function getReadStateUnreadDelta(wasRead: boolean, isRead: boolean) {
  if (wasRead === isRead) {
    return 0;
  }

  return isRead ? -1 : 1;
}

function clampCount(value: number) {
  return Math.max(0, value);
}

function createMailCacheSnapshot(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['mail'] })
    .map((query) => ({
      queryKey: query.queryKey,
      data: query.state.data,
    }));
}

function restoreMailCacheSnapshot(
  queryClient: QueryClient,
  snapshot: ReturnType<typeof createMailCacheSnapshot> | undefined,
) {
  if (!snapshot) {
    return;
  }

  for (const query of snapshot) {
    queryClient.setQueryData(query.queryKey, query.data);
  }
}
