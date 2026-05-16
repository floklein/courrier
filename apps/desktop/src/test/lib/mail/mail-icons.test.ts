import { describe, expect, it } from 'vitest';
import { folderIcons } from '@/lib/mail/mail-icons';

describe('mail folder icons', () => {
  it('maps every supported folder icon to a renderable component', () => {
    expect(Object.keys(folderIcons).sort()).toEqual([
      'archive',
      'clock',
      'file',
      'folder',
      'inbox',
      'mail-x',
      'send',
      'star',
      'trash',
    ]);

    for (const icon of Object.values(folderIcons)) {
      expect(typeof icon).toBe('object');
    }
  });
});
