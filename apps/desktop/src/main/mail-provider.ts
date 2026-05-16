import type {
  MailAccount,
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  MailDraftDetail,
  MailDraftSaveInput,
  MailDraftSummary,
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

export interface ProviderDraftSaveInput extends Omit<MailDraftSaveInput, 'attachments'> {
  attachments?: Array<LocalAttachmentFile | NonNullable<MailDraftSaveInput['attachments']>[number]>;
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
  listPeople(accountId: string, query?: string): Promise<MailPersonSuggestion[]>;
  listDrafts(accountId: string): Promise<MailDraftSummary[]>;
  getDraft(accountId: string, providerDraftId: string): Promise<MailDraftDetail>;
  createDraft(
    accountId: string,
    input: ProviderDraftSaveInput,
  ): Promise<MailDraftDetail>;
  updateDraft(
    accountId: string,
    providerDraftId: string,
    input: ProviderDraftSaveInput,
  ): Promise<MailDraftDetail>;
  deleteDraft(accountId: string, providerDraftId: string): Promise<void>;
  sendDraft(accountId: string, providerDraftId: string): Promise<void>;
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
