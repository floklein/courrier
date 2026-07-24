import type { BrowserWindow } from 'electron';

export interface ComposeWindowCloseHandshake {
  authorizeAndClose: () => void;
}

export function registerComposeWindowCloseHandshake(
  composeWindow: BrowserWindow,
): ComposeWindowCloseHandshake {
  let isCloseAuthorized = false;

  composeWindow.on('close', (event) => {
    if (isCloseAuthorized) {
      isCloseAuthorized = false;
      return;
    }

    if (composeWindow.webContents.isDestroyed()) {
      return;
    }

    event.preventDefault();
    composeWindow.webContents.send('window:close-requested');
  });

  return {
    authorizeAndClose: () => {
      isCloseAuthorized = true;

      try {
        composeWindow.close();
      } catch (error) {
        isCloseAuthorized = false;
        throw error;
      }
    },
  };
}
