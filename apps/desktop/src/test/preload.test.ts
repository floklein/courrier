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
