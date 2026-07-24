import type {
  FolderIcon,
  MailAddress,
  MailAttachment,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
} from '@/lib/mail-types';

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
  parentFolderId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  importance?: string | null;
  flag?: {
    flagStatus?: string | null;
  } | null;
  from?: GraphEmailAddress | null;
  toRecipients?: GraphEmailAddress[] | null;
  ccRecipients?: GraphEmailAddress[] | null;
  bccRecipients?: GraphEmailAddress[] | null;
  replyTo?: GraphEmailAddress[] | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

export interface GraphMessageDetail extends GraphMessage {
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
  attachments?: GraphAttachment[] | null;
}

export interface GraphAttachment {
  '@odata.type'?: string | null;
  id?: string | null;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
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
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParentId = new Map<string, MailFolder[]>();
  const roots: MailFolder[] = [];

  for (const folder of folders) {
    if (folder.parentFolderId && foldersById.has(folder.parentFolderId)) {
      const siblings = childrenByParentId.get(folder.parentFolderId) ?? [];
      siblings.push(folder);
      childrenByParentId.set(folder.parentFolderId, siblings);
      continue;
    }

    roots.push(folder);
  }

  const sorted: MailFolder[] = [];
  const visited = new Set<string>();

  function visit(folder: MailFolder) {
    if (visited.has(folder.id)) {
      return;
    }

    visited.add(folder.id);
    sorted.push(folder);

    for (const child of sortFolderSiblings(
      childrenByParentId.get(folder.id) ?? [],
    )) {
      visit(child);
    }
  }

  for (const folder of sortFolderSiblings(roots)) {
    visit(folder);
  }

  return sorted;
}

function sortFolderSiblings(folders: MailFolder[]) {
  return [...folders].sort((left, right) => {
    const leftOrder = getFolderOrder(left);
    const rightOrder = getFolderOrder(right);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    const labelOrder = left.label.localeCompare(right.label);

    if (labelOrder !== 0) {
      return labelOrder;
    }

    return left.id.localeCompare(right.id);
  });
}

export function mapGraphMessageSummary(
  folderId: string,
  message: GraphMessage,
): MailMessageSummary {
  return {
    id: message.id || '',
    folderId,
    folderLabel: undefined,
    folderWellKnownName: undefined,
    sender: mapAddress(message.from, 'Unknown sender'),
    recipients: (message.toRecipients ?? []).map(formatRecipient),
    ccRecipients: (message.ccRecipients ?? []).map(formatRecipient),
    replyTo: (message.replyTo ?? []).map((recipient) =>
      mapAddress(recipient, 'Unknown recipient'),
    ),
    subject: message.subject || '(No subject)',
    preview: message.bodyPreview || '',
    receivedDateTime: message.receivedDateTime || '',
    isRead: message.isRead ?? true,
    hasAttachments: message.hasAttachments ?? false,
    importance: mapImportance(message.importance),
    isFlagged: message.flag?.flagStatus === 'flagged',
    isImportant: mapImportance(message.importance) === 'high',
    internetMessageId: message.internetMessageId || undefined,
    conversationId: message.conversationId || undefined,
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
    attachments: (message.attachments ?? [])
      .filter(isGraphFileAttachment)
      .map(mapGraphAttachment)
      .filter((attachment) => attachment.id && !attachment.isInline),
  };
}

function isGraphFileAttachment(attachment: GraphAttachment) {
  return attachment['@odata.type'] === '#microsoft.graph.fileAttachment';
}

function mapGraphAttachment(attachment: GraphAttachment): MailAttachment {
  return {
    id: attachment.id || '',
    name: attachment.name || 'attachment',
    contentType: attachment.contentType || 'application/octet-stream',
    size: attachment.size ?? 0,
    isInline: attachment.isInline ?? false,
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
