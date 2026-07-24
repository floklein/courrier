import { describe, expect, it, vi } from 'vitest';
import { registerComposeWindowCloseHandshake } from '@/main/compose-window-close-lifecycle';

describe('compose window close lifecycle', () => {
  it('intercepts native close and asks the renderer to finish closing', () => {
    const window = createComposeWindowMock();

    registerComposeWindowCloseHandshake(window.value as never);
    const closeEvent = window.emitNativeClose();

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.send).toHaveBeenCalledWith('window:close-requested');
  });

  it('authorizes exactly one programmatic close without a request loop', () => {
    const window = createComposeWindowMock();
    const handshake = registerComposeWindowCloseHandshake(window.value as never);

    handshake.authorizeAndClose();

    expect(window.close).toHaveBeenCalledOnce();
    expect(window.closeEvents[0]?.preventDefault).not.toHaveBeenCalled();
    expect(window.send).not.toHaveBeenCalled();

    const nextCloseEvent = window.emitNativeClose();

    expect(nextCloseEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.send).toHaveBeenCalledOnce();
  });

  it('does not intercept after the renderer has been destroyed', () => {
    const window = createComposeWindowMock({ isDestroyed: true });

    registerComposeWindowCloseHandshake(window.value as never);
    const closeEvent = window.emitNativeClose();

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.send).not.toHaveBeenCalled();
  });
});

function createComposeWindowMock({
  isDestroyed = false,
}: {
  isDestroyed?: boolean;
} = {}) {
  let closeHandler:
    | ((event: { preventDefault: () => void }) => void)
    | undefined;
  const closeEvents: Array<{ preventDefault: ReturnType<typeof vi.fn> }> = [];
  const send = vi.fn();
  const emitNativeClose = () => {
    const event = { preventDefault: vi.fn() };
    closeEvents.push(event);
    closeHandler?.(event);
    return event;
  };
  const close = vi.fn(emitNativeClose);
  const value = {
    close,
    on: vi.fn(
      (
        _eventName: 'close',
        handler: (event: { preventDefault: () => void }) => void,
      ) => {
        closeHandler = handler;
      },
    ),
    webContents: {
      isDestroyed: vi.fn(() => isDestroyed),
      send,
    },
  };

  return {
    close,
    closeEvents,
    emitNativeClose,
    send,
    value,
  };
}
