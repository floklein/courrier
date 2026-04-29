import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  PagedMessages,
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
    signIn: () => ipcRenderer.invoke('auth:sign-in') as Promise<AuthSession>,
    signOut: () => ipcRenderer.invoke('auth:sign-out') as Promise<AuthSession>,
  },
  mail: {
    listFolders: () =>
      ipcRenderer.invoke('mail:list-folders') as Promise<MailFolder[]>,
    listMessages: (folderId: string, pageUrl?: string, searchQuery?: string) =>
      ipcRenderer.invoke(
        'mail:list-messages',
        folderId,
        pageUrl,
        searchQuery,
      ) as Promise<PagedMessages>,
    getMessage: (folderId: string, messageId: string) =>
      ipcRenderer.invoke(
        'mail:get-message',
        folderId,
        messageId,
      ) as Promise<MailMessageDetail | undefined>,
    markMessageReadState: (messageId: string, isRead: boolean) =>
      ipcRenderer.invoke(
        'mail:mark-message-read-state',
        messageId,
        isRead,
      ) as Promise<void>,
    moveMessage: (messageId: string, destinationFolderId: string) =>
      ipcRenderer.invoke(
        'mail:move-message',
        messageId,
        destinationFolderId,
      ) as Promise<MailMessageDetail>,
    deleteMessage: (messageId: string) =>
      ipcRenderer.invoke(
        'mail:delete-message',
        messageId,
      ) as Promise<MailMessageDetail>,
    sendMessage: (input: SendMailInput) =>
      ipcRenderer.invoke('mail:send-message', input) as Promise<void>,
    replyToMessage: (input: ReplyToMessageInput) =>
      ipcRenderer.invoke('mail:reply-to-message', input) as Promise<void>,
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
