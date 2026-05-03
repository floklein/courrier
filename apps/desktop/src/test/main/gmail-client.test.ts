import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailClient } from '../../main/gmail-client';

const accountId = 'google:account-1';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GmailClient', () => {
  it('maps Gmail labels into generic mail folders', async () => {
    mockFetch(
      jsonResponse({
        labels: [
          { id: 'Label_1', name: 'Projects', messagesTotal: 3, messagesUnread: 1 },
          { id: 'INBOX', name: 'Inbox', messagesTotal: 10, messagesUnread: 2 },
          { id: 'UNREAD', name: 'Unread' },
        ],
      }),
    );
    const client = createGmailClient();

    await expect(client.listFolders(accountId)).resolves.toMatchObject([
      {
        id: 'INBOX',
        label: 'Inbox',
        icon: 'inbox',
        wellKnownName: 'inbox',
        unreadCount: 2,
      },
      {
        id: 'Label_1',
        label: 'Projects',
        icon: 'folder',
        unreadCount: 1,
      },
    ]);
  });

  it('marks messages read by removing the Gmail UNREAD label', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 'message-1' }));
    const client = createGmailClient();

    await client.markMessageReadState(accountId, 'message-1', true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/message-1/modify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          addLabelIds: [],
          removeLabelIds: ['UNREAD'],
        }),
      }),
    );
  });

  it('sends raw RFC 2822 mail through Gmail', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 'sent-1' }));
    const client = createGmailClient();

    await client.sendMessage(accountId, {
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      toRecipients: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      raw: string;
    };
    const decoded = Buffer.from(body.raw, 'base64url').toString('utf8');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    );
    expect(decoded).toContain('To: "Ada Lovelace" <ada@example.com>');
    expect(decoded).toContain('Subject: Hello');
    expect(decoded).toContain('<p>Hi</p>');
  });
});

function createGmailClient() {
  return new GmailClient({
    id: 'google',
    displayName: 'Google',
    getConfigurationError: vi.fn(),
    getAccounts: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
