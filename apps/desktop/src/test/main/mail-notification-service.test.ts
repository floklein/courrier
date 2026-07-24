import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessageSummary } from '@/lib/mail-types';

const electronMock = vi.hoisted(() => ({
  getPath: vi.fn(() => 'test-user-data'),
  isSupported: vi.fn(() => true),
  notifications: [] as Array<{
    options: Record<string, unknown>;
    handlers: Record<string, (...args: unknown[]) => void>;
    show: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('electron', () => {
  class MockNotification {
    private readonly handlers: Record<string, (...args: unknown[]) => void> = {};
    readonly show = vi.fn();

    constructor(readonly options: Record<string, unknown>) {
      electronMock.notifications.push({
        options,
        handlers: this.handlers,
        show: this.show,
      });
    }

    static isSupported() {
      return electronMock.isSupported();
    }

    on(eventName: string, handler: (...args: unknown[]) => void) {
      this.handlers[eventName] = handler;
      return this;
    }
  }

  return {
    app: { getPath: electronMock.getPath },
    Notification: MockNotification,
  };
});

import {
  MailNotificationService,
  mailNotificationSettingsPatchSchema,
} from '@/main/mail-notification-service';

let tempDir: string;
let settingsPath: string;
const notificationServiceTestOptions = {
  coalesceDelayMs: 0,
  now: () => new Date('2026-05-16T09:00:00.000Z'),
};

beforeEach(async () => {
  electronMock.notifications = [];
  electronMock.isSupported.mockReturnValue(true);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'courrier-notification-test-'));
  settingsPath = path.join(tempDir, 'mail-notifications.json');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('MailNotificationService', () => {
  it('rejects malformed notification settings patches', () => {
    expect(mailNotificationSettingsPatchSchema.safeParse([]).success).toBe(
      false,
    );
    expect(
      mailNotificationSettingsPatchSchema.safeParse({ enabled: 'yes' }).success,
    ).toBe(false);
    expect(
      mailNotificationSettingsPatchSchema.safeParse({ unknown: true }).success,
    ).toBe(false);
  });

  it('shows unread provider messages once and routes clicks to the message', async () => {
    const message = createMessage();
    const onNotificationClick = vi.fn();
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [message],
        state: { gmailLastHistoryId: 'history-2' },
      }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick,
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    await service.handleRemoteChange(createEvent());
    await service.handleRemoteChange(createEvent('event-2'));

    expect(provider.getNotificationMessages).toHaveBeenCalledTimes(2);
    expect(electronMock.notifications).toHaveLength(1);
    expect(electronMock.notifications[0]?.options).toMatchObject({
      title: 'Ada Lovelace',
      body: 'A note\nPreview text',
      silent: false,
    });
    expect(electronMock.notifications[0]?.show).toHaveBeenCalledTimes(1);

    electronMock.notifications[0]?.handlers.click?.();

    expect(onNotificationClick).toHaveBeenCalledWith('microsoft:account-1', message);
    await expect(readStore()).resolves.toMatchObject({
      recentMessageIds: ['microsoft:account-1:message-1'],
      providerStateByAccountId: {
        'microsoft:account-1': { gmailLastHistoryId: 'history-2' },
      },
    });
  });

  it('persists user settings and suppresses notifications when disabled', async () => {
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage()],
      }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    await expect(service.updateSettings({ enabled: false })).resolves.toEqual({
      supported: true,
      enabled: false,
      includePreview: true,
      silent: false,
    });
    await service.handleRemoteChange(createEvent());

    expect(provider.getNotificationMessages).not.toHaveBeenCalled();
    expect(electronMock.notifications).toHaveLength(0);
    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('does not suppress the same provider message id across accounts', async () => {
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage()],
      }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);
    service.setAccountSubscriptionActive('google:account-2', true);

    await service.handleRemoteChange(createEvent('event-1', 'microsoft:account-1'));
    await service.handleRemoteChange(createEvent('event-2', 'google:account-2'));

    expect(electronMock.notifications).toHaveLength(2);
    await expect(readStore()).resolves.toMatchObject({
      recentMessageIds: [
        'microsoft:account-1:message-1',
        'google:account-2:message-1',
      ],
    });
  });

  it('logs native notification failures', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage()],
      }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    await service.handleRemoteChange(createEvent());
    electronMock.notifications[0]?.handlers.failed?.(
      {},
      'Windows rejected the notification',
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Native mail notification failed.',
      'Windows rejected the notification',
    );
  });

  it('updates the synchronous tray decision when settings change', async () => {
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: { getProvider: vi.fn() } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    expect(service.shouldKeepMainWindowInTray()).toBe(false);

    service.setAccountSubscriptionActive('microsoft:account-1', true);

    expect(service.shouldKeepMainWindowInTray()).toBe(true);

    await service.updateSettings({ enabled: false });

    expect(service.shouldKeepMainWindowInTray()).toBe(false);
  });

  it('merges provider notification state without clearing existing store data', async () => {
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: { getProvider: vi.fn() } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    await service.updateSettings({ includePreview: false });
    await service.mergeProviderState('google:account-1', {
      gmailLastHistoryId: 'history-100',
    });

    await expect(readStore()).resolves.toMatchObject({
      settings: { includePreview: false },
      providerStateByAccountId: {
        'google:account-1': { gmailLastHistoryId: 'history-100' },
      },
    });
  });

  it('serializes concurrent notification handling and suppresses duplicates', async () => {
    let releaseFirstResolution = () => {};
    const firstResolution = new Promise<void>((resolve) => {
      releaseFirstResolution = resolve;
    });
    const provider = {
      getNotificationMessages: vi
        .fn()
        .mockImplementationOnce(async () => {
          await firstResolution;
          return { messages: [createMessage()] };
        })
        .mockResolvedValue({ messages: [createMessage()] }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    const firstHandle = service.handleRemoteChange(createEvent());
    await vi.waitFor(() => {
      expect(provider.getNotificationMessages).toHaveBeenCalledTimes(1);
    });
    const secondHandle = service.handleRemoteChange(createEvent('event-2'));

    await Promise.resolve();
    expect(provider.getNotificationMessages).toHaveBeenCalledTimes(1);

    releaseFirstResolution();
    await Promise.all([firstHandle, secondHandle]);

    expect(provider.getNotificationMessages).toHaveBeenCalledTimes(2);
    expect(electronMock.notifications).toHaveLength(1);
  });

  it('preserves provider state for concurrent account subscriptions', async () => {
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: { getProvider: vi.fn() } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    await Promise.all([
      service.mergeProviderState('google:account-1', {
        gmailLastHistoryId: 'history-1',
      }),
      service.mergeProviderState('google:account-2', {
        gmailLastHistoryId: 'history-2',
      }),
    ]);

    await expect(readStore()).resolves.toMatchObject({
      providerStateByAccountId: {
        'google:account-1': { gmailLastHistoryId: 'history-1' },
        'google:account-2': { gmailLastHistoryId: 'history-2' },
      },
    });
  });

  it('advances Gmail state while disabled without replaying disabled mail', async () => {
    const provider = {
      getNotificationMessages: vi.fn(
        async (
          _accountId: string,
          _event: unknown,
          state: { gmailLastHistoryId?: string },
        ) => ({
          messages: [createMessage('message-2')],
          state: { ...state, gmailLastHistoryId: 'history-3' },
        }),
      ),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('google:account-1', true);

    await service.updateSettings({ enabled: false });
    await service.handleRemoteChange(createGoogleEvent('event-2', 'history-2'));

    expect(provider.getNotificationMessages).not.toHaveBeenCalled();
    await expect(readStore()).resolves.toMatchObject({
      providerStateByAccountId: {
        'google:account-1': { gmailLastHistoryId: 'history-2' },
      },
    });

    await service.updateSettings({ enabled: true });
    await service.handleRemoteChange(createGoogleEvent('event-3', 'history-3'));

    expect(provider.getNotificationMessages).toHaveBeenCalledWith(
      'google:account-1',
      expect.objectContaining({ historyId: 'history-3' }),
      { gmailLastHistoryId: 'history-2' },
    );
    expect(electronMock.notifications).toHaveLength(1);
  });

  it('suppresses events received before this app startup', async () => {
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage()],
      }),
    };
    const service = new MailNotificationService({
      coalesceDelayMs: 0,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      now: () => new Date('2026-05-16T10:00:00.000Z'),
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    await service.handleRemoteChange({
      ...createEvent(),
      receivedAt: '2026-05-16T09:59:59.999Z',
    });

    expect(provider.getNotificationMessages).not.toHaveBeenCalled();
    expect(electronMock.notifications).toHaveLength(0);
  });

  it('does not move the Gmail baseline backward for a replayed startup event', async () => {
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage()],
        state: { gmailLastHistoryId: '501' },
      }),
    };
    const service = new MailNotificationService({
      coalesceDelayMs: 0,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      now: () => new Date('2026-05-16T10:00:00.000Z'),
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('google:account-1', true);

    await service.mergeProviderState('google:account-1', {
      gmailLastHistoryId: '500',
    });
    await service.handleRemoteChange({
      ...createGoogleEvent('event-replayed', '400'),
      receivedAt: '2026-05-16T09:59:59.999Z',
    });
    await service.handleRemoteChange({
      ...createGoogleEvent('event-live', '501'),
      receivedAt: '2026-05-16T10:00:00.001Z',
    });

    expect(provider.getNotificationMessages).toHaveBeenCalledTimes(1);
    expect(provider.getNotificationMessages).toHaveBeenCalledWith(
      'google:account-1',
      expect.objectContaining({ historyId: '501' }),
      { gmailLastHistoryId: '500' },
    );
    await expect(readStore()).resolves.toMatchObject({
      providerStateByAccountId: {
        'google:account-1': { gmailLastHistoryId: '501' },
      },
    });
  });

  it('coalesces a burst from one account into one notification', async () => {
    vi.useFakeTimers();
    const provider = {
      getNotificationMessages: vi.fn(
        async (_accountId: string, event: { messageId?: string }) => ({
          messages: [createMessage(event.messageId)],
        }),
      ),
    };
    const onNotificationClick = vi.fn();
    const service = new MailNotificationService({
      coalesceDelayMs: 50,
      getAccountLabel: vi.fn().mockResolvedValue('Ada'),
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      now: notificationServiceTestOptions.now,
      onNotificationClick,
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    await service.handleRemoteChange(
      createEvent('event-1', 'microsoft:account-1', 'message-1'),
    );
    await service.handleRemoteChange(
      createEvent('event-2', 'microsoft:account-1', 'message-2'),
    );

    expect(electronMock.notifications).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);

    expect(electronMock.notifications).toHaveLength(1);
    expect(electronMock.notifications[0]?.options).toMatchObject({
      title: '2 new messages',
      body: 'New mail for Ada',
    });

    electronMock.notifications[0]?.handlers.click?.();
    expect(onNotificationClick).toHaveBeenCalledWith(
      'microsoft:account-1',
      expect.objectContaining({ id: 'message-2' }),
    );
  });

  it('does not enqueue a provider result after its account stops', async () => {
    let resolveProvider: (value: { messages: MailMessageSummary[] }) => void =
      () => {};
    const providerResult = new Promise<{ messages: MailMessageSummary[] }>(
      (resolve) => {
        resolveProvider = resolve;
      },
    );
    const provider = {
      getNotificationMessages: vi.fn(() => providerResult),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    const handling = service.handleRemoteChange(createEvent());
    await vi.waitFor(() => {
      expect(provider.getNotificationMessages).toHaveBeenCalledTimes(1);
    });

    service.setAccountSubscriptionActive('microsoft:account-1', false);
    resolveProvider({ messages: [createMessage()] });
    await handling;

    expect(electronMock.notifications).toHaveLength(0);
  });

  it('does not show a grouped notification after its account stops', async () => {
    let resolveAccountLabel: (value: string) => void = () => {};
    const accountLabel = new Promise<string>((resolve) => {
      resolveAccountLabel = resolve;
    });
    const getAccountLabel = vi.fn(() => accountLabel);
    const provider = {
      getNotificationMessages: vi.fn().mockResolvedValue({
        messages: [createMessage('message-1'), createMessage('message-2')],
      }),
    };
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      getAccountLabel,
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });
    service.setAccountSubscriptionActive('microsoft:account-1', true);

    const handling = service.handleRemoteChange(createEvent());
    await vi.waitFor(() => {
      expect(getAccountLabel).toHaveBeenCalledTimes(1);
    });

    service.setAccountSubscriptionActive('microsoft:account-1', false);
    resolveAccountLabel('Ada');
    await handling;

    expect(electronMock.notifications).toHaveLength(0);
  });

  it('cannot enable notifications when Electron does not support them', async () => {
    electronMock.isSupported.mockReturnValue(false);
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: { getProvider: vi.fn() } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    service.setAccountSubscriptionActive('microsoft:account-1', true);

    await expect(service.updateSettings({ enabled: true })).resolves.toEqual({
      supported: false,
      enabled: false,
      includePreview: true,
      silent: false,
    });
    expect(service.shouldKeepMainWindowInTray()).toBe(false);
  });

  it('resets valid JSON with an invalid store shape', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    await fs.writeFile(settingsPath, 'null');
    const service = new MailNotificationService({
      ...notificationServiceTestOptions,
      mailService: { getProvider: vi.fn() } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      supported: true,
      enabled: true,
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Stored mail notification settings are corrupt; resetting them.',
      expect.any(SyntaxError),
    );
  });
});

function createEvent(
  id = 'event-1',
  accountId = 'microsoft:account-1',
  messageId = 'message-1',
) {
  return {
    id,
    clientId: 'client-1',
    accountId,
    providerId: 'microsoft' as const,
    subscriptionId: 'subscription-1',
    kind: 'message-change' as const,
    changeType: 'created' as const,
    messageId,
    receivedAt: '2026-05-16T10:00:00.000Z',
  };
}

function createGoogleEvent(id: string, historyId: string) {
  return {
    id,
    clientId: 'client-1',
    accountId: 'google:account-1',
    providerId: 'google' as const,
    subscriptionId: `pubsub-${id}`,
    historyId,
    kind: 'message-change' as const,
    changeType: 'updated' as const,
    receivedAt: '2026-05-16T10:00:00.000Z',
  };
}

function createMessage(id = 'message-1'): MailMessageSummary {
  return {
    id,
    folderId: 'inbox',
    sender: { name: 'Ada Lovelace', email: 'ada@example.com' },
    recipients: [],
    subject: 'A note',
    preview: 'Preview text',
    receivedDateTime: '2026-05-16T10:00:00.000Z',
    isRead: false,
    hasAttachments: false,
    importance: 'normal',
  };
}

async function readStore() {
  return JSON.parse(await fs.readFile(settingsPath, 'utf8')) as unknown;
}
