import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'test-user-data') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

import {
  createGraphNotificationUrl,
  createSubscriptionExpiration,
  getRenewalDelayMs,
} from '../../main/mail-subscription-manager';

describe('mail subscription manager helpers', () => {
  it('creates the Graph notification URL from the relay public URL', () => {
    expect(createGraphNotificationUrl('https://relay.example.com/')).toBe(
      'https://relay.example.com/graph/notifications',
    );
  });

  it('creates a future subscription expiration', () => {
    expect(createSubscriptionExpiration(new Date('2026-04-29T10:00:00.000Z'))).toBe(
      '2026-04-30T10:00:00.000Z',
    );
  });

  it('renews one hour before expiration with a minimum one minute delay', () => {
    expect(
      getRenewalDelayMs(
        '2026-04-29T12:00:00.000Z',
        new Date('2026-04-29T10:00:00.000Z'),
      ),
    ).toBe(60 * 60 * 1000);

    expect(
      getRenewalDelayMs(
        '2026-04-29T10:30:00.000Z',
        new Date('2026-04-29T10:00:00.000Z'),
      ),
    ).toBe(60 * 1000);
  });
});
