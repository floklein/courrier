import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { api } from '@/lib/api-client';
import type {
  MailFolder,
  MailMessageSummary,
  ReplyToMessageInput,
  SendMailInput,
} from '@/lib/mail-types';
import { encodeRouteId } from '@/lib/route-ids';
import {
  createMailCacheSnapshot,
  getReadStateUnreadDelta,
  removeCachedMessage,
  restoreMailCacheSnapshot,
  updateCachedFolderCounts,
  updateCachedMessageReadState,
} from '@/lib/mail/mail-cache';

export function useMailActions({
  accountId,
  folders,
  messages,
  messageId,
  resolvedFolderId,
  closeCompose,
  onReplyMessageIdChange,
}: {
  accountId: string;
  folders: MailFolder[];
  messages: MailMessageSummary[];
  messageId: string | undefined;
  resolvedFolderId: string;
  closeCompose: () => void;
  onReplyMessageIdChange: (
    updater: (current: string | undefined) => string | undefined,
  ) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function handleMessageRemoved(
    message: MailMessageSummary,
    removedMessageIds = new Set([message.id]),
  ) {
    removeCachedMessage(queryClient, accountId, message.id);
    onReplyMessageIdChange((current) =>
      current && removedMessageIds.has(current) ? undefined : current,
    );

    if (message.id !== messageId) {
      return;
    }

    const nextMessage = findNextVisibleMessageAfterRemoval(
      messages,
      message.id,
      removedMessageIds,
    );

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
      queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'messages'] }),
    ]);
  }

  const markReadMutation = useMutation({
    mutationFn: ({
      message,
      isRead,
    }: {
      message: MailMessageSummary;
      isRead: boolean;
    }) => api.mail.markMessageReadState(accountId, message.id, isRead),
    onMutate: async ({ message, isRead }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      updateCachedMessageReadState(queryClient, accountId, message.id, isRead);
      updateCachedFolderCounts(queryClient, accountId, {
        folderId: message.folderId,
        unreadDelta: getReadStateUnreadDelta(message.isRead, isRead),
      });

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSuccess: (_data, { message }) => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['mail', accountId, 'folders'],
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: ['mail', accountId, 'messages'],
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: ['mail', accountId, 'message', resolvedFolderId, message.id],
          refetchType: 'none',
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
      removedMessageIds?: Set<string>;
    }) =>
      api.mail.moveMessage(
        accountId,
        message.id,
        message.folderId,
        destinationFolderId,
      ),
    onMutate: async ({ message, destinationFolderId, removedMessageIds }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);

      handleMessageRemoved(message, removedMessageIds);
      updateCachedFolderCounts(queryClient, accountId, {
        folderId: message.folderId,
        totalDelta: -1,
        unreadDelta: message.isRead ? 0 : -1,
      });
      updateCachedFolderCounts(queryClient, accountId, {
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
    mutationFn: ({ message }: {
      message: MailMessageSummary;
      removedMessageIds?: Set<string>;
    }) =>
      api.mail.deleteMessage(accountId, message.id),
    onMutate: async ({ message, removedMessageIds }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const trashFolder = folders.find(
        (folder) => folder.wellKnownName === 'deleteditems',
      );

      handleMessageRemoved(message, removedMessageIds);
      updateCachedFolderCounts(queryClient, accountId, {
        folderId: message.folderId,
        totalDelta: -1,
        unreadDelta: message.isRead ? 0 : -1,
      });

      if (trashFolder && trashFolder.id !== message.folderId) {
        updateCachedFolderCounts(queryClient, accountId, {
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
    mutationFn: (input: SendMailInput) => api.mail.sendMessage(accountId, input),
    onSuccess: async () => {
      closeCompose();
      await invalidateMailLists();
    },
  });
  const replyToMessageMutation = useMutation({
    mutationFn: (input: ReplyToMessageInput) =>
      api.mail.replyToMessage(accountId, input),
    onSuccess: async () => {
      onReplyMessageIdChange(() => undefined);
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

  return {
    deleteMutation,
    isActionPending,
    isSendingMessage,
    markReadMutation,
    moveMutation,
    queryClient,
    replyToMessageMutation,
    sendMessageMutation,
  };
}

function findNextVisibleMessageAfterRemoval(
  messages: MailMessageSummary[],
  removedMessageId: string,
  removedMessageIds: Set<string>,
) {
  const removedIndex = messages.findIndex(
    (message) => message.id === removedMessageId,
  );

  if (removedIndex === -1) {
    return messages.find((message) => !removedMessageIds.has(message.id));
  }

  return (
    messages
      .slice(removedIndex + 1)
      .find((message) => !removedMessageIds.has(message.id)) ??
    messages
      .slice(0, removedIndex)
      .reverse()
      .find((message) => !removedMessageIds.has(message.id))
  );
}
