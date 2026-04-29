import { ipcMain } from 'electron';
import type { GraphClient } from './graph-client';
import { AuthRequiredError, type AuthService } from './auth-service';
import { assertTrustedSender } from './security';
import type {
  MailMessageDetail,
  PagedMessages,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';

export function registerIpcHandlers(
  authService: AuthService,
  graphClient: GraphClient,
  options: {
    startMailSubscriptions?: () => Promise<void>;
  } = {},
) {
  ipcMain.handle('auth:get-session', (event) => {
    assertTrustedSender(event);
    return authService.getSession();
  });
  ipcMain.handle('auth:sign-in', async (event) => {
    assertTrustedSender(event);
    const session = await authService.signIn();

    if (session.status === 'authenticated') {
      await options.startMailSubscriptions?.();
    }

    return session;
  });
  ipcMain.handle('auth:sign-out', (event) => {
    assertTrustedSender(event);
    return authService.signOut();
  });

  ipcMain.handle('mail:list-folders', (event) => {
    assertTrustedSender(event);
    return graphClient.listFolders().catch((error: unknown) =>
      handleAuthRequiredRead(error, []),
    );
  });
  ipcMain.handle(
    'mail:list-messages',
    (event, folderId: string, pageUrl?: string, searchQuery?: string) => {
      assertTrustedSender(event);
      return graphClient
        .listMessages(folderId, pageUrl, searchQuery)
        .catch((error: unknown) =>
          handleAuthRequiredRead<PagedMessages>(error, { messages: [] }),
        );
    },
  );
  ipcMain.handle('mail:get-message', (event, folderId: string, messageId: string) => {
    assertTrustedSender(event);
    return graphClient.getMessage(folderId, messageId).catch((error: unknown) =>
      handleAuthRequiredRead<MailMessageDetail | undefined>(error, undefined),
    );
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

function handleAuthRequiredRead<T>(error: unknown, fallback: T): T {
  if (
    error instanceof AuthRequiredError ||
    (error instanceof Error && error.message === 'Microsoft sign-in is required.')
  ) {
    return fallback;
  }

  throw error;
}
