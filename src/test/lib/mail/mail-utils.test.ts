import { describe, expect, it } from 'vitest';
import { encodeRouteId } from '../../../lib/route-ids';
import {
  formatMailDate,
  getInitials,
  parseMailPath,
} from '../../../lib/mail/mail-utils';

describe('mail utils', () => {
  it('parses folder and message ids from mail routes', () => {
    expect(parseMailPath('/mail/inbox')).toEqual({
      folderId: 'inbox',
      messageId: undefined,
    });
    expect(parseMailPath('/mail/archive/message-1')).toEqual({
      folderId: 'archive',
      messageId: 'message-1',
    });
  });

  it('decodes opaque Outlook ids from mail route segments', () => {
    const folderId = 'AAMkAGI2T/folder+abc=';
    const messageId = 'AAMkAGI2T/message+def=';

    expect(
      parseMailPath(
        `/mail/${encodeRouteId(folderId)}/${encodeRouteId(messageId)}`,
      ),
    ).toEqual({
      folderId,
      messageId,
    });
  });

  it('returns inbox when the path is not a mail route', () => {
    expect(parseMailPath('/')).toEqual({
      folderId: 'inbox',
      messageId: undefined,
    });
  });

  it('creates compact sender initials', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('Grace')).toBe('G');
  });

  it('keeps invalid dates readable', () => {
    expect(formatMailDate('not-a-date', 'short')).toBe('not-a-date');
    expect(formatMailDate('', 'long')).toBe('');
  });
});
