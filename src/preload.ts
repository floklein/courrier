import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthSession,
  MailFolder,
  MailMessageDetail,
  PagedMessages,
} from './lib/mail-types';

const courrier = {
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
      ) as Promise<MailMessageDetail>,
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
  },
};

contextBridge.exposeInMainWorld('courrier', courrier);

export type CourrierApi = typeof courrier;
