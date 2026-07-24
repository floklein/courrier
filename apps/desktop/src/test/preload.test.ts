import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMock.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
  webUtils: {
    getPathForFile: vi.fn(),
  },
}));

import type { CourrierApi } from '@/preload';
import type { MailDraftSaveInput } from '@/lib/mail-types';
import '@/preload';

describe('preload open-message bridge', () => {
  it('buffers validated messages until the renderer subscribes', () => {
    const openMessageRegistration = electronMock.on.mock.calls.find(
      ([eventName]) => eventName === 'mail:open-message',
    );
    const emitOpenMessage = openMessageRegistration?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined;
    const exposedApi = electronMock.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'courrier',
    )?.[1] as CourrierApi | undefined;
    const listener = vi.fn();
    const payload = {
      accountId: 'microsoft:account-1',
      folderId: 'inbox',
      messageId: 'message-1',
    };

    expect(emitOpenMessage).toBeTypeOf('function');
    expect(exposedApi).toBeDefined();

    emitOpenMessage?.({}, payload);
    const unsubscribe = exposedApi?.mail.onOpenMessage(listener);

    expect(listener).toHaveBeenCalledWith(payload);

    emitOpenMessage?.({}, { ...payload, messageId: '' });
    expect(listener).toHaveBeenCalledTimes(1);

    emitOpenMessage?.({}, { ...payload, messageId: 'message-2' });
    expect(listener).toHaveBeenLastCalledWith({
      ...payload,
      messageId: 'message-2',
    });

    unsubscribe?.();
    emitOpenMessage?.({}, { ...payload, messageId: 'message-3' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('preload compose-window close bridge', () => {
  it('buffers a close request and supports listener cleanup', () => {
    const closeRequestRegistration = electronMock.on.mock.calls.find(
      ([eventName]) => eventName === 'window:close-requested',
    );
    const emitCloseRequest = closeRequestRegistration?.[1] as
      | ((event: unknown) => void)
      | undefined;
    const exposedApi = electronMock.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'courrier',
    )?.[1] as CourrierApi | undefined;
    const listener = vi.fn();

    expect(emitCloseRequest).toBeTypeOf('function');
    expect(exposedApi).toBeDefined();

    emitCloseRequest?.({});
    const unsubscribe = exposedApi?.window.onCloseRequested(listener);

    expect(listener).toHaveBeenCalledOnce();

    emitCloseRequest?.({});
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe?.();
    emitCloseRequest?.({});
    expect(listener).toHaveBeenCalledTimes(2);

    const nextListener = vi.fn();
    const unsubscribeNext = exposedApi?.window.onCloseRequested(nextListener);

    expect(nextListener).toHaveBeenCalledOnce();
    unsubscribeNext?.();
  });

  it('requests an authorized current-window close through IPC', async () => {
    const exposedApi = electronMock.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'courrier',
    )?.[1] as CourrierApi | undefined;

    await exposedApi?.window.closeCurrent();

    expect(electronMock.invoke).toHaveBeenCalledWith('window:close-current');
  });
});

describe('preload draft bridge', () => {
  it('forwards every draft operation and its arguments through IPC', async () => {
    electronMock.invoke.mockClear();
    const exposedApi = electronMock.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'courrier',
    )?.[1] as CourrierApi | undefined;
    const draftInput = createDraftSaveInput();

    expect(exposedApi).toBeDefined();

    await exposedApi?.drafts.list('microsoft:account-1');
    await exposedApi?.drafts.get('microsoft:account-1', 'draft-1');
    await exposedApi?.drafts.save('microsoft:account-1', draftInput);
    await exposedApi?.drafts.delete('microsoft:account-1', 'draft-1');
    await exposedApi?.drafts.send('microsoft:account-1', 'draft-1');

    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      1,
      'draft:list',
      'microsoft:account-1',
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      2,
      'draft:get',
      'microsoft:account-1',
      'draft-1',
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      3,
      'draft:save',
      'microsoft:account-1',
      draftInput,
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      4,
      'draft:delete',
      'microsoft:account-1',
      'draft-1',
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      5,
      'draft:send',
      'microsoft:account-1',
      'draft-1',
    );
  });
});

function createDraftSaveInput(): MailDraftSaveInput {
  return {
    providerDraftId: 'draft-1',
    providerDraftMessageId: 'draft-message-1',
    kind: 'reply',
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
