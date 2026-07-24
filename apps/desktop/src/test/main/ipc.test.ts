import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppUrlTrustPolicy } from '@/main/security';
import type { MailDraftSaveInput } from '@/lib/mail-types';

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

import { registerIpcHandlers } from '@/main/ipc';

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
      getActiveAccountId: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
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
    expect(startMailSubscriptions).toHaveBeenCalledWith();
  });

  it('does not start mail subscriptions after unauthenticated sign-in', async () => {
    const authService = {
      signIn: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
      getActiveAccountId: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
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

  it('validates and forwards triage action payloads', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await invokeIpc(
      'mail:set-message-star-state',
      trustedEvent,
      'google:account-1',
      'message-1',
      true,
    );
    await expect(
      invokeIpc(
        'mail:set-message-important-state',
        trustedEvent,
        'google:account-1',
        'message-1',
        'yes',
      ),
    ).rejects.toThrow('Invalid IPC payload');

    expect(mailService.setMessageStarState).toHaveBeenCalledWith(
      'google:account-1',
      'message-1',
      true,
    );
    expect(mailService.setMessageImportantState).not.toHaveBeenCalled();
  });

  it('validates and forwards search messages payloads', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await invokeIpc('mail:search-messages', trustedEvent, 'google:account-1', {
      query: 'hello',
      scope: 'all',
    });
    await expect(
      invokeIpc('mail:search-messages', trustedEvent, 'google:account-1', {
        query: '',
        scope: 'all',
      }),
    ).rejects.toThrow('Invalid IPC payload');

    expect(mailService.searchMessages).toHaveBeenCalledWith('google:account-1', {
      query: 'hello',
      scope: 'all',
    });
    expect(mailService.searchMessages).toHaveBeenCalledTimes(1);
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

describe('IPC draft handlers', () => {
  it('validates and forwards the complete draft lifecycle', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();
    const draftInput = createDraftSaveInput({
      providerDraftId: 'draft-1',
      providerDraftMessageId: 'draft-message-1',
      kind: 'replyAll',
      relatedMessageId: 'message-1',
    });

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await invokeIpc('draft:list', trustedEvent, 'microsoft:account-1');
    await invokeIpc(
      'draft:get',
      trustedEvent,
      'microsoft:account-1',
      'draft-1',
    );
    await invokeIpc(
      'draft:save',
      trustedEvent,
      'microsoft:account-1',
      draftInput,
    );
    await invokeIpc(
      'draft:delete',
      trustedEvent,
      'microsoft:account-1',
      'draft-1',
    );
    await invokeIpc(
      'draft:send',
      trustedEvent,
      'microsoft:account-1',
      'draft-1',
    );

    expect(mailService.listDrafts).toHaveBeenCalledWith('microsoft:account-1');
    expect(mailService.getDraft).toHaveBeenCalledWith(
      'microsoft:account-1',
      'draft-1',
    );
    expect(mailService.saveDraft).toHaveBeenCalledWith(
      'microsoft:account-1',
      draftInput,
    );
    expect(mailService.deleteDraft).toHaveBeenCalledWith(
      'microsoft:account-1',
      'draft-1',
    );
    expect(mailService.sendDraft).toHaveBeenCalledWith(
      'microsoft:account-1',
      'draft-1',
    );
  });

  it('rejects draft calls from an untrusted sender', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await expect(
      invokeIpc(
        'draft:list',
        { senderFrame: { url: 'https://attacker.example' } },
        'microsoft:account-1',
      ),
    ).rejects.toThrow('Refusing privileged IPC from an untrusted page.');
    expect(mailService.listDrafts).not.toHaveBeenCalled();
  });

  it('rejects response drafts without a related message', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await expect(
      invokeIpc(
        'draft:save',
        trustedEvent,
        'google:account-1',
        createDraftSaveInput({ kind: 'reply' }),
      ),
    ).rejects.toThrow('Invalid IPC payload');
    expect(mailService.saveDraft).not.toHaveBeenCalled();
  });

  it('rejects drafts with more than 500 aggregate recipients', async () => {
    const authService = {
      signIn: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
    };
    const mailService = createMailService();
    const toRecipients = Array.from({ length: 500 }, (_, index) => ({
      email: `recipient-${index}@example.com`,
    }));

    registerIpcHandlers(authService as never, mailService as never, { trustPolicy });

    await expect(
      invokeIpc(
        'draft:save',
        trustedEvent,
        'google:account-1',
        createDraftSaveInput({
          toRecipients,
          ccRecipients: [{ email: 'copy@example.com' }],
        }),
      ),
    ).rejects.toThrow('Invalid IPC payload');
    expect(mailService.saveDraft).not.toHaveBeenCalled();
  });
});

function createMailService() {
  return {
    getCapabilities: vi.fn(),
    listFolders: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    searchMessages: vi.fn(),
    markMessageReadState: vi.fn(),
    moveMessage: vi.fn(),
    deleteMessage: vi.fn(),
    archiveMessage: vi.fn(),
    markMessageJunkState: vi.fn(),
    setMessageStarState: vi.fn(),
    setMessageFlagState: vi.fn(),
    setMessageImportantState: vi.fn(),
    downloadAttachment: vi.fn(),
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    deleteDraft: vi.fn(),
    sendDraft: vi.fn(),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
  };
}

function createDraftSaveInput(
  overrides: Partial<MailDraftSaveInput> = {},
): MailDraftSaveInput {
  return {
    kind: 'new',
    toRecipients: [{ name: 'Ada', email: 'ada@example.com' }],
    ccRecipients: [{ name: 'Grace', email: 'grace@example.com' }],
    bccRecipients: [{ name: 'Hidden', email: 'hidden@example.com' }],
    toValue: 'Ada <ada@example.com>',
    ccValue: 'Grace <grace@example.com>',
    bccValue: 'Hidden <hidden@example.com>',
    subject: 'Draft subject',
    bodyHtml: '<p>Draft body</p>',
    editorValue: {
      html: '<p>Draft body</p>',
      text: 'Draft body',
      isEmpty: false,
    },
    attachments: [],
    ...overrides,
  };
}

async function invokeIpc(channel: string, event: unknown, ...args: unknown[]) {
  const handler = ipcHandlers.get(channel);

  if (!handler) {
    throw new Error(`Missing IPC handler: ${channel}`);
  }

  return handler(event, ...args);
}
