import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import type { AuthService } from '@/main/auth-service';
import type { MailService } from '@/main/mail-service';
import { assertTrustedSender, type AppUrlTrustPolicy } from '@/main/security';
import type {
  ReplyToMessageInput,
  SendMailInput,
  MailDraftSaveInput,
} from '@/lib/mail-types';
import {
  ipcIdSchema,
  mailPageTokenSchema,
  mailPeopleQuerySchema,
  mailSearchQuerySchema,
  mailDraftSaveInputSchema,
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
  ipcMain.handle('mail:list-people', (event, accountId: string, query?: string) => {
    assertSender(event);
    return mailService.listPeople(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(mailPeopleQuerySchema, query),
    );
  });
  ipcMain.handle('draft:list', (event, accountId: string) => {
    assertSender(event);
    return mailService.listDrafts(parseIpcPayload(ipcIdSchema, accountId));
  });
  ipcMain.handle('draft:get', (event, accountId: string, providerDraftId: string) => {
    assertSender(event);
    return mailService.getDraft(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(ipcIdSchema, providerDraftId),
    );
  });
  ipcMain.handle('draft:save', (event, accountId: string, input: MailDraftSaveInput) => {
    assertSender(event);
    return mailService.saveDraft(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(mailDraftSaveInputSchema, input),
    );
  });
  ipcMain.handle('draft:delete', (event, accountId: string, providerDraftId: string) => {
    assertSender(event);
    return mailService.deleteDraft(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(ipcIdSchema, providerDraftId),
    );
  });
  ipcMain.handle('draft:send', (event, accountId: string, providerDraftId: string) => {
    assertSender(event);
    return mailService.sendDraft(
      parseIpcPayload(ipcIdSchema, accountId),
      parseIpcPayload(ipcIdSchema, providerDraftId),
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
