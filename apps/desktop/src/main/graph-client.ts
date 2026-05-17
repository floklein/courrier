import {
  mapGraphFolder,
  mapGraphMessageDetail,
  mapGraphMessageSummary,
  sortMailFolders,
  type GraphAttachment,
  type GraphMailFolder,
  type GraphMessage,
  type GraphMessageDetail,
} from '@/lib/graph-mappers';
import type {
  MailAccount,
  MailActionCapability,
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  PagedMessages,
  SendMailInput,
} from '@/lib/mail-types';
import { GraphRequestError } from '@/lib/graph-errors';
import fs from 'node:fs/promises';
import type {
  CreateMailSubscriptionInput,
  DownloadedMailAttachment,
  MailAuthProvider,
  MailProvider,
  MailSubscription,
  MoveMessageInput,
  ProviderReplyToMessageInput,
  ProviderSendMailInput,
  RenewSubscriptionInput,
} from '@/main/mail-provider';

const graphBaseUrl = 'https://graph.microsoft.com/v1.0';
const folderSelect =
  '$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount,isHidden';
const wellKnownFolderNames = [
  'inbox',
  'drafts',
  'sentitems',
  'archive',
  'deleteditems',
  'junkemail',
];

interface GraphCollection<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface GraphScoredEmailAddress {
  address?: string | null;
}

interface GraphPerson {
  id?: string | null;
  displayName?: string | null;
  scoredEmailAddresses?: GraphScoredEmailAddress[] | null;
  userPrincipalName?: string | null;
}

export class GraphClient implements MailProvider {
  readonly id = 'microsoft' as const;

  constructor(private readonly authProvider: MailAuthProvider) {}

  async getCapabilities(): Promise<MailActionCapability[]> {
    return ['archive', 'junk', 'flag', 'important'];
  }

  async listFolders(accountId: string): Promise<MailFolder[]> {
    const folders = await this.fetchFolders(
      accountId,
      `${graphBaseUrl}/me/mailFolders?$top=100&${folderSelect}`,
      0,
    );

    return sortMailFolders(await this.tagWellKnownFolders(accountId, folders));
  }

  async listMessages(
    accountId: string,
    folderId: string,
    nextPageToken?: string,
    searchQuery?: string,
  ): Promise<PagedMessages> {
    const search = searchQuery?.trim();
    const url =
      getValidatedMessagePageUrl(folderId, nextPageToken) ??
      createMessagesUrl(folderId, search);

    const data = await this.fetchGraph<GraphCollection<GraphMessage>>(
      accountId,
      url,
    );

    return {
      messages: (data.value ?? [])
        .filter((message) => Boolean(message.id))
        .map((message) => mapGraphMessageSummary(folderId, message)),
      nextPageToken: data['@odata.nextLink'],
    };
  }

  async getMessage(
    accountId: string,
    folderId: string,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const data = await this.fetchGraph<GraphMessageDetail>(
      accountId,
      `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
        folderId,
      )}/messages/${encodeURIComponent(
        messageId,
      )}?$select=id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,flag,from,toRecipients,body&$expand=attachments($select=id,name,contentType,size,isInline,@odata.type)`,
    );

    return mapGraphMessageDetail(folderId, data);
  }

  async markMessageReadState(
    accountId: string,
    messageId: string,
    isRead: boolean,
  ): Promise<void> {
    await this.fetchGraph(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead }),
      },
    );
  }

  async moveMessage(
    accountId: string,
    { messageId, destinationFolderId }: MoveMessageInput,
  ): Promise<MailMessageDetail> {
    const data = await this.fetchGraph<GraphMessageDetail>(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}/move`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: destinationFolderId }),
      },
    );

    return mapGraphMessageDetail(destinationFolderId, data);
  }

  async deleteMessage(
    accountId: string,
    messageId: string,
  ): Promise<MailMessageDetail> {
    return this.moveMessage(accountId, {
      messageId,
      sourceFolderId: '',
      destinationFolderId: 'deleteditems',
    });
  }

  archiveMessage(
    accountId: string,
    messageId: string,
    sourceFolderId: string,
  ): Promise<MailMessageDetail> {
    return this.moveMessage(accountId, {
      messageId,
      sourceFolderId,
      destinationFolderId: 'archive',
    });
  }

  markMessageJunkState(
    accountId: string,
    messageId: string,
    isJunk: boolean,
  ): Promise<MailMessageDetail> {
    return this.moveMessage(accountId, {
      messageId,
      sourceFolderId: '',
      destinationFolderId: isJunk ? 'junkemail' : 'inbox',
    });
  }

  async setMessageStarState(): Promise<void> {
    throw new Error('Star is not supported for Microsoft accounts.');
  }

  async setMessageFlagState(
    accountId: string,
    messageId: string,
    isFlagged: boolean,
  ): Promise<void> {
    await this.patchMessage(accountId, messageId, {
      flag: { flagStatus: isFlagged ? 'flagged' : 'notFlagged' },
    });
  }

  async setMessageImportantState(
    accountId: string,
    messageId: string,
    isImportant: boolean,
  ): Promise<void> {
    await this.patchMessage(accountId, messageId, {
      importance: isImportant ? 'high' : 'normal',
    });
  }

  async listPeople(
    accountId: string,
    query?: string,
  ): Promise<MailPersonSuggestion[]> {
    const search = query?.trim();
    const params = new URLSearchParams({
      $top: '10',
      $select: 'id,displayName,scoredEmailAddresses,userPrincipalName',
    });

    if (search) {
      params.set('$search', `"${search.replaceAll('"', '\\"')}"`);
    }

    const data = await this.fetchGraph<GraphCollection<GraphPerson>>(
      accountId,
      `${graphBaseUrl}/me/people?${params.toString()}`,
    );

    return mapPeopleSuggestions(data.value ?? []);
  }

  private async patchMessage(
    accountId: string,
    messageId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.fetchGraph(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
  }

  async sendMessage(accountId: string, input: ProviderSendMailInput): Promise<void> {
    const attachments = input.attachments ?? [];

    if (attachments.length > 0) {
      const draft = await this.fetchGraph<GraphMessageDetail>(
        accountId,
        `${graphBaseUrl}/me/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subject: input.subject,
            body: {
              contentType: 'HTML',
              content: input.bodyHtml,
            },
            toRecipients: input.toRecipients.map(formatGraphRecipient),
          }),
        },
      );

      if (!draft.id) {
        throw new Error('Microsoft Graph did not return a draft ID.');
      }

      await this.addAttachmentsToDraft(accountId, draft.id, attachments);
      await this.sendDraft(accountId, draft.id);
      return;
    }

    await this.fetchGraph(accountId, `${graphBaseUrl}/me/sendMail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: {
            contentType: 'HTML',
            content: input.bodyHtml,
          },
          toRecipients: input.toRecipients.map(formatGraphRecipient),
        },
        saveToSentItems: true,
      }),
    });
  }

  async replyToMessage(
    accountId: string,
    input: ProviderReplyToMessageInput,
  ): Promise<void> {
    const draft = await this.fetchGraph<GraphMessageDetail>(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(
        input.messageId,
      )}/createReply`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (!draft.id) {
      throw new Error('Microsoft Graph did not return a reply draft ID.');
    }

    await this.fetchGraph(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(draft.id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: {
            contentType: 'HTML',
            content: input.bodyHtml,
          },
        }),
      },
    );

    await this.addAttachmentsToDraft(accountId, draft.id, input.attachments ?? []);
    await this.sendDraft(accountId, draft.id);
  }

  async downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedMailAttachment> {
    const attachment = await this.fetchGraph<
      GraphAttachment & { contentBytes?: string | null }
    >(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(
        messageId,
      )}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    if (
      attachment['@odata.type'] &&
      attachment['@odata.type'] !== '#microsoft.graph.fileAttachment'
    ) {
      throw new Error('Microsoft Graph attachment type is not supported.');
    }

    if (attachment.contentBytes == null) {
      throw new Error('Microsoft Graph did not return attachment content.');
    }

    return {
      name: attachment.name || 'attachment',
      contentType: attachment.contentType || 'application/octet-stream',
      content: Buffer.from(attachment.contentBytes, 'base64'),
    };
  }

  async createMailSubscription(
    input: CreateMailSubscriptionInput,
  ): Promise<MailSubscription> {
    return this.fetchGraph<MailSubscription>(
      input.account.id,
      `${graphBaseUrl}/subscriptions`,
      {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.notificationUrl,
        resource: 'me/messages',
        expirationDateTime: input.expirationDateTime,
        clientState: input.clientState,
      }),
      },
    );
  }

  async renewSubscription(
    input: RenewSubscriptionInput,
  ): Promise<MailSubscription> {
    return this.fetchGraph<MailSubscription>(
      input.account.id,
      `${graphBaseUrl}/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expirationDateTime: input.expirationDateTime,
        }),
      },
    );
  }

  async deleteSubscription(
    account: MailAccount,
    subscriptionId: string,
  ): Promise<void> {
    await this.fetchGraph(
      account.id,
      `${graphBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  getNotificationUrl(relayPublicUrl: string) {
    return new URL('/graph/notifications', relayPublicUrl).toString();
  }

  private async fetchFolders(
    accountId: string,
    url: string,
    depth: number,
  ): Promise<MailFolder[]> {
    const data = await this.fetchGraph<GraphCollection<GraphMailFolder>>(
      accountId,
      url,
    );
    const folders: MailFolder[] = [];

    for (const folder of data.value ?? []) {
      if (!folder.id) {
        continue;
      }

      folders.push(mapGraphFolder(folder, depth));

      if ((folder.childFolderCount ?? 0) > 0) {
        folders.push(
          ...(await this.fetchFolders(
            accountId,
            `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
              folder.id,
            )}/childFolders?$top=100&${folderSelect}`,
            depth + 1,
          )),
        );
      }
    }

    if (data['@odata.nextLink']) {
      folders.push(
        ...(await this.fetchFolders(accountId, data['@odata.nextLink'], depth)),
      );
    }

    return folders;
  }

  private async tagWellKnownFolders(accountId: string, folders: MailFolder[]) {
    const knownFolderResults = await Promise.allSettled(
      wellKnownFolderNames.map(async (wellKnownName) => ({
        wellKnownName,
        folder: await this.fetchGraph<GraphMailFolder>(
          accountId,
          `${graphBaseUrl}/me/mailFolders/${wellKnownName}?${folderSelect}`,
        ),
      })),
    );
    const wellKnownById = new Map<string, string>();

    for (const result of knownFolderResults) {
      if (result.status !== 'fulfilled' || !result.value.folder.id) {
        continue;
      }

      wellKnownById.set(result.value.folder.id, result.value.wellKnownName);
    }

    return folders.map((folder) => {
      const wellKnownName = wellKnownById.get(folder.id);

      if (!wellKnownName) {
        return folder;
      }

      return mapGraphFolder(
        {
          id: folder.id,
          displayName: folder.label,
          parentFolderId: folder.parentFolderId,
          totalItemCount: folder.totalCount,
          unreadItemCount: folder.unreadCount,
          childFolderCount: folder.hasChildren ? 1 : 0,
          wellKnownName,
        },
        folder.depth,
      );
    });
  }

  private async fetchGraph<T>(
    accountId: string,
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!isMicrosoftGraphUrl(url)) {
      throw new Error('Refusing to fetch a non-Microsoft Graph URL.');
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
      throw createGraphRequestError(response.status, body);
    }

    const body = await response.text();

    if (!body) {
      return undefined as T;
    }

    return JSON.parse(body) as T;
  }

  private async addAttachmentsToDraft(
    accountId: string,
    draftId: string,
    attachments: NonNullable<ProviderSendMailInput['attachments']>,
  ) {
    for (const attachment of attachments) {
      if (attachment.size < 3 * 1024 * 1024) {
        await this.addSmallAttachmentToDraft(accountId, draftId, attachment);
      } else {
        await this.addLargeAttachmentToDraft(accountId, draftId, attachment);
      }
    }
  }

  private async addSmallAttachmentToDraft(
    accountId: string,
    draftId: string,
    attachment: NonNullable<ProviderSendMailInput['attachments']>[number],
  ) {
    const content = await fs.readFile(attachment.path);

    await this.fetchGraph(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(draftId)}/attachments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.name,
          contentType: attachment.contentType,
          contentBytes: content.toString('base64'),
        }),
      },
    );
  }

  private async addLargeAttachmentToDraft(
    accountId: string,
    draftId: string,
    attachment: NonNullable<ProviderSendMailInput['attachments']>[number],
  ) {
    const session = await this.fetchGraph<{ uploadUrl?: string }>(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(
        draftId,
      )}/attachments/createUploadSession`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          AttachmentItem: {
            attachmentType: 'file',
            name: attachment.name,
            size: attachment.size,
            contentType: attachment.contentType,
          },
        }),
      },
    );

    if (!session.uploadUrl) {
      throw new Error('Microsoft Graph did not return an attachment upload URL.');
    }

    const file = await fs.open(attachment.path, 'r');
    const chunkSize = 327_680 * 12;
    let offset = 0;

    try {
      while (offset < attachment.size) {
        const length = Math.min(chunkSize, attachment.size - offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        const chunk = buffer.subarray(0, bytesRead);
        const response = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(chunk.byteLength),
            'Content-Range': `bytes ${offset}-${offset + chunk.byteLength - 1}/${attachment.size}`,
          },
          body: chunk,
        });

        if (!response.ok) {
          throw new Error(
            `Microsoft Graph attachment upload failed: ${response.status} ${await response.text()}`,
          );
        }

        offset += chunk.byteLength;
      }
    } finally {
      await file.close();
    }
  }

  private async sendDraft(accountId: string, draftId: string) {
    await this.fetchGraph(
      accountId,
      `${graphBaseUrl}/me/messages/${encodeURIComponent(draftId)}/send`,
      {
        method: 'POST',
      },
    );
  }
}

function isMicrosoftGraphUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const graphBase = new URL(graphBaseUrl);

    return (
      url.origin === graphBase.origin &&
      (url.pathname === graphBase.pathname ||
        url.pathname.startsWith(`${graphBase.pathname}/`))
    );
  } catch {
    return false;
  }
}

function createGraphRequestError(status: number, body: string) {
  const parsedBody = parseGraphErrorBody(body);
  return new GraphRequestError({
    body,
    code: parsedBody.code,
    message: parsedBody.message ?? body,
    status,
  });
}

function parseGraphErrorBody(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        code?: unknown;
        message?: unknown;
      };
    };

    return {
      code: typeof parsed.error?.code === 'string' ? parsed.error.code : undefined,
      message:
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : undefined,
    };
  } catch {
    return {};
  }
}

function createMessagesUrl(folderId: string, search?: string) {
  const params = new URLSearchParams({
    $top: '25',
    $select:
      'id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,flag,from,toRecipients',
  });

  if (search) {
    params.set('$search', `"${search.replaceAll('"', '\\"')}"`);
  } else {
    params.set('$orderby', 'receivedDateTime desc');
  }

  return `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
    folderId,
  )}/messages?${params.toString()}`;
}

export function getValidatedMessagePageUrl(
  folderId: string,
  nextPageUrl?: string,
) {
  if (!nextPageUrl) {
    return undefined;
  }

  let url: URL;

  try {
    url = new URL(nextPageUrl);
  } catch {
    throw new Error(
      `Refusing to fetch an unexpected Microsoft Graph page URL: ${describeRejectedMessagePageUrl(
        nextPageUrl,
      )}`,
    );
  }

  const graphBase = new URL(graphBaseUrl);
  const pathSegments = url.pathname.split('/');
  const pageFolderId = getMessagePageFolderId(pathSegments);
  const isExpectedMessagePage =
    url.origin === graphBase.origin &&
    pathSegments[1] === 'v1.0' &&
    pathSegments[2] === 'me' &&
    pageFolderId === folderId &&
    pathSegments.at(-1) === 'messages';

  if (!isExpectedMessagePage) {
    throw new Error(
      `Refusing to fetch an unexpected Microsoft Graph page URL: ${describeRejectedMessagePageUrl(
        nextPageUrl,
      )}`,
    );
  }

  return nextPageUrl;
}

function getMessagePageFolderId(pathSegments: string[]) {
  if (pathSegments[3] === 'mailFolders' && pathSegments.length >= 6) {
    return pathSegments
      .slice(4, -1)
      .map(decodeGraphPathSegment)
      .join('/');
  }

  const keyedMailFolderMatch = pathSegments[3]?.match(
    /^mailFolders\('(.+)'\)$/,
  );

  if (keyedMailFolderMatch && pathSegments.length === 5) {
    return decodeGraphPathSegment(
      keyedMailFolderMatch[1].replaceAll("''", "'"),
    );
  }

  return undefined;
}

function decodeGraphPathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function describeRejectedMessagePageUrl(nextPageUrl: string) {
  try {
    const url = new URL(nextPageUrl);
    const queryKeys = Array.from(url.searchParams.keys()).sort();

    return JSON.stringify({
      origin: url.origin,
      pathname: url.pathname,
      queryKeys,
    });
  } catch {
    return JSON.stringify({
      valueType: typeof nextPageUrl,
      length: nextPageUrl.length,
    });
  }
}

function formatGraphRecipient(recipient: SendMailInput['toRecipients'][number]) {
  return {
    emailAddress: {
      name: recipient.name || recipient.email,
      address: recipient.email,
    },
  };
}

function mapPeopleSuggestions(people: GraphPerson[]): MailPersonSuggestion[] {
  const suggestions: MailPersonSuggestion[] = [];
  const seenEmails = new Set<string>();

  for (const person of people) {
    const email =
      person.scoredEmailAddresses?.find((candidate) =>
        isValidEmail(candidate.address),
      )?.address ?? person.userPrincipalName;

    if (!isValidEmail(email)) {
      continue;
    }

    const normalizedEmail = email.toLowerCase();

    if (seenEmails.has(normalizedEmail)) {
      continue;
    }

    seenEmails.add(normalizedEmail);
    suggestions.push({
      id: person.id || normalizedEmail,
      name: person.displayName?.trim() || email,
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
