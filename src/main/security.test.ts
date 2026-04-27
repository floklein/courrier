import { describe, expect, it } from 'vitest';
import { isTrustedAppUrl } from './security';

describe('main-process app URL trust checks', () => {
  it('allows packaged app files and local Vite development URLs', () => {
    expect(isTrustedAppUrl('file:///C:/app/index.html')).toBe(true);
    expect(isTrustedAppUrl('http://localhost:5173')).toBe(true);
    expect(isTrustedAppUrl('http://127.0.0.1:5173')).toBe(true);
  });

  it('rejects remote URLs that would otherwise inherit the preload bridge', () => {
    expect(isTrustedAppUrl('https://evil.example')).toBe(false);
    expect(isTrustedAppUrl('http://evil.example')).toBe(false);
  });
});
