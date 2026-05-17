import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MailMessageDetail } from '@/lib/mail-types';
import { MailComposer } from '@/ui/compose/MailComposer';

vi.mock('@atlaskit/pragmatic-drag-and-drop/external/adapter', () => ({
  dropTargetForExternal: vi.fn(() => vi.fn()),
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/external/file', () => ({
  containsFiles: vi.fn(() => false),
  getFiles: vi.fn(() => []),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    attachments: {
      pickLocal: vi.fn(),
      registerDroppedFiles: vi.fn(),
    },
  },
}));

vi.mock('@/ui/compose/RichTextMailEditor', async () => {
  const React = await import('react');

  return {
    RichTextMailEditor({
      id,
      initialValue,
      onChange,
    }: {
      id?: string;
      initialValue?: { html: string; text: string; isEmpty: boolean };
      onChange: (value: { html: string; text: string; isEmpty: boolean }) => void;
    }) {
      return React.createElement('textarea', {
        id,
        'aria-label': 'Message body',
        defaultValue: initialValue?.text ?? '',
        onChange: (event: { target: HTMLTextAreaElement }) => {
          const text = event.target.value;

          onChange({
            html: text ? `<p>${text}</p>` : '',
            text,
            isEmpty: text.length === 0,
          });
        },
      });
    },
  };
});

const replyMessage: MailMessageDetail = {
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

describe('MailComposer', () => {
  it('does not prompt when closing an untouched response composer', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onClose = vi.fn();

    renderComposer({ onClose });

    fireEvent.click(screen.getByLabelText('Cancel composer'));

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prompts when closing an edited response composer', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();

    renderComposer({ onClose });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Edited reply' },
    });
    fireEvent.click(screen.getByLabelText('Cancel composer'));

    expect(confirm).toHaveBeenCalledWith('Discard this unsent message?');
    expect(onClose).not.toHaveBeenCalled();
  });
});

function renderComposer({ onClose }: { onClose: () => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MailComposer
          accountId="microsoft:account-1"
          accountEmail="ada@example.com"
          mode="replyAll"
          replyMessage={replyMessage}
          isSending={false}
          error={null}
          onClose={onClose}
          onReply={vi.fn()}
          onSend={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
