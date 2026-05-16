import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeRouteId } from '@/lib/route-ids';
import {
  formatMailDate,
  getInitials,
  parseMailPath,
} from '@/lib/mail/mail-utils';

describe('mail utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('returns inbox when an encoded folder route is malformed', () => {
    expect(parseMailPath('/mail/id_%%%%/id_%%%%')).toEqual({
      folderId: 'inbox',
      messageId: undefined,
    });
  });

  it('creates compact sender initials', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('Grace')).toBe('G');
    expect(getInitials('jean-luc picard')).toBe('JP');
    expect(getInitials('123')).toBe('');
  });

  it('keeps invalid dates readable', () => {
    expect(formatMailDate('not-a-date', 'short')).toBe('not-a-date');
    expect(formatMailDate('', 'long')).toBe('');
  });

  it('formats short dates as time for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00'));

    expect(formatMailDate('2026-05-15T09:05:00', 'short')).toBe('09:05');
  });

  it('formats short dates with weekday and date within the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00'));

    expect(formatMailDate('2026-05-14T09:05:00', 'short')).toBe('Thu 14/05');
  });

  it('includes the year for older short dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00'));

    expect(formatMailDate('2025-12-31T09:05:00', 'short')).toBe('31/12/2025');
  });

  it('formats long dates with date and time details', () => {
    expect(formatMailDate('2026-05-15T09:05:00', 'long')).toContain('2026');
  });
});
