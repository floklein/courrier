import { describe, expect, it, vi } from 'vitest';
import {
  doesArchiveRemoveFromCurrentFolder,
  getLabelFolderStateUpdate,
} from '@/hooks/useMailActions';
import type { MailFolder, MailMessageSummary } from '@/lib/mail-types';

vi.mock('@/lib/api-client', () => ({
  api: {
    mail: {},
  },
}));

describe('mail action folder state updates', () => {
  it('removes a message from the current Starred folder when unstarred', () => {
    expect(
      getLabelFolderStateUpdate({
        folders: [folder({ id: 'STARRED' })],
        labelFolderId: 'STARRED',
        message: message({ folderId: 'STARRED', isRead: false }),
        wasEnabled: true,
        isEnabled: false,
      }),
    ).toEqual({
      folderId: 'STARRED',
      shouldRemoveMessage: true,
      totalDelta: -1,
      unreadDelta: -1,
    });
  });

  it('updates label-folder counts without removing messages from other folders', () => {
    expect(
      getLabelFolderStateUpdate({
        folders: [folder({ id: 'IMPORTANT' })],
        labelFolderId: 'IMPORTANT',
        message: message({ folderId: 'INBOX', isRead: true }),
        wasEnabled: false,
        isEnabled: true,
      }),
    ).toEqual({
      folderId: 'IMPORTANT',
      shouldRemoveMessage: false,
      totalDelta: 1,
      unreadDelta: 0,
    });
  });

  it('keeps Gmail archive optimistic removal scoped to inbox', () => {
    const folders = [
      folder({ id: 'INBOX', wellKnownName: 'inbox' }),
      folder({ id: 'STARRED' }),
    ];

    expect(
      doesArchiveRemoveFromCurrentFolder({
        accountId: 'google:account-1',
        folders,
        folderId: 'INBOX',
      }),
    ).toBe(true);
    expect(
      doesArchiveRemoveFromCurrentFolder({
        accountId: 'google:account-1',
        folders,
        folderId: 'STARRED',
      }),
    ).toBe(false);
    expect(
      doesArchiveRemoveFromCurrentFolder({
        accountId: 'microsoft:account-1',
        folders,
        folderId: 'inbox',
      }),
    ).toBe(true);
  });
});

function folder({
  id,
  wellKnownName,
}: {
  id: string;
  wellKnownName?: string;
}): MailFolder {
  return {
    id,
    label: id,
    icon: 'folder',
    unreadCount: 0,
    totalCount: 0,
    wellKnownName,
    hasChildren: false,
    depth: 0,
  };
}

function message({
  folderId,
  isRead,
}: {
  folderId: string;
  isRead: boolean;
}): MailMessageSummary {
  return {
    id: 'message-1',
    folderId,
    sender: { name: 'Ada Lovelace', email: 'ada@example.com' },
    recipients: [],
    subject: 'Hello',
    preview: 'Preview',
    receivedDateTime: '2026-05-16T10:00:00.000Z',
    isRead,
    hasAttachments: false,
    importance: 'normal',
  };
}
