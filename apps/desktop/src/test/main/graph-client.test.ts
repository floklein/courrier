import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../main/auth-service';
import { GraphClient, getValidatedMessagePageUrl } from '../../main/graph-client';

const graphBaseUrl = 'https://graph.microsoft.com/v1.0';

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
    ).toThrow('Refusing to fetch an unexpected Microsoft Graph page URL.');
  });

  it('rejects next links for a different folder', () => {
    expect(() =>
      getValidatedMessagePageUrl(
        'inbox',
        'https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages?$top=25',
      ),
    ).toThrow('Refusing to fetch an unexpected Microsoft Graph page URL.');
  });
});

describe('GraphClient write requests', () => {
  it('creates a mailbox message subscription with lifecycle notifications', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        id: 'subscription-1',
        expirationDateTime: '2026-04-29T12:00:00.000Z',
        resource: '/me/messages',
      }, 201),
    );
    const client = createGraphClient();

    const subscription = await client.createMailSubscription({
      clientState: 'client-state',
      expirationDateTime: '2026-04-29T12:00:00.000Z',
      notificationUrl: 'https://relay.example.com/graph/notifications',
    });

    expect(subscription).toEqual({
      id: 'subscription-1',
      expirationDateTime: '2026-04-29T12:00:00.000Z',
      resource: '/me/messages',
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
        resource: '/me/messages',
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

    await client.sendMessage({
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

  it('creates, updates, and sends a reply draft in order', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ id: 'draft-1' }),
      new Response(null, { status: 204 }),
      new Response('', { status: 202 }),
    );
    const client = createGraphClient();

    await client.replyToMessage({
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

  it('does not update or send a reply draft when Graph omits the draft id', async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    const client = createGraphClient();

    await expect(
      client.replyToMessage({
        messageId: 'message-1',
        bodyHtml: '<p>Reply</p>',
      }),
    ).rejects.toThrow('Microsoft Graph did not return a reply draft ID.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes Graph response status and body when a write request fails', async () => {
    mockFetch(new Response('invalid request', { status: 400 }));
    const client = createGraphClient();

    await expect(client.markMessageReadState('message-1', true)).rejects.toThrow(
      'Microsoft Graph request failed: 400 invalid request',
    );
  });
});

function createGraphClient() {
  return new GraphClient({
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
  } as unknown as AuthService);
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
