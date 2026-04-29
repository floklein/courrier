import type {
  FolderIcon,
  MailAddress,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
} from './mail-types';

interface GraphEmailAddress {
  emailAddress?: {
    name?: string | null;
    address?: string | null;
  } | null;
}

export interface GraphMailFolder {
  id?: string | null;
  displayName?: string | null;
  parentFolderId?: string | null;
  totalItemCount?: number | null;
  unreadItemCount?: number | null;
  childFolderCount?: number | null;
  wellKnownName?: string | null;
}

export interface GraphMessage {
  id?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  importance?: string | null;
  from?: GraphEmailAddress | null;
  toRecipients?: GraphEmailAddress[] | null;
}

export interface GraphMessageDetail extends GraphMessage {
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
}

const wellKnownFolderOrder = [
  'inbox',
  'drafts',
  'sentitems',
  'archive',
  'deleteditems',
  'junkemail',
];

const wellKnownIcons: Record<string, FolderIcon> = {
  inbox: 'inbox',
  drafts: 'file',
  sentitems: 'send',
  archive: 'archive',
  deleteditems: 'trash',
  junkemail: 'mail-x',
};

export function mapGraphFolder(
  folder: GraphMailFolder,
  depth = 0,
): MailFolder {
  const wellKnownName = folder.wellKnownName?.toLowerCase() || undefined;

  return {
    id: folder.id || '',
    label: folder.displayName || 'Untitled folder',
    icon: wellKnownName
      ? (wellKnownIcons[wellKnownName] ?? 'folder')
      : 'folder',
    unreadCount: folder.unreadItemCount ?? 0,
    totalCount: folder.totalItemCount ?? 0,
    parentFolderId: folder.parentFolderId || undefined,
    wellKnownName,
    hasChildren: (folder.childFolderCount ?? 0) > 0,
    depth,
  };
}

export function sortMailFolders(folders: MailFolder[]) {
  return [...folders].sort((left, right) => {
    const leftOrder = getFolderOrder(left);
    const rightOrder = getFolderOrder(right);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return left.label.localeCompare(right.label);
  });
}

export function mapGraphMessageSummary(
  folderId: string,
  message: GraphMessage,
): MailMessageSummary {
  return {
    id: message.id || '',
    folderId,
    sender: mapAddress(message.from, 'Unknown sender'),
    recipients: (message.toRecipients ?? []).map(formatRecipient),
    subject: message.subject || '(No subject)',
    preview: message.bodyPreview || '',
    receivedDateTime: message.receivedDateTime || '',
    isRead: message.isRead ?? true,
    hasAttachments: message.hasAttachments ?? false,
    importance: mapImportance(message.importance),
  };
}

export function mapGraphMessageDetail(
  folderId: string,
  message: GraphMessageDetail,
): MailMessageDetail {
  const summary = mapGraphMessageSummary(folderId, message);
  const contentType =
    message.body?.contentType?.toLowerCase() === 'text' ? 'text' : 'html';

  return {
    ...summary,
    bodyContentType: contentType,
    bodyContent: message.body?.content || '',
  };
}

function getFolderOrder(folder: MailFolder) {
  if (!folder.wellKnownName) {
    return wellKnownFolderOrder.length;
  }

  const index = wellKnownFolderOrder.indexOf(folder.wellKnownName);
  return index === -1 ? wellKnownFolderOrder.length : index;
}

function mapAddress(
  address: GraphEmailAddress | null | undefined,
  fallbackName: string,
): MailAddress {
  return {
    name: address?.emailAddress?.name || fallbackName,
    email: address?.emailAddress?.address || '',
  };
}

function formatRecipient(recipient: GraphEmailAddress) {
  const address = mapAddress(recipient, 'Unknown recipient');

  if (!address.email) {
    return address.name;
  }

  return `${address.name} <${address.email}>`;
}

function mapImportance(importance: string | null | undefined) {
  if (importance === 'low' || importance === 'high') {
    return importance;
  }

  return 'normal';
}
