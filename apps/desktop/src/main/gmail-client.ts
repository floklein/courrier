import type {
  MailRemoteChangeEvent,
} from '@courrier/mail-contracts';
import type {
  MailAccount,
  MailActionCapability,
  MailAddress,
  MailAttachment,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MailPersonSuggestion,
  PagedMessages,
  SearchMessagesInput,
} from '@/lib/mail-types';
import type {
  CreateMailSubscriptionInput,
  DownloadedMailAttachment,
  MailAuthProvider,
  MailProvider,
  MailNotificationResolution,
  MailNotificationState,
  MailSubscription,
  MoveMessageInput,
  ProviderReplyToMessageInput,
  ProviderSendMailInput,
  RenewSubscriptionInput,
} from '@/main/mail-provider';
import MailComposer from 'nodemailer/lib/mail-composer';

const gmailBaseUrl = 'https://gmail.googleapis.com/gmail/v1';
const peopleBaseUrl = 'https://people.googleapis.com/v1';
const gmailPageSize = '25';
const messageMetadataHeaders = ['From', 'To', 'Subject', 'Date'];
const detailHeaders = [
  'From',
  'Reply-To',
  'To',
  'Cc',
  'Subject',
  'Date',
  'Message-ID',
  'References',
  'In-Reply-To',
];

interface GmailLabel {
  id?: string;
  name?: string;
  type?: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
}

interface GmailListLabelsResponse {
  labels?: GmailLabel[];
}

interface GmailMessageListItem {
  id?: string;
  threadId?: string;
}

interface GmailListMessagesResponse {
  messages?: GmailMessageListItem[];
  nextPageToken?: string;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePartBody {
  attachmentId?: string;
  data?: string;
  size?: number;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

interface GmailMessage extends GmailMessagePart {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailWatchResponse {
  historyId?: string;
  expiration?: string;
}

interface GmailAttachmentResponse {
  data?: string;
  size?: number;
}

interface GmailHistoryResponse {
  historyId?: string;
  history?: Array<{
    messagesAdded?: Array<{ message?: GmailMessageListItem }>;
    labelsAdded?: Array<{
      message?: GmailMessageListItem;
      labelIds?: string[];
    }>;
  }>;
}

interface PeopleSearchResponse {
  results?: Array<{
    person?: {
      resourceName?: string;
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string; displayName?: string }>;
    };
  }>;
}

export class GmailClient implements MailProvider {
  readonly id = 'google' as const;

  constructor(private readonly authProvider: MailAuthProvider) {}

  async getCapabilities(): Promise<MailActionCapability[]> {
    return ['archive', 'junk', 'star', 'important'];
  }

  async listFolders(accountId: string): Promise<MailFolder[]> {
    const data = await this.fetchGmail<GmailListLabelsResponse>(
      accountId,
      `${gmailBaseUrl}/users/me/labels`,
    );
    const labels = (data.labels ?? []).filter(
      (label) => label.id && label.name && !isHiddenGmailLabel(label.id),
    );
    const hydratedLabels = await Promise.all(
      labels.map(async (label) => ({
        ...label,
        ...(await this.getLabel(accountId, label.id ?? '')),
      })),
    );

    return sortGmailFolders(hydratedLabels.map(mapGmailLabel));
  }

  async listMessages(
    accountId: string,
    folderId: string,
    nextPageToken?: string,
    searchQuery?: string,
  ): Promise<PagedMessages> {
    const params = new URLSearchParams({
      maxResults: gmailPageSize,
    });
    const search = searchQuery?.trim();

    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    params.append('labelIds', folderId);

    if (isGmailInboxCategory(folderId)) {
      params.append('labelIds', 'INBOX');
    }

    if (search) {
      params.set('q', search);
    }

    const data = await this.fetchGmail<GmailListMessagesResponse>(
      accountId,
      `${gmailBaseUrl}/users/me/messages?${params.toString()}`,
    );
    const messages = await Promise.all(
      (data.messages ?? [])
        .filter((message) => message.id)
        .map((message) =>
          this.getMessageSummary(accountId, folderId, message.id ?? ''),
        ),
    );

    return {
      messages,
      nextPageToken: data.nextPageToken,
    };
  }

  async searchMessages(
    accountId: string,
    input: SearchMessagesInput,
  ): Promise<PagedMessages> {
    if (input.scope === 'folder') {
      return this.listMessages(
        accountId,
        input.folderId ?? 'INBOX',
        input.nextPageToken,
        input.query,
      );
    }

    const params = new URLSearchParams({
      maxResults: gmailPageSize,
      q: input.query.trim(),
    });

    if (input.nextPageToken) {
      params.set('pageToken', input.nextPageToken);
    }

    if (input.includeSpamTrash) {
      params.set('includeSpamTrash', 'true');
    }

    const [data, folders] = await Promise.all([
      this.fetchGmail<GmailListMessagesResponse>(
        accountId,
        `${gmailBaseUrl}/users/me/messages?${params.toString()}`,
      ),
      this.listFolders(accountId),
    ]);
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    const messages = await Promise.all(
      (data.messages ?? [])
        .filter((message) => message.id)
        .map(async (message) => {
          const summary = await this.getMessageSummary(
            accountId,
            input.folderId ?? 'INBOX',
            message.id ?? '',
          );
          const matchedFolderIds = summary.matchedFolderIds ?? [];
          const displayFolderId =
            getPreferredDisplayFolderId(matchedFolderIds) ?? summary.folderId;
          const folder = foldersById.get(displayFolderId);

          return {
            ...summary,
            folderId: displayFolderId,
            folderLabel: folder?.label ?? getGmailDisplayName(displayFolderId, displayFolderId),
            folderWellKnownName: folder?.wellKnownName,
          };
        }),
    );

    return {
      messages,
      nextPageToken: data.nextPageToken,
    };
  }

  async getMessage(
    accountId: string,
    folderId: string,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const params = new URLSearchParams({
      format: 'full',
    });

    for (const header of detailHeaders) {
      params.append('metadataHeaders', header);
    }

    const message = await this.fetchGmail<GmailMessage>(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(
        messageId,
      )}?${params.toString()}`,
    );

    return mapGmailMessageDetail(folderId, message);
  }

  async getNotificationMessages(
    accountId: string,
    event: MailRemoteChangeEvent,
    state: MailNotificationState = {},
  ): Promise<MailNotificationResolution> {
    if (event.kind !== 'message-change' || event.providerId !== 'google') {
      return { messages: [], state };
    }

    const historyId = event.historyId ?? event.subscriptionId;

    if (!state.gmailLastHistoryId) {
      return {
        messages: [],
        state: { ...state, gmailLastHistoryId: historyId },
      };
    }

    const params = new URLSearchParams({
      startHistoryId: state.gmailLastHistoryId,
      historyTypes: 'messageAdded',
    });
    const data = await this.fetchGmail<GmailHistoryResponse>(
      accountId,
      `${gmailBaseUrl}/users/me/history?${params.toString()}`,
    );
    const candidateIds = new Set<string>();

    for (const item of data.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        if (added.message?.id) {
          candidateIds.add(added.message.id);
        }
      }

      for (const labels of item.labelsAdded ?? []) {
        if (labels.message?.id && labels.labelIds?.includes('INBOX')) {
          candidateIds.add(labels.message.id);
        }
      }
    }

    const messages = (
      await Promise.all(
        [...candidateIds].map((messageId) =>
          this.getMessageSummary(accountId, 'INBOX', messageId),
        ),
      )
    ).filter((message) =>
      !message.isRead && message.matchedFolderIds?.includes('INBOX'),
    );

    return {
      messages,
      state: {
        ...state,
        gmailLastHistoryId: data.historyId ?? historyId,
      },
    };
  }

  async markMessageReadState(
    accountId: string,
    messageId: string,
    isRead: boolean,
  ): Promise<void> {
    await this.modifyMessage(accountId, messageId, {
      addLabelIds: isRead ? [] : ['UNREAD'],
      removeLabelIds: isRead ? ['UNREAD'] : [],
    });
  }

  async moveMessage(
    accountId: string,
    { messageId, sourceFolderId, destinationFolderId }: MoveMessageInput,
  ): Promise<MailMessageDetail> {
    const removeLabelIds =
      sourceFolderId && sourceFolderId !== destinationFolderId
        ? [sourceFolderId]
        : [];
    const message = await this.modifyMessage(accountId, messageId, {
      addLabelIds: [destinationFolderId],
      removeLabelIds,
    });

    return mapGmailMessageDetail(destinationFolderId, message);
  }

  async deleteMessage(accountId: string, messageId: string): Promise<undefined> {
    await this.fetchGmail(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(messageId)}/trash`,
      { method: 'POST' },
    );
    return undefined;
  }

  async archiveMessage(
    accountId: string,
    messageId: string,
    sourceFolderId?: string,
  ): Promise<MailMessageDetail> {
    const removeLabelId = getGmailArchiveSourceLabel(sourceFolderId);
    const message = await this.modifyMessage(accountId, messageId, {
      removeLabelIds: [removeLabelId],
    });

    return mapGmailMessageDetail(
      message.labelIds?.find((labelId) => labelId !== removeLabelId) ??
        removeLabelId,
      message,
    );
  }

  async markMessageJunkState(
    accountId: string,
    messageId: string,
    isJunk: boolean,
  ): Promise<MailMessageDetail> {
    const message = await this.modifyMessage(accountId, messageId, {
      addLabelIds: isJunk ? ['SPAM'] : ['INBOX'],
      removeLabelIds: isJunk ? ['INBOX'] : ['SPAM'],
    });

    return mapGmailMessageDetail(isJunk ? 'SPAM' : 'INBOX', message);
  }

  async setMessageStarState(
    accountId: string,
    messageId: string,
    isStarred: boolean,
  ): Promise<void> {
    await this.modifyMessage(accountId, messageId, {
      addLabelIds: isStarred ? ['STARRED'] : [],
      removeLabelIds: isStarred ? [] : ['STARRED'],
    });
  }

  async setMessageFlagState(): Promise<void> {
    throw new Error('Flag is not supported for Gmail accounts.');
  }

  async setMessageImportantState(
    accountId: string,
    messageId: string,
    isImportant: boolean,
  ): Promise<void> {
    await this.modifyMessage(accountId, messageId, {
      addLabelIds: isImportant ? ['IMPORTANT'] : [],
      removeLabelIds: isImportant ? [] : ['IMPORTANT'],
    });
  }

  async listPeople(
    accountId: string,
    query?: string,
  ): Promise<MailPersonSuggestion[]> {
    const search = query?.trim();

    if (!search) {
      return [];
    }

    const params = new URLSearchParams({
      query: search,
      readMask: 'names,emailAddresses',
      pageSize: '10',
    });
    const data = await this.fetchPeople<PeopleSearchResponse>(
      accountId,
      `${peopleBaseUrl}/people:searchContacts?${params.toString()}`,
    );

    return mapPeopleSuggestions(data);
  }

  async sendMessage(accountId: string, input: ProviderSendMailInput): Promise<void> {
    await this.fetchGmail(accountId, `${gmailBaseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: await createRawMail({
          attachments: input.attachments ?? [],
          bodyHtml: input.bodyHtml,
          bccRecipients: input.bccRecipients ?? [],
          ccRecipients: input.ccRecipients ?? [],
          subject: input.subject,
          toRecipients: input.toRecipients,
        }),
      }),
    });
  }

  async replyToMessage(
    accountId: string,
    input: ProviderReplyToMessageInput,
  ): Promise<void> {
    const original =
      (input.kind ?? 'reply') === 'forward'
        ? await this.getFullMessage(accountId, input.messageId)
        : await this.getRawMessage(accountId, input.messageId);
    const headers = getHeaderMap(original.payload?.headers);
    const accountEmail = await this.getAccountEmail(accountId);
    const kind = input.kind ?? 'reply';
    const replyAllRecipients =
      kind === 'replyAll'
        ? getGmailReplyAllRecipients(headers, accountEmail)
        : undefined;
    const toRecipients =
      input.toRecipients ??
      (kind === 'replyAll'
        ? replyAllRecipients?.toRecipients ?? []
        : kind === 'forward'
          ? []
          : getGmailReplyRecipients(headers));
    const ccRecipients =
      input.ccRecipients ??
      (kind === 'replyAll' ? replyAllRecipients?.ccRecipients ?? [] : []);
    const subject =
      kind === 'forward'
        ? createForwardSubject(headers.get('subject') ?? '')
        : createReplySubject(headers.get('subject') ?? '');
    const messageId = headers.get('message-id');
    const references = [headers.get('references'), messageId]
      .filter(Boolean)
      .join(' ');

    if (toRecipients.length === 0) {
      throw new Error('Gmail reply target is missing a sender address.');
    }

    await this.fetchGmail(accountId, `${gmailBaseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: await createRawMail({
          attachments: input.attachments ?? [],
          bodyHtml:
            kind === 'forward'
              ? createForwardBodyHtml(input.bodyHtml, original)
              : input.bodyHtml,
          bccRecipients: input.bccRecipients ?? [],
          ccRecipients,
          subject,
          toRecipients,
          extraHeaders: {
            ...(kind !== 'forward' && messageId ? { 'In-Reply-To': messageId } : {}),
            ...(kind !== 'forward' && references ? { References: references } : {}),
          },
        }),
        ...(kind === 'forward' ? {} : { threadId: original.threadId }),
      }),
    });
  }

  async downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedMailAttachment> {
    const message = await this.getFullMessage(accountId, messageId);
    const part = findAttachmentPart(message.payload, attachmentId);

    if (!part) {
      throw new Error('Gmail attachment was not found.');
    }

    const data =
      part.body?.data ??
      (
        await this.fetchGmail<GmailAttachmentResponse>(
          accountId,
          `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(
            messageId,
          )}/attachments/${encodeURIComponent(attachmentId)}`,
        )
      ).data;

    if (data == null) {
      throw new Error('Gmail did not return attachment content.');
    }

    return {
      name: part.filename || 'attachment',
      contentType: part.mimeType || 'application/octet-stream',
      content: decodeBase64UrlBuffer(data),
    };
  }

  async createMailSubscription(
    input: CreateMailSubscriptionInput,
  ): Promise<MailSubscription> {
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;

    if (!topicName) {
      throw new Error('GOOGLE_PUBSUB_TOPIC is missing; Gmail live updates are disabled.');
    }

    const data = await this.fetchGmail<GmailWatchResponse>(
      input.account.id,
      `${gmailBaseUrl}/users/me/watch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName,
          labelFilterBehavior: 'include',
          labelIds: ['INBOX'],
        }),
      },
    );

    return {
      id: data.historyId ?? input.account.providerAccountId,
      expirationDateTime: data.expiration
        ? new Date(Number(data.expiration)).toISOString()
        : input.expirationDateTime,
      resource: input.account.email,
    };
  }

  async renewSubscription(
    input: RenewSubscriptionInput,
  ): Promise<MailSubscription> {
    return this.createMailSubscription({
      account: input.account,
      clientState: '',
      expirationDateTime: input.expirationDateTime,
      notificationUrl: '',
    });
  }

  async deleteSubscription(account: MailAccount): Promise<void> {
    await this.fetchGmail(account.id, `${gmailBaseUrl}/users/me/stop`, {
      method: 'POST',
    });
  }

  getNotificationUrl(relayPublicUrl: string) {
    return new URL('/google/pubsub', relayPublicUrl).toString();
  }

  private async getMessageSummary(
    accountId: string,
    folderId: string,
    messageId: string,
  ) {
    const params = new URLSearchParams({
      format: 'metadata',
    });

    for (const header of messageMetadataHeaders) {
      params.append('metadataHeaders', header);
    }

    const message = await this.fetchGmail<GmailMessage>(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(
        messageId,
      )}?${params.toString()}`,
    );

    return mapGmailMessageSummary(folderId, message);
  }

  private async getRawMessage(accountId: string, messageId: string) {
    const params = new URLSearchParams({
      format: 'metadata',
    });

    for (const header of detailHeaders) {
      params.append('metadataHeaders', header);
    }

    return this.fetchGmail<GmailMessage>(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(
        messageId,
      )}?${params.toString()}`,
    );
  }

  private async getFullMessage(accountId: string, messageId: string) {
    return this.fetchGmail<GmailMessage>(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(
        messageId,
      )}?format=full`,
    );
  }

  private async getAccountEmail(accountId: string) {
    const accounts = await this.authProvider.getAccounts();
    return accounts.find((account) => account.id === accountId)?.email;
  }

  private async getLabel(accountId: string, labelId: string) {
    return this.fetchGmail<GmailLabel>(
      accountId,
      `${gmailBaseUrl}/users/me/labels/${encodeURIComponent(labelId)}`,
    );
  }

  private async modifyMessage(
    accountId: string,
    messageId: string,
    input: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) {
    return this.fetchGmail<GmailMessage>(
      accountId,
      `${gmailBaseUrl}/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  private async fetchGmail<T>(
    accountId: string,
    url: string,
    init: RequestInit = {},
  ) {
    return this.fetchGoogle<T>(accountId, url, gmailBaseUrl, init);
  }

  private async fetchPeople<T>(
    accountId: string,
    url: string,
    init: RequestInit = {},
  ) {
    return this.fetchGoogle<T>(accountId, url, peopleBaseUrl, init);
  }

  private async fetchGoogle<T>(
    accountId: string,
    url: string,
    expectedBaseUrl: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!isExpectedGoogleUrl(url, expectedBaseUrl)) {
      throw new Error('Refusing to fetch an unexpected Google API URL.');
    }

    const token = await this.authProvider.getAccessToken(accountId);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google API request failed: ${response.status} ${body}`);
    }

    const body = await response.text();
    return body ? (JSON.parse(body) as T) : (undefined as T);
  }
}

function mapGmailLabel(label: GmailLabel): MailFolder {
  const id = label.id ?? '';
  const wellKnownName = getGmailWellKnownName(id);

  return {
    id,
    label: getGmailDisplayName(id, label.name),
    icon: getGmailFolderIcon(id),
    unreadCount: label.messagesUnread ?? 0,
    totalCount: label.messagesTotal ?? 0,
    wellKnownName,
    hasChildren: false,
    depth: 0,
  };
}

function mapGmailMessageSummary(
  folderId: string,
  message: GmailMessage,
): MailMessageSummary {
  const headers = getHeaderMap(message.payload?.headers);
  const sender = parseMailbox(headers.get('from') ?? '');

  return {
    id: message.id ?? '',
    folderId,
    sender: sender.email ? sender : { name: sender.name || 'Unknown sender', email: '' },
    recipients: parseMailboxList(headers.get('to') ?? '').map(formatAddress),
    ccRecipients: parseMailboxList(headers.get('cc') ?? '').map(formatAddress),
    replyTo: parseMailboxList(headers.get('reply-to') ?? ''),
    subject: headers.get('subject') || '(No subject)',
    preview: message.snippet ?? '',
    receivedDateTime: mapGmailDate(message, headers),
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
    hasAttachments: hasAttachments(message.payload),
    importance: (message.labelIds ?? []).includes('IMPORTANT') ? 'high' : 'normal',
    isStarred: (message.labelIds ?? []).includes('STARRED'),
    isImportant: (message.labelIds ?? []).includes('IMPORTANT'),
    matchedFolderIds: message.labelIds ?? [],
    internetMessageId: headers.get('message-id') || undefined,
    threadId: message.threadId,
  };
}

function mapGmailMessageDetail(
  folderId: string,
  message: GmailMessage,
): MailMessageDetail {
  const summary = mapGmailMessageSummary(folderId, message);
  const body = extractBody(message.payload);

  return {
    ...summary,
    bodyContentType: body.contentType,
    bodyContent: body.content,
    attachments: collectAttachments(message.payload),
  };
}

function getGmailDisplayName(id: string, name: string | undefined) {
  const map: Record<string, string> = {
    INBOX: 'Inbox',
    DRAFT: 'Drafts',
    SENT: 'Sent',
    TRASH: 'Trash',
    SPAM: 'Spam',
    STARRED: 'Starred',
    IMPORTANT: 'Important',
    CATEGORY_PERSONAL: 'Primary',
    CATEGORY_SOCIAL: 'Social',
    CATEGORY_PROMOTIONS: 'Promotions',
    CATEGORY_UPDATES: 'Updates',
    CATEGORY_FORUMS: 'Forums',
  };

  return map[id] ?? name ?? id;
}

function getPreferredDisplayFolderId(labelIds: string[]) {
  const preferredOrder = ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED'];

  return (
    preferredOrder.find((labelId) => labelIds.includes(labelId)) ??
    labelIds.find((labelId) => !isHiddenGmailLabel(labelId))
  );
}

function sortGmailFolders(folders: MailFolder[]) {
  const order = [
    'INBOX',
    'DRAFT',
    'SENT',
    'CATEGORY_PERSONAL',
    'TRASH',
    'SPAM',
    'CATEGORY_FORUMS',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL',
    'CATEGORY_UPDATES',
    'IMPORTANT',
    'STARRED',
  ];

  return [...folders].sort((left, right) => {
    const leftOrder = order.includes(left.id) ? order.indexOf(left.id) : order.length;
    const rightOrder = order.includes(right.id)
      ? order.indexOf(right.id)
      : order.length;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.label.localeCompare(right.label);
  });
}

function getGmailWellKnownName(id: string) {
  const map: Record<string, string> = {
    INBOX: 'inbox',
    DRAFT: 'drafts',
    SENT: 'sentitems',
    TRASH: 'deleteditems',
    SPAM: 'junkemail',
  };

  return map[id];
}

function getGmailFolderIcon(id: string): MailFolder['icon'] {
  const map: Record<string, MailFolder['icon']> = {
    INBOX: 'inbox',
    DRAFT: 'file',
    SENT: 'send',
    TRASH: 'trash',
    SPAM: 'mail-x',
    STARRED: 'star',
    IMPORTANT: 'important',
  };

  return map[id] ?? 'folder';
}

function isHiddenGmailLabel(id: string | undefined) {
  return id === 'CHAT' || id === 'UNREAD';
}

function isGmailInboxCategory(id: string) {
  return id.startsWith('CATEGORY_');
}

function getGmailArchiveSourceLabel(sourceFolderId: string | undefined) {
  if (
    !sourceFolderId ||
    sourceFolderId === 'INBOX' ||
    isGmailInboxCategory(sourceFolderId)
  ) {
    return 'INBOX';
  }

  return sourceFolderId;
}

function getHeaderMap(headers: GmailHeader[] | undefined) {
  const map = new Map<string, string>();

  for (const header of headers ?? []) {
    if (header.name && header.value) {
      map.set(header.name.toLowerCase(), header.value);
    }
  }

  return map;
}

function mapGmailDate(message: GmailMessage, headers: Map<string, string>) {
  if (message.internalDate && /^\d+$/.test(message.internalDate)) {
    return new Date(Number(message.internalDate)).toISOString();
  }

  const parsed = Date.parse(headers.get('date') ?? '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function extractBody(part: GmailMessagePart | undefined): {
  contentType: 'html' | 'text';
  content: string;
} {
  const html = findBodyPart(part, 'text/html');

  if (html) {
    return { contentType: 'html', content: decodeBase64Url(html) };
  }

  const text = findBodyPart(part, 'text/plain');
  return { contentType: 'text', content: text ? decodeBase64Url(text) : '' };
}

function findBodyPart(
  part: GmailMessagePart | undefined,
  mimeType: string,
): string | undefined {
  if (!part) {
    return undefined;
  }

  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return part.body.data;
  }

  for (const child of part.parts ?? []) {
    const data = findBodyPart(child, mimeType);

    if (data) {
      return data;
    }
  }

  return undefined;
}

function hasAttachments(part: GmailMessagePart | undefined): boolean {
  if (!part) {
    return false;
  }

  if (part.filename && !isInlinePart(part)) {
    return true;
  }

  return (part.parts ?? []).some(hasAttachments);
}

function collectAttachments(part: GmailMessagePart | undefined): MailAttachment[] {
  if (!part) {
    return [];
  }

  const attachments: MailAttachment[] = [];

  if (part.filename && !isInlinePart(part)) {
    attachments.push({
      id: part.body?.attachmentId || part.partId || part.filename,
      name: part.filename,
      contentType: part.mimeType || 'application/octet-stream',
      size: part.body?.size ?? 0,
      isInline: false,
    });
  }

  for (const child of part.parts ?? []) {
    attachments.push(...collectAttachments(child));
  }

  return attachments;
}

function findAttachmentPart(
  part: GmailMessagePart | undefined,
  attachmentId: string,
): GmailMessagePart | undefined {
  if (!part) {
    return undefined;
  }

  if (
    part.filename &&
    !isInlinePart(part) &&
    (part.body?.attachmentId === attachmentId ||
      part.partId === attachmentId ||
      part.filename === attachmentId)
  ) {
    return part;
  }

  for (const child of part.parts ?? []) {
    const match = findAttachmentPart(child, attachmentId);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function isInlinePart(part: GmailMessagePart) {
  const disposition = part.headers
    ?.find((header) => header.name?.toLowerCase() === 'content-disposition')
    ?.value?.toLowerCase();

  return disposition?.split(';', 1)[0].trim() === 'inline';
}

function decodeBase64Url(value: string) {
  return decodeBase64UrlBuffer(value).toString('utf8');
}

function decodeBase64UrlBuffer(value: string) {
  return Buffer.from(
    value.replaceAll('-', '+').replaceAll('_', '/'),
    'base64',
  );
}

async function createRawMail({
  attachments,
  bccRecipients,
  bodyHtml,
  ccRecipients,
  extraHeaders = {},
  subject,
  toRecipients,
}: {
  attachments: NonNullable<ProviderSendMailInput['attachments']>;
  bccRecipients?: ProviderSendMailInput['bccRecipients'];
  bodyHtml: string;
  ccRecipients?: ProviderSendMailInput['ccRecipients'];
  extraHeaders?: Record<string, string>;
  subject: string;
  toRecipients: ProviderSendMailInput['toRecipients'];
}) {
  const composer = new MailComposer({
    attachments: attachments.map((attachment) => ({
      contentType: attachment.contentType,
      filename: attachment.name,
      path: attachment.path,
    })),
    headers: extraHeaders,
    html: bodyHtml,
    subject,
    text: '',
    to: toRecipients.map(formatComposeRecipient).join(', '),
    cc: (ccRecipients ?? []).map(formatComposeRecipient).join(', ') || undefined,
    bcc: (bccRecipients ?? []).map(formatComposeRecipient).join(', ') || undefined,
  });
  const message = injectBccHeader(
    await buildMimeMessage(composer),
    bccRecipients ?? [],
  );

  return message.toString('base64url');
}

function injectBccHeader(
  message: Buffer,
  recipients: ProviderSendMailInput['bccRecipients'],
) {
  if (!recipients?.length) {
    return message;
  }

  const source = message.toString('utf8');
  const bccHeader = `Bcc: ${recipients.map(formatComposeRecipient).join(', ')}\r\n`;
  const headerEndIndex = source.indexOf('\r\n\r\n');

  if (headerEndIndex === -1) {
    return Buffer.from(`${bccHeader}${source}`, 'utf8');
  }

  return Buffer.from(
    `${source.slice(0, headerEndIndex)}\r\n${bccHeader}${source.slice(headerEndIndex + 2)}`,
    'utf8',
  );
}

function formatComposeRecipient(
  recipient: ProviderSendMailInput['toRecipients'][number],
) {
  return recipient.name
    ? `"${recipient.name.replaceAll('"', '\\"')}" <${recipient.email}>`
    : recipient.email;
}

function createReplySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject || '(No subject)'}`;
}

function createForwardSubject(subject: string) {
  return /^fwd:/i.test(subject) ? subject : `Fwd: ${subject || '(No subject)'}`;
}

function getGmailReplyRecipients(headers: Map<string, string>) {
  const replyTarget =
    parseMailboxList(headers.get('reply-to') ?? '')[0] ??
    parseMailbox(headers.get('from') ?? '');

  return replyTarget.email
    ? [{ name: replyTarget.name, email: replyTarget.email }]
    : [];
}

function getGmailReplyAllRecipients(
  headers: Map<string, string>,
  accountEmail: string | undefined,
) {
  const toRecipients = dedupeComposeRecipients([
    ...getGmailReplyRecipients(headers),
    ...parseMailboxList(headers.get('to') ?? ''),
  ].filter((address) =>
    address.email &&
    address.email.toLowerCase() !== accountEmail?.toLowerCase(),
  ).map((address) => ({ name: address.name, email: address.email })));
  const toEmails = new Set(
    toRecipients.map((recipient) => recipient.email.toLowerCase()),
  );
  const ccRecipients = dedupeComposeRecipients(
    parseMailboxList(headers.get('cc') ?? '')
      .filter((address) =>
        address.email &&
        address.email.toLowerCase() !== accountEmail?.toLowerCase() &&
        !toEmails.has(address.email.toLowerCase()),
      )
      .map((address) => ({ name: address.name, email: address.email })),
  );

  return { toRecipients, ccRecipients };
}

function dedupeComposeRecipients(
  recipients: ProviderSendMailInput['toRecipients'],
) {
  const deduped: ProviderSendMailInput['toRecipients'] = [];
  const seen = new Set<string>();

  for (const recipient of recipients) {
    const email = recipient.email.toLowerCase();

    if (seen.has(email)) {
      continue;
    }

    seen.add(email);
    deduped.push(recipient);
  }

  return deduped;
}

function createForwardBodyHtml(bodyHtml: string, original: GmailMessage) {
  const headers = getHeaderMap(original.payload?.headers);
  const originalBody = extractBody(original.payload);
  const escapedPreview =
    originalBody.contentType === 'text'
      ? `<pre>${escapeHtml(originalBody.content)}</pre>`
      : originalBody.content;

  return `${bodyHtml}<br><br><blockquote><p>---------- Forwarded message ---------</p><p><strong>From:</strong> ${escapeHtml(
    headers.get('from') ?? '',
  )}<br><strong>Date:</strong> ${escapeHtml(
    headers.get('date') ?? '',
  )}<br><strong>Subject:</strong> ${escapeHtml(
    headers.get('subject') ?? '',
  )}<br><strong>To:</strong> ${escapeHtml(headers.get('to') ?? '')}</p>${escapedPreview}</blockquote>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildMimeMessage(composer: MailComposer) {
  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((error, message) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(message);
    });
  });
}

function parseMailboxList(value: string) {
  return splitMailboxList(value)
    .map(parseMailbox)
    .filter((address) => address.name || address.email);
}

function splitMailboxList(value: string) {
  const items: string[] = [];
  let current = '';
  let isQuoted = false;
  let angleDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previousCharacter = value[index - 1];

    if (character === '"' && previousCharacter !== '\\') {
      isQuoted = !isQuoted;
      current += character;
      continue;
    }

    if (!isQuoted && character === '<') {
      angleDepth += 1;
      current += character;
      continue;
    }

    if (!isQuoted && character === '>' && angleDepth > 0) {
      angleDepth -= 1;
      current += character;
      continue;
    }

    if (!isQuoted && angleDepth === 0 && character === ',') {
      items.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  items.push(current);
  return items;
}

function parseMailbox(value: string): MailAddress {
  const match = /^(?:"?([^"]*)"?\s)?<([^<>]+)>$/.exec(value.trim());

  if (match) {
    return {
      name: match[1]?.trim() || match[2],
      email: match[2],
    };
  }

  const trimmed = value.trim();
  return {
    name: trimmed,
    email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed) ? trimmed : '',
  };
}

function formatAddress(address: MailAddress) {
  return address.email ? `${address.name} <${address.email}>` : address.name;
}

function mapPeopleSuggestions(data: PeopleSearchResponse) {
  const suggestions: MailPersonSuggestion[] = [];
  const seenEmails = new Set<string>();

  for (const result of data.results ?? []) {
    const person = result.person;
    const email = person?.emailAddresses?.find((candidate) =>
      isValidEmail(candidate.value),
    )?.value;

    if (!email) {
      continue;
    }

    const normalizedEmail = email.toLowerCase();

    if (seenEmails.has(normalizedEmail)) {
      continue;
    }

    seenEmails.add(normalizedEmail);
    suggestions.push({
      id: person?.resourceName ?? normalizedEmail,
      name:
        person?.names?.[0]?.displayName ??
        person?.emailAddresses?.[0]?.displayName ??
        email,
      email,
    });
  }

  return suggestions;
}

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  );
}

function isExpectedGoogleUrl(rawUrl: string, expectedBaseUrl: string) {
  try {
    const url = new URL(rawUrl);
    const expectedUrl = new URL(expectedBaseUrl);

    return (
      url.origin === expectedUrl.origin &&
      (url.pathname === expectedUrl.pathname ||
        url.pathname.startsWith(`${expectedUrl.pathname}/`))
    );
  } catch {
    return false;
  }
}
