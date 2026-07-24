import { describe, expect, it } from 'vitest';
import {
  getJunkActionState,
  isArchiveFolder,
} from '@/ui/mail/MailActionMenu';
import type { MailFolder } from '@/lib/mail-types';

describe('MailActionMenu triage actions', () => {
  it('switches the junk action to restore when viewing a junk folder', () => {
    expect(
      getJunkActionState(
        [folder({ id: 'junk-id', wellKnownName: 'junkemail' })],
        'junk-id',
      ),
    ).toEqual({
      isJunk: false,
      label: 'Not junk',
    });
  });

  it('detects archive folders before showing archive actions', () => {
    expect(
      isArchiveFolder(
        [folder({ id: 'archive-id', wellKnownName: 'archive' })],
        'archive-id',
      ),
    ).toBe(true);
    expect(isArchiveFolder([folder({ id: 'inbox' })], 'inbox')).toBe(false);
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
