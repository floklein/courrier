import type {
  BrowserWindow,
  MenuItemConstructorOptions,
} from 'electron';

export interface OpenMailMessagePayload {
  accountId: string;
  folderId: string;
  messageId: string;
}

export function focusMainWindow(window: BrowserWindow) {
  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
}

export function openMessageWhenWindowReady(
  window: BrowserWindow,
  payload: OpenMailMessagePayload,
) {
  let didOpen = false;
  const openMessage = () => {
    if (didOpen) {
      return;
    }

    didOpen = true;
    focusMainWindow(window);
    window.webContents.send('mail:open-message', payload);
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', openMessage);
    return;
  }

  openMessage();
}

export function registerMainWindowCloseBehavior(
  window: BrowserWindow,
  {
    isExplicitQuit,
    onClose,
    onHide,
    shouldKeepInTray,
  }: {
    isExplicitQuit: () => boolean;
    onClose: () => void;
    onHide: () => void;
    shouldKeepInTray: () => boolean;
  },
) {
  window.on('close', (event) => {
    if (isExplicitQuit()) {
      return;
    }

    if (!shouldKeepInTray()) {
      onClose();
      return;
    }

    event.preventDefault();
    onHide();
    window.hide();
  });
}

export function createTrayMenuTemplate({
  onOpen,
  onQuit,
}: {
  onOpen: () => void;
  onQuit: () => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Open',
      click: onOpen,
    },
    {
      label: 'Close',
      click: onQuit,
    },
  ];
}
