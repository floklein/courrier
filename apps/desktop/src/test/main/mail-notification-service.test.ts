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
    handlers: Record<string, () => void>;
    show: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('electron', () => {
  class MockNotification {
    private readonly handlers: Record<string, () => void> = {};
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

    on(eventName: string, handler: () => void) {
      this.handlers[eventName] = handler;
      return this;
    }
  }

  return {
    app: { getPath: electronMock.getPath },
    Notification: MockNotification,
  };
});

import { MailNotificationService } from '@/main/mail-notification-service';

let tempDir: string;
let settingsPath: string;

beforeEach(async () => {
  electronMock.notifications = [];
  electronMock.isSupported.mockReturnValue(true);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'courrier-notification-test-'));
  settingsPath = path.join(tempDir, 'mail-notifications.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('MailNotificationService', () => {
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
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick,
      settingsPath,
    });

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

    expect(onNotificationClick).toHaveBeenCalledWith(message);
    await expect(readStore()).resolves.toMatchObject({
      recentMessageIds: ['message-1'],
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
      mailService: {
        getProvider: vi.fn(() => provider),
      } as never,
      onNotificationClick: vi.fn(),
      settingsPath,
    });

    await expect(service.updateSettings({ enabled: false })).resolves.toEqual({
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
});

function createEvent(id = 'event-1') {
  return {
    id,
    clientId: 'client-1',
    accountId: 'microsoft:account-1',
    providerId: 'microsoft' as const,
    subscriptionId: 'subscription-1',
    kind: 'message-change' as const,
    changeType: 'created' as const,
    messageId: 'message-1',
    receivedAt: '2026-05-16T10:00:00.000Z',
  };
}

function createMessage(): MailMessageSummary {
  return {
    id: 'message-1',
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
