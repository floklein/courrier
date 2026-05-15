import { describe, expect, it, vi } from 'vitest';

vi.mock('@azure/msal-node-extensions', () => ({
  DataProtectionScope: { CurrentUser: 'CurrentUser' },
  FilePersistence: { create: vi.fn() },
  PersistenceCachePlugin: vi.fn(),
  PersistenceCreator: { createPersistence: vi.fn() },
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'test-user-data') },
  shell: { openExternal: vi.fn() },
}));

import { shouldUsePlaintextCacheFallback } from '../../main/microsoft-auth-provider';

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
