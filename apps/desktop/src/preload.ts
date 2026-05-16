import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AuthSession,
  LocalMailAttachment,
  MailActionCapability,
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  SearchMessagesInput,
  PagedMessages,
  ProviderId,
  ReplyToMessageInput,
  SendMailInput,
} from '@/lib/mail-types';
import type { ComposeWindowDraft } from '@/lib/compose-window';
import {
  mailRemoteChangeEventSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';

interface OpenMailMessagePayload {
  folderId: string;
  messageId: string;
}

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
  attachments: {
    pickLocal: () =>
      ipcRenderer.invoke('attachment:pick-local') as Promise<LocalMailAttachment[]>,
    registerDroppedFiles: (files: File[]) =>
      ipcRenderer.invoke(
        'attachment:register-local-files',
        files
          .map((file) => ({
            path: webUtils.getPathForFile(file),
            name: file.name,
            contentType: file.type,
            size: file.size,
          }))
          .filter((file) => file.path),
      ) as Promise<LocalMailAttachment[]>,
    open: (accountId: string, messageId: string, attachmentId: string) =>
      ipcRenderer.invoke(
        'attachment:open',
        accountId,
        messageId,
        attachmentId,
      ) as Promise<void>,
    download: (accountId: string, messageId: string, attachmentId: string) =>
      ipcRenderer.invoke(
        'attachment:download',
        accountId,
        messageId,
        attachmentId,
      ) as Promise<boolean>,
  },
  mail: {
    getCapabilities: (accountId: string) =>
      ipcRenderer.invoke(
        'mail:get-capabilities',
        accountId,
      ) as Promise<MailActionCapability[]>,
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
    searchMessages: (accountId: string, input: SearchMessagesInput) =>
      ipcRenderer.invoke(
        'mail:search-messages',
        accountId,
        input,
      ) as Promise<PagedMessages>,
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
    archiveMessage: (
      accountId: string,
      messageId: string,
      sourceFolderId: string,
    ) =>
      ipcRenderer.invoke(
        'mail:archive-message',
        accountId,
        messageId,
        sourceFolderId,
      ) as Promise<MailMessageDetail | undefined>,
    markMessageJunkState: (
      accountId: string,
      messageId: string,
      isJunk: boolean,
    ) =>
      ipcRenderer.invoke(
        'mail:mark-message-junk-state',
        accountId,
        messageId,
        isJunk,
      ) as Promise<MailMessageDetail | undefined>,
    setMessageStarState: (
      accountId: string,
      messageId: string,
      isStarred: boolean,
    ) =>
      ipcRenderer.invoke(
        'mail:set-message-star-state',
        accountId,
        messageId,
        isStarred,
      ) as Promise<void>,
    setMessageFlagState: (
      accountId: string,
      messageId: string,
      isFlagged: boolean,
    ) =>
      ipcRenderer.invoke(
        'mail:set-message-flag-state',
        accountId,
        messageId,
        isFlagged,
      ) as Promise<void>,
    setMessageImportantState: (
      accountId: string,
      messageId: string,
      isImportant: boolean,
    ) =>
      ipcRenderer.invoke(
        'mail:set-message-important-state',
        accountId,
        messageId,
        isImportant,
      ) as Promise<void>,
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
    onOpenMessage: (listener: (payload: OpenMailMessagePayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as OpenMailMessagePayload).folderId === 'string' &&
          typeof (payload as OpenMailMessagePayload).messageId === 'string'
        ) {
          listener(payload as OpenMailMessagePayload);
        }
      };

      ipcRenderer.on('mail:open-message', handler);
      return () => {
        ipcRenderer.removeListener('mail:open-message', handler);
      };
    },
  },
  notifications: {
    getSettings: () =>
      ipcRenderer.invoke('notifications:get-settings') as Promise<{
        enabled: boolean;
        includePreview: boolean;
        silent: boolean;
      }>,
    updateSettings: (settings: {
      enabled?: boolean;
      includePreview?: boolean;
      silent?: boolean;
    }) =>
      ipcRenderer.invoke('notifications:update-settings', settings) as Promise<{
        enabled: boolean;
        includePreview: boolean;
        silent: boolean;
      }>,
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
