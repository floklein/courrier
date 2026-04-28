import { cleanup as cleanupLiveRegion } from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useComposeStore } from '../../hooks/compose-store';
import { useMailActions } from '../../hooks/useMailActions';
import { useMailClientState } from '../../hooks/useMailClientState';
import { api } from '../../lib/api-client';
import type { ComposeWindowDraft } from '../../lib/compose-window';
import type {
  AuthSession,
  MailMessageSummary,
  ReplyToMessageInput,
  SendMailInput,
} from '../../lib/mail-types';
import { encodeRouteId } from '../../lib/route-ids';
import { cn } from '../../lib/utils';
import { NewMessageComposerOverlay } from '../compose/NewMessageComposerOverlay';
import { FolderRail } from '../mail/FolderRail';
import { MessageList } from '../mail/MessageList';
import { ReadingPane } from '../mail/ReadingPane';

export function AuthenticatedMailClient({
  session,
}: {
  session: Extract<AuthSession, { status: 'authenticated' }>;
}) {
  const navigate = useNavigate();
  const [replyMessageId, setReplyMessageId] = useState<string>();
  const [isOpeningComposeWindow, setIsOpeningComposeWindow] = useState(false);
  const [isMailDragActive, setIsMailDragActive] = useState(false);
  const isComposingNew = useComposeStore((state) => state.isOpen);
  const closeCompose = useComposeStore((state) => state.close);
  const openCompose = useComposeStore((state) => state.open);
  const manuallyMarkedUnreadMessageId = useRef<string | undefined>(undefined);
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
    selectedMessage,
    setSearchQuery,
  } = useMailClientState();
  const isReadingMessage = Boolean(messageId);
  const {
    deleteMutation,
    isActionPending,
    isSendingMessage,
    markReadMutation,
    moveMutation,
    replyToMessageMutation,
    sendMessageMutation,
  } = useMailActions({
    folders,
    messages,
    messageId,
    resolvedFolderId,
    closeCompose,
    onReplyMessageIdChange: setReplyMessageId,
  });

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
