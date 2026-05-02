import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import type { GraphClient } from './graph-client';
import type { AuthService } from './auth-service';
import { assertTrustedSender, type AppUrlTrustPolicy } from './security';
import type {
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import {
  graphPageUrlSchema,
  ipcIdSchema,
  mailSearchQuerySchema,
  replyToMessageInputSchema,
  sendMailInputSchema,
} from '../lib/mail-schemas';

export function registerIpcHandlers(
  authService: AuthService,
  graphClient: GraphClient,
  options: {
    trustPolicy: AppUrlTrustPolicy;
    startMailSubscriptions?: () => Promise<void>;
    stopMailSubscriptions?: () => Promise<void>;
  },
) {
  const assertSender = (event: IpcMainInvokeEvent) =>
    assertTrustedSender(event, options.trustPolicy);

  ipcMain.handle('auth:get-session', (event) => {
    assertSender(event);
    return authService.getSession();
  });
  ipcMain.handle('auth:sign-in', async (event) => {
    assertSender(event);
    const session = await authService.signIn();

    if (session.status === 'authenticated') {
      await options.startMailSubscriptions?.();
    }

    return session;
  });
  ipcMain.handle('auth:sign-out', async (event) => {
    assertSender(event);
    await options.stopMailSubscriptions?.();
    return authService.signOut();
  });

  ipcMain.handle('mail:list-folders', (event) => {
    assertSender(event);
    return graphClient.listFolders();
  });
  ipcMain.handle(
    'mail:list-messages',
    (event, folderId: string, pageUrl?: string, searchQuery?: string) => {
      assertSender(event);
      return graphClient.listMessages(
        parseIpcPayload(ipcIdSchema, folderId),
        parseIpcPayload(graphPageUrlSchema, pageUrl),
        parseIpcPayload(mailSearchQuerySchema, searchQuery),
      );
    },
  );
  ipcMain.handle('mail:get-message', (event, folderId: string, messageId: string) => {
    assertSender(event);
    return graphClient.getMessage(
      parseIpcPayload(ipcIdSchema, folderId),
      parseIpcPayload(ipcIdSchema, messageId),
    );
  });
  ipcMain.handle(
    'mail:mark-message-read-state',
    (event, messageId: string, isRead: boolean) => {
      assertSender(event);
      return graphClient.markMessageReadState(
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isRead),
      );
    },
  );
  ipcMain.handle(
    'mail:move-message',
    (event, messageId: string, destinationFolderId: string) => {
      assertSender(event);
      return graphClient.moveMessage(
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(ipcIdSchema, destinationFolderId),
      );
    },
  );
  ipcMain.handle('mail:delete-message', (event, messageId: string) => {
    assertSender(event);
    return graphClient.deleteMessage(parseIpcPayload(ipcIdSchema, messageId));
  });
  ipcMain.handle('mail:send-message', (event, input: SendMailInput) => {
    assertSender(event);
    return graphClient.sendMessage(parseIpcPayload(sendMailInputSchema, input));
  });
  ipcMain.handle(
    'mail:reply-to-message',
    (event, input: ReplyToMessageInput) => {
      assertSender(event);
      return graphClient.replyToMessage(
        parseIpcPayload(replyToMessageInputSchema, input),
      );
    },
  );
}

const booleanSchema = z.boolean();

function parseIpcPayload<T>(
  schema: Pick<ZodType<T>, 'safeParse'>,
  value: unknown,
) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error('Invalid IPC payload');
  }

  return result.data;
}
