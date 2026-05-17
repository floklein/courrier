import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import type { AuthService } from '@/main/auth-service';
import type { MailService } from '@/main/mail-service';
import { assertTrustedSender, type AppUrlTrustPolicy } from '@/main/security';
import type {
  ReplyToMessageInput,
  SendMailInput,
} from '@/lib/mail-types';
import {
  ipcIdSchema,
  mailPageTokenSchema,
  mailPeopleQuerySchema,
  mailSearchQuerySchema,
  providerIdSchema,
  replyToMessageInputSchema,
  sendMailInputSchema,
} from '@/lib/mail-schemas';

export function registerIpcHandlers(
  authService: AuthService,
  mailService: MailService,
  options: {
    trustPolicy: AppUrlTrustPolicy;
    startMailSubscriptions?: (accountId?: string) => Promise<void>;
    stopMailSubscriptions?: (accountId?: string) => Promise<void>;
  },
) {
  const assertSender = (event: IpcMainInvokeEvent) =>
    assertTrustedSender(event, options.trustPolicy);

  ipcMain.handle('auth:get-session', (event) => {
    assertSender(event);
    return authService.getSession();
  });
  ipcMain.handle('auth:sign-in', async (event, providerId: unknown) => {
    assertSender(event);
    const session = await authService.signIn(
      parseIpcPayload(providerIdSchema, providerId),
    );

    if (session.status === 'authenticated') {
      await options.startMailSubscriptions?.();
    }

    return session;
  });
  ipcMain.handle('auth:switch-account', async (event, accountId: string) => {
    assertSender(event);
    return authService.switchAccount(
      parseIpcPayload(ipcIdSchema, accountId),
    );
  });
  ipcMain.handle('auth:sign-out', async (event, accountId?: string) => {
    assertSender(event);
    const parsedAccountId = parseIpcPayload(ipcIdSchema.optional(), accountId);
    try {
      await options.stopMailSubscriptions?.(parsedAccountId);
    } catch (error) {
      console.warn('Mail subscription cleanup failed during sign-out.', error);
    }

    const session = await authService.signOut(parsedAccountId);

    if (session.status === 'authenticated') {
      await options.startMailSubscriptions?.(session.activeAccount.id);
    }

    return session;
  });

  ipcMain.handle('mail:list-folders', (event, accountId: string) => {
    assertSender(event);
    return mailService.listFolders(parseIpcPayload(ipcIdSchema, accountId));
  });
  ipcMain.handle('mail:get-capabilities', (event, accountId: string) => {
    assertSender(event);
    return mailService.getCapabilities(parseIpcPayload(ipcIdSchema, accountId));
  });
  ipcMain.handle(
    'mail:list-messages',
    (
      event,
      accountId: string,
      folderId: string,
      pageToken?: string,
      searchQuery?: string,
    ) => {
      assertSender(event);
      return mailService.listMessages(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, folderId),
        parseIpcPayload(mailPageTokenSchema, pageToken),
        parseIpcPayload(mailSearchQuerySchema, searchQuery),
      );
    },
  );
  ipcMain.handle('mail:get-message', (event, accountId: string, folderId: string, messageId: string) => {
    assertSender(event);
    return mailService.getMessage(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(ipcIdSchema, folderId),
      parseIpcPayload(ipcIdSchema, messageId),
    );
  });
  ipcMain.handle(
    'mail:mark-message-read-state',
    (event, accountId: string, messageId: string, isRead: boolean) => {
      assertSender(event);
      return mailService.markMessageReadState(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isRead),
      );
    },
  );
  ipcMain.handle(
    'mail:move-message',
    (
      event,
      accountId: string,
      messageId: string,
      sourceFolderId: string,
      destinationFolderId: string,
    ) => {
      assertSender(event);
      return mailService.moveMessage(parseIpcPayload(ipcIdSchema, accountId), {
        messageId: parseIpcPayload(ipcIdSchema, messageId),
        sourceFolderId: parseIpcPayload(ipcIdSchema, sourceFolderId),
        destinationFolderId: parseIpcPayload(ipcIdSchema, destinationFolderId),
      });
    },
  );
  ipcMain.handle('mail:delete-message', (event, accountId: string, messageId: string) => {
    assertSender(event);
    return mailService.deleteMessage(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(ipcIdSchema, messageId),
    );
  });
  ipcMain.handle(
    'mail:archive-message',
    (event, accountId: string, messageId: string, sourceFolderId: string) => {
      assertSender(event);
      return mailService.archiveMessage(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(ipcIdSchema, sourceFolderId),
      );
    },
  );
  ipcMain.handle(
    'mail:mark-message-junk-state',
    (event, accountId: string, messageId: string, isJunk: boolean) => {
      assertSender(event);
      return mailService.markMessageJunkState(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isJunk),
      );
    },
  );
  ipcMain.handle(
    'mail:set-message-star-state',
    (event, accountId: string, messageId: string, isStarred: boolean) => {
      assertSender(event);
      return mailService.setMessageStarState(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isStarred),
      );
    },
  );
  ipcMain.handle(
    'mail:set-message-flag-state',
    (event, accountId: string, messageId: string, isFlagged: boolean) => {
      assertSender(event);
      return mailService.setMessageFlagState(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isFlagged),
      );
    },
  );
  ipcMain.handle(
    'mail:set-message-important-state',
    (event, accountId: string, messageId: string, isImportant: boolean) => {
      assertSender(event);
      return mailService.setMessageImportantState(
        parseIpcPayload(ipcIdSchema, accountId),
        parseIpcPayload(ipcIdSchema, messageId),
        parseIpcPayload(booleanSchema, isImportant),
      );
    },
  );
  ipcMain.handle('mail:list-people', (event, accountId: string, query?: string) => {
    assertSender(event);
    return mailService.listPeople(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(mailPeopleQuerySchema, query),
    );
  });
  ipcMain.handle('mail:send-message', (event, accountId: string, input: SendMailInput) => {
    assertSender(event);
    return mailService.sendMessage(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(sendMailInputSchema, input),
    );
  });
  ipcMain.handle(
    'mail:reply-to-message',
    (event, accountId: string, input: ReplyToMessageInput) => {
      assertSender(event);
      return mailService.replyToMessage(
        parseIpcPayload(ipcIdSchema, accountId),
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
