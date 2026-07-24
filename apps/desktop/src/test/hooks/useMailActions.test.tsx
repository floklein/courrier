import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMailActions } from '@/hooks/useMailActions';
import type { MailFolder, MailMessageSummary } from '@/lib/mail-types';
import { encodeRouteId } from '@/lib/route-ids';
import { getManualUnreadGuardAfterAction } from '@/ui/app/AuthenticatedMailClient';

const navigateMock = vi.hoisted(() => vi.fn());
const mailApiMock = vi.hoisted(() => ({
  archiveMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  getCapabilities: vi.fn().mockResolvedValue([]),
  markMessageReadState: vi.fn().mockResolvedValue(undefined),
  markMessageJunkState: vi.fn().mockResolvedValue(undefined),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  replyToMessage: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  setMessageFlagState: vi.fn().mockResolvedValue(undefined),
  setMessageImportantState: vi.fn().mockResolvedValue(undefined),
  setMessageStarState: vi.fn().mockResolvedValue(undefined),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mailApiMock.markMessageReadState.mockResolvedValue(undefined);
  });

  it('opens the next mixed-folder result from its real folder after removal', async () => {
    const currentMessage = createMessage('message-1', 'archive');
    const nextMessage = createMessage('message-2', 'sent');

    renderHarness({
      messageId: currentMessage.id,
      messages: [currentMessage, nextMessage],
    });

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

  it('skips every bulk-removed message when navigating after deleting the open message', async () => {
    const messages = [
      createMessage('message-1', 'inbox'),
      createMessage('message-2', 'inbox'),
      createMessage('message-3', 'inbox'),
      createMessage('message-4', 'sent'),
    ];
    const removedMessageIds = new Set(['message-2', 'message-3']);

    renderHarness({
      deleteIndex: 1,
      messageId: 'message-2',
      messages,
      removedMessageIds,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: encodeRouteId('sent'),
          messageId: encodeRouteId('message-4'),
        },
        replace: true,
      });
    });
  });

  it('skips every selected Gmail result when bulk deleting outside Inbox', async () => {
    const messages = [
      createMessage('message-1', 'sent'),
      createMessage('message-2', 'sent'),
      createMessage('message-3', 'inbox'),
    ];

    renderBulkHarness({
      accountId: 'google:account-1',
      action: 'delete',
      actionMessages: messages.slice(0, 2),
      messageId: 'message-1',
      messages,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run bulk action' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: encodeRouteId('inbox'),
          messageId: encodeRouteId('message-3'),
        },
        replace: true,
      });
    });
  });

  it('keeps non-Inbox Gmail results eligible after bulk archive navigation', async () => {
    const messages = [
      createMessage('message-1', 'INBOX'),
      createMessage('message-2', 'STARRED'),
      createMessage('message-3', 'SENT'),
    ];

    renderBulkHarness({
      accountId: 'google:account-1',
      action: 'archive',
      actionMessages: messages.slice(0, 2),
      folders: [
        createFolder('INBOX', 'inbox'),
        createFolder('STARRED'),
        createFolder('SENT', 'sentitems'),
      ],
      messageId: 'message-1',
      messages,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run bulk action' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: encodeRouteId('STARRED'),
          messageId: encodeRouteId('message-2'),
        },
        replace: true,
      });
    });
  });

  it('runs one aggregate mark-read action and rolls back the full cache snapshot', async () => {
    const firstRequest = deferred<void>();
    const secondRequest = deferred<void>();
    const messages = [
      { ...createMessage('message-1', 'inbox'), isRead: false },
      { ...createMessage('message-2', 'inbox'), isRead: false },
    ];
    mailApiMock.markMessageReadState.mockImplementation(
      (_accountId, messageId) =>
        messageId === 'message-1'
          ? firstRequest.promise
          : secondRequest.promise,
    );

    const { detailQueryKey, queryClient, queryKey } = renderBulkHarness({
      accountId: 'account-1',
      action: 'mark-read',
      actionMessages: messages,
      messageId: 'message-1',
      messages,
      seedMessageCache: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run bulk action' }));

    await waitFor(() => {
      expect(mailApiMock.markMessageReadState).toHaveBeenCalledTimes(2);
      expect(getCachedReadStates(queryClient, queryKey)).toEqual([true, true]);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    act(() => {
      secondRequest.resolve();
      firstRequest.reject(new Error('Could not update the first message.'));
    });

    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument();
      expect(getCachedReadStates(queryClient, queryKey)).toEqual([false, false]);
      expect(queryClient.getQueryState(detailQueryKey)?.isInvalidated).toBe(
        true,
      );
    });
  });
});

describe('bulk unread guard', () => {
  it('guards the open message even when another selected message routes the batch', () => {
    expect(
      getManualUnreadGuardAfterAction({
        currentGuardId: undefined,
        isRead: false,
        openMessageId: 'message-2',
        targetMessageIds: new Set(['message-1', 'message-2']),
      }),
    ).toBe('message-2');
  });

  it('preserves the existing guard when the open message is outside the batch', () => {
    expect(
      getManualUnreadGuardAfterAction({
        currentGuardId: 'message-3',
        isRead: true,
        openMessageId: 'message-3',
        targetMessageIds: new Set(['message-1', 'message-2']),
      }),
    ).toBe('message-3');
  });
});

function renderHarness({
  deleteIndex = 0,
  messageId,
  messages,
  removedMessageIds,
}: {
  deleteIndex?: number;
  messageId: string;
  messages: MailMessageSummary[];
  removedMessageIds?: Set<string>;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ActionHarness
        deleteIndex={deleteIndex}
        messageId={messageId}
        messages={messages}
        removedMessageIds={removedMessageIds}
      />
    </QueryClientProvider>,
  );
}

function ActionHarness({
  deleteIndex,
  messageId,
  messages,
  removedMessageIds,
}: {
  deleteIndex: number;
  messageId: string;
  messages: MailMessageSummary[];
  removedMessageIds?: Set<string>;
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
      onClick={() =>
        actions.deleteMutation.mutate({
          message: messages[deleteIndex],
          removedMessageIds,
        })
      }
    >
      Delete
    </button>
  );
}

function renderBulkHarness({
  accountId,
  action,
  actionMessages,
  folders = [],
  messageId,
  messages,
  seedMessageCache = false,
}: {
  accountId: string;
  action: 'archive' | 'delete' | 'mark-read';
  actionMessages: MailMessageSummary[];
  folders?: MailFolder[];
  messageId: string;
  messages: MailMessageSummary[];
  seedMessageCache?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const queryKey = [
    'mail',
    accountId,
    'messages',
    'inbox',
    'folder',
    '',
  ] as const;
  const detailQueryKey = [
    'mail',
    accountId,
    'message',
    'inbox',
    messages[1]?.id ?? messages[0]?.id,
  ] as const;

  if (seedMessageCache) {
    queryClient.setQueryData(queryKey, {
      pages: [{ messages, nextPageToken: undefined }],
      pageParams: [undefined],
    });
    const detailMessage = messages[1] ?? messages[0];

    if (detailMessage) {
      queryClient.setQueryData(detailQueryKey, {
        ...detailMessage,
        bodyContentType: 'text',
        bodyContent: detailMessage.preview,
        attachments: [],
      });
    }
  }

  render(
    <QueryClientProvider client={queryClient}>
      <BulkActionHarness
        accountId={accountId}
        action={action}
        actionMessages={actionMessages}
        folders={folders}
        messageId={messageId}
        messages={messages}
      />
    </QueryClientProvider>,
  );

  return { detailQueryKey, queryClient, queryKey };
}

function BulkActionHarness({
  accountId,
  action,
  actionMessages,
  folders,
  messageId,
  messages,
}: {
  accountId: string;
  action: 'archive' | 'delete' | 'mark-read';
  actionMessages: MailMessageSummary[];
  folders: MailFolder[];
  messageId: string;
  messages: MailMessageSummary[];
}) {
  const actions = useMailActions({
    accountId,
    closeCompose: vi.fn(),
    folders,
    messages,
    messageId,
    onReplyMessageIdChange: vi.fn(),
    resolvedFolderId: 'inbox',
  });

  function runBulkAction() {
    if (action === 'archive') {
      actions.bulkArchiveMutation.mutate({ messages: actionMessages });
      return;
    }

    if (action === 'delete') {
      actions.bulkDeleteMutation.mutate({ messages: actionMessages });
      return;
    }

    actions.bulkMarkReadMutation.mutate({
      messages: actionMessages,
      isRead: true,
    });
  }

  return (
    <>
      <button type="button" onClick={runBulkAction}>
        Run bulk action
      </button>
      <span>{actions.isActionPending ? 'Pending' : 'Idle'}</span>
    </>
  );
}

function getCachedReadStates(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
) {
  const data = queryClient.getQueryData<{
    pages: Array<{ messages: MailMessageSummary[] }>;
  }>(queryKey);

  return data?.pages[0]?.messages.map((message) => message.isRead);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
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

function createFolder(id: string, wellKnownName?: string): MailFolder {
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
