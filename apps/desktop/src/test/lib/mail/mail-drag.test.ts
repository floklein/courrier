import { describe, expect, it } from 'vitest';
import {
  getMovableMailMessages,
  isMailMessageDragData,
  mailMessageDragType,
} from '@/lib/mail/mail-drag';
import type { MailMessageSummary } from '@/lib/mail-types';

describe('mail drag payload guard', () => {
  it('accepts a mail message drag payload', () => {
    expect(
      isMailMessageDragData({
        type: mailMessageDragType,
        sourceFolderId: 'inbox',
        message: {
          id: 'message-1',
        },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    'message-1',
    { type: 'other', sourceFolderId: 'inbox', message: { id: 'message-1' } },
    { type: mailMessageDragType, message: { id: 'message-1' } },
    { type: mailMessageDragType, sourceFolderId: 'inbox', message: null },
  ])('rejects invalid drag payload %#', (payload) => {
    expect(isMailMessageDragData(payload)).toBe(false);
  });

  it('filters a mixed-folder batch against each message source folder', () => {
    const inboxMessage = message('message-1', 'inbox');
    const sentMessage = message('message-2', 'sent');

    expect(
      getMovableMailMessages(
        {
          message: inboxMessage,
          messages: [inboxMessage, sentMessage],
          sourceFolderId: 'inbox',
        },
        'inbox',
      ).map((candidate) => candidate.id),
    ).toEqual(['message-2']);
  });

  it('uses the drag source folder when a message has no effective folder', () => {
    const draggedMessage = message('message-1', '');

    expect(
      getMovableMailMessages(
        {
          message: draggedMessage,
          sourceFolderId: 'inbox',
        },
        'inbox',
      ),
    ).toEqual([]);
  });
});

function message(id: string, folderId: string): MailMessageSummary {
  return {
    id,
    folderId,
    sender: { name: 'Ada', email: 'ada@example.com' },
    recipients: [],
    subject: id,
    preview: '',
    receivedDateTime: '2026-05-16T10:00:00.000Z',
    isRead: true,
    hasAttachments: false,
    importance: 'normal',
  };
}
