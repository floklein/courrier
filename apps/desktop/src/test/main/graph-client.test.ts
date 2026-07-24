import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GraphClient,
  getValidatedGlobalMessagePageUrl,
  getValidatedMessagePageUrl,
} from '@/main/graph-client';
import type { MailAccount } from '@/lib/mail-types';
import {
  GraphRequestError,
  isGraphItemNotFoundError,
} from '@/lib/graph-errors';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const graphBaseUrl = 'https://graph.microsoft.com/v1.0';
const account: MailAccount = {
  id: 'microsoft:account-1',
  providerId: 'microsoft',
  providerAccountId: 'account-1',
  email: 'ada@example.com',
  label: 'Ada',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Graph message pagination URL validation', () => {
  it('accepts next links for the selected folder messages collection', () => {
    const folderId = 'AAMkAGI2T/abc+def=';
    const nextLink =
      'https://graph.microsoft.com/v1.0/me/mailFolders/AAMkAGI2T%2Fabc%2Bdef%3D/messages?$top=25&$skiptoken=next';

    expect(getValidatedMessagePageUrl(folderId, nextLink)).toBe(nextLink);
  });

  it('rejects arbitrary Graph URLs from the renderer', () => {
    expect(() =>
      getValidatedMessagePageUrl(
        'inbox',
        'https://graph.microsoft.com/v1.0/me/messages?$top=25',
      ),
    ).toThrow(/^Refusing to fetch an unexpected Microsoft Graph page URL/);
  });

  it('rejects next links for a different folder', () => {
    expect(() =>
      getValidatedMessagePageUrl(
        'inbox',
        'https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages?$top=25',
      ),
    ).toThrow(/^Refusing to fetch an unexpected Microsoft Graph page URL/);
  });

  it('accepts only the global messages collection for global search pages', () => {
    const nextLink =
      'https://graph.microsoft.com/v1.0/me/messages?$top=25&$skiptoken=next';

    expect(getValidatedGlobalMessagePageUrl(nextLink)).toBe(nextLink);
    expect(() =>
      getValidatedGlobalMessagePageUrl(
        'https://graph.microsoft.com/v1.0/me/messages/message-1/attachments',
      ),
    ).toThrow(/^Refusing to fetch an unexpected Microsoft Graph page URL/);
  });
});

describe('GraphClient write requests', () => {
  it('creates a mailbox message subscription with lifecycle notifications', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: 'subscription-1',
        expirationDateTime: '2026-04-29T12:00:00.000Z',
        resource: 'me/messages',
      }, 201),
    );
    const client = createGraphClient();

    const subscription = await client.createMailSubscription({
      account,
      clientState: 'client-state',
      expirationDateTime: '2026-04-29T12:00:00.000Z',
      notificationUrl: 'https://relay.example.com/graph/notifications',
    });

    expect(subscription).toEqual({
      id: 'subscription-1',
      expirationDateTime: '2026-04-29T12:00:00.000Z',
      resource: 'me/messages',
    });
    expect(fetchMock).toHaveBeenCalledWith(`${graphBaseUrl}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: 'https://relay.example.com/graph/notifications',
        lifecycleNotificationUrl: 'https://relay.example.com/graph/notifications',
        resource: 'me/messages',
        expirationDateTime: '2026-04-29T12:00:00.000Z',
        clientState: 'client-state',
      }),
    });
  });

  it('renews a subscription expiration', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: 'subscription-1',
        expirationDateTime: '2026-04-29T12:00:00.000Z',
        resource: '/me/messages',
      }, 200),
    );
    const client = createGraphClient();

    await client.renewSubscription({
      account,
      subscriptionId: 'subscription-1',
      expirationDateTime: '2026-04-29T12:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${graphBaseUrl}/subscriptions/subscription-1`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expirationDateTime: '2026-04-29T12:00:00.000Z',
        }),
      },
    );
  });

  it('sends HTML mail through Microsoft Graph with bearer auth', async () => {
    const fetchMock = mockFetch(new Response('', { status: 202 }));
    const client = createGraphClient();

    await client.sendMessage(account.id, {
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      toRecipients: [
        { email: 'ada@example.com' },
        { name: 'Grace Hopper', email: 'grace@example.com' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${graphBaseUrl}/me/sendMail`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      message: {
        subject: 'Hello',
        body: {
          contentType: 'HTML',
          content: '<p>Hi</p>',
        },
        toRecipients: [
          {
            emailAddress: {
              name: 'ada@example.com',
              address: 'ada@example.com',
            },
          },
          {
            emailAddress: {
              name: 'Grace Hopper',
              address: 'grace@example.com',
            },
          },
        ],
      },
      saveToSentItems: true,
    });
  });

  it('includes Cc and Bcc recipients in Microsoft Graph send payloads', async () => {
    const fetchMock = mockFetch(new Response('', { status: 202 }));
    const client = createGraphClient();

    await client.sendMessage(account.id, {
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      toRecipients: [{ email: 'ada@example.com' }],
      ccRecipients: [{ email: 'grace@example.com' }],
      bccRecipients: [{ email: 'hidden@example.com' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.message.ccRecipients).toEqual([
      {
        emailAddress: {
          name: 'grace@example.com',
          address: 'grace@example.com',
        },
      },
    ]);
    expect(body.message.bccRecipients).toEqual([
      {
        emailAddress: {
          name: 'hidden@example.com',
          address: 'hidden@example.com',
        },
      },
    ]);
  });

  it('uploads large attachments with Graph upload-session byte ranges', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'courrier-test-'));
    const filePath = path.join(tempDir, 'large.bin');
    const content = Buffer.alloc((327_680 * 12) + 1);
    await fs.writeFile(filePath, content);
    const fetchMock = mockFetch(
      jsonResponse({ id: 'draft-1' }),
      jsonResponse({ uploadUrl: `${graphBaseUrl}/upload-session` }),
      new Response('', { status: 202 }),
      new Response('', { status: 201 }),
      new Response('', { status: 202 }),
    );
    const client = createGraphClient();

    try {
      await client.sendMessage(account.id, {
        subject: 'Hello',
        bodyHtml: '<p>Hi</p>',
        toRecipients: [{ email: 'ada@example.com' }],
        attachments: [
          {
            id: 'attachment-1',
            name: 'large.bin',
            contentType: 'application/octet-stream',
            size: content.byteLength,
            path: filePath,
          },
        ],
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    expect(fetchMock.mock.calls[2][0]).toBe(`${graphBaseUrl}/upload-session`);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(327_680 * 12),
        'Content-Range': `bytes 0-${(327_680 * 12) - 1}/${content.byteLength}`,
      },
    });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '1',
        'Content-Range': `bytes ${327_680 * 12}-${327_680 * 12}/${content.byteLength}`,
      },
    });
  });

  it('downloads empty Microsoft Graph file attachments', async () => {
    mockFetch(jsonResponse({
      '@odata.type': '#microsoft.graph.fileAttachment',
      id: 'attachment-1',
      name: 'empty.txt',
      contentType: 'text/plain',
      contentBytes: '',
    }));
    const client = createGraphClient();

    const attachment = await client.downloadAttachment(
      account.id,
      'message-1',
      'attachment-1',
    );

    expect(attachment).toMatchObject({
      name: 'empty.txt',
      contentType: 'text/plain',
    });
    expect(attachment.content).toHaveLength(0);
  });

  it('rejects unsupported Microsoft Graph attachment types', async () => {
    mockFetch(jsonResponse({
      '@odata.type': '#microsoft.graph.itemAttachment',
      id: 'attachment-1',
      name: 'forwarded-message',
    }));
    const client = createGraphClient();

    await expect(
      client.downloadAttachment(account.id, 'message-1', 'attachment-1'),
    ).rejects.toThrow('Microsoft Graph attachment type is not supported.');
  });

  it('creates, updates, and sends a reply draft in order', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'draft-1' }),
      new Response(null, { status: 204 }),
      new Response('', { status: 202 }),
    );
    const client = createGraphClient();

    await client.replyToMessage(account.id, {
      messageId: 'message-1',
      bodyHtml: '<p>Reply</p>',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${graphBaseUrl}/me/messages/message-1/createReply`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${graphBaseUrl}/me/messages/draft-1`,
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      body: {
        contentType: 'HTML',
        content: '<p>Reply</p>',
      },
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      `${graphBaseUrl}/me/messages/draft-1/send`,
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });

  it('uses Graph reply-all and forward draft actions', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'reply-all-draft' }),
      new Response(null, { status: 204 }),
      new Response('', { status: 202 }),
      jsonResponse({
        id: 'forward-draft',
        body: {
          contentType: 'html',
          content: '<div>Forwarded header</div><p>Original body</p>',
        },
      }),
      new Response(null, { status: 204 }),
      new Response('', { status: 202 }),
    );
    const client = createGraphClient();

    await client.replyToMessage(account.id, {
      kind: 'replyAll',
      messageId: 'message-1',
      bodyHtml: '<p>Reply</p>',
    });
    await client.replyToMessage(account.id, {
      kind: 'forward',
      messageId: 'message-1',
      bodyHtml: '<p>Forward</p>',
      toRecipients: [{ email: 'ada@example.com' }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${graphBaseUrl}/me/messages/message-1/createReplyAll`,
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      `${graphBaseUrl}/me/messages/message-1/createForward`,
    );
    expect(JSON.parse(fetchMock.mock.calls[4][1]?.body as string)).toMatchObject({
      toRecipients: [
        {
          emailAddress: {
            name: 'ada@example.com',
            address: 'ada@example.com',
          },
        },
      ],
      body: {
        contentType: 'HTML',
        content:
          '<p>Forward</p><br><br><div>Forwarded header</div><p>Original body</p>',
      },
    });
  });

  it('does not update or send a reply draft when Graph omits the draft id', async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    const client = createGraphClient();

    await expect(
      client.replyToMessage(account.id, {
        messageId: 'message-1',
        bodyHtml: '<p>Reply</p>',
      }),
    ).rejects.toThrow('Microsoft Graph did not return a reply draft ID.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes Graph response status and body when a write request fails', async () => {
    mockFetch(new Response('invalid request', { status: 400 }));
    const client = createGraphClient();

    await expect(
      client.markMessageReadState(account.id, 'message-1', true),
    ).rejects.toThrow(
      'Microsoft Graph request failed: 400 invalid request',
    );
  });

  it('marks messages unread through Microsoft Graph', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const client = createGraphClient();

    await client.markMessageReadState(account.id, 'message-1', false);

    expect(fetchMock).toHaveBeenCalledWith(
      `${graphBaseUrl}/me/messages/message-1`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: false }),
      },
    );
  });

  it('archives and marks messages as junk through Microsoft Graph moves', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'message-1' }),
      jsonResponse({ id: 'message-1' }),
    );
    const client = createGraphClient();

    await client.archiveMessage(account.id, 'message-1', 'inbox');
    await client.markMessageJunkState(account.id, 'message-1', true);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${graphBaseUrl}/me/messages/message-1/move`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      destinationId: 'archive',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      destinationId: 'junkemail',
    });
  });

  it('patches Graph flag and importance state', async () => {
    const fetchMock = mockFetch(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );
    const client = createGraphClient();

    await client.setMessageFlagState(account.id, 'message-1', true);
    await client.setMessageImportantState(account.id, 'message-1', false);

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      flag: { flagStatus: 'flagged' },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      importance: 'normal',
    });
  });

  it('searches all Microsoft Graph messages without a folder path', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        value: [
          {
            id: 'message-1',
            parentFolderId: 'archive-id',
            subject: 'Hello',
            from: { emailAddress: { name: 'Ada', address: 'ada@example.com' } },
          },
        ],
      }),
      jsonResponse({ value: [] }),
      ...Array.from({ length: 6 }, () => jsonResponse({}, 404)),
    );
    const client = createGraphClient();

    const result = await client.searchMessages(account.id, {
      query: 'hello',
      scope: 'all',
    });

    expect(fetchMock.mock.calls[0][0]).toContain(`${graphBaseUrl}/me/messages?`);
    expect(fetchMock.mock.calls[0][0]).toContain('%22hello%22');
    expect(fetchMock.mock.calls[0][0]).toContain('parentFolderId');
    expect(result.messages[0]).toMatchObject({
      id: 'message-1',
      folderId: 'archive-id',
      sender: { name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('throws structured Graph errors with Microsoft error codes', async () => {
    mockFetch(
      jsonResponse({
        error: {
          code: 'ErrorItemNotFound',
          message: 'The specified object was not found in the store.',
        },
      }, 404),
    );
    const client = createGraphClient();

    const error = await client
      .markMessageReadState(account.id, 'message-1', true)
      .catch((candidate: unknown) => candidate);

    expect(error).toBeInstanceOf(GraphRequestError);
    expect(error).toMatchObject({
      status: 404,
      code: 'ErrorItemNotFound',
    });
    expect(isGraphItemNotFoundError(error)).toBe(true);
  });

  it('resolves unread inbox creations for native notifications', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/messages/message-1?')) {
        return jsonResponse({
          id: 'message-1',
          parentFolderId: 'inbox-folder',
          subject: 'Hello',
          bodyPreview: 'Preview',
          receivedDateTime: '2026-05-16T10:00:00.000Z',
          isRead: false,
          hasAttachments: false,
          importance: 'normal',
          from: {
            emailAddress: {
              name: 'Ada Lovelace',
              address: 'ada@example.com',
            },
          },
          toRecipients: [],
        });
      }

      if (url.includes('/me/mailFolders?$top=100')) {
        return jsonResponse({
          value: [
            {
              id: 'inbox-folder',
              displayName: 'Inbox',
              unreadItemCount: 1,
              totalItemCount: 1,
            },
          ],
        });
      }

      if (url.includes('/me/mailFolders/inbox?')) {
        return jsonResponse({
          id: 'inbox-folder',
          displayName: 'Inbox',
          wellKnownName: 'inbox',
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createGraphClient();

    const resolution = await client.getNotificationMessages(account.id, {
      id: 'event-1',
      clientId: 'client-1',
      accountId: account.id,
      providerId: 'microsoft',
      subscriptionId: 'subscription-1',
      kind: 'message-change',
      changeType: 'created',
      messageId: 'message-1',
      receivedAt: '2026-05-16T10:00:00.000Z',
    });

    expect(resolution.messages).toMatchObject([
      {
        id: 'message-1',
        folderId: 'inbox-folder',
        sender: { name: 'Ada Lovelace', email: 'ada@example.com' },
        subject: 'Hello',
        isRead: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.includes('/me/mailFolders?$top=100'),
      ),
    ).toBe(false);
  });

  it('does not notify for Graph changes outside inbox or already read messages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/messages/message-1?')) {
        return jsonResponse({
          id: 'message-1',
          parentFolderId: 'archive-folder',
          subject: 'Hello',
          isRead: false,
        });
      }

      if (url.includes('/me/mailFolders?$top=100')) {
        return jsonResponse({
          value: [
            { id: 'archive-folder', displayName: 'Archive' },
            { id: 'inbox-folder', displayName: 'Inbox' },
          ],
        });
      }

      if (url.includes('/me/mailFolders/inbox?')) {
        return jsonResponse({
          id: 'inbox-folder',
          displayName: 'Inbox',
          wellKnownName: 'inbox',
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createGraphClient();

    await expect(
      client.getNotificationMessages(account.id, {
        id: 'event-1',
        clientId: 'client-1',
        accountId: account.id,
        providerId: 'microsoft',
        subscriptionId: 'subscription-1',
        kind: 'message-change',
        changeType: 'created',
        messageId: 'message-1',
        receivedAt: '2026-05-16T10:00:00.000Z',
      }),
    ).resolves.toEqual({ messages: [] });
  });

  it('does not notify for a read message in the Graph inbox', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/messages/message-1?')) {
        return jsonResponse({
          id: 'message-1',
          parentFolderId: 'inbox-folder',
          subject: 'Already read',
          isRead: true,
        });
      }

      if (url.includes('/me/mailFolders/inbox?')) {
        return jsonResponse({ id: 'inbox-folder' });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createGraphClient();

    await expect(
      client.getNotificationMessages(account.id, {
        id: 'event-2',
        clientId: 'client-1',
        accountId: account.id,
        providerId: 'microsoft',
        subscriptionId: 'subscription-1',
        kind: 'message-change',
        changeType: 'created',
        messageId: 'message-1',
        receivedAt: '2026-05-16T10:01:00.000Z',
      }),
    ).resolves.toEqual({ messages: [] });
  });
});

function createGraphClient() {
  return new GraphClient({
    id: 'microsoft',
    displayName: 'Microsoft',
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
