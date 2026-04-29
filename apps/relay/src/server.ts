import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { loadConfig, type RelayConfig } from './config';
import { registerGraphWebhookRoutes } from './graph-webhook';
import { RealtimeHub } from './realtime';
import { InMemoryRelayStore, type RelayStore } from './store';

export interface BuildServerOptions {
  config: RelayConfig;
  store?: RelayStore;
}

export function buildServer({ config, store = new InMemoryRelayStore() }: BuildServerOptions) {
  const fastify = Fastify({ logger: true });
  const realtime = new RealtimeHub(store);

  fastify.register(websocket);

  fastify.get('/health', async () => ({ ok: true }));
  registerGraphWebhookRoutes({ config, fastify, realtime, store });
  realtime.registerRoutes(fastify);

  return fastify;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({ host: config.HOST, port: config.PORT });
}
