import { describe, expect, it, vi } from 'vitest';
import {
  createTrayMenuTemplate,
  focusMainWindow,
  openMessageWhenWindowReady,
  registerMainWindowCloseBehavior,
} from '@/main/main-window-lifecycle';

describe('main window lifecycle', () => {
  it('restores, shows, and focuses a minimized window', () => {
    const window = createWindowMock({ isMinimized: true });

    focusMainWindow(window.value);

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('sends an open-message request immediately to an already loaded window', () => {
    const window = createWindowMock();
    const payload = {
      accountId: 'microsoft:account-1',
      folderId: 'inbox',
      messageId: 'message-1',
    };

    openMessageWhenWindowReady(window.value, payload);

    expect(window.webContentsOnce).not.toHaveBeenCalled();
    expect(window.send).toHaveBeenCalledWith('mail:open-message', payload);
  });

  it('waits for a loading renderer and sends the open request once', () => {
    const window = createWindowMock({ isLoading: true });
    const payload = {
      accountId: 'google:account-1',
      folderId: 'INBOX',
      messageId: 'message-2',
    };

    openMessageWhenWindowReady(window.value, payload);

    expect(window.send).not.toHaveBeenCalled();
    expect(window.webContentsOnce).toHaveBeenCalledWith(
      'did-finish-load',
      expect.any(Function),
    );

    const didFinishLoad = window.webContentsOnce.mock.calls[0]?.[1] as
      | (() => void)
      | undefined;
    didFinishLoad?.();
    didFinishLoad?.();

    expect(window.send).toHaveBeenCalledTimes(1);
    expect(window.send).toHaveBeenCalledWith('mail:open-message', payload);
  });

  it('hides the main window only when background notifications are active', () => {
    const window = createWindowMock();
    const onClose = vi.fn();
    const onHide = vi.fn();

    registerMainWindowCloseBehavior(window.value, {
      isExplicitQuit: () => false,
      onClose,
      onHide,
      shouldKeepInTray: () => true,
    });

    const closeEvent = { preventDefault: vi.fn() };
    window.emitWindowEvent('close', closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(window.hide).toHaveBeenCalledTimes(1);
  });

  it('allows normal and explicit main-window closes', () => {
    const normalWindow = createWindowMock();
    const normalClose = vi.fn();

    registerMainWindowCloseBehavior(normalWindow.value, {
      isExplicitQuit: () => false,
      onClose: normalClose,
      onHide: vi.fn(),
      shouldKeepInTray: () => false,
    });
    const normalEvent = { preventDefault: vi.fn() };
    normalWindow.emitWindowEvent('close', normalEvent);

    expect(normalClose).toHaveBeenCalledTimes(1);
    expect(normalEvent.preventDefault).not.toHaveBeenCalled();
    expect(normalWindow.hide).not.toHaveBeenCalled();

    const explicitWindow = createWindowMock();
    const explicitClose = vi.fn();

    registerMainWindowCloseBehavior(explicitWindow.value, {
      isExplicitQuit: () => true,
      onClose: explicitClose,
      onHide: vi.fn(),
      shouldKeepInTray: () => true,
    });
    const explicitEvent = { preventDefault: vi.fn() };
    explicitWindow.emitWindowEvent('close', explicitEvent);

    expect(explicitClose).not.toHaveBeenCalled();
    expect(explicitEvent.preventDefault).not.toHaveBeenCalled();
    expect(explicitWindow.hide).not.toHaveBeenCalled();
  });

  it('creates tray actions that open and explicitly quit', () => {
    const onOpen = vi.fn();
    const onQuit = vi.fn();
    const template = createTrayMenuTemplate({ onOpen, onQuit });

    expect(template.map((item) => item.label)).toEqual(['Open', 'Close']);

    if (typeof template[0]?.click === 'function') {
      template[0].click({} as never, {} as never, {} as never);
    }
    if (typeof template[1]?.click === 'function') {
      template[1].click({} as never, {} as never, {} as never);
    }

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

function createWindowMock({
  isLoading = false,
  isMinimized = false,
}: {
  isLoading?: boolean;
  isMinimized?: boolean;
} = {}) {
  const windowHandlers = new Map<string, (...args: never[]) => void>();
  const restore = vi.fn();
  const show = vi.fn();
  const focus = vi.fn();
  const hide = vi.fn();
  const send = vi.fn();
  const webContentsOnce = vi.fn();
  const value = {
    focus,
    hide,
    isMinimized: vi.fn(() => isMinimized),
    on: vi.fn((eventName: string, handler: (...args: never[]) => void) => {
      windowHandlers.set(eventName, handler);
    }),
    restore,
    show,
    webContents: {
      isLoading: vi.fn(() => isLoading),
      once: webContentsOnce,
      send,
    },
  } as never;

  return {
    emitWindowEvent(eventName: string, ...args: unknown[]) {
      windowHandlers.get(eventName)?.(...(args as never[]));
    },
    focus,
    hide,
    restore,
    send,
    show,
    value,
    webContentsOnce,
  };
}
