import { describe, expect, it, vi } from 'vitest';

describe('api client compose-window close bridge', () => {
  it('forwards close-request subscriptions to the preload API', async () => {
    const unsubscribe = vi.fn();
    const onCloseRequested = vi.fn(() => unsubscribe);
    const unusedApiGroup = new Proxy(
      {},
      {
        get: () => vi.fn(),
      },
    );

    Object.defineProperty(window, 'courrier', {
      configurable: true,
      value: {
        attachments: unusedApiGroup,
        auth: unusedApiGroup,
        drafts: unusedApiGroup,
        mail: unusedApiGroup,
        notifications: unusedApiGroup,
        window: {
          closeCurrent: vi.fn(),
          getComposeDraft: vi.fn(),
          onCloseRequested,
          openComposeWindow: vi.fn(),
        },
      },
    });

    const { api } = await import('@/lib/api-client');
    const listener = vi.fn();

    expect(api.window.onCloseRequested(listener)).toBe(unsubscribe);
    expect(onCloseRequested).toHaveBeenCalledWith(listener);
  });
});
