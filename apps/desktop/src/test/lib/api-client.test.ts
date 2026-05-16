import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  };
  const windowApi = {
    closeCurrent: vi.fn(),
    getComposeDraft: vi.fn(),
    openComposeWindow: vi.fn(),
  };

  Object.defineProperty(window, 'courrier', {
    configurable: true,
    value: { attachments, auth, mail, window: windowApi },
  });

  return { attachments, auth, mail, windowApi };
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
});
