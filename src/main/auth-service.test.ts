import { describe, expect, it } from 'vitest';
import { AuthService, shouldUsePlaintextCacheFallback } from './auth-service';

describe('auth callback templates', () => {
  it('passes polished light and dark mode templates to interactive sign-in', async () => {
    let capturedRequest:
      | {
          successTemplate: string;
          errorTemplate: string;
        }
      | undefined;

    const service = Object.assign(Object.create(AuthService.prototype), {
      clientId: 'client-id',
      pcaPromise: Promise.resolve({
        acquireTokenInteractive: async (request: {
          successTemplate: string;
          errorTemplate: string;
        }) => {
          capturedRequest = request;

          return {
            account: {
              homeAccountId: 'account-id',
              username: 'alex@example.com',
              name: 'Alex',
            },
          };
        },
      }),
    }) as AuthService;

    await service.signIn();

    expect(capturedRequest?.successTemplate).toContain(
      'Courrier sign-in complete',
    );
    expect(capturedRequest?.successTemplate).toContain(
      'color-scheme: light dark',
    );
    expect(capturedRequest?.successTemplate).toContain(
      'prefers-color-scheme: dark',
    );
    expect(capturedRequest?.successTemplate).toContain(
      '--primary: oklch(0.205 0 0)',
    );
    expect(capturedRequest?.successTemplate).toContain(
      'Inter, ui-sans-serif',
    );
    expect(capturedRequest?.successTemplate).not.toContain('#2563eb');
    expect(capturedRequest?.successTemplate).not.toContain('#60a5fa');
    expect(capturedRequest?.successTemplate).toContain(
      'You can close this tab',
    );
    expect(capturedRequest?.errorTemplate).toContain('Courrier sign-in failed');
    expect(capturedRequest?.errorTemplate).toContain(
      'prefers-color-scheme: dark',
    );
  });
});

describe('auth cache fallback detection', () => {
  it('detects unavailable DPAPI persistence validation errors', () => {
    const error = new Error(
      'PersistenceError: CachePersistenceError: Verifing persistence failed with the error: Error: Dpapi bindings unavailable',
    );

    expect(shouldUsePlaintextCacheFallback(error)).toBe(true);
  });

  it('does not fall back for unrelated persistence errors', () => {
    const error = new Error('Cache file permission denied');

    expect(shouldUsePlaintextCacheFallback(error)).toBe(false);
  });
});
