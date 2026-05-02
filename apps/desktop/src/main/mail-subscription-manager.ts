import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import {
  relaySubscriptionRegistrationSchema,
  relayServerMessageSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';
import { z } from 'zod';
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

const mailSubscriptionStateSchema = z.object({
  clientId: z.string().min(1),
  clientState: z.string().min(24),
  authToken: z.string().min(24),
  subscriptionId: z.string().min(1).optional(),
  expirationDateTime: z.string().datetime().optional(),
  lastEventId: z.string().min(1).optional(),
});

type StopOptions = {
  deleteRemoteSubscription?: boolean;
};

export class MailSubscriptionManager {
  private renewalTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private startPromise: Promise<void> | undefined;
  private readonly pendingSocketTasks = new Set<Promise<void>>();
  private readonly stoppedStartsNeedingRemoteDelete = new Set<number>();
  private webSocket: WebSocket | undefined;
  private isStopped = true;
  private shouldDeleteRemoteSubscriptionWhileStopping = false;
  private lifecycleGeneration = 0;

  constructor(private readonly options: MailSubscriptionManagerOptions) {}

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.isStopped = false;
    const generation = ++this.lifecycleGeneration;
    this.stoppedStartsNeedingRemoteDelete.delete(generation);
    const startPromise = this.startOnce(generation).finally(() => {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    });

    this.startPromise = startPromise;
    return this.startPromise;
  }

  private async startOnce(generation: number) {
    if (!this.options.relayPublicUrl || !this.options.relayAdminToken) {
      return;
    }

    const state = await this.loadState();
    if (!this.isLifecycleActive(generation)) {
      return;
    }

    const subscription = await this.ensureSubscription(state);
    if (!this.isLifecycleActive(generation)) {
      await this.deleteSubscriptionFromStoppedStart(generation, subscription.id);
      return;
    }

    state.subscriptionId = subscription.id;
    state.expirationDateTime = subscription.expirationDateTime;
    await this.saveState(state);
    if (!this.isLifecycleActive(generation)) {
      return;
    }

    await this.registerWithRelay(state);
    if (!this.isLifecycleActive(generation)) {
      return;
    }

    this.scheduleRenewal(state);
    this.connectWebSocket(state);
  }

  async stop(options: StopOptions = {}) {
    const stoppedGeneration = this.lifecycleGeneration;
    const pendingStart = this.startPromise;

    if (options.deleteRemoteSubscription) {
      this.shouldDeleteRemoteSubscriptionWhileStopping = true;
      this.stoppedStartsNeedingRemoteDelete.add(stoppedGeneration);
    }

    this.lifecycleGeneration += 1;
    this.isStopped = true;
    this.startPromise = undefined;
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
    await pendingStart?.catch((error: unknown) => {
      console.warn('Mail subscription startup did not stop cleanly.', error);
    });
    await Promise.allSettled([...this.pendingSocketTasks]);

    if (options.deleteRemoteSubscription) {
      await this.deleteRemoteSubscription();
    }

    this.shouldDeleteRemoteSubscriptionWhileStopping = false;
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
    if (!state.expirationDateTime || this.isStopped) {
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
    const body = relaySubscriptionRegistrationSchema.parse({
      clientId: state.clientId,
      clientState: state.clientState,
      authToken: state.authToken,
      subscriptionId: state.subscriptionId,
      expirationDateTime: state.expirationDateTime,
    });
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.relayAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Relay registration failed: ${response.status}`);
    }
  }

  private connectWebSocket(state: MailSubscriptionState) {
    if (this.isStopped) {
      return;
    }

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
      const task = this.handleSocketMessage(state, event.data, socket)
        .catch((error: unknown) => {
          console.warn('Relay WebSocket message processing failed.', error);

          if (this.webSocket === socket) {
            socket.close();
          }
        })
        .finally(() => {
          this.pendingSocketTasks.delete(task);
        });

      this.pendingSocketTasks.add(task);
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

  private async handleSocketMessage(
    state: MailSubscriptionState,
    data: unknown,
    socket: WebSocket,
  ) {
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

    await this.recoverFromLifecycleEvent(state, result.data.event);
    if (this.isStopped) {
      return;
    }

    sendRemoteChangeToRenderers(result.data.event);
    state.lastEventId = result.data.event.id;
    await this.saveState(state);

    if (this.webSocket === socket && !this.isStopped) {
      socket.send(JSON.stringify({ type: 'ack', eventId: result.data.event.id }));
    }
  }

  private async loadState(): Promise<MailSubscriptionState> {
    try {
      const result = mailSubscriptionStateSchema.safeParse(
        JSON.parse(await fs.readFile(this.getStatePath(), 'utf8')),
      );

      if (result.success) {
        return result.data;
      }

      console.warn('Stored mail subscription state is invalid; resetting it.', result.error);
      return createInitialState();
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('Stored mail subscription state is corrupt; resetting it.', error);
        return createInitialState();
      }

      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      return createInitialState();
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
    event: MailRemoteChangeEvent,
  ) {
    if (event.kind !== 'lifecycle' || this.isStopped) {
      return;
    }

    if (event.changeType === 'subscriptionRemoved') {
      state.subscriptionId = undefined;
      state.expirationDateTime = undefined;
    }

    if (
      event.changeType === 'subscriptionRemoved' ||
      event.changeType === 'reauthorizationRequired'
    ) {
      const subscription = await this.ensureSubscription(state);
      if (this.isStopped) {
        await this.deleteSubscriptionIfStopping(subscription.id);
        return;
      }

      state.subscriptionId = subscription.id;
      state.expirationDateTime = subscription.expirationDateTime;
      await this.saveState(state);
      if (this.isStopped) {
        return;
      }

      await this.registerWithRelay(state);
      this.scheduleRenewal(state);
    }
  }

  private isLifecycleActive(generation: number) {
    return !this.isStopped && this.lifecycleGeneration === generation;
  }

  private async deleteSubscriptionFromStoppedStart(
    generation: number,
    subscriptionId: string | undefined,
  ) {
    if (!subscriptionId || !this.stoppedStartsNeedingRemoteDelete.has(generation)) {
      return;
    }

    this.stoppedStartsNeedingRemoteDelete.delete(generation);
    await this.deleteRemoteSubscriptionById(subscriptionId);
  }

  private async deleteSubscriptionIfStopping(subscriptionId: string | undefined) {
    if (!subscriptionId || !this.isStopped) {
      return;
    }

    if (this.shouldDeleteRemoteSubscriptionWhileStopping) {
      await this.deleteRemoteSubscriptionById(subscriptionId);
    }
  }

  private async deleteRemoteSubscription() {
    let state: MailSubscriptionState;

    try {
      state = await this.loadState();
    } catch (error) {
      console.warn('Could not read mail subscription state during sign-out.', error);
      return;
    }

    if (!state.subscriptionId) {
      return;
    }

    await this.deleteRemoteSubscriptionById(state.subscriptionId);

    state.subscriptionId = undefined;
    state.expirationDateTime = undefined;
    await this.saveState(state);
  }

  private async deleteRemoteSubscriptionById(subscriptionId: string) {
    try {
      await this.options.graphClient.deleteSubscription(subscriptionId);
    } catch (error) {
      console.warn('Could not delete Microsoft Graph mail subscription.', error);
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

function createInitialState(): MailSubscriptionState {
  return {
    clientId: randomUUID(),
    clientState: randomSecret(),
    authToken: randomSecret(),
  };
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
