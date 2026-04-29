import {
  relayClientMessageSchema,
  relayServerMessageSchema,
  type MailRemoteChangeEvent,
  type RelayServerMessage,
} from '@courrier/mail-contracts';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { RelayStore } from './store';

export class RealtimeHub {
  private readonly socketsByClientId = new Map<string, Set<WebSocket>>();

  constructor(private readonly store: RelayStore) {}

  registerRoutes(fastify: FastifyInstance) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      let clientId: string | undefined;

      socket.on('message', async (rawMessage) => {
        const result = relayClientMessageSchema.safeParse(
          parseSocketMessage(rawMessage),
        );

        if (!result.success) {
          sendSocketMessage(socket, {
            type: 'error',
            message: 'Invalid relay client message',
          });
          return;
        }

        if (result.data.type === 'register') {
          const subscription = await this.store.getSubscriptionByClientId(
            result.data.clientId,
          );

          if (!subscription || subscription.authToken !== result.data.token) {
            sendSocketMessage(socket, {
              type: 'error',
              message: 'Relay registration failed',
            });
            socket.close();
            return;
          }

          clientId = result.data.clientId;
          this.addSocket(clientId, socket);
          sendSocketMessage(socket, { type: 'ready', clientId });

          const missedEvents = await this.store.listEventsAfter(
            clientId,
            result.data.lastEventId,
          );

          for (const event of missedEvents) {
            sendSocketMessage(socket, { type: 'mail-change', event });
          }
          return;
        }

        if (!clientId) {
          sendSocketMessage(socket, {
            type: 'error',
            message: 'Relay client must register before acknowledging events',
          });
          return;
        }

        await this.store.acknowledgeEvent(clientId, result.data.eventId);
      });

      socket.on('close', () => {
        if (clientId) {
          this.removeSocket(clientId, socket);
        }
      });
    });
  }

  sendMailChange(event: MailRemoteChangeEvent) {
    const sockets = this.socketsByClientId.get(event.clientId);

    if (!sockets) {
      return;
    }

    for (const socket of sockets) {
      sendSocketMessage(socket, { type: 'mail-change', event });
    }
  }

  private addSocket(clientId: string, socket: WebSocket) {
    const sockets = this.socketsByClientId.get(clientId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.socketsByClientId.set(clientId, sockets);
  }

  private removeSocket(clientId: string, socket: WebSocket) {
    const sockets = this.socketsByClientId.get(clientId);

    if (!sockets) {
      return;
    }

    sockets.delete(socket);

    if (sockets.size === 0) {
      this.socketsByClientId.delete(clientId);
    }
  }
}

function parseSocketMessage(rawMessage: Buffer | ArrayBuffer | Buffer[]) {
  const text = Array.isArray(rawMessage)
    ? Buffer.concat(rawMessage).toString('utf8')
    : rawMessage instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(rawMessage)).toString('utf8')
      : Buffer.from(rawMessage).toString('utf8');

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function sendSocketMessage(
  socket: WebSocket,
  message: RelayServerMessage,
) {
  const parsedMessage = relayServerMessageSchema.parse(message);
  socket.send(JSON.stringify(parsedMessage));
}
