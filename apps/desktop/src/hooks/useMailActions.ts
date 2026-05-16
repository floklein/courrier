import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  updateCachedMessageState,
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
  const actionCapabilitiesQuery = useQuery({
    queryKey: ['mail', accountId, 'capabilities'],
    queryFn: () => api.mail.getCapabilities(accountId),
    staleTime: Infinity,
  });

  function handleMessageRemoved(message: MailMessageSummary) {
    removeCachedMessage(queryClient, accountId, message.id);
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
          folderId: encodeRouteId(nextMessage.folderId || resolvedFolderId),
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
          queryKey: [
            'mail',
            accountId,
            'message',
            message.folderId || resolvedFolderId,
            message.id,
          ],
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
    }) =>
      api.mail.moveMessage(
        accountId,
        message.id,
        message.folderId,
        destinationFolderId,
      ),
    onMutate: async ({ message, destinationFolderId }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);

      handleMessageRemoved(message);
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
    mutationFn: ({ message }: { message: MailMessageSummary }) =>
      api.mail.deleteMessage(accountId, message.id),
    onMutate: async ({ message }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const trashFolder = folders.find(
        (folder) => folder.wellKnownName === 'deleteditems',
      );

      handleMessageRemoved(message);
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
  const archiveMutation = useMutation({
    mutationFn: ({ message }: { message: MailMessageSummary }) =>
      api.mail.archiveMessage(accountId, message.id, message.folderId),
    onMutate: async ({ message }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const archiveFolder = folders.find(
        (folder) => folder.wellKnownName === 'archive',
      );
      const removesCurrentMessage = doesArchiveRemoveFromCurrentFolder({
        accountId,
        folders,
        folderId: message.folderId,
      });

      if (removesCurrentMessage) {
        handleMessageRemoved(message);
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: message.folderId,
          totalDelta: -1,
          unreadDelta: message.isRead ? 0 : -1,
        });
      }

      if (
        removesCurrentMessage &&
        archiveFolder &&
        archiveFolder.id !== message.folderId
      ) {
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: archiveFolder.id,
          totalDelta: 1,
          unreadDelta: message.isRead ? 0 : 1,
        });
      }

      announce(`Archived "${message.subject}".`);

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateMailLists();
    },
  });
  const junkMutation = useMutation({
    mutationFn: ({
      message,
      isJunk,
    }: {
      message: MailMessageSummary;
      isJunk: boolean;
    }) => api.mail.markMessageJunkState(accountId, message.id, isJunk),
    onMutate: async ({ message, isJunk }) => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const destinationFolder = folders.find(
        (folder) => folder.wellKnownName === (isJunk ? 'junkemail' : 'inbox'),
      );

      handleMessageRemoved(message);
      updateCachedFolderCounts(queryClient, accountId, {
        folderId: message.folderId,
        totalDelta: -1,
        unreadDelta: message.isRead ? 0 : -1,
      });

      if (destinationFolder && destinationFolder.id !== message.folderId) {
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: destinationFolder.id,
          totalDelta: 1,
          unreadDelta: message.isRead ? 0 : 1,
        });
      }

      announce(
        `${isJunk ? 'Marked' : 'Restored'} "${message.subject}" ${
          isJunk ? 'as junk' : 'from junk'
        }.`,
      );

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateMailLists();
    },
  });
  const starMutation = useMutation({
    mutationFn: ({
      message,
      isStarred,
    }: {
      message: MailMessageSummary;
      isStarred: boolean;
    }) => api.mail.setMessageStarState(accountId, message.id, isStarred),
    onMutate: async ({ message, isStarred }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const starredUpdate = getLabelFolderStateUpdate({
        folders,
        labelFolderId: 'STARRED',
        message,
        wasEnabled: Boolean(message.isStarred) || message.folderId === 'STARRED',
        isEnabled: isStarred,
      });

      updateCachedMessageState(queryClient, accountId, message.id, {
        isStarred,
      });

      if (starredUpdate.shouldRemoveMessage) {
        handleMessageRemoved(message);
      }

      if (starredUpdate.folderId) {
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: starredUpdate.folderId,
          totalDelta: starredUpdate.totalDelta,
          unreadDelta: starredUpdate.unreadDelta,
        });
      }

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
  const flagMutation = useMutation({
    mutationFn: ({
      message,
      isFlagged,
    }: {
      message: MailMessageSummary;
      isFlagged: boolean;
    }) => api.mail.setMessageFlagState(accountId, message.id, isFlagged),
    onMutate: async ({ message, isFlagged }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      updateCachedMessageState(queryClient, accountId, message.id, {
        isFlagged,
      });

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSuccess: (_data, { message }) => {
      void queryClient.invalidateQueries({
        queryKey: ['mail', accountId, 'message', resolvedFolderId, message.id],
        refetchType: 'none',
      });
    },
  });
  const importantMutation = useMutation({
    mutationFn: ({
      message,
      isImportant,
    }: {
      message: MailMessageSummary;
      isImportant: boolean;
    }) => api.mail.setMessageImportantState(accountId, message.id, isImportant),
    onMutate: async ({ message, isImportant }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const importantUpdate = getLabelFolderStateUpdate({
        folders,
        labelFolderId: 'IMPORTANT',
        message,
        wasEnabled:
          Boolean(message.isImportant) ||
          message.importance === 'high' ||
          message.folderId === 'IMPORTANT',
        isEnabled: isImportant,
      });

      updateCachedMessageState(queryClient, accountId, message.id, {
        isImportant,
        importance: isImportant ? 'high' : 'normal',
      });

      if (importantUpdate.shouldRemoveMessage) {
        handleMessageRemoved(message);
      }

      if (importantUpdate.folderId) {
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: importantUpdate.folderId,
          totalDelta: importantUpdate.totalDelta,
          unreadDelta: importantUpdate.unreadDelta,
        });
      }

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
    archiveMutation.isPending ||
    junkMutation.isPending ||
    starMutation.isPending ||
    flagMutation.isPending ||
    importantMutation.isPending ||
    sendMessageMutation.isPending ||
    replyToMessageMutation.isPending;
  const isSendingMessage =
    sendMessageMutation.isPending || replyToMessageMutation.isPending;

  return {
    actionCapabilities: actionCapabilitiesQuery.data ?? [],
    archiveMutation,
    deleteMutation,
    flagMutation,
    importantMutation,
    isActionPending,
    isSendingMessage,
    junkMutation,
    markReadMutation,
    moveMutation,
    queryClient,
    replyToMessageMutation,
    sendMessageMutation,
    starMutation,
  };
}

export function getLabelFolderStateUpdate({
  folders,
  labelFolderId,
  message,
  wasEnabled,
  isEnabled,
}: {
  folders: MailFolder[];
  labelFolderId: string;
  message: MailMessageSummary;
  wasEnabled: boolean;
  isEnabled: boolean;
}) {
  const folder = folders.find((candidate) => candidate.id === labelFolderId);
  const delta = wasEnabled === isEnabled ? 0 : isEnabled ? 1 : -1;

  return {
    folderId: folder?.id,
    shouldRemoveMessage: Boolean(folder && message.folderId === folder.id && !isEnabled),
    totalDelta: delta,
    unreadDelta: message.isRead ? 0 : delta,
  };
}

export function doesArchiveRemoveFromCurrentFolder({
  accountId,
  folders,
  folderId,
}: {
  accountId: string;
  folders: MailFolder[];
  folderId: string;
}) {
  if (!accountId.startsWith('google:')) {
    return true;
  }

  const folder = folders.find((candidate) => candidate.id === folderId);

  return folder?.wellKnownName === 'inbox' || folderId === 'INBOX';
}
