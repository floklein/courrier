import type {
  MailAccount,
  MailAddress,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MailPersonSuggestion,
  PagedMessages,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import type {
  CreateMailSubscriptionInput,
  MailAuthProvider,
  MailProvider,
  MailSubscription,
  MoveMessageInput,
  RenewSubscriptionInput,
} from './mail-provider';

const gmailBaseUrl = 'https://gmail.googleapis.com/gmail/v1';
const peopleBaseUrl = 'https://people.googleapis.com/v1';
const gmailPageSize = '25';
const messageMetadataHeaders = ['From', 'To', 'Subject', 'Date'];
const detailHeaders = [
  'From',
  'To',
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
  data?: string;
}

interface GmailMessagePart {
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

  async listFolders(accountId: string): Promise<MailFolder[]> {
    const data = await this.fetchGmail<GmailListLabelsResponse>(
      accountId,
      `${gmailBaseUrl}/users/me/labels`,
    );

    return sortGmailFolders(
      (data.labels ?? [])
        .filter((label) => label.id && label.name && !isHiddenGmailLabel(label.id))
        .map(mapGmailLabel),
    );
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

  async sendMessage(accountId: string, input: SendMailInput): Promise<void> {
    await this.fetchGmail(accountId, `${gmailBaseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: createRawMail({
          bodyHtml: input.bodyHtml,
          subject: input.subject,
          toRecipients: input.toRecipients,
        }),
      }),
    });
  }

  async replyToMessage(
    accountId: string,
    input: ReplyToMessageInput,
  ): Promise<void> {
    const original = await this.getRawMessage(accountId, input.messageId);
    const headers = getHeaderMap(original.payload?.headers);
    const from = parseMailbox(headers.get('from') ?? '');
    const subject = createReplySubject(headers.get('subject') ?? '');
    const messageId = headers.get('message-id');
    const references = [headers.get('references'), messageId]
      .filter(Boolean)
      .join(' ');

    if (!from.email) {
      throw new Error('Gmail reply target is missing a sender address.');
    }

    await this.fetchGmail(accountId, `${gmailBaseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: createRawMail({
          bodyHtml: input.bodyHtml,
          subject,
          toRecipients: [{ name: from.name, email: from.email }],
          extraHeaders: {
            ...(messageId ? { 'In-Reply-To': messageId } : {}),
            ...(references ? { References: references } : {}),
          },
        }),
        threadId: original.threadId,
      }),
    });
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
    label: label.name ?? id,
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
    subject: headers.get('subject') || '(No subject)',
    preview: message.snippet ?? '',
    receivedDateTime: mapGmailDate(message, headers),
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
    hasAttachments: hasAttachments(message.payload),
    importance: (message.labelIds ?? []).includes('IMPORTANT') ? 'high' : 'normal',
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
  };
}

function sortGmailFolders(folders: MailFolder[]) {
  const order = ['INBOX', 'DRAFT', 'SENT', 'CATEGORY_PERSONAL', 'TRASH', 'SPAM'];

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
    IMPORTANT: 'clock',
  };

  return map[id] ?? 'folder';
}

function isHiddenGmailLabel(id: string | undefined) {
  return id === 'CHAT' || id === 'UNREAD';
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

  if (part.mimeType === mimeType && part.body?.data) {
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

  if (part.filename) {
    return true;
  }

  return (part.parts ?? []).some(hasAttachments);
}

function decodeBase64Url(value: string) {
  return Buffer.from(
    value.replaceAll('-', '+').replaceAll('_', '/'),
    'base64',
  ).toString('utf8');
}

function createRawMail({
  bodyHtml,
  extraHeaders = {},
  subject,
  toRecipients,
}: {
  bodyHtml: string;
  extraHeaders?: Record<string, string>;
  subject: string;
  toRecipients: SendMailInput['toRecipients'];
}) {
  const headers = [
    ['To', toRecipients.map(formatComposeRecipient).join(', ')],
    ['Subject', subject],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/html; charset=UTF-8'],
    ['Content-Transfer-Encoding', '8bit'],
    ...Object.entries(extraHeaders),
  ];
  const message = `${headers
    .map(([name, value]) => `${name}: ${encodeHeaderValue(value)}`)
    .join('\r\n')}\r\n\r\n${bodyHtml}`;

  return Buffer.from(message, 'utf8').toString('base64url');
}

function formatComposeRecipient(
  recipient: SendMailInput['toRecipients'][number],
) {
  return recipient.name
    ? `"${recipient.name.replaceAll('"', '\\"')}" <${recipient.email}>`
    : recipient.email;
}

function encodeHeaderValue(value: string) {
  return value.replaceAll(/\r?\n/g, ' ');
}

function createReplySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject || '(No subject)'}`;
}

function parseMailboxList(value: string) {
  return value
    .split(',')
    .map(parseMailbox)
    .filter((address) => address.name || address.email);
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
