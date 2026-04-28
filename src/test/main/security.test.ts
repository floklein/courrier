import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import { assertTrustedSender, isTrustedAppUrl } from '../../main/security';

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

  it('rejects malformed URLs and non-app file URLs', () => {
    expect(isTrustedAppUrl(undefined)).toBe(false);
    expect(isTrustedAppUrl('not a url')).toBe(false);
    expect(isTrustedAppUrl('file:///C:/app/settings.html')).toBe(false);
  });

  it.each([
    'file:///C:/app/index.html',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])('allows privileged IPC from trusted sender %s', (url) => {
    expect(() => assertTrustedSender(createIpcEvent(url))).not.toThrow();
  });

  it.each([
    undefined,
    'https://evil.example',
    'http://evil.example',
    'not a url',
    'file:///C:/app/settings.html',
  ])('rejects privileged IPC from untrusted sender %s', (url) => {
    expect(() => assertTrustedSender(createIpcEvent(url))).toThrow(
      'Refusing privileged IPC from an untrusted page.',
    );
  });
});

function createIpcEvent(url: string | undefined) {
  return {
    senderFrame: url ? { url } : undefined,
  } as IpcMainInvokeEvent;
}
