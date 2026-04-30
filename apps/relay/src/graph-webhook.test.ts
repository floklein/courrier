import { describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { InMemoryRelayStore } from './store';

const config = {
  HOST: '127.0.0.1',
  PORT: 3001,
  RELAY_ADMIN_TOKEN: 'admin-token-with-enough-length',
  RELAY_PUBLIC_URL: 'https://relay.example.com',
};

describe('Graph webhook routes', () => {
  it('responds to Microsoft Graph validation tokens as plain text', async () => {
    const server = buildServer({ config, logger: false });

    const response = await server.inject({
      method: 'POST',
      url: '/graph/notifications?validationToken=hello%20graph',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('hello graph');
  });

  it('stores matching Graph notifications as mail change events', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store, logger: false });

    await store.upsertSubscription({
      clientId: 'desktop-1',
      clientState: 'client-state-with-enough-length',
      authToken: 'auth-token-with-enough-length',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/graph/notifications',
      payload: {
        value: [
          {
            subscriptionId: 'subscription-1',
            clientState: 'client-state-with-enough-length',
            changeType: 'created',
            resource: "Users('user')/messages('message-1')",
            resourceData: { id: 'message-1' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    await expect(store.listEventsAfter('desktop-1')).resolves.toMatchObject([
      {
        clientId: 'desktop-1',
        subscriptionId: 'subscription-1',
        changeType: 'created',
        messageId: 'message-1',
      },
    ]);
  });

  it('delivers Graph notifications to registered WebSocket clients', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store, logger: false });

    await store.upsertSubscription({
      clientId: 'desktop-1',
      clientState: 'client-state-with-enough-length',
      authToken: 'auth-token-with-enough-length',
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
      }),
    );
    await waitFor(() => messages.length === 1);

    const response = await server.inject({
      method: 'POST',
      url: '/graph/notifications',
      payload: {
        value: [
          {
            subscriptionId: 'subscription-1',
            clientState: 'client-state-with-enough-length',
            changeType: 'created',
            resourceData: { id: 'message-1' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    await waitFor(() => messages.length === 2);
    expect(JSON.parse(messages[1])).toMatchObject({
      type: 'mail-change',
      event: {
        clientId: 'desktop-1',
        subscriptionId: 'subscription-1',
        changeType: 'created',
        messageId: 'message-1',
      },
    });

    socket.close();
    await server.close();
  });

  it('forwards Graph lifecycle notifications as mail change events', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store, logger: false });

    await store.upsertSubscription({
      clientId: 'desktop-1',
      clientState: 'client-state-with-enough-length',
      authToken: 'auth-token-with-enough-length',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/graph/notifications',
      payload: {
        value: [
          {
            subscriptionId: 'subscription-1',
            clientState: 'client-state-with-enough-length',
            lifecycleEvent: 'subscriptionRemoved',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    await expect(store.listEventsAfter('desktop-1')).resolves.toMatchObject([
      {
        clientId: 'desktop-1',
        subscriptionId: 'subscription-1',
        changeType: 'subscriptionRemoved',
      },
    ]);
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
