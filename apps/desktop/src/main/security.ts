import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type OpenExternal = (url: string) => Promise<void>;

export interface AppUrlTrustPolicy {
  appFilePath?: string;
  devOrigin?: string;
}

export function createAppUrlTrustPolicy({
  appFilePath,
  devServerUrl,
}: {
  appFilePath?: string;
  devServerUrl?: string;
}): AppUrlTrustPolicy {
  return {
    appFilePath: appFilePath ? normalizeFilePath(appFilePath) : undefined,
    devOrigin: devServerUrl ? new URL(devServerUrl).origin : undefined,
  };
}

export function isTrustedAppUrl(
  rawUrl: string | undefined,
  trustPolicy: AppUrlTrustPolicy,
) {
  if (!rawUrl) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === 'file:' && trustPolicy.appFilePath) {
    return normalizeFilePath(fileURLToPath(url)) === trustPolicy.appFilePath;
  }

  return (
    url.protocol === 'http:' &&
    Boolean(trustPolicy.devOrigin) &&
    url.origin === trustPolicy.devOrigin
  );
}

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  trustPolicy: AppUrlTrustPolicy,
) {
  if (!isTrustedAppUrl(event.senderFrame?.url, trustPolicy)) {
    throw new Error('Refusing privileged IPC from an untrusted page.');
  }
}

export function registerWindowNavigationGuards(
  window: BrowserWindow,
  openExternal: OpenExternal,
  trustPolicy: AppUrlTrustPolicy,
) {
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url, trustPolicy)) {
      return;
    }

    event.preventDefault();

    if (isHttpUrl(url)) {
      void openExternal(url);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void openExternal(url);
    }

    return { action: 'deny' };
  });
}

function isHttpUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeFilePath(filePath: string) {
  return path.normalize(filePath).toLowerCase();
}
