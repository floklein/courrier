import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppUrlTrustPolicy } from '../../main/security';

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

import { registerIpcHandlers } from '../../main/ipc';

const trustedEvent = {
  senderFrame: { url: 'http://localhost:5173' },
};
const trustPolicy = createAppUrlTrustPolicy({
  devServerUrl: 'http://localhost:5173',
});

beforeEach(() => {
  ipcHandlers.clear();
});

describe('IPC auth handlers', () => {
  it('starts mail subscriptions after successful sign-in', async () => {
    const session = {
      status: 'authenticated',
      activeAccount: { id: 'microsoft:account-1' },
    };
    const authService = {
      signIn: vi.fn().mockResolvedValue(session),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();
    const startMailSubscriptions = vi.fn().mockResolvedValue(undefined);

    registerIpcHandlers(authService as never, mailService as never, {
      startMailSubscriptions,
      trustPolicy,
    });
    const result = await ipcHandlers.get('auth:sign-in')?.(
      trustedEvent,
      'microsoft',
    );

    expect(result).toBe(session);
    expect(startMailSubscriptions).toHaveBeenCalledWith('microsoft:account-1');
  });

  it('does not start mail subscriptions after unauthenticated sign-in', async () => {
    const authService = {
      signIn: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();
    const startMailSubscriptions = vi.fn().mockResolvedValue(undefined);

    registerIpcHandlers(authService as never, mailService as never, {
      startMailSubscriptions,
      trustPolicy,
    });
    await ipcHandlers.get('auth:sign-in')?.(trustedEvent, 'microsoft');

    expect(startMailSubscriptions).not.toHaveBeenCalled();
  });

  it('signs out even when subscription cleanup fails', async () => {
    const session = { status: 'unauthenticated' };
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      switchAccount: vi.fn(),
      signOut: vi.fn().mockResolvedValue(session),
    };
    const mailService = createMailService();
    const stopMailSubscriptions = vi
      .fn()
      .mockRejectedValue(new Error('relay unavailable'));

    registerIpcHandlers(authService as never, mailService as never, {
      stopMailSubscriptions,
      trustPolicy,
    });
    const result = await ipcHandlers.get('auth:sign-out')?.(
      trustedEvent,
      'microsoft:account-1',
    );

    expect(result).toBe(session);
    expect(stopMailSubscriptions).toHaveBeenCalledWith('microsoft:account-1');
    expect(authService.signOut).toHaveBeenCalledWith('microsoft:account-1');
  });
});

describe('IPC mail handlers', () => {
  it('rejects invalid message identifiers before calling Graph', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await expect(
      invokeIpc(
        'mail:mark-message-read-state',
        trustedEvent,
        'microsoft:account-1',
        '',
        true,
      ),
    ).rejects.toThrow('Invalid IPC payload');
    expect(mailService.markMessageReadState).not.toHaveBeenCalled();
  });

  it('rejects malformed send-message payloads before calling Graph', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await expect(
      invokeIpc(
        'mail:send-message',
        trustedEvent,
        'microsoft:account-1',
        {
          toRecipients: [],
          subject: 'Hello',
          bodyHtml: '<p>Hi</p>',
        },
      ),
    ).rejects.toThrow('Invalid IPC payload');
    expect(mailService.sendMessage).not.toHaveBeenCalled();
  });
});

function createMailService() {
  return {
    listFolders: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    markMessageReadState: vi.fn(),
    moveMessage: vi.fn(),
    deleteMessage: vi.fn(),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
  };
}

async function invokeIpc(channel: string, event: unknown, ...args: unknown[]) {
  const handler = ipcHandlers.get(channel);

  if (!handler) {
    throw new Error(`Missing IPC handler: ${channel}`);
  }

  return handler(event, ...args);
}
