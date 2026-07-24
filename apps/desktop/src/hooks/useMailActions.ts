import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
      queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'drafts'] }),
    ]);
  }

  async function invalidateBulkMailState() {
    await Promise.all([
      invalidateMailLists(),
      queryClient.invalidateQueries({
        queryKey: ['mail', accountId, 'message'],
      }),
    ]);
  }

  const markReadMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'mark-read'],
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
  const bulkMarkReadMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'bulk-mark-read'],
    mutationFn: ({
      messages: selectedMessages,
      isRead,
    }: {
      messages: MailMessageSummary[];
      isRead: boolean;
    }) =>
      runMailActionsWithConcurrency(selectedMessages, (message) =>
        api.mail.markMessageReadState(accountId, message.id, isRead),
      ),
    onMutate: async ({ messages: selectedMessages, isRead }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);

      for (const message of selectedMessages) {
        updateCachedMessageReadState(queryClient, accountId, message.id, isRead);
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: message.folderId,
          unreadDelta: getReadStateUnreadDelta(message.isRead, isRead),
        });
      }

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateBulkMailState();
    },
  });
  const moveMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'move'],
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
  const bulkMoveMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'bulk-move'],
    mutationFn: ({
      messages: selectedMessages,
      destinationFolderId,
    }: {
      messages: MailMessageSummary[];
      destinationFolderId: string;
    }) =>
      runMailActionsWithConcurrency(selectedMessages, (message) =>
        api.mail.moveMessage(
          accountId,
          message.id,
          message.folderId,
          destinationFolderId,
        ),
      ),
    onMutate: async ({ messages: selectedMessages, destinationFolderId }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const removedMessageIds = new Set(
        selectedMessages.map((message) => message.id),
      );

      for (const message of selectedMessages) {
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
      }

      const destinationFolder = folders.find(
        (folder) => folder.id === destinationFolderId,
      );

      if (destinationFolder) {
        announce(
          `Moved ${formatMessageCount(selectedMessages.length)} to ${destinationFolder.label}.`,
        );
      }

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateBulkMailState();
    },
  });
  const deleteMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'delete'],
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
  const bulkDeleteMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'bulk-delete'],
    mutationFn: ({
      messages: selectedMessages,
    }: {
      messages: MailMessageSummary[];
    }) =>
      runMailActionsWithConcurrency(selectedMessages, (message) =>
        api.mail.deleteMessage(accountId, message.id),
      ),
    onMutate: async ({ messages: selectedMessages }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const removedMessageIds = new Set(
        selectedMessages.map((message) => message.id),
      );
      const trashFolder = folders.find(
        (folder) => folder.wellKnownName === 'deleteditems',
      );

      for (const message of selectedMessages) {
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
      }

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateBulkMailState();
    },
  });
  const archiveMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'archive'],
    mutationFn: ({
      message,
    }: {
      message: MailMessageSummary;
      removedMessageIds?: Set<string>;
    }) =>
      api.mail.archiveMessage(accountId, message.id, message.folderId),
    onMutate: async ({ message, removedMessageIds }) => {
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
        handleMessageRemoved(message, removedMessageIds);
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
  const bulkArchiveMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'bulk-archive'],
    mutationFn: ({
      messages: selectedMessages,
    }: {
      messages: MailMessageSummary[];
    }) =>
      runMailActionsWithConcurrency(selectedMessages, (message) =>
        api.mail.archiveMessage(accountId, message.id, message.folderId),
      ),
    onMutate: async ({ messages: selectedMessages }) => {
      await queryClient.cancelQueries({ queryKey: ['mail', accountId] });
      const snapshot = createMailCacheSnapshot(queryClient);
      const removedMessageIds = new Set(
        selectedMessages
          .filter((message) =>
            doesArchiveRemoveFromCurrentFolder({
              accountId,
              folders,
              folderId: message.folderId,
            }),
          )
          .map((message) => message.id),
      );
      const archiveFolder = folders.find(
        (folder) => folder.wellKnownName === 'archive',
      );

      for (const message of selectedMessages) {
        const removesCurrentMessage = doesArchiveRemoveFromCurrentFolder({
          accountId,
          folders,
          folderId: message.folderId,
        });

        if (!removesCurrentMessage) {
          continue;
        }

        handleMessageRemoved(message, removedMessageIds);
        updateCachedFolderCounts(queryClient, accountId, {
          folderId: message.folderId,
          totalDelta: -1,
          unreadDelta: message.isRead ? 0 : -1,
        });

        if (archiveFolder && archiveFolder.id !== message.folderId) {
          updateCachedFolderCounts(queryClient, accountId, {
            folderId: archiveFolder.id,
            totalDelta: 1,
            unreadDelta: message.isRead ? 0 : 1,
          });
        }
      }

      announce(`Archived ${formatMessageCount(selectedMessages.length)}.`);

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      restoreMailCacheSnapshot(queryClient, context?.snapshot);
    },
    onSettled: async () => {
      await invalidateBulkMailState();
    },
  });
  const junkMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'junk'],
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
    mutationKey: ['mail', accountId, 'action', 'star'],
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
    mutationKey: ['mail', accountId, 'action', 'flag'],
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
    mutationKey: ['mail', accountId, 'action', 'important'],
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
    mutationKey: ['mail', accountId, 'action', 'send'],
    mutationFn: (input: SendMailInput) => api.mail.sendMessage(accountId, input),
    onSuccess: async () => {
      closeCompose();
      await invalidateMailLists();
    },
  });
  const replyToMessageMutation = useMutation({
    mutationKey: ['mail', accountId, 'action', 'reply'],
    mutationFn: (input: ReplyToMessageInput) =>
      api.mail.replyToMessage(accountId, input),
    onSuccess: async () => {
      onReplyMessageIdChange(() => undefined);
      await invalidateMailLists();
    },
  });
  const activeMailActionCount = useIsMutating({
    mutationKey: ['mail', accountId, 'action'],
  });
  const isActionPending = activeMailActionCount > 0;
  const isSendingMessage =
    sendMessageMutation.isPending || replyToMessageMutation.isPending;

  return {
    actionCapabilities: actionCapabilitiesQuery.data ?? [],
    archiveMutation,
    bulkArchiveMutation,
    bulkDeleteMutation,
    bulkMarkReadMutation,
    bulkMoveMutation,
    deleteMutation,
    invalidateMailLists,
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

async function runMailActionsWithConcurrency<T>(
  items: T[],
  action: (item: T) => Promise<unknown>,
  concurrency = 4,
) {
  const errors: unknown[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;

        try {
          await action(item);
        } catch (error) {
          errors.push(error);
        }
      }
    }),
  );

  if (errors.length > 0) {
    throw errors[0];
  }
}

function formatMessageCount(count: number) {
  return `${count} ${count === 1 ? 'message' : 'messages'}`;
}
