import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { pathToFileURL } from 'node:url';
import { loadConfig, type RelayConfig } from './config.js';
import { registerGraphWebhookRoutes } from './graph-webhook.js';
import { RealtimeHub } from './realtime.js';
import { InMemoryRelayStore, type RelayStore } from './store.js';

export interface BuildServerOptions {
  config: RelayConfig;
  store?: RelayStore;
}

export function buildServer({ config, store = new InMemoryRelayStore() }: BuildServerOptions) {
  const fastify = Fastify({ logger: true });
  const realtime = new RealtimeHub(store);

  fastify.register(websocket);
  fastify.register(async (websocketFastify) => {
    realtime.registerRoutes(websocketFastify);
  });

  fastify.get('/health', async () => ({ ok: true }));
  registerGraphWebhookRoutes({ config, fastify, realtime, store });

  return fastify;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({ host: config.HOST, port: config.PORT });
}
