import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  PagedMessages,
  ProviderId,
  ReplyToMessageInput,
  SendMailInput,
} from './lib/mail-types';
import type { ComposeWindowDraft } from './lib/compose-window';
import {
  mailRemoteChangeEventSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';

const courrier = {
  platform: process.platform,
  auth: {
    getSession: () => ipcRenderer.invoke('auth:get-session') as Promise<AuthSession>,
    signIn: (providerId: ProviderId) =>
      ipcRenderer.invoke('auth:sign-in', providerId) as Promise<AuthSession>,
    switchAccount: (accountId: string) =>
      ipcRenderer.invoke('auth:switch-account', accountId) as Promise<AuthSession>,
    signOut: (accountId?: string) =>
      ipcRenderer.invoke('auth:sign-out', accountId) as Promise<AuthSession>,
  },
  mail: {
    listFolders: (accountId: string) =>
      ipcRenderer.invoke('mail:list-folders', accountId) as Promise<MailFolder[]>,
    listMessages: (
      accountId: string,
      folderId: string,
      pageToken?: string,
      searchQuery?: string,
    ) =>
      ipcRenderer.invoke(
        'mail:list-messages',
        accountId,
        folderId,
        pageToken,
        searchQuery,
      ) as Promise<PagedMessages>,
    getMessage: (accountId: string, folderId: string, messageId: string) =>
      ipcRenderer.invoke(
        'mail:get-message',
        accountId,
        folderId,
        messageId,
      ) as Promise<MailMessageDetail | undefined>,
    markMessageReadState: (
      accountId: string,
      messageId: string,
      isRead: boolean,
    ) =>
      ipcRenderer.invoke(
        'mail:mark-message-read-state',
        accountId,
        messageId,
        isRead,
      ) as Promise<void>,
    moveMessage: (
      accountId: string,
      messageId: string,
      sourceFolderId: string,
      destinationFolderId: string,
    ) =>
      ipcRenderer.invoke(
        'mail:move-message',
        accountId,
        messageId,
        sourceFolderId,
        destinationFolderId,
      ) as Promise<MailMessageDetail>,
    deleteMessage: (accountId: string, messageId: string) =>
      ipcRenderer.invoke(
        'mail:delete-message',
        accountId,
        messageId,
      ) as Promise<MailMessageDetail>,
    listPeople: (accountId: string, query?: string) =>
      ipcRenderer.invoke(
        'mail:list-people',
        accountId,
        query,
      ) as Promise<MailPersonSuggestion[]>,
    sendMessage: (accountId: string, input: SendMailInput) =>
      ipcRenderer.invoke('mail:send-message', accountId, input) as Promise<void>,
    replyToMessage: (accountId: string, input: ReplyToMessageInput) =>
      ipcRenderer.invoke('mail:reply-to-message', accountId, input) as Promise<void>,
    onRemoteChange: (listener: (event: MailRemoteChangeEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, change: unknown) => {
        const result = mailRemoteChangeEventSchema.safeParse(change);

        if (result.success) {
          listener(result.data);
        }
      };

      ipcRenderer.on('mail:remote-change', handler);
      return () => {
        ipcRenderer.removeListener('mail:remote-change', handler);
      };
    },
  },
  window: {
    closeCurrent: () => ipcRenderer.invoke('window:close-current') as Promise<void>,
    getComposeDraft: () =>
      ipcRenderer.invoke('window:get-compose-draft') as Promise<
        ComposeWindowDraft | undefined
      >,
    openComposeWindow: (draft: ComposeWindowDraft) =>
      ipcRenderer.invoke('window:open-compose', draft) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('courrier', courrier);

export type CourrierApi = typeof courrier;
