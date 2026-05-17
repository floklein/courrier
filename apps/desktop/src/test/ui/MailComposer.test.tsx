import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailComposer } from '@/ui/compose/MailComposer';
import { api } from '@/lib/api-client';
import type { MailMessageDetail } from '@/lib/mail-types';

vi.mock('@/lib/api-client', () => ({
  api: {
    attachments: {
      pickLocal: vi.fn(),
      registerDroppedFiles: vi.fn(),
    },
    drafts: {
      save: vi.fn(),
      send: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/ui/compose/RichTextMailEditor', () => ({
  RichTextMailEditor: ({
    disabled,
    initialValue,
    onChange,
  }: {
    disabled?: boolean;
    initialValue?: { html: string; text: string; isEmpty: boolean };
    onChange: (value: { html: string; text: string; isEmpty: boolean }) => void;
  }) => (
    <textarea
      aria-label="Message"
      defaultValue={initialValue?.text ?? ''}
      disabled={disabled}
      onChange={(event) =>
        onChange({
          html: event.currentTarget.value,
          text: event.currentTarget.value,
          isEmpty: event.currentTarget.value.length === 0,
        })
      }
    />
  ),
}));

vi.mock('@/ui/compose/RecipientPicker', () => ({
  RecipientPicker: ({
    disabled,
    inputValue,
    onInputChange,
  }: {
    disabled?: boolean;
    inputValue: string;
    onInputChange: (value: string) => void;
  }) => (
    <input
      aria-label="To"
      defaultValue={inputValue}
      disabled={disabled}
      onChange={(event) => onInputChange(event.currentTarget.value)}
    />
  ),
}));

const accountId = 'microsoft:account-1';
const replyMessage: MailMessageDetail = {
  id: 'message-1',
  folderId: 'inbox',
  subject: 'Question',
  sender: { name: 'Ada', email: 'ada@example.com' },
  recipients: [],
  receivedDateTime: '2026-05-16T10:00:00.000Z',
  preview: 'Question',
  bodyContentType: 'html',
  bodyContent: '<p>Question</p>',
  isRead: true,
  hasAttachments: false,
  importance: 'normal',
  attachments: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('MailComposer provider drafts', () => {
  it('does not send a stale provider draft when the forced save fails', async () => {
    vi.mocked(api.drafts.save).mockRejectedValueOnce(new Error('save failed'));
    const user = userEvent.setup();

    render(
      <MailComposer
        accountId={accountId}
        error={null}
        initialDraft={{
          accountId,
          providerDraftId: 'draft-1',
          providerDraftMessageId: 'message-1',
          kind: 'new',
          toValue: 'ada@example.com',
          subject: 'Hello',
          editorValue: {
            html: '<p>Hello</p>',
            text: 'Hello',
            isEmpty: false,
          },
          attachments: [],
        }}
        isSending={false}
        mode="new"
        onClose={vi.fn()}
        onReply={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(api.drafts.save).toHaveBeenCalledTimes(1));
    expect(api.drafts.send).not.toHaveBeenCalled();
    expect(
      screen.getByText('Autosave failed. Keep the composer open and try again.'),
    ).toBeInTheDocument();
  });

  it('submits reply composers through the reply path even with a draft id', async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();

    render(
      <MailComposer
        accountId={accountId}
        error={null}
        initialDraft={{
          accountId,
          providerDraftId: 'draft-1',
          providerDraftMessageId: 'message-1',
          kind: 'reply',
          relatedMessageId: replyMessage.id,
          toValue: '',
          subject: '',
          editorValue: {
            html: '<p>Reply</p>',
            text: 'Reply',
            isEmpty: false,
          },
          attachments: [],
        }}
        isSending={false}
        mode="reply"
        replyMessage={replyMessage}
        onClose={vi.fn()}
        onReply={onReply}
        onSend={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onReply).toHaveBeenCalledWith({
      messageId: replyMessage.id,
      bodyHtml: '<p>Reply</p>',
      attachments: [],
    });
    expect(api.drafts.send).not.toHaveBeenCalled();
  });

  it('ignores provider draft ids from a different account', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(
      <MailComposer
        accountId="google:account-2"
        error={null}
        initialDraft={{
          accountId,
          providerDraftId: 'draft-1',
          providerDraftMessageId: 'message-1',
          kind: 'new',
          toValue: 'ada@example.com',
          subject: 'Hello',
          editorValue: {
            html: '<p>Hello</p>',
            text: 'Hello',
            isEmpty: false,
          },
          attachments: [],
        }}
        isSending={false}
        mode="new"
        onClose={vi.fn()}
        onReply={vi.fn()}
        onSend={onSend}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith({
      toRecipients: [{ email: 'ada@example.com' }],
      subject: 'Hello',
      bodyHtml: '<p>Hello</p>',
      attachments: [],
    });
    expect(api.drafts.send).not.toHaveBeenCalled();
  });
});
