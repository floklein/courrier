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

  it('creates and sends Gmail provider drafts', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: 'draft-1',
        message: {
          id: 'message-1',
          snippet: 'Hello',
          payload: {
            headers: [
              { name: 'To', value: 'ada@example.com' },
              { name: 'Subject', value: 'Hello' },
              { name: 'Date', value: 'Sat, 16 May 2026 10:00:00 +0000' },
            ],
            body: {
              data: Buffer.from('<p>Hello</p>').toString('base64url'),
            },
            mimeType: 'text/html',
          },
        },
      }),
      jsonResponse({ id: 'sent-1' }),
    );
    const client = createGmailClient();

    const draft = await client.createDraft(accountId, {
      kind: 'new',
      toRecipients: [{ email: 'ada@example.com' }],
      toValue: 'ada@example.com',
      subject: 'Hello',
      bodyHtml: '<p>Hello</p>',
      editorValue: { html: '<p>Hello</p>', text: 'Hello', isEmpty: false },
      attachments: [],
    });
    await client.sendDraft(accountId, draft.providerDraftId);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',
    );
    expect(draft).toMatchObject({
      providerDraftId: 'draft-1',
      providerDraftMessageId: 'message-1',
      toValue: 'ada@example.com',
      subject: 'Hello',
    });
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
