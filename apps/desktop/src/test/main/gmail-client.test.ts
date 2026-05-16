import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailClient } from '@/main/gmail-client';

const accountId = 'google:account-1';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GmailClient', () => {
  it('maps Gmail labels into generic mail folders', async () => {
    mockFetch(
      jsonResponse({
        labels: [
          { id: 'Label_1', name: 'Projects' },
          { id: 'INBOX', name: 'Inbox' },
          { id: 'IMPORTANT', name: 'Important' },
          { id: 'UNREAD', name: 'Unread' },
        ],
      }),
      jsonResponse({
        id: 'Label_1',
        name: 'Projects',
        messagesTotal: 3,
        messagesUnread: 1,
      }),
      jsonResponse({
        id: 'INBOX',
        name: 'Inbox',
        messagesTotal: 10,
        messagesUnread: 2,
      }),
      jsonResponse({
        id: 'IMPORTANT',
        name: 'Important',
        messagesTotal: 4,
        messagesUnread: 0,
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
        id: 'IMPORTANT',
        label: 'Important',
        icon: 'important',
        unreadCount: 0,
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

  it('marks messages unread by adding the Gmail UNREAD label', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 'message-1' }));
    const client = createGmailClient();

    await client.markMessageReadState(accountId, 'message-1', false);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/message-1/modify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          addLabelIds: ['UNREAD'],
          removeLabelIds: [],
        }),
      }),
    );
  });

  it('archives and marks messages as junk with Gmail labels', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'message-1', labelIds: ['Label_1'] }),
      jsonResponse({ id: 'message-1', labelIds: ['SPAM'] }),
      jsonResponse({ id: 'message-1', labelIds: [] }),
      jsonResponse({ id: 'message-1', labelIds: ['CATEGORY_PERSONAL'] }),
    );
    const client = createGmailClient();

    await client.archiveMessage(accountId, 'message-1', 'INBOX');
    await client.markMessageJunkState(accountId, 'message-1', true);
    await client.archiveMessage(accountId, 'message-1', 'SPAM');
    await client.archiveMessage(accountId, 'message-1', 'CATEGORY_PERSONAL');

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      removeLabelIds: ['INBOX'],
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      addLabelIds: ['SPAM'],
      removeLabelIds: ['INBOX'],
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({
      removeLabelIds: ['SPAM'],
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toEqual({
      removeLabelIds: ['INBOX'],
    });
  });

  it('scopes Gmail category folders to inbox messages', async () => {
    const fetchMock = mockFetch(jsonResponse({ messages: [] }));
    const client = createGmailClient();

    await client.listMessages(accountId, 'CATEGORY_PERSONAL');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&labelIds=CATEGORY_PERSONAL&labelIds=INBOX',
    );
  });

  it('toggles Gmail star and important labels', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'message-1' }),
      jsonResponse({ id: 'message-1' }),
    );
    const client = createGmailClient();

    await client.setMessageStarState(accountId, 'message-1', true);
    await client.setMessageImportantState(accountId, 'message-1', false);

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      addLabelIds: ['STARRED'],
      removeLabelIds: [],
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      addLabelIds: [],
      removeLabelIds: ['IMPORTANT'],
    });
  });

  it('searches all Gmail messages without labelIds and maps result labels', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ messages: [{ id: 'message-1' }] }),
      jsonResponse({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'STARRED', name: 'Starred' },
        ],
      }),
      jsonResponse({ id: 'INBOX', name: 'Inbox' }),
      jsonResponse({ id: 'STARRED', name: 'Starred' }),
      jsonResponse({
        id: 'message-1',
        labelIds: ['INBOX', 'STARRED'],
        payload: {
          headers: [
            { name: 'From', value: 'Ada <ada@example.com>' },
            { name: 'Subject', value: 'Hello' },
          ],
        },
      }),
    );
    const client = createGmailClient();

    const result = await client.searchMessages(accountId, {
      query: 'hello',
      scope: 'all',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=hello',
    );
    expect(result.messages[0]).toMatchObject({
      id: 'message-1',
      folderId: 'INBOX',
      folderLabel: 'Inbox',
      matchedFolderIds: ['INBOX', 'STARRED'],
    });
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
    expect(decoded).toContain('To: Ada Lovelace <ada@example.com>');
    expect(decoded).toContain('Subject: Hello');
    expect(decoded).toContain('<p>Hi</p>');
  });

  it('includes Cc and Bcc headers in raw Gmail mail', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 'sent-1' }));
    const client = createGmailClient();

    await client.sendMessage(accountId, {
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      toRecipients: [{ email: 'ada@example.com' }],
      ccRecipients: [{ email: 'grace@example.com' }],
      bccRecipients: [{ email: 'hidden@example.com' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      raw: string;
    };
    const decoded = Buffer.from(body.raw, 'base64url').toString('utf8');

    expect(decoded).toContain('Cc: grace@example.com');
    expect(decoded).toContain('Bcc: hidden@example.com');
    expect(decoded.match(/^Bcc:/gm)).toHaveLength(1);
  });

  it('builds Gmail reply-all recipients from Reply-To, To, and Cc', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: 'message-1',
        threadId: 'thread-1',
        payload: {
          headers: [
            { name: 'Reply-To', value: 'Sender <sender@example.com>' },
            { name: 'To', value: 'Ada <ada@example.com>, Other <other@example.com>' },
            { name: 'Cc', value: 'Copy <copy@example.com>' },
            { name: 'Subject', value: 'Hello' },
            { name: 'Message-ID', value: '<message-1@example.com>' },
          ],
        },
      }),
      jsonResponse({ id: 'sent-1' }),
    );
    const client = createGmailClient();

    await client.replyToMessage(accountId, {
      kind: 'replyAll',
      messageId: 'message-1',
      bodyHtml: '<p>Reply</p>',
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      raw: string;
      threadId: string;
    };
    const decoded = Buffer.from(body.raw, 'base64url')
      .toString('utf8')
      .replace(/\r\n[ \t]+/g, ' ');

    expect(body.threadId).toBe('thread-1');
    expect(decoded).toContain('To: Sender <sender@example.com>, Other <other@example.com>, Copy <copy@example.com>');
    expect(decoded).not.toContain('Ada <ada@example.com>');
  });

  it('keeps attachments whose filenames contain inline', async () => {
    mockFetch(jsonResponse({
      id: 'message-1',
      payload: {
        headers: [],
        parts: [
          {
            partId: '1',
            filename: 'inline-report.pdf',
            mimeType: 'application/pdf',
            headers: [
              {
                name: 'Content-Disposition',
                value: 'attachment; filename="inline-report.pdf"',
              },
            ],
            body: {
              attachmentId: 'attachment-1',
              size: 123,
            },
          },
        ],
      },
    }));
    const client = createGmailClient();

    const message = await client.getMessage(accountId, 'INBOX', 'message-1');

    expect(message.attachments).toEqual([
      {
        id: 'attachment-1',
        name: 'inline-report.pdf',
        contentType: 'application/pdf',
        size: 123,
        isInline: false,
      },
    ]);
  });

  it('downloads empty Gmail attachments', async () => {
    mockFetch(jsonResponse({
      id: 'message-1',
      payload: {
        parts: [
          {
            filename: 'empty.txt',
            mimeType: 'text/plain',
            body: {
              attachmentId: 'attachment-1',
              data: '',
              size: 0,
            },
          },
        ],
      },
    }));
    const client = createGmailClient();

    const attachment = await client.downloadAttachment(
      accountId,
      'message-1',
      'attachment-1',
    );

    expect(attachment).toMatchObject({
      name: 'empty.txt',
      contentType: 'text/plain',
    });
    expect(attachment.content).toHaveLength(0);
  });
});

function createGmailClient() {
  return new GmailClient({
    id: 'google',
    displayName: 'Google',
    getConfigurationError: vi.fn(),
    getAccounts: vi.fn().mockResolvedValue([
      {
        id: accountId,
        providerId: 'google',
        providerAccountId: 'account-1',
        email: 'ada@example.com',
        label: 'Ada',
      },
    ]),
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
