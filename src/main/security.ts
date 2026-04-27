import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

type OpenExternal = (url: string) => Promise<void>;

export function isTrustedAppUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === 'file:') {
    return url.pathname.endsWith('/index.html');
  }

  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  );
}

export function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (!isTrustedAppUrl(event.senderFrame?.url)) {
    throw new Error('Refusing privileged IPC from an untrusted page.');
  }
}

export function registerWindowNavigationGuards(
  window: BrowserWindow,
  openExternal: OpenExternal,
) {
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) {
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
