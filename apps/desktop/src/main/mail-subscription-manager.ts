import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import {
  relayServerMessageSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';
import type { GraphClient } from './graph-client';

const subscriptionStateFileName = 'mail-subscription.json';
const subscriptionDurationMs = 24 * 60 * 60 * 1000;
const renewalBufferMs = 60 * 60 * 1000;
const minimumRenewalDelayMs = 60 * 1000;
const reconnectDelayMs = 1000;

interface MailSubscriptionState {
  clientId: string;
  clientState: string;
  authToken: string;
  subscriptionId?: string;
  expirationDateTime?: string;
  lastEventId?: string;
}

interface MailSubscriptionManagerOptions {
  graphClient: GraphClient;
  relayAdminToken?: string;
  relayPublicUrl?: string;
  reconnectDelayMs?: number;
  statePath?: string;
}

export class MailSubscriptionManager {
  private renewalTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private webSocket: WebSocket | undefined;
  private isStopped = true;

  constructor(private readonly options: MailSubscriptionManagerOptions) {}

  async start() {
    if (!this.options.relayPublicUrl || !this.options.relayAdminToken) {
      return;
    }

    this.isStopped = false;
    const state = await this.loadState();
    const subscription = await this.ensureSubscription(state);

    state.subscriptionId = subscription.id;
    state.expirationDateTime = subscription.expirationDateTime;
    await this.saveState(state);
    await this.registerWithRelay(state);
    this.scheduleRenewal(state);
    this.connectWebSocket(state);
  }

  stop() {
    this.isStopped = true;
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const socket = this.webSocket;
    this.webSocket = undefined;
    socket?.close();
  }

  private async ensureSubscription(state: MailSubscriptionState) {
    if (
      state.subscriptionId &&
      state.expirationDateTime &&
      !isExpired(state.expirationDateTime)
    ) {
      try {
        return await this.options.graphClient.renewSubscription({
          subscriptionId: state.subscriptionId,
          expirationDateTime: createSubscriptionExpiration(),
        });
      } catch (error) {
        if (!isSubscriptionGoneError(error)) {
          throw error;
        }

        state.subscriptionId = undefined;
        state.expirationDateTime = undefined;
      }
    }

    return this.options.graphClient.createMailSubscription({
      clientState: state.clientState,
      expirationDateTime: createSubscriptionExpiration(),
      notificationUrl: createGraphNotificationUrl(this.options.relayPublicUrl ?? ''),
    });
  }

  private scheduleRenewal(state: MailSubscriptionState) {
    if (!state.expirationDateTime) {
      return;
    }

    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    this.renewalTimer = setTimeout(() => {
      void this.start().catch((error: unknown) => {
        console.warn('Mail subscription renewal failed.', error);
        this.scheduleRenewal(state);
      });
    }, getRenewalDelayMs(state.expirationDateTime));
  }

  private async registerWithRelay(state: MailSubscriptionState) {
    const relayUrl = new URL('/relay/subscriptions', this.options.relayPublicUrl);
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.relayAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: state.clientId,
        clientState: state.clientState,
        authToken: state.authToken,
        subscriptionId: state.subscriptionId,
        expirationDateTime: state.expirationDateTime,
      }),
    });

    if (!response.ok) {
      throw new Error(`Relay registration failed: ${response.status}`);
    }
  }

  private connectWebSocket(state: MailSubscriptionState) {
    const relayUrl = new URL('/ws', this.options.relayPublicUrl);
    relayUrl.protocol = relayUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const previousSocket = this.webSocket;
    const socket = new WebSocket(relayUrl);

    this.webSocket = socket;
    previousSocket?.close();
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'register',
          clientId: state.clientId,
          token: state.authToken,
          lastEventId: state.lastEventId,
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      void this.handleSocketMessage(state, event.data);
    });
    socket.addEventListener('error', () => {
      if (this.webSocket === socket) {
        socket.close();
      }
    });
    socket.addEventListener('close', () => {
      if (this.webSocket !== socket || this.isStopped) {
        return;
      }

      this.webSocket = undefined;
      this.scheduleReconnect();
    });
  }

  private async handleSocketMessage(state: MailSubscriptionState, data: unknown) {
    const result = relayServerMessageSchema.safeParse(parseSocketData(data));

    if (!result.success) {
      return;
    }

    if (result.data.type === 'error') {
      console.warn('Relay WebSocket error:', result.data.message);
      return;
    }

    if (result.data.type !== 'mail-change') {
      return;
    }

    state.lastEventId = result.data.event.id;
    await this.saveState(state);
    sendRemoteChangeToRenderers(result.data.event);
    this.webSocket?.send(
      JSON.stringify({ type: 'ack', eventId: result.data.event.id }),
    );

    await this.recoverFromLifecycleEvent(state, result.data.event.changeType);
  }

  private async loadState(): Promise<MailSubscriptionState> {
    try {
      return JSON.parse(await fs.readFile(this.getStatePath(), 'utf8'));
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      return {
        clientId: randomUUID(),
        clientState: randomSecret(),
        authToken: randomSecret(),
      };
    }
  }

  private async saveState(state: MailSubscriptionState) {
    const statePath = this.getStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }

  private getStatePath() {
    return (
      this.options.statePath ??
      path.join(app.getPath('userData'), subscriptionStateFileName)
    );
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isStopped) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, this.options.reconnectDelayMs ?? reconnectDelayMs);
  }

  private async reconnect() {
    if (this.isStopped) {
      return;
    }

    try {
      const state = await this.loadState();
      await this.registerWithRelay(state);
      this.connectWebSocket(state);
    } catch (error) {
      console.warn('Relay WebSocket reconnect failed.', error);
      this.scheduleReconnect();
    }
  }

  private async recoverFromLifecycleEvent(
    state: MailSubscriptionState,
    changeType: MailRemoteChangeEvent['changeType'],
  ) {
    try {
      if (changeType === 'subscriptionRemoved') {
        state.subscriptionId = undefined;
        state.expirationDateTime = undefined;
        await this.saveState(state);
        await this.start();
        return;
      }

      if (changeType === 'reauthorizationRequired') {
        await this.start();
      }
    } catch (error) {
      console.warn('Mail subscription lifecycle recovery failed.', error);
    }
  }
}

export function createGraphNotificationUrl(relayPublicUrl: string) {
  return new URL('/graph/notifications', relayPublicUrl).toString();
}

export function createSubscriptionExpiration(now = new Date()) {
  return new Date(now.getTime() + subscriptionDurationMs).toISOString();
}

export function getRenewalDelayMs(expirationDateTime: string, now = new Date()) {
  const expiration = new Date(expirationDateTime).getTime();
  const renewalAt = expiration - renewalBufferMs;
  return Math.max(renewalAt - now.getTime(), minimumRenewalDelayMs);
}

function sendRemoteChangeToRenderers(event: MailRemoteChangeEvent) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('mail:remote-change', event);
  });
}

function parseSocketData(data: unknown) {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data) as unknown;
    }

    if (data instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(new Uint8Array(data)).toString('utf8')) as unknown;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function randomSecret() {
  return randomBytes(32).toString('base64url');
}

function isExpired(expirationDateTime: string, now = new Date()) {
  return new Date(expirationDateTime).getTime() <= now.getTime();
}

function isSubscriptionGoneError(error: unknown) {
  return (
    error instanceof Error &&
    /Microsoft Graph request failed: (404|410)\b/.test(error.message)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
