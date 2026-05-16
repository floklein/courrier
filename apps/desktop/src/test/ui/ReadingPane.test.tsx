import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MailMessageDetail, MailResponseKind } from '@/lib/mail-types';
import { ReadingPane } from '@/ui/mail/ReadingPane';

vi.mock('@/lib/api-client', () => ({
  api: {
    attachments: {
      download: vi.fn(),
      open: vi.fn(),
    },
  },
}));

vi.mock('@/ui/compose/MailComposer', async () => {
  const React = await import('react');

  return {
    MailComposer({ mode }: { mode: MailResponseKind }) {
      const initialMode = React.useRef(mode);

      return React.createElement('div', {
        'data-current-mode': mode,
        'data-initial-mode': initialMode.current,
        'data-testid': 'mail-composer',
      });
    },
  };
});

const message: MailMessageDetail = {
  id: 'message-1',
  folderId: 'inbox',
  sender: { name: 'Sender', email: 'sender@example.com' },
  recipients: ['Ada <ada@example.com>'],
  ccRecipients: ['Copy <copy@example.com>'],
  replyTo: [{ name: 'Replies', email: 'replies@example.com' }],
  subject: 'Hello',
  preview: 'Preview',
  receivedDateTime: '2026-05-16T12:00:00Z',
  isRead: false,
  hasAttachments: false,
  importance: 'normal',
  bodyContentType: 'text',
  bodyContent: 'Hello',
  attachments: [],
};

describe('ReadingPane', () => {
  it('remounts the inline composer when the response kind changes', () => {
    const { rerender } = renderReadingPane('reply');

    expect(screen.getByTestId('mail-composer')).toHaveAttribute(
      'data-initial-mode',
      'reply',
    );

    rerender(createReadingPane('replyAll'));

    expect(screen.getByTestId('mail-composer')).toHaveAttribute(
      'data-current-mode',
      'replyAll',
    );
    expect(screen.getByTestId('mail-composer')).toHaveAttribute(
      'data-initial-mode',
      'replyAll',
    );
  });
});

function renderReadingPane(responseKind: MailResponseKind) {
  return render(createReadingPane(responseKind));
}

function createReadingPane(responseKind: MailResponseKind) {
  return (
    <TooltipProvider>
      <ReadingPane
        accountId="microsoft:account-1"
        accountEmail="ada@example.com"
        folderId="inbox"
        folders={[]}
        isActionPending={false}
        message={message}
        replyMessageId={message.id}
        responseKind={responseKind}
        isSendingMessage={false}
        replyError={null}
        isLoading={false}
        error={null}
        isMailDragActive={false}
        onCloseReply={vi.fn()}
        onDeleteMessage={vi.fn()}
        onMarkMessageReadState={vi.fn()}
        onMoveMessage={vi.fn()}
        onForwardMessage={vi.fn()}
        onReplyToMessage={vi.fn()}
        onReplyAllToMessage={vi.fn()}
        onReplyToMessageBody={vi.fn()}
      />
    </TooltipProvider>
  );
}
