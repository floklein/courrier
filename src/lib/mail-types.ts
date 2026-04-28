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

export interface SendMailInput {
  toRecipients: MailComposeRecipient[];
  subject: string;
  bodyHtml: string;
}

export interface ReplyToMessageInput {
  messageId: string;
  bodyHtml: string;
}

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
}

export interface PagedMessages {
  messages: MailMessageSummary[];
  nextPageUrl?: string;
}

export type AuthSession =
  | {
      status: 'authenticated';
      account: {
        homeAccountId: string;
        username: string;
        name?: string;
      };
    }
  | {
      status: 'unauthenticated';
    }
  | {
      status: 'configuration-error';
      message: string;
    };
