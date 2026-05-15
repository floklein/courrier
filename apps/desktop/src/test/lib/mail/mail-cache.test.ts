import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type {
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  PagedMessages,
} from '../../../lib/mail-types';
import {
  createMailCacheSnapshot,
  getReadStateUnreadDelta,
  removeCachedMessage,
  restoreMailCacheSnapshot,
  updateCachedFolderCounts,
  updateCachedMessageReadState,
} from '../../../lib/mail/mail-cache';

const accountId = 'microsoft:account-1';

describe('mail cache helpers', () => {
  it('updates message read state in list and detail caches', () => {
    const queryClient = createQueryClient();
    seedMessages(queryClient, [message({ id: 'message-1', isRead: false })]);
    queryClient.setQueryData(
      ['mail', accountId, 'message', 'inbox', 'message-1'],
      messageDetail({ id: 'message-1', isRead: false }),
    );

    updateCachedMessageReadState(queryClient, accountId, 'message-1', true);

    expect(getCachedMessages(queryClient)[0].isRead).toBe(true);
    expect(
      queryClient.getQueryData<MailMessageDetail>([
        'mail',
        accountId,
        'message',
        'inbox',
        'message-1',
      ])?.isRead,
    ).toBe(true);
  });

  it('removes a message from cached pages and clears message detail queries', () => {
    const queryClient = createQueryClient();
    seedMessages(queryClient, [
      message({ id: 'message-1' }),
      message({ id: 'message-2' }),
    ]);
    queryClient.setQueryData(
      ['mail', accountId, 'message', 'inbox', 'message-1'],
      messageDetail({ id: 'message-1' }),
    );

    removeCachedMessage(queryClient, accountId, 'message-1');

    expect(getCachedMessages(queryClient).map((cached) => cached.id)).toEqual([
      'message-2',
    ]);
    expect(
      queryClient.getQueryData(['mail', accountId, 'message', 'inbox', 'message-1']),
    ).toBeUndefined();
  });

  it('updates folder counts without dropping below zero', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData<MailFolder[]>(['mail', accountId, 'folders'], [
      folder({ id: 'inbox', totalCount: 1, unreadCount: 0 }),
      folder({ id: 'archive', totalCount: 5, unreadCount: 2 }),
    ]);

    updateCachedFolderCounts(queryClient, accountId, {
      folderId: 'inbox',
      totalDelta: -5,
      unreadDelta: -2,
    });

    expect(queryClient.getQueryData<MailFolder[]>(['mail', accountId, 'folders'])).toEqual([
      folder({ id: 'inbox', totalCount: 0, unreadCount: 0 }),
      folder({ id: 'archive', totalCount: 5, unreadCount: 2 }),
    ]);
  });

  it.each([
    { wasRead: false, isRead: true, expected: -1 },
    { wasRead: true, isRead: false, expected: 1 },
    { wasRead: true, isRead: true, expected: 0 },
    { wasRead: false, isRead: false, expected: 0 },
  ])(
    'returns $expected unread delta when read state changes from $wasRead to $isRead',
    ({ wasRead, isRead, expected }) => {
      expect(getReadStateUnreadDelta(wasRead, isRead)).toBe(expected);
    },
  );

  it('restores a snapshot after optimistic cache changes', () => {
    const queryClient = createQueryClient();
    const originalMessages = [message({ id: 'message-1', isRead: false })];
    const originalFolders = [folder({ id: 'inbox', totalCount: 2, unreadCount: 1 })];
    seedMessages(queryClient, originalMessages);
    queryClient.setQueryData<MailFolder[]>(['mail', accountId, 'folders'], originalFolders);

    const snapshot = createMailCacheSnapshot(queryClient);
    updateCachedMessageReadState(queryClient, accountId, 'message-1', true);
    updateCachedFolderCounts(queryClient, accountId, {
      folderId: 'inbox',
      unreadDelta: -1,
    });

    restoreMailCacheSnapshot(queryClient, snapshot);

    expect(getCachedMessages(queryClient)).toEqual(originalMessages);
    expect(queryClient.getQueryData<MailFolder[]>(['mail', accountId, 'folders'])).toEqual(
      originalFolders,
    );
  });
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function seedMessages(
  queryClient: QueryClient,
  messages: MailMessageSummary[],
) {
  queryClient.setQueryData<InfiniteData<PagedMessages>>(
    ['mail', accountId, 'messages', 'inbox'],
    {
      pages: [{ messages }],
      pageParams: [undefined],
    },
  );
}

function getCachedMessages(queryClient: QueryClient) {
  return (
    queryClient.getQueryData<InfiniteData<PagedMessages>>([
      'mail',
      accountId,
      'messages',
      'inbox',
    ])?.pages[0].messages ?? []
  );
}

function message({
  id,
  isRead = false,
}: {
  id: string;
  isRead?: boolean;
}): MailMessageSummary {
  return {
    id,
    folderId: 'inbox',
    sender: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    recipients: ['grace@example.com'],
    subject: 'Hello',
    preview: 'Preview',
    receivedDateTime: '2026-04-28T10:00:00Z',
    isRead,
    hasAttachments: false,
    importance: 'normal',
  };
}

function messageDetail({
  id,
  isRead = false,
}: {
  id: string;
  isRead?: boolean;
}): MailMessageDetail {
  return {
    ...message({ id, isRead }),
    bodyContentType: 'html',
    bodyContent: '<p>Hello</p>',
  };
}

function folder({
  id,
  totalCount,
  unreadCount,
}: {
  id: string;
  totalCount: number;
  unreadCount: number;
}): MailFolder {
  return {
    id,
    label: id,
    icon: 'file',
    unreadCount,
    totalCount,
    hasChildren: false,
    depth: 0,
  };
}
