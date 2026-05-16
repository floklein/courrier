export type FolderIcon =
  | 'inbox'
  | 'send'
  | 'folder'
  | 'file'
  | 'mail-x'
  | 'archive'
  | 'trash'
  | 'star'
  | 'clock';

export interface MailFolder {
  id: string;
  label: string;
  icon: FolderIcon;
  unreadCount: number;
  totalCount: number;
  parentFolderId?: string;
  wellKnownName?: string;
  hasChildren: boolean;
  depth: number;
}

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailComposeRecipient {
  name?: string;
  email: string;
}

export interface MailPersonSuggestion {
  id: string;
  name: string;
  email: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline?: boolean;
}

export interface LocalMailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  providerAttachmentId?: string;
}

export interface SendMailInput {
  toRecipients: MailComposeRecipient[];
  subject: string;
  bodyHtml: string;
  attachments?: LocalMailAttachment[];
}

export interface ReplyToMessageInput {
  messageId: string;
  bodyHtml: string;
  attachments?: LocalMailAttachment[];
}

export type MailDraftKind = 'new' | 'reply' | 'replyAll' | 'forward';

export interface MailDraftSaveInput {
  providerDraftId?: string;
  providerDraftMessageId?: string;
  kind: MailDraftKind;
  relatedMessageId?: string;
  toRecipients: MailComposeRecipient[];
  toValue: string;
  ccValue?: string;
  bccValue?: string;
  subject: string;
  bodyHtml: string;
  editorValue: {
    html: string;
    text: string;
    isEmpty: boolean;
  };
  attachments?: LocalMailAttachment[];
}

export interface MailDraftSummary {
  providerDraftId: string;
  providerDraftMessageId?: string;
  accountId: string;
  kind: MailDraftKind;
  relatedMessageId?: string;
  toValue: string;
  ccValue?: string;
  bccValue?: string;
  subject: string;
  editorValue: {
    html: string;
    text: string;
    isEmpty: boolean;
  };
  attachments: LocalMailAttachment[];
  createdAt: string;
  updatedAt: string;
}

export type MailDraftDetail = MailDraftSummary;

export interface MailMessageSummary {
  id: string;
  folderId: string;
  sender: MailAddress;
  recipients: string[];
  subject: string;
  preview: string;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: 'low' | 'normal' | 'high';
}

export interface MailMessageDetail extends MailMessageSummary {
  bodyContentType: 'html' | 'text';
  bodyContent: string;
  attachments: MailAttachment[];
}

export interface PagedMessages {
  messages: MailMessageSummary[];
  nextPageToken?: string;
}

export type ProviderId = 'microsoft' | 'google';

export interface MailAccount {
  id: string;
  providerId: ProviderId;
  providerAccountId: string;
  email: string;
  name?: string;
  label: string;
}

export interface ProviderConfigurationStatus {
  providerId: ProviderId;
  displayName: string;
  isConfigured: boolean;
  message?: string;
}

export type AuthSession =
  | {
      status: 'authenticated';
      activeAccount: MailAccount;
      accounts: MailAccount[];
      providers: ProviderConfigurationStatus[];
    }
  | {
      status: 'unauthenticated';
      accounts: MailAccount[];
      providers: ProviderConfigurationStatus[];
    }
  | {
      status: 'configuration-error';
      message: string;
      accounts: MailAccount[];
      providers: ProviderConfigurationStatus[];
    };
