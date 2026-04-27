import { ipcMain } from 'electron';
import type { GraphClient } from './graph-client';
import type { AuthService } from './auth-service';
import { assertTrustedSender } from './security';

export function registerIpcHandlers(
  authService: AuthService,
  graphClient: GraphClient,
) {
  ipcMain.handle('auth:get-session', (event) => {
    assertTrustedSender(event);
    return authService.getSession();
  });
  ipcMain.handle('auth:sign-in', (event) => {
    assertTrustedSender(event);
    return authService.signIn();
  });
  ipcMain.handle('auth:sign-out', (event) => {
    assertTrustedSender(event);
    return authService.signOut();
  });

  ipcMain.handle('mail:list-folders', (event) => {
    assertTrustedSender(event);
    return graphClient.listFolders();
  });
  ipcMain.handle('mail:list-messages', (event, folderId: string, pageUrl?: string) => {
    assertTrustedSender(event);
    return graphClient.listMessages(folderId, pageUrl);
  });
  ipcMain.handle('mail:get-message', (event, folderId: string, messageId: string) => {
    assertTrustedSender(event);
    return graphClient.getMessage(folderId, messageId);
  });
}
