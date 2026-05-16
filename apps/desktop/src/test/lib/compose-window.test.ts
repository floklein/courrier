import { describe, expect, it } from 'vitest';
import {
  composeWindowDraftSchema,
  emptyComposeWindowDraft,
} from '@/lib/compose-window';

describe('compose window draft schema', () => {
  it('accepts the empty draft shape used by new compose windows', () => {
    expect(emptyComposeWindowDraft).toEqual({
      accountId: '',
      toValue: '',
      subject: '',
      editorValue: {
        html: '',
        text: '',
        isEmpty: true,
      },
    });
  });

  it('validates persisted compose drafts', () => {
    expect(
      composeWindowDraftSchema.parse({
        accountId: 'microsoft:user-1',
        toValue: '"Ada Lovelace" <ada@example.com>',
        subject: 'Notes',
        editorValue: {
          html: '<p>Hello</p>',
          text: 'Hello',
          isEmpty: false,
        },
      }),
    ).toEqual({
      accountId: 'microsoft:user-1',
      toValue: '"Ada Lovelace" <ada@example.com>',
      subject: 'Notes',
      editorValue: {
        html: '<p>Hello</p>',
        text: 'Hello',
        isEmpty: false,
      },
    });
  });

  it('rejects drafts without an account id', () => {
    expect(
      composeWindowDraftSchema.safeParse({
        accountId: '',
        toValue: '',
        subject: '',
        editorValue: {
          html: '',
          text: '',
          isEmpty: true,
        },
      }).success,
    ).toBe(false);
  });
});
