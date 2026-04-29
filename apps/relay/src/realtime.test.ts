import { describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { InMemoryRelayStore } from './store';

const config = {
  HOST: '127.0.0.1',
  PORT: 3001,
  RELAY_ADMIN_TOKEN: 'admin-token-with-enough-length',
  RELAY_PUBLIC_URL: 'https://relay.example.com',
};

describe('RealtimeHub', () => {
  it('accepts WebSocket registration after relay subscription registration', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store });

    await store.upsertSubscription({
      clientId: 'desktop-1',
      clientState: 'client-state-with-enough-length',
      authToken: 'auth-token-with-enough-length',
    });
    await server.ready();

    const socket = await server.injectWS('/ws');
    const messagePromise = new Promise<string>((resolve) => {
      socket.once('message', (message) => {
        resolve(message.toString());
      });
    });

    socket.send(
      JSON.stringify({
        type: 'register',
        clientId: 'desktop-1',
        token: 'auth-token-with-enough-length',
      }),
    );

    await expect(messagePromise).resolves.toBe(
      JSON.stringify({ type: 'ready', clientId: 'desktop-1' }),
    );

    socket.close();
    await server.close();
  });

  it('replays events after the last acknowledged event', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store });

    await store.upsertSubscription({
      clientId: 'desktop-1',
      clientState: 'client-state-with-enough-length',
      authToken: 'auth-token-with-enough-length',
    });
    await store.appendEvent({
      id: 'event-1',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      kind: 'message-change',
      changeType: 'created',
      receivedAt: new Date().toISOString(),
    });
    await store.appendEvent({
      id: 'event-2',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      kind: 'message-change',
      changeType: 'updated',
      receivedAt: new Date().toISOString(),
    });
    await server.ready();

    const socket = await server.injectWS('/ws');
    const messages: string[] = [];
    socket.on('message', (message) => {
      messages.push(message.toString());
    });

    socket.send(
      JSON.stringify({
        type: 'register',
        clientId: 'desktop-1',
        token: 'auth-token-with-enough-length',
        lastEventId: 'event-1',
      }),
    );

    await waitFor(() => messages.length === 2);

    expect(messages.map((message) => JSON.parse(message))).toMatchObject([
      { type: 'ready', clientId: 'desktop-1' },
      { type: 'mail-change', event: { id: 'event-2' } },
    ]);

    socket.send(JSON.stringify({ type: 'ack', eventId: 'event-2' }));
    await waitFor(async () => (await store.listEventsAfter('desktop-1')).length === 0);

    socket.close();
    await server.close();
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Timed out waiting for condition.');
}
