import { describe, expect, it } from 'vitest';
import {
  isMailMessageDragData,
  mailMessageDragType,
} from '../../../lib/mail/mail-drag';

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
});
