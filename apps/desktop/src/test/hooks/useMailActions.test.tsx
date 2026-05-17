import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessageSummary } from '@/lib/mail-types';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({
  announce: vi.fn(),
}));

describe('useMailActions', () => {
  beforeEach(() => {
    vi.resetModules();
    navigateMock.mockReset();
    installCourrierApi();
  });

  it('skips every bulk-removed message when navigating after deleting the open message', async () => {
    const { useMailActions } = await import('@/hooks/useMailActions');
    const queryClient = new QueryClient();
    const messages = [
      message({ id: 'message-1' }),
      message({ id: 'message-2' }),
      message({ id: 'message-3' }),
      message({ id: 'message-4' }),
    ];
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(
      () =>
        useMailActions({
          accountId: 'account-1',
          folders: [],
          messages,
          messageId: 'message-2',
          resolvedFolderId: 'inbox',
          closeCompose: vi.fn(),
          onReplyMessageIdChange: vi.fn(),
        }),
      { wrapper },
    );

    act(() => {
      result.current.deleteMutation.mutate({
        message: messages[1],
        removedMessageIds: new Set(['message-2', 'message-3']),
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: 'inbox',
          messageId: 'id_bWVzc2FnZS00',
        },
        replace: true,
      });
    });
  });
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function installCourrierApi() {
  Object.defineProperty(window, 'courrier', {
    configurable: true,
    value: {
      attachments: {
        pickLocal: vi.fn(),
        registerDroppedFiles: vi.fn(),
        open: vi.fn(),
        download: vi.fn(),
      },
      auth: {
        getSession: vi.fn(),
        signIn: vi.fn(),
        switchAccount: vi.fn(),
        signOut: vi.fn(),
      },
      mail: {
        listFolders: vi.fn(),
        listMessages: vi.fn(),
        getMessage: vi.fn(),
        markMessageReadState: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        listPeople: vi.fn(),
        sendMessage: vi.fn(),
        replyToMessage: vi.fn(),
        onRemoteChange: vi.fn(),
      },
      window: {
        closeCurrent: vi.fn(),
        getComposeDraft: vi.fn(),
        openComposeWindow: vi.fn(),
      },
    },
  });
}

function message({ id }: { id: string }): MailMessageSummary {
  return {
    id,
    folderId: 'inbox',
    sender: {
      name: `Sender ${id}`,
      email: `${id}@example.com`,
    },
    recipients: [],
    subject: `Subject ${id}`,
    preview: `Preview ${id}`,
    receivedDateTime: '2026-05-16T10:00:00.000Z',
    isRead: false,
    hasAttachments: false,
    importance: 'normal',
  };
}
