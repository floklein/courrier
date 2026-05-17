import type {
  MailAccount,
  MailActionCapability,
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  PagedMessages,
  ProviderId,
  ReplyToMessageInput,
  SendMailInput,
} from '@/lib/mail-types';

export interface MailAuthProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  getConfigurationError(): string | undefined;
  getAccounts(): Promise<MailAccount[]>;
  signIn(): Promise<MailAccount | undefined>;
  signOut(accountId: string): Promise<void>;
  getAccessToken(accountId: string): Promise<string>;
}

export interface MoveMessageInput {
  messageId: string;
  sourceFolderId: string;
  destinationFolderId: string;
}

export interface LocalAttachmentFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  path: string;
}

export interface ProviderSendMailInput extends Omit<SendMailInput, 'attachments'> {
  attachments?: LocalAttachmentFile[];
}

export interface ProviderReplyToMessageInput extends Omit<ReplyToMessageInput, 'attachments'> {
  attachments?: LocalAttachmentFile[];
}

export interface DownloadedMailAttachment {
  name: string;
  contentType: string;
  content: Buffer;
}

export interface MailSubscriptionProvider {
  createMailSubscription(input: CreateMailSubscriptionInput): Promise<MailSubscription>;
  renewSubscription(input: RenewSubscriptionInput): Promise<MailSubscription>;
  deleteSubscription(account: MailAccount, subscriptionId: string): Promise<void>;
  getNotificationUrl(relayPublicUrl: string): string;
}

export interface CreateMailSubscriptionInput {
  account: MailAccount;
  clientState: string;
  expirationDateTime: string;
  notificationUrl: string;
}

export interface RenewSubscriptionInput {
  account: MailAccount;
  subscriptionId: string;
  expirationDateTime: string;
}

export interface MailSubscription {
  id: string;
  expirationDateTime: string;
  resource?: string;
}

export interface MailProvider extends MailSubscriptionProvider {
  readonly id: ProviderId;
  getCapabilities(accountId: string): Promise<MailActionCapability[]>;
  listFolders(accountId: string): Promise<MailFolder[]>;
  listMessages(
    accountId: string,
    folderId: string,
    nextPageToken?: string,
    searchQuery?: string,
  ): Promise<PagedMessages>;
  getMessage(
    accountId: string,
    folderId: string,
    messageId: string,
  ): Promise<MailMessageDetail>;
  markMessageReadState(
    accountId: string,
    messageId: string,
    isRead: boolean,
  ): Promise<void>;
  moveMessage(accountId: string, input: MoveMessageInput): Promise<MailMessageDetail>;
  deleteMessage(
    accountId: string,
    messageId: string,
  ): Promise<MailMessageDetail | undefined>;
  archiveMessage(
    accountId: string,
    messageId: string,
    sourceFolderId: string,
  ): Promise<MailMessageDetail | undefined>;
  markMessageJunkState(
    accountId: string,
    messageId: string,
    isJunk: boolean,
  ): Promise<MailMessageDetail | undefined>;
  setMessageStarState(
    accountId: string,
    messageId: string,
    isStarred: boolean,
  ): Promise<void>;
  setMessageFlagState(
    accountId: string,
    messageId: string,
    isFlagged: boolean,
  ): Promise<void>;
  setMessageImportantState(
    accountId: string,
    messageId: string,
    isImportant: boolean,
  ): Promise<void>;
  listPeople(accountId: string, query?: string): Promise<MailPersonSuggestion[]>;
  sendMessage(accountId: string, input: ProviderSendMailInput): Promise<void>;
  replyToMessage(accountId: string, input: ProviderReplyToMessageInput): Promise<void>;
  downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedMailAttachment>;
}

export interface RegisteredProvider {
  auth: MailAuthProvider;
  mail: MailProvider;
}

export function getProviderFromAccountId(accountId: string): ProviderId | undefined {
  const [providerId] = accountId.split(':', 1);

  return providerId === 'microsoft' || providerId === 'google'
    ? providerId
    : undefined;
}
