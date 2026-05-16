import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMailRouteAfterActiveAccountChanged } from '@/lib/mail/mail-route-navigation';

describe('mail route navigation', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('does nothing when the current route is outside mail', async () => {
    const navigate = vi.fn();
    window.location.hash = '#/settings';

    await resetMailRouteAfterActiveAccountChanged(navigate);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing when the hash is empty or the root route', async () => {
    const navigate = vi.fn();

    await resetMailRouteAfterActiveAccountChanged(navigate);
    window.location.hash = '#/';
    await resetMailRouteAfterActiveAccountChanged(navigate);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('resets mail routes to inbox after the active account changes', async () => {
    const navigate = vi.fn();
    window.location.hash = '#mail/archive/message-1?pane=reading';

    await resetMailRouteAfterActiveAccountChanged(navigate);

    expect(navigate).toHaveBeenCalledWith({
      to: '/mail/$folderId',
      params: { folderId: 'inbox' },
      replace: true,
    });
  });
});
