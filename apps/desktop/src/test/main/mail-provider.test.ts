import { describe, expect, it } from 'vitest';
import { getProviderFromAccountId } from '../../main/mail-provider';

describe('mail provider helpers', () => {
  it('reads the provider from supported account ids', () => {
    expect(getProviderFromAccountId('microsoft:user-1')).toBe('microsoft');
    expect(getProviderFromAccountId('google:user-1')).toBe('google');
  });

  it('ignores account ids with unsupported providers', () => {
    expect(getProviderFromAccountId('imap:user-1')).toBeUndefined();
    expect(getProviderFromAccountId('missing-provider')).toBeUndefined();
  });
});
