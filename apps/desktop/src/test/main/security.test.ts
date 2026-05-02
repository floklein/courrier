import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  assertTrustedSender,
  createAppUrlTrustPolicy,
  isTrustedAppUrl,
} from '../../main/security';

const trustPolicy = createAppUrlTrustPolicy({
  appFilePath: 'C:\\app\\index.html',
  devServerUrl: 'http://localhost:5173',
});

describe('main-process app URL trust checks', () => {
  it('allows only the packaged app file and configured Vite development origin', () => {
    expect(isTrustedAppUrl('file:///C:/app/index.html', trustPolicy)).toBe(true);
    expect(isTrustedAppUrl('http://localhost:5173/mail', trustPolicy)).toBe(true);
    expect(isTrustedAppUrl('http://localhost:5174', trustPolicy)).toBe(false);
    expect(isTrustedAppUrl('http://127.0.0.1:5173', trustPolicy)).toBe(false);
  });

  it('rejects remote URLs that would otherwise inherit the preload bridge', () => {
    expect(isTrustedAppUrl('https://evil.example', trustPolicy)).toBe(false);
    expect(isTrustedAppUrl('http://evil.example', trustPolicy)).toBe(false);
  });

  it('rejects malformed URLs and non-app file URLs', () => {
    expect(isTrustedAppUrl(undefined, trustPolicy)).toBe(false);
    expect(isTrustedAppUrl('not a url', trustPolicy)).toBe(false);
    expect(isTrustedAppUrl('file:///C:/app/settings.html', trustPolicy)).toBe(false);
  });

  it.each([
    'file:///C:/app/index.html',
    'http://localhost:5173',
  ])('allows privileged IPC from trusted sender %s', (url) => {
    expect(() => assertTrustedSender(createIpcEvent(url), trustPolicy)).not.toThrow();
  });

  it.each([
    undefined,
    'https://evil.example',
    'http://evil.example',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'not a url',
    'file:///C:/app/settings.html',
  ])('rejects privileged IPC from untrusted sender %s', (url) => {
    expect(() => assertTrustedSender(createIpcEvent(url), trustPolicy)).toThrow(
      'Refusing privileged IPC from an untrusted page.',
    );
  });
});

function createIpcEvent(url: string | undefined) {
  return {
    senderFrame: url ? { url } : undefined,
  } as IpcMainInvokeEvent;
}
