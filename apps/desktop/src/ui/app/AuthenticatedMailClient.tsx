import { cleanup as cleanupLiveRegion } from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useComposeStore } from '@/hooks/compose-store';
import { useActiveMailAccountChange } from '@/hooks/useActiveMailAccountChange';
import { useMailActions } from '@/hooks/useMailActions';
import { useMailClientState } from '@/hooks/useMailClientState';
import { api } from '@/lib/api-client';
import type { ComposeWindowDraft } from '@/lib/compose-window';
import {
  isGoogleInvalidMessageIdError,
  isGraphItemNotFoundError,
  isMicrosoftSignInRequiredError,
} from '@/lib/graph-errors';
import type {
  AuthSession,
  MailFolder,
  MailMessageSummary,
  MailResponseKind,
} from '@/lib/mail-types';
import {
  mailDraftQueryOptions,
  mailDraftsQueryOptions,
  mailFoldersQueryOptions,
  mailMessagesQueryOptions,
} from '@/lib/mail/mail-query-options';
import { encodeRouteId } from '@/lib/route-ids';
import { cn } from '@/lib/utils';
import { NewMessageComposerOverlay } from '@/ui/compose/NewMessageComposerOverlay';
import { FolderRail } from '@/ui/mail/FolderRail';
import { MessageList } from '@/ui/mail/MessageList';
import { ReadingPane } from '@/ui/mail/ReadingPane';

export function AuthenticatedMailClient({
  session,
}: {
  session: Extract<AuthSession, { status: 'authenticated' }>;
}) {
  const activeAccount = session.activeAccount;
  const navigate = useNavigate();
  const [replyMessageId, setReplyMessageId] = useState<string>();
  const [responseKind, setResponseKind] = useState<MailResponseKind>('reply');
  const [draftOpenError, setDraftOpenError] = useState<Error | null>(null);
  const [isOpeningComposeWindow, setIsOpeningComposeWindow] = useState(false);
  const [isMailDragActive, setIsMailDragActive] = useState(false);
  const isComposingNew = useComposeStore((state) => state.isOpen);
  const closeCompose = useComposeStore((state) => state.close);
  const flushAndCloseCompose = useComposeStore((state) => state.flushAndClose);
  const openCompose = useComposeStore((state) => state.open);
  const setComposeFlushHandler = useComposeStore(
    (state) => state.setFlushHandler,
  );
  const manuallyMarkedUnreadMessageId = useRef<string | undefined>(undefined);
  const openingProviderDraftId = useRef<string | undefined>(undefined);
  const previousFolderId = useRef<string | undefined>(undefined);
  const {
    applyActiveMailAccountSession,
    prepareActiveMailAccountChange,
  } = useActiveMailAccountChange();
  const {
    currentFolder,
    folders,
    foldersQuery,
    messageId,
    messageQuery,
    messages,
    messagesQuery,
    resolvedFolderId,
    searchQuery,
    searchScope,
    selectedMessage,
    setSearchQuery,
    setSearchScope,
  } = useMailClientState(activeAccount.id);
  const isReadingMessage = Boolean(messageId);
  const {
    actionCapabilities,
    archiveMutation,
    deleteMutation,
    invalidateMailLists,
    flagMutation,
    importantMutation,
    isActionPending,
    junkMutation,
    markReadMutation,
    moveMutation,
    queryClient,
    starMutation,
  } = useMailActions({
    accountId: activeAccount.id,
    folders,
    messages,
    messageId,
    resolvedFolderId,
    closeCompose,
    onReplyMessageIdChange: setReplyMessageId,
  });
  const draftsQuery = useQuery(mailDraftsQueryOptions(activeAccount.id));

  useEffect(() => cleanupLiveRegion, []);

  useEffect(() => {
    return api.mail.onOpenMessage(({ accountId, folderId, messageId }) => {
      const openMessage = async () => {
        if (accountId !== activeAccount.id) {
          await prepareActiveMailAccountChange();
          const nextSession = await api.auth.switchAccount(accountId);
          await applyActiveMailAccountSession(nextSession);
        }

        await navigate({
          to: '/mail/$folderId/$messageId',
          params: {
            folderId: encodeRouteId(folderId),
            messageId: encodeRouteId(messageId),
          },
        });
      };

      void openMessage();
    });
  }, [
    activeAccount.id,
    applyActiveMailAccountSession,
    navigate,
    prepareActiveMailAccountChange,
  ]);

  useEffect(() => {
    for (const account of session.accounts) {
      void queryClient
        .ensureQueryData(mailFoldersQueryOptions(account.id))
        .then((folders) => {
          const inboxFolder = getInboxFolder(folders);

          if (!inboxFolder) {
            return;
          }

          return queryClient.prefetchInfiniteQuery(
            mailMessagesQueryOptions(account.id, inboxFolder.id),
          );
        })
        .catch(() => undefined);
    }
  }, [queryClient, session.accounts]);

  useEffect(() => {
    if (
      !isMicrosoftSignInRequiredError(foldersQuery.error) &&
      !isMicrosoftSignInRequiredError(messagesQuery.error) &&
      !isMicrosoftSignInRequiredError(messageQuery.error)
    ) {
      return;
    }

    queryClient.removeQueries({ queryKey: ['mail', activeAccount.id] });
    void queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
  }, [
    activeAccount.id,
    foldersQuery.error,
    messageQuery.error,
    messagesQuery.error,
    queryClient,
  ]);

  useEffect(() => {
    const didChangeFolder =
      previousFolderId.current !== undefined &&
      previousFolderId.current !== resolvedFolderId;
    previousFolderId.current = resolvedFolderId;

    if (!didChangeFolder) {
      return;
    }

    if (searchScope === 'folder') {
      setSearchQuery('');
    }

    setReplyMessageId(undefined);
    setDraftOpenError(null);
    manuallyMarkedUnreadMessageId.current = undefined;
  }, [resolvedFolderId, searchScope, setSearchQuery]);

  useEffect(() => {
    if (
      currentFolder?.wellKnownName !== 'drafts' ||
      !messageId ||
      !draftsQuery.data
    ) {
      return;
    }

    const providerDraft = draftsQuery.data.find(
      (draft) =>
        draft.providerDraftId === messageId ||
        draft.providerDraftMessageId === messageId,
    );

    if (!providerDraft) {
      return;
    }

    if (openingProviderDraftId.current === providerDraft.providerDraftId) {
      return;
    }

    openingProviderDraftId.current = providerDraft.providerDraftId;

    const openProviderDraft = async () => {
      try {
        setDraftOpenError(null);
        const didClose = await flushAndCloseCompose();

        if (!didClose) {
          return;
        }

        const draft = await queryClient.ensureQueryData(
          mailDraftQueryOptions(activeAccount.id, providerDraft.providerDraftId),
        );

        setReplyMessageId(undefined);
        openCompose(draft);
        await navigate({
          to: '/mail/$folderId',
          params: { folderId: encodeRouteId(resolvedFolderId) },
          replace: true,
        });
      } catch (error) {
        setDraftOpenError(
          error instanceof Error
            ? error
            : new Error('Could not open the provider draft.'),
        );
      } finally {
        if (
          openingProviderDraftId.current === providerDraft.providerDraftId
        ) {
          openingProviderDraftId.current = undefined;
        }
      }
    };

    void openProviderDraft();
  }, [
    activeAccount.id,
    currentFolder?.wellKnownName,
    draftsQuery.data,
    flushAndCloseCompose,
    messageId,
    navigate,
    openCompose,
    queryClient,
    resolvedFolderId,
  ]);

  useEffect(() => {
    if (!messageId || !messageQuery.error) {
      return;
    }

    const error = messageQuery.error;

    if (isGoogleInvalidMessageIdError(error)) {
      void navigate({
        to: '/mail/$folderId',
        params: { folderId: 'inbox' },
        replace: true,
      });
      return;
    }

    if (!isGraphItemNotFoundError(error)) {
      return;
    }

    void navigate({
      to: '/mail/$folderId',
      params: { folderId: encodeRouteId(resolvedFolderId) },
      replace: true,
    });
  }, [messageId, messageQuery.error, navigate, resolvedFolderId]);

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

  function handleArchiveMessage(message: MailMessageSummary) {
    archiveMutation.mutate({ message });
  }

  function handleMarkMessageJunkState(
    message: MailMessageSummary,
    isJunk: boolean,
  ) {
    junkMutation.mutate({ message, isJunk });
  }

  function handleToggleMessageStar(
    message: MailMessageSummary,
    isStarred: boolean,
  ) {
    starMutation.mutate({ message, isStarred });
  }

  function handleToggleMessageFlag(
    message: MailMessageSummary,
    isFlagged: boolean,
  ) {
    flagMutation.mutate({ message, isFlagged });
  }

  function handleToggleMessageImportant(
    message: MailMessageSummary,
    isImportant: boolean,
  ) {
    importantMutation.mutate({ message, isImportant });
  }

  async function handleRespondToMessage(
    message: MailMessageSummary,
    kind: MailResponseKind,
  ) {
    const didClose = await flushAndCloseCompose();

    if (!didClose) {
      return;
    }

    setResponseKind(kind);
    setReplyMessageId(message.id);

    if (message.id === messageId) {
      return;
    }

    void navigate({
      to: '/mail/$folderId/$messageId',
      params: {
        folderId: encodeRouteId(message.folderId || resolvedFolderId),
        messageId: encodeRouteId(message.id),
      },
      replace: true,
    });
  }

  function handleReplyToMessage(message: MailMessageSummary) {
    void handleRespondToMessage(message, 'reply');
  }

  function handleReplyAllToMessage(message: MailMessageSummary) {
    void handleRespondToMessage(message, 'replyAll');
  }

  function handleForwardMessage(message: MailMessageSummary) {
    void handleRespondToMessage(message, 'forward');
  }

  function handleCloseReply() {
    setReplyMessageId(undefined);
  }

  async function handleComposeMessage() {
    const didClose = await flushAndCloseCompose();

    if (!didClose) {
      return;
    }

    setReplyMessageId(undefined);
    openCompose();
  }

  function handleCloseCompose() {
    closeCompose();
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


  function handleSearch(query: string) {
    setSearchQuery(query);
  }

  function handleSearchScopeChange(scope: typeof searchScope) {
    setSearchScope(scope);
  }

  return (
    <TooltipProvider delay={200}>
      <main className="grid h-full min-h-0 grid-cols-[240px_minmax(280px,360px)_minmax(0,1fr)] bg-background max-lg:grid-cols-[76px_minmax(280px,340px)_minmax(0,1fr)] max-md:grid-cols-[72px_minmax(0,1fr)]">
        <FolderRail
          accountEmail={activeAccount.email}
          accountName={activeAccount.name ?? activeAccount.email}
          accounts={session.accounts}
          providers={session.providers}
          activeAccountId={activeAccount.id}
          currentFolderId={resolvedFolderId}
          folders={folders}
          isLoading={foldersQuery.isPending}
          error={foldersQuery.error as Error | null}
          isActionPending={isActionPending}
          onComposeMessage={() => {
            void handleComposeMessage();
          }}
          onMoveMessage={handleMoveMessage}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <MessageList
          folderId={resolvedFolderId}
          folderLabel={currentFolder?.label ?? 'Inbox'}
          folders={folders}
          actionCapabilities={actionCapabilities}
          messages={messages}
          selectedMessageId={messageId}
          isLoading={messagesQuery.isPending || foldersQuery.isPending}
          error={draftOpenError ?? (messagesQuery.error as Error | null)}
          hasNextPage={Boolean(messagesQuery.hasNextPage)}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          isActionPending={isActionPending}
          onLoadMore={() => {
            void messagesQuery.fetchNextPage();
          }}
          onDeleteMessage={handleDeleteMessage}
          onArchiveMessage={handleArchiveMessage}
          onDragActiveChange={setIsMailDragActive}
          onMarkMessageJunkState={handleMarkMessageJunkState}
          onMarkMessageReadState={handleMarkMessageReadState}
          onMoveMessage={handleMoveMessage}
          onForwardMessage={handleForwardMessage}
          onReplyToMessage={handleReplyToMessage}
          onReplyAllToMessage={handleReplyAllToMessage}
          onToggleMessageFlag={handleToggleMessageFlag}
          onToggleMessageImportant={handleToggleMessageImportant}
          onToggleMessageStar={handleToggleMessageStar}
          onSearch={handleSearch}
          onSearchScopeChange={handleSearchScopeChange}
          searchQuery={searchQuery}
          searchScope={searchScope}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <ReadingPane
          accountId={activeAccount.id}
          accountEmail={activeAccount.email}
          folderId={resolvedFolderId}
          folders={folders}
          actionCapabilities={actionCapabilities}
          isActionPending={isActionPending}
          message={selectedMessage}
          replyMessageId={replyMessageId}
          responseKind={responseKind}
          isSendingMessage={false}
          replyError={null}
          isLoading={messageQuery.isPending && Boolean(messageId)}
          error={messageQuery.error as Error | null}
          isMailDragActive={isMailDragActive}
          onCloseReply={handleCloseReply}
          onDeleteMessage={handleDeleteMessage}
          onArchiveMessage={handleArchiveMessage}
          onMarkMessageJunkState={handleMarkMessageJunkState}
          onMarkMessageReadState={handleMarkMessageReadState}
          onMoveMessage={handleMoveMessage}
          onForwardMessage={handleForwardMessage}
          onReplyToMessage={handleReplyToMessage}
          onReplyAllToMessage={handleReplyAllToMessage}
          onFlushHandlerChange={setComposeFlushHandler}
          onProviderDraftChanged={invalidateMailLists}
          onToggleMessageFlag={handleToggleMessageFlag}
          onToggleMessageImportant={handleToggleMessageImportant}
          onToggleMessageStar={handleToggleMessageStar}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
        {isComposingNew && (
          <NewMessageComposerOverlay
            accountId={activeAccount.id}
            isSending={isOpeningComposeWindow}
            error={null}
            onClose={handleCloseCompose}
            onMoveToWindow={handleMoveComposeToWindow}
            onProviderDraftChanged={invalidateMailLists}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

function getInboxFolder(folders: MailFolder[] | undefined) {
  if (!folders?.length) {
    return undefined;
  }

  return (
    folders.find((folder) => folder.wellKnownName === 'inbox') ??
    folders.find((folder) => folder.id.toLowerCase() === 'inbox') ??
    folders[0]
  );
}
