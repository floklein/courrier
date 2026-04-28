import { describe, expect, it } from 'vitest';
import { shouldUsePlaintextCacheFallback } from '../../main/auth-service';

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
