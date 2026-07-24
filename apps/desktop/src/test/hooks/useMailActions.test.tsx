import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessageSummary } from '@/lib/mail-types';
import { useMailActions } from '@/hooks/useMailActions';
import { encodeRouteId } from '@/lib/route-ids';

const navigateMock = vi.hoisted(() => vi.fn());
const mailApiMock = vi.hoisted(() => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  markMessageReadState: vi.fn().mockResolvedValue(undefined),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  replyToMessage: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({
  announce: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    mail: mailApiMock,
  },
}));

describe('useMailActions', () => {
  it('opens the next mixed-folder result from its real folder after removal', async () => {
    const currentMessage = createMessage('message-1', 'archive');
    const nextMessage = createMessage('message-2', 'sent');
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ActionHarness
          messageId={currentMessage.id}
          messages={[currentMessage, nextMessage]}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: encodeRouteId('sent'),
          messageId: encodeRouteId('message-2'),
        },
        replace: true,
      });
    });
  });
});

function ActionHarness({
  messageId,
  messages,
}: {
  messageId: string;
  messages: MailMessageSummary[];
}) {
  const actions = useMailActions({
    accountId: 'account-1',
    closeCompose: vi.fn(),
    folders: [],
    messages,
    messageId,
    onReplyMessageIdChange: vi.fn(),
    resolvedFolderId: 'inbox',
  });

  return (
    <button
      type="button"
      onClick={() => actions.deleteMutation.mutate({ message: messages[0] })}
    >
      Delete
    </button>
  );
}

function createMessage(id: string, folderId: string): MailMessageSummary {
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
