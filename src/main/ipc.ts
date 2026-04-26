import { ipcMain } from 'electron';
import type { GraphClient } from './graph-client';
import type { AuthService } from './auth-service';

export function registerIpcHandlers(
  authService: AuthService,
  graphClient: GraphClient,
) {
  ipcMain.handle('auth:get-session', () => authService.getSession());
  ipcMain.handle('auth:sign-in', () => authService.signIn());
  ipcMain.handle('auth:sign-out', () => authService.signOut());

  ipcMain.handle('mail:list-folders', () => graphClient.listFolders());
  ipcMain.handle('mail:list-messages', (_event, folderId: string, pageUrl?: string) =>
    graphClient.listMessages(folderId, pageUrl),
  );
  ipcMain.handle('mail:get-message', (_event, folderId: string, messageId: string) =>
    graphClient.getMessage(folderId, messageId),
  );
}
