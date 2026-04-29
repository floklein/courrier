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
  statePath?: string;
}

export class MailSubscriptionManager {
  private renewalTimer: NodeJS.Timeout | undefined;
  private webSocket: WebSocket | undefined;

  constructor(private readonly options: MailSubscriptionManagerOptions) {}

  async start() {
    if (!this.options.relayPublicUrl || !this.options.relayAdminToken) {
      return;
    }

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
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    this.webSocket?.close();
  }

  private async ensureSubscription(state: MailSubscriptionState) {
    if (state.subscriptionId && state.expirationDateTime) {
      return this.options.graphClient.renewSubscription({
        subscriptionId: state.subscriptionId,
        expirationDateTime: createSubscriptionExpiration(),
      });
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

    this.renewalTimer = setTimeout(() => {
      void this.start();
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
    const socket = new WebSocket(relayUrl);

    this.webSocket = socket;
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
  }

  private async handleSocketMessage(state: MailSubscriptionState, data: unknown) {
    const result = relayServerMessageSchema.safeParse(parseSocketData(data));

    if (!result.success || result.data.type !== 'mail-change') {
      return;
    }

    state.lastEventId = result.data.event.id;
    await this.saveState(state);
    sendRemoteChangeToRenderers(result.data.event);
    this.webSocket?.send(
      JSON.stringify({ type: 'ack', eventId: result.data.event.id }),
    );
  }

  private async loadState(): Promise<MailSubscriptionState> {
    try {
      return JSON.parse(await fs.readFile(this.getStatePath(), 'utf8'));
    } catch {
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
  if (typeof data === 'string') {
    return JSON.parse(data) as unknown;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(new Uint8Array(data)).toString('utf8')) as unknown;
  }

  return undefined;
}

function randomSecret() {
  return randomBytes(32).toString('base64url');
}
