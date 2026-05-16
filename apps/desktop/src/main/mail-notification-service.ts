import fs from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  Notification,
  type NativeImage,
} from 'electron';
import type { MailRemoteChangeEvent } from '@courrier/mail-contracts';
import type { MailMessageSummary } from '@/lib/mail-types';
import type { MailService } from '@/main/mail-service';
import type { MailNotificationState } from '@/main/mail-provider';

export interface MailNotificationSettings {
  enabled: boolean;
  includePreview: boolean;
  silent: boolean;
}

interface MailNotificationStore {
  settings?: Partial<MailNotificationSettings>;
  recentMessageIds?: string[];
  providerStateByAccountId?: Record<string, MailNotificationState>;
  startupAt?: string;
}

interface MailNotificationServiceOptions {
  icon?: string | NativeImage;
  mailService: MailService;
  now?: () => Date;
  onNotificationClick: (message: MailMessageSummary) => void;
  settingsPath?: string;
}

const notificationStateFileName = 'mail-notifications.json';
const maxRecentMessageIds = 200;

export class MailNotificationService {
  constructor(private readonly options: MailNotificationServiceOptions) {}

  isSupported() {
    return Notification.isSupported();
  }

  async getSettings(): Promise<MailNotificationSettings> {
    const store = await this.loadStore();
    return normalizeSettings(store.settings, this.isSupported());
  }

  async updateSettings(
    patch: Partial<MailNotificationSettings>,
  ): Promise<MailNotificationSettings> {
    const store = await this.loadStore();
    const settings = {
      ...normalizeSettings(store.settings, this.isSupported()),
      ...patch,
    };

    store.settings = settings;
    await this.saveStore(store);
    return settings;
  }

  async handleRemoteChange(event: MailRemoteChangeEvent) {
    if (event.kind !== 'message-change' || !event.accountId) {
      return;
    }

    const settings = await this.getSettings();

    if (!settings.enabled || !this.isSupported()) {
      return;
    }

    const provider = this.options.mailService.getProvider(event.accountId);

    if (!provider.getNotificationMessages) {
      return;
    }

    const store = await this.loadStore();
    const providerState =
      store.providerStateByAccountId?.[event.accountId] ?? {};
    const resolution = await provider.getNotificationMessages(
      event.accountId,
      event,
      providerState,
    );

    store.providerStateByAccountId = {
      ...(store.providerStateByAccountId ?? {}),
      [event.accountId]: resolution.state ?? providerState,
    };

    const recentIds = new Set(store.recentMessageIds ?? []);
    const messages = resolution.messages.filter((message) => {
      if (recentIds.has(message.id)) {
        return false;
      }

      recentIds.add(message.id);
      return true;
    });

    store.recentMessageIds = [...recentIds].slice(-maxRecentMessageIds);
    store.startupAt ??= this.options.now?.().toISOString() ?? new Date().toISOString();
    await this.saveStore(store);

    for (const message of messages) {
      this.showNotification(message, settings);
    }
  }

  private showNotification(
    message: MailMessageSummary,
    settings: MailNotificationSettings,
  ) {
    const notification = new Notification({
      title: message.sender.name || message.sender.email || 'New mail',
      body: createNotificationBody(message, settings),
      icon: this.options.icon,
      silent: settings.silent,
    });

    notification.on('click', () => {
      this.options.onNotificationClick(message);
    });

    try {
      notification.show();
    } catch (error) {
      console.warn('Native mail notification failed.', error);
    }
  }

  private async loadStore(): Promise<MailNotificationStore> {
    try {
      return JSON.parse(await fs.readFile(this.getSettingsPath(), 'utf8')) as
        MailNotificationStore;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {};
      }

      if (error instanceof SyntaxError) {
        console.warn('Stored mail notification settings are corrupt; resetting them.', error);
        return {};
      }

      throw error;
    }
  }

  private async saveStore(store: MailNotificationStore) {
    const settingsPath = this.getSettingsPath();
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(store, null, 2));
  }

  private getSettingsPath() {
    return (
      this.options.settingsPath ??
      path.join(app.getPath('userData'), notificationStateFileName)
    );
  }
}

function normalizeSettings(
  settings: Partial<MailNotificationSettings> | undefined,
  isSupported: boolean,
): MailNotificationSettings {
  return {
    enabled: settings?.enabled ?? isSupported,
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
