import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { announce } from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { api } from '../lib/api-client';
import type {
  MailFolder,
  MailMessageSummary,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import {
  createMailCacheSnapshot,
  getReadStateUnreadDelta,
  removeCachedMessage,
  restoreMailCacheSnapshot,
  updateCachedFolderCounts,
  updateCachedMessageReadState,
} from '../lib/mail/mail-cache';

const actionInvalidationKeys = {
  folders: ['mail', 'folders'] as const,
  messages: ['mail', 'messages'] as const,
};

export function useMailActions({
  folders,
  messages,
  messageId,
  resolvedFolderId,
  closeCompose,
  onReplyMessageIdChange,
}: {
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

  function handleMessageRemoved(message: MailMessageSummary) {
    removeCachedMessage(queryClient, message.id);
    onReplyMessageIdChange((current) =>
      current === message.id ? undefined : current,
    );

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
