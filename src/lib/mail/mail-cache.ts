import type {
  InfiniteData,
  QueryClient,
} from '@tanstack/react-query';
import type {
  MailFolder,
  MailMessageDetail,
  PagedMessages,
} from '../mail-types';

export function updateCachedMessageReadState(
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

export function removeCachedMessage(
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

export function updateCachedFolderCounts(
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

export function getReadStateUnreadDelta(wasRead: boolean, isRead: boolean) {
  if (wasRead === isRead) {
    return 0;
  }

  return isRead ? -1 : 1;
}

export function createMailCacheSnapshot(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['mail'] })
    .map((query) => ({
      queryKey: query.queryKey,
      data: query.state.data,
    }));
}

export function restoreMailCacheSnapshot(
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

function clampCount(value: number) {
  return Math.max(0, value);
}
