import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rendererSend = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'test-user-data') },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: rendererSend } }]),
  },
}));

import {
  createGraphNotificationUrl,
  createSubscriptionExpiration,
  getRenewalDelayMs,
  MailSubscriptionManager,
} from '../../main/mail-subscription-manager';

const originalWebSocket = globalThis.WebSocket;
let statePath: string;
let managers: MailSubscriptionManager[] = [];

beforeEach(async () => {
  managers = [];
  MockWebSocket.instances = [];
  rendererSend.mockClear();
  vi.restoreAllMocks();
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 201 })));
  statePath = path.join(
    await fs.mkdtemp(path.join(tmpdir(), 'courrier-subscription-test-')),
    'mail-subscription.json',
  );
});

afterEach(async () => {
  await Promise.all(managers.map((manager) => manager.stop()));
  vi.useRealTimers();
  vi.stubGlobal('WebSocket', originalWebSocket);
  await fs.rm(path.dirname(statePath), { recursive: true, force: true });
});

describe('mail subscription manager helpers', () => {
  it('creates the Graph notification URL from the relay public URL', () => {
    expect(createGraphNotificationUrl('https://relay.example.com/')).toBe(
      'https://relay.example.com/graph/notifications',
    );
  });

  it('creates a future subscription expiration', () => {
    expect(createSubscriptionExpiration(new Date('2026-04-29T10:00:00.000Z'))).toBe(
      '2026-04-30T10:00:00.000Z',
    );
  });

  it('renews one hour before expiration with a minimum one minute delay', () => {
    expect(
      getRenewalDelayMs(
        '2026-04-29T12:00:00.000Z',
        new Date('2026-04-29T10:00:00.000Z'),
      ),
    ).toBe(60 * 60 * 1000);

    expect(
      getRenewalDelayMs(
        '2026-04-29T10:30:00.000Z',
        new Date('2026-04-29T10:00:00.000Z'),
      ),
    ).toBe(60 * 1000);
  });
});

describe('MailSubscriptionManager', () => {
  it('creates a subscription, registers with the relay, receives mail changes, and acknowledges them', async () => {
    const graphClient = createGraphClient();
    const manager = createManager(graphClient);

    await manager.start();
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive({
      type: 'mail-change',
      event: {
        id: 'event-1',
        clientId: 'client-1',
        subscriptionId: 'subscription-1',
        kind: 'message-change',
        changeType: 'created',
        messageId: 'message-1',
        receivedAt: '2026-04-29T10:00:00.000Z',
      },
    });

    await waitFor(() => rendererSend.mock.calls.length === 1);

    expect(graphClient.createMailSubscription).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      new URL('/relay/subscriptions', 'https://relay.example.com'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(MockWebSocket.instances[0].sent).toContainEqual({
      type: 'register',
      clientId: expect.any(String),
      token: expect.any(String),
    });
    expect(rendererSend).toHaveBeenCalledWith(
      'mail:remote-change',
      expect.objectContaining({ id: 'event-1', messageId: 'message-1' }),
    );
    await waitFor(() =>
      MockWebSocket.instances[0].sent.some(
        (message) =>
          isRecord(message) &&
          message.type === 'ack' &&
          message.eventId === 'event-1',
      ),
    );
    expect(MockWebSocket.instances[0].sent).toContainEqual({
      type: 'ack',
      eventId: 'event-1',
    });
  });

  it('closes the previous WebSocket when start runs again for renewal', async () => {
    const manager = createManager(createGraphClient());

    await manager.start();
    const firstSocket = MockWebSocket.instances[0];

    await manager.start();

    expect(firstSocket.wasClosed).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('creates a fresh subscription when saved subscription state is expired', async () => {
    await fs.writeFile(
      statePath,
      JSON.stringify({
        clientId: 'client-1',
        clientState: 'client-state-with-enough-length',
        authToken: 'auth-token-with-enough-length',
        subscriptionId: 'expired-subscription',
        expirationDateTime: '2000-01-01T00:00:00.000Z',
      }),
    );
    const graphClient = createGraphClient();
    const manager = createManager(graphClient);

    await manager.start();

    expect(graphClient.renewSubscription).not.toHaveBeenCalled();
    expect(graphClient.createMailSubscription).toHaveBeenCalledTimes(1);
  });

  it('falls back to creating a subscription when Graph rejects renewal as gone', async () => {
    const futureExpiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      statePath,
      JSON.stringify({
        clientId: 'client-1',
        clientState: 'client-state-with-enough-length',
        authToken: 'auth-token-with-enough-length',
        subscriptionId: 'deleted-subscription',
        expirationDateTime: futureExpiration,
      }),
    );
    const graphClient = createGraphClient();
    graphClient.renewSubscription.mockRejectedValue(
      new Error('Microsoft Graph request failed: 404 not found'),
    );
    const manager = createManager(graphClient);

    await manager.start();

    expect(graphClient.renewSubscription).toHaveBeenCalledTimes(1);
    expect(graphClient.createMailSubscription).toHaveBeenCalledTimes(1);
  });

  it('reconnects and re-registers when the WebSocket closes', async () => {
    const manager = createManager(createGraphClient());

    await manager.start();
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].closeFromServer();
    await waitFor(() => MockWebSocket.instances.length === 2);
    MockWebSocket.instances[1].open();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].sent).toContainEqual({
      type: 'register',
      clientId: expect.any(String),
      token: expect.any(String),
    });
  });

  it('creates a replacement subscription after Graph reports subscription removal', async () => {
    const graphClient = createGraphClient();
    const manager = createManager(graphClient);

    await manager.start();
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive({
      type: 'mail-change',
      event: {
        id: 'event-removed',
        clientId: 'client-1',
        subscriptionId: 'subscription-1',
        kind: 'lifecycle',
        changeType: 'subscriptionRemoved',
        receivedAt: '2026-04-29T10:00:00.000Z',
      },
    });

    await waitFor(() => graphClient.createMailSubscription.mock.calls.length === 2);

    expect(graphClient.renewSubscription).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent starts so only one socket and Graph subscription are created', async () => {
    const graphClient = createGraphClient();
    const manager = createManager(graphClient);

    await Promise.all([manager.start(), manager.start()]);

    expect(graphClient.createMailSubscription).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

function createManager(graphClient = createGraphClient()) {
  const manager = new MailSubscriptionManager({
    graphClient: graphClient as never,
    relayAdminToken: 'admin-token-with-enough-length',
    relayPublicUrl: 'https://relay.example.com',
    reconnectDelayMs: 1,
    statePath,
  });
  managers.push(manager);
  return manager;
}

function createGraphClient() {
  return {
    createMailSubscription: vi.fn().mockResolvedValue({
      id: 'subscription-1',
      expirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    renewSubscription: vi.fn().mockResolvedValue({
      id: 'subscription-1',
      expirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  };
}

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  readonly sent: unknown[] = [];
  wasClosed = false;

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    this.wasClosed = true;
    this.dispatchEvent(new Event('close'));
  }

  open() {
    this.dispatchEvent(new Event('open'));
  }

  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  closeFromServer() {
    this.dispatchEvent(new Event('close'));
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Timed out waiting for condition.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
