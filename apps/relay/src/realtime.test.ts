import { describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { InMemoryRelayStore } from './store';

const config = {
  HOST: '127.0.0.1',
  PORT: 3001,
  RELAY_ADMIN_TOKEN: 'admin-token-with-enough-length',
  RELAY_PUBLIC_URL: 'https://relay.example.com',
  RELAY_SHARED_SECRET: 'shared-secret-with-enough-length',
};

describe('RealtimeHub', () => {
  it('replays events after the last acknowledged event', async () => {
    const store = new InMemoryRelayStore();
    const server = buildServer({ config, store });

    await store.appendEvent({
      id: 'event-1',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      changeType: 'created',
      receivedAt: new Date().toISOString(),
    });
    await store.appendEvent({
      id: 'event-2',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      changeType: 'updated',
      receivedAt: new Date().toISOString(),
    });

    await store.acknowledgeEvent('desktop-1', 'event-1');

    await expect(store.listEventsAfter('desktop-1')).resolves.toMatchObject([
      { id: 'event-2' },
    ]);

    await server.close();
  });
});
