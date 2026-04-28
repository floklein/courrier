import { ipcMain } from 'electron';
import type { GraphClient } from './graph-client';
import type { AuthService } from './auth-service';
import { assertTrustedSender } from './security';
import type { ReplyToMessageInput, SendMailInput } from '../lib/mail-types';

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
  ipcMain.handle(
    'mail:list-messages',
    (event, folderId: string, pageUrl?: string, searchQuery?: string) => {
      assertTrustedSender(event);
      return graphClient.listMessages(folderId, pageUrl, searchQuery);
    },
  );
  ipcMain.handle('mail:get-message', (event, folderId: string, messageId: string) => {
    assertTrustedSender(event);
    return graphClient.getMessage(folderId, messageId);
  });
  ipcMain.handle(
    'mail:mark-message-read-state',
    (event, messageId: string, isRead: boolean) => {
      assertTrustedSender(event);
      return graphClient.markMessageReadState(messageId, isRead);
    },
  );
  ipcMain.handle(
    'mail:move-message',
    (event, messageId: string, destinationFolderId: string) => {
      assertTrustedSender(event);
      return graphClient.moveMessage(messageId, destinationFolderId);
    },
  );
  ipcMain.handle('mail:delete-message', (event, messageId: string) => {
    assertTrustedSender(event);
    return graphClient.deleteMessage(messageId);
  });
  ipcMain.handle('mail:send-message', (event, input: SendMailInput) => {
    assertTrustedSender(event);
    return graphClient.sendMessage(input);
  });
  ipcMain.handle(
    'mail:reply-to-message',
    (event, input: ReplyToMessageInput) => {
      assertTrustedSender(event);
      return graphClient.replyToMessage(input);
    },
  );
}
