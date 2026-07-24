import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailDraftSaveInput } from '@/lib/mail-types';

function installCourrierApi() {
  const attachments = {
    pickLocal: vi.fn(),
    registerDroppedFiles: vi.fn(),
    open: vi.fn(),
    download: vi.fn(),
  };
  const auth = {
    getSession: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
    signIn: vi.fn(),
    switchAccount: vi.fn(),
    signOut: vi.fn(),
  };
  const mail = {
    getCapabilities: vi.fn(),
    listFolders: vi.fn(),
    listMessages: vi.fn(),
    searchMessages: vi.fn(),
    getMessage: vi.fn(),
    markMessageReadState: vi.fn(),
    moveMessage: vi.fn(),
    deleteMessage: vi.fn(),
    archiveMessage: vi.fn(),
    markMessageJunkState: vi.fn(),
    setMessageStarState: vi.fn(),
    setMessageFlagState: vi.fn(),
    setMessageImportantState: vi.fn(),
    listPeople: vi.fn(),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
    onRemoteChange: vi.fn(),
    onOpenMessage: vi.fn(),
  };
  const notifications = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const drafts = {
    list: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    send: vi.fn(),
  };
  const windowApi = {
    closeCurrent: vi.fn(),
    getComposeDraft: vi.fn(),
    openComposeWindow: vi.fn(),
  };

  Object.defineProperty(window, 'courrier', {
    configurable: true,
    value: {
      attachments,
      auth,
      drafts,
      mail,
      notifications,
      window: windowApi,
    },
  });

  return { attachments, auth, drafts, mail, notifications, windowApi };
}

describe('api client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('forwards auth and mail calls to the preload bridge', async () => {
    const bridge = installCourrierApi();
    const { api } = await import('@/lib/api-client');

    await api.auth.getSession();
    api.auth.signIn('google');
    api.mail.getCapabilities('account-1');
    api.mail.moveMessage('account-1', 'message-1', 'inbox', 'archive');
    api.mail.searchMessages('account-1', { query: 'hello', scope: 'all' });

    expect(bridge.auth.getSession).toHaveBeenCalledOnce();
    expect(bridge.auth.signIn).toHaveBeenCalledWith('google');
    expect(bridge.mail.getCapabilities).toHaveBeenCalledWith('account-1');
    expect(bridge.mail.moveMessage).toHaveBeenCalledWith(
      'account-1',
      'message-1',
      'inbox',
      'archive',
    );
    expect(bridge.mail.searchMessages).toHaveBeenCalledWith('account-1', {
      query: 'hello',
      scope: 'all',
    });
  });

  it('wraps current-window bridge calls', async () => {
    const bridge = installCourrierApi();
    const { api } = await import('@/lib/api-client');

    api.window.closeCurrent();
    api.window.getComposeDraft();
    api.window.openComposeWindow({
      accountId: 'account-1',
      toValue: 'ada@example.com',
      subject: 'Hello',
      editorValue: { html: '<p>Hello</p>', text: 'Hello', isEmpty: false },
    });

    expect(bridge.windowApi.closeCurrent).toHaveBeenCalledOnce();
    expect(bridge.windowApi.getComposeDraft).toHaveBeenCalledOnce();
    expect(bridge.windowApi.openComposeWindow).toHaveBeenCalledWith({
      accountId: 'account-1',
      toValue: 'ada@example.com',
      subject: 'Hello',
      editorValue: { html: '<p>Hello</p>', text: 'Hello', isEmpty: false },
    });
  });

  it('forwards every draft call and its arguments to the preload bridge', async () => {
    const bridge = installCourrierApi();
    const { api } = await import('@/lib/api-client');
    const draftInput = createDraftSaveInput();

    api.drafts.list('google:account-1');
    api.drafts.get('google:account-1', 'draft-1');
    api.drafts.save('google:account-1', draftInput);
    api.drafts.delete('google:account-1', 'draft-1');
    api.drafts.send('google:account-1', 'draft-1');

    expect(bridge.drafts.list).toHaveBeenCalledWith('google:account-1');
    expect(bridge.drafts.get).toHaveBeenCalledWith(
      'google:account-1',
      'draft-1',
    );
    expect(bridge.drafts.save).toHaveBeenCalledWith(
      'google:account-1',
      draftInput,
    );
    expect(bridge.drafts.delete).toHaveBeenCalledWith(
      'google:account-1',
      'draft-1',
    );
    expect(bridge.drafts.send).toHaveBeenCalledWith(
      'google:account-1',
      'draft-1',
    );
  });
});

function createDraftSaveInput(): MailDraftSaveInput {
  return {
    providerDraftId: 'draft-1',
    providerDraftMessageId: 'draft-message-1',
    kind: 'forward',
    relatedMessageId: 'message-1',
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
  };
}
