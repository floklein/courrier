import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  Notification,
  type NativeImage,
} from 'electron';
import type { MailRemoteChangeEvent } from '@courrier/mail-contracts';
import { z } from 'zod';
import type { MailMessageSummary } from '@/lib/mail-types';
import type { MailService } from '@/main/mail-service';
import type { MailNotificationState } from '@/main/mail-provider';

export const mailNotificationSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    includePreview: z.boolean().optional(),
    silent: z.boolean().optional(),
  })
  .strict();

export type MailNotificationSettingsPatch = z.infer<
  typeof mailNotificationSettingsPatchSchema
>;

interface StoredMailNotificationSettings {
  enabled: boolean;
  includePreview: boolean;
  silent: boolean;
}

export interface MailNotificationSettings
  extends StoredMailNotificationSettings {
  supported: boolean;
}

interface MailNotificationStore {
  settings?: Partial<StoredMailNotificationSettings>;
  recentMessageIds?: string[];
  providerStateByAccountId?: Record<string, MailNotificationState>;
  startupAt?: string;
}

interface PendingNotificationBatch {
  messages: MailMessageSummary[];
  settings: MailNotificationSettings;
  timer: NodeJS.Timeout;
}

interface MailNotificationServiceOptions {
  coalesceDelayMs?: number;
  getAccountLabel?: (accountId: string) => Promise<string | undefined>;
  icon?: string | NativeImage;
  mailService: MailService;
  now?: () => Date;
  onNotificationClick: (accountId: string, message: MailMessageSummary) => void;
  settingsPath?: string;
}

const notificationStateFileName = 'mail-notifications.json';
const maxRecentMessageIds = 200;
const defaultCoalesceDelayMs = 750;

export class MailNotificationService {
  private readonly activeSubscriptionAccountIds = new Set<string>();
  private cachedSettings: MailNotificationSettings | undefined;
  private readonly pendingNotificationBatches = new Map<
    string,
    PendingNotificationBatch
  >();
  private readonly startupAt: string;
  private storeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: MailNotificationServiceOptions) {
    this.startupAt = (options.now?.() ?? new Date()).toISOString();
  }

  isSupported() {
    return Notification.isSupported();
  }

  async getSettings(): Promise<MailNotificationSettings> {
    return this.runStoreOperation(async () => {
      const store = await this.loadStore();
      const settings = normalizeSettings(store.settings, this.isSupported());
      const didUpdateStartup = this.markCurrentStartup(store);

      if (didUpdateStartup) {
        await this.saveStore(store);
      }

      this.cachedSettings = settings;
      return settings;
    });
  }

  async updateSettings(
    patch: MailNotificationSettingsPatch,
  ): Promise<MailNotificationSettings> {
    return this.runStoreOperation(async () => {
      const store = await this.loadStore();
      const current = normalizeSettings(store.settings, this.isSupported());
      const storedSettings: StoredMailNotificationSettings = {
        enabled: current.supported
          ? (patch.enabled ?? current.enabled)
          : false,
        includePreview: patch.includePreview ?? current.includePreview,
        silent: patch.silent ?? current.silent,
      };
      const settings = normalizeSettings(storedSettings, current.supported);

      store.settings = storedSettings;
      this.markCurrentStartup(store);
      await this.saveStore(store);
      this.cachedSettings = settings;
      this.updatePendingNotificationSettings(settings);
      return settings;
    });
  }

  setAccountSubscriptionActive(accountId: string, isActive: boolean) {
    if (isActive) {
      this.activeSubscriptionAccountIds.add(accountId);
      return;
    }

    this.activeSubscriptionAccountIds.delete(accountId);
    this.clearPendingNotifications(accountId);
  }

  shouldKeepMainWindowInTray() {
    const settings =
      this.cachedSettings ?? normalizeSettings(undefined, this.isSupported());

    return (
      settings.enabled &&
      settings.supported &&
      this.activeSubscriptionAccountIds.size > 0
    );
  }

  async mergeProviderState(
    accountId: string,
    state: MailNotificationState | undefined,
  ) {
    if (!state) {
      return;
    }

    await this.runStoreOperation(async () => {
      const store = await this.loadStore();

      store.providerStateByAccountId = {
        ...(store.providerStateByAccountId ?? {}),
        [accountId]: {
          ...(store.providerStateByAccountId?.[accountId] ?? {}),
          ...state,
        },
      };
      this.markCurrentStartup(store);
      await this.saveStore(store);
    });
  }

  async handleRemoteChange(event: MailRemoteChangeEvent) {
    if (event.kind !== 'message-change' || !event.accountId) {
      return;
    }

    const accountId = event.accountId;

    await this.runStoreOperation(async () => {
      const store = await this.loadStore();
      const settings = normalizeSettings(store.settings, this.isSupported());
      const didUpdateStartup = this.markCurrentStartup(store);
      const shouldSuppressDisplay =
        !settings.enabled ||
        !settings.supported ||
        !this.activeSubscriptionAccountIds.has(accountId) ||
        isEventBeforeStartup(event, this.startupAt);

      this.cachedSettings = settings;

      if (shouldSuppressDisplay) {
        const didAdvanceState = advanceGmailStateFromEvent(
          store,
          accountId,
          event,
        );

        if (didUpdateStartup || didAdvanceState) {
          await this.saveStore(store);
        }
        return;
      }

      const provider = this.options.mailService.getProvider(accountId);

      if (!provider.getNotificationMessages) {
        if (didUpdateStartup) {
          await this.saveStore(store);
        }
        return;
      }

      const providerState =
        store.providerStateByAccountId?.[accountId] ?? {};
      const resolution = await provider.getNotificationMessages(
        accountId,
        event,
        providerState,
      );

      store.providerStateByAccountId = {
        ...(store.providerStateByAccountId ?? {}),
        [accountId]: resolution.state ?? providerState,
      };

      const recentIds = new Set(store.recentMessageIds ?? []);
      const messages = resolution.messages.filter((message) => {
        const recentId = createRecentMessageId(accountId, message.id);

        if (recentIds.has(recentId)) {
          return false;
        }

        recentIds.add(recentId);
        return true;
      });

      store.recentMessageIds = [...recentIds].slice(-maxRecentMessageIds);
      await this.saveStore(store);
      await this.enqueueNotifications(accountId, messages, settings);
    });
  }

  private async enqueueNotifications(
    accountId: string,
    messages: MailMessageSummary[],
    settings: MailNotificationSettings,
  ) {
    if (
      messages.length === 0 ||
      !this.canShowNotifications(accountId)
    ) {
      return;
    }

    const coalesceDelayMs =
      this.options.coalesceDelayMs ?? defaultCoalesceDelayMs;

    if (coalesceDelayMs <= 0) {
      await this.showNotificationBatch(accountId, messages, settings);
      return;
    }

    const existing = this.pendingNotificationBatches.get(accountId);

    if (existing) {
      existing.messages.push(...messages);
      existing.settings = settings;
      return;
    }

    const batch: PendingNotificationBatch = {
      messages: [...messages],
      settings,
      timer: setTimeout(() => {
        this.pendingNotificationBatches.delete(accountId);
        void this.showNotificationBatch(
          accountId,
          batch.messages,
          batch.settings,
        ).catch((error: unknown) => {
          console.warn('Could not create grouped mail notification.', error);
        });
      }, coalesceDelayMs),
    };

    this.pendingNotificationBatches.set(accountId, batch);
  }

  private async showNotificationBatch(
    accountId: string,
    messages: MailMessageSummary[],
    settings: MailNotificationSettings,
  ) {
    if (!this.canShowNotifications(accountId)) {
      return;
    }

    const message = messages.at(-1);

    if (!message) {
      return;
    }

    if (messages.length === 1) {
      this.showNotification(
        accountId,
        message,
        message.sender.name || message.sender.email || 'New mail',
        createNotificationBody(message, settings),
        settings,
      );
      return;
    }

    let accountLabel: string | undefined;

    try {
      accountLabel = await this.options.getAccountLabel?.(accountId);
    } catch (error) {
      console.warn('Could not resolve the notification account label.', error);
    }

    if (!this.canShowNotifications(accountId)) {
      return;
    }

    this.showNotification(
      accountId,
      message,
      `${messages.length} new messages`,
      accountLabel ? `New mail for ${accountLabel}` : 'New mail',
      settings,
    );
  }

  private canShowNotifications(accountId: string) {
    return Boolean(
      this.cachedSettings?.enabled &&
        this.cachedSettings.supported &&
        this.activeSubscriptionAccountIds.has(accountId),
    );
  }

  private showNotification(
    accountId: string,
    message: MailMessageSummary,
    title: string,
    body: string,
    settings: MailNotificationSettings,
  ) {
    const notification = new Notification({
      title,
      body,
      icon: this.options.icon,
      silent: settings.silent,
    });

    notification.on('click', () => {
      this.options.onNotificationClick(accountId, message);
    });
    notification.on('failed', (_event, error) => {
      console.warn('Native mail notification failed.', error);
    });

    try {
      notification.show();
    } catch (error) {
      console.warn('Native mail notification failed.', error);
    }
  }

  private updatePendingNotificationSettings(
    settings: MailNotificationSettings,
  ) {
    if (!settings.enabled || !settings.supported) {
      this.clearPendingNotifications();
      return;
    }

    for (const batch of this.pendingNotificationBatches.values()) {
      batch.settings = settings;
    }
  }

  private clearPendingNotifications(accountId?: string) {
    for (const [pendingAccountId, batch] of this.pendingNotificationBatches) {
      if (accountId && accountId !== pendingAccountId) {
        continue;
      }

      clearTimeout(batch.timer);
      this.pendingNotificationBatches.delete(pendingAccountId);
    }
  }

  private async loadStore(): Promise<MailNotificationStore> {
    try {
      return parseMailNotificationStore(
        JSON.parse(await fs.readFile(this.getSettingsPath(), 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {};
      }

      if (error instanceof SyntaxError) {
        console.warn(
          'Stored mail notification settings are corrupt; resetting them.',
          error,
        );
        return {};
      }

      throw error;
    }
  }

  private async saveStore(store: MailNotificationStore) {
    const settingsPath = this.getSettingsPath();
    const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });

    try {
      await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), {
        flag: 'wx',
      });
      await fs.rename(temporaryPath, settingsPath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  private getSettingsPath() {
    return (
      this.options.settingsPath ??
      path.join(app.getPath('userData'), notificationStateFileName)
    );
  }

  private markCurrentStartup(store: MailNotificationStore) {
    if (store.startupAt === this.startupAt) {
      return false;
    }

    store.startupAt = this.startupAt;
    return true;
  }

  private async runStoreOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.storeQueue.then(operation, operation);

    this.storeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function normalizeSettings(
  settings: Partial<StoredMailNotificationSettings> | undefined,
  isSupported: boolean,
): MailNotificationSettings {
  return {
    supported: isSupported,
    enabled: isSupported && (settings?.enabled ?? true),
    includePreview: settings?.includePreview ?? true,
    silent: settings?.silent ?? false,
  };
}

function createNotificationBody(
  message: MailMessageSummary,
  settings: MailNotificationSettings,
) {
  const subject = message.subject || '(No subject)';

  if (!settings.includePreview || !message.preview) {
    return truncate(subject, 180);
  }

  return truncate(`${subject}\n${message.preview}`, 220);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function createRecentMessageId(accountId: string, messageId: string) {
  return `${accountId}:${messageId}`;
}

function isEventBeforeStartup(
  event: MailRemoteChangeEvent,
  startupAt: string,
) {
  return new Date(event.receivedAt).getTime() < new Date(startupAt).getTime();
}

function advanceGmailStateFromEvent(
  store: MailNotificationStore,
  accountId: string,
  event: MailRemoteChangeEvent,
) {
  if (
    event.kind !== 'message-change' ||
    event.providerId !== 'google' ||
    !event.historyId
  ) {
    return false;
  }

  const currentState = store.providerStateByAccountId?.[accountId] ?? {};

  if (
    currentState.gmailLastHistoryId &&
    !isNewerGmailHistoryId(
      currentState.gmailLastHistoryId,
      event.historyId,
    )
  ) {
    return false;
  }

  store.providerStateByAccountId = {
    ...(store.providerStateByAccountId ?? {}),
    [accountId]: {
      ...currentState,
      gmailLastHistoryId: event.historyId,
    },
  };
  return true;
}

function isNewerGmailHistoryId(currentHistoryId: string, nextHistoryId: string) {
  if (
    /^\d+$/.test(currentHistoryId) &&
    /^\d+$/.test(nextHistoryId)
  ) {
    return BigInt(nextHistoryId) > BigInt(currentHistoryId);
  }

  return nextHistoryId !== currentHistoryId;
}

function parseMailNotificationStore(value: unknown): MailNotificationStore {
  if (!isRecord(value)) {
    throw new SyntaxError('Stored notification state must be an object.');
  }

  const settings = isRecord(value.settings)
    ? {
        ...(typeof value.settings.enabled === 'boolean'
          ? { enabled: value.settings.enabled }
          : {}),
        ...(typeof value.settings.includePreview === 'boolean'
          ? { includePreview: value.settings.includePreview }
          : {}),
        ...(typeof value.settings.silent === 'boolean'
          ? { silent: value.settings.silent }
          : {}),
      }
    : undefined;
  const providerStateByAccountId: Record<string, MailNotificationState> = {};

  if (isRecord(value.providerStateByAccountId)) {
    for (const [accountId, state] of Object.entries(
      value.providerStateByAccountId,
    )) {
      if (
        isRecord(state) &&
        typeof state.gmailLastHistoryId === 'string'
      ) {
        providerStateByAccountId[accountId] = {
          gmailLastHistoryId: state.gmailLastHistoryId,
        };
      }
    }
  }

  return {
    ...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
    ...(Array.isArray(value.recentMessageIds)
      ? {
          recentMessageIds: value.recentMessageIds.filter(
            (messageId): messageId is string => typeof messageId === 'string',
          ),
        }
      : {}),
    ...(Object.keys(providerStateByAccountId).length > 0
      ? { providerStateByAccountId }
      : {}),
    ...(typeof value.startupAt === 'string'
      ? { startupAt: value.startupAt }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
