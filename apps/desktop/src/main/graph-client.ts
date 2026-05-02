import {
  mapGraphFolder,
  mapGraphMessageDetail,
  mapGraphMessageSummary,
  sortMailFolders,
  type GraphMailFolder,
  type GraphMessage,
  type GraphMessageDetail,
} from '../lib/graph-mappers';
import type {
  MailFolder,
  MailMessageDetail,
  PagedMessages,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import { GraphRequestError } from '../lib/graph-errors';
import type { AuthService } from './auth-service';

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

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
}

export interface CreateMailSubscriptionInput {
  clientState: string;
  expirationDateTime: string;
  notificationUrl: string;
}

export interface RenewSubscriptionInput {
  subscriptionId: string;
  expirationDateTime: string;
}

export class GraphClient {
  constructor(private readonly authService: AuthService) {}

  async listFolders(): Promise<MailFolder[]> {
    const folders = await this.fetchFolders(
      `${graphBaseUrl}/me/mailFolders?$top=100&${folderSelect}`,
      0,
    );

    return sortMailFolders(await this.tagWellKnownFolders(folders));
  }

  async listMessages(
    folderId: string,
    nextPageUrl?: string,
    searchQuery?: string,
  ): Promise<PagedMessages> {
    const search = searchQuery?.trim();
    const url =
      getValidatedMessagePageUrl(folderId, nextPageUrl) ??
      createMessagesUrl(folderId, search);

    const data = await this.fetchGraph<GraphCollection<GraphMessage>>(url);

    return {
      messages: (data.value ?? [])
        .filter((message) => Boolean(message.id))
        .map((message) => mapGraphMessageSummary(folderId, message)),
      nextPageUrl: data['@odata.nextLink'],
    };
  }

  async getMessage(
    folderId: string,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const data = await this.fetchGraph<GraphMessageDetail>(
      `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
        folderId,
      )}/messages/${encodeURIComponent(
        messageId,
      )}?$select=id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,from,toRecipients,body`,
    );

    return mapGraphMessageDetail(folderId, data);
  }

  async markMessageReadState(
    messageId: string,
    isRead: boolean,
  ): Promise<void> {
    await this.fetchGraph(
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
    messageId: string,
    destinationFolderId: string,
  ): Promise<MailMessageDetail> {
    const data = await this.fetchGraph<GraphMessageDetail>(
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

  async deleteMessage(messageId: string): Promise<MailMessageDetail> {
    return this.moveMessage(messageId, 'deleteditems');
  }

  async sendMessage(input: SendMailInput): Promise<void> {
    await this.fetchGraph(`${graphBaseUrl}/me/sendMail`, {
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

  async replyToMessage(input: ReplyToMessageInput): Promise<void> {
    const draft = await this.fetchGraph<GraphMessageDetail>(
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

    await this.fetchGraph(
      `${graphBaseUrl}/me/messages/${encodeURIComponent(draft.id)}/send`,
      {
        method: 'POST',
      },
    );
  }

  async createMailSubscription(
    input: CreateMailSubscriptionInput,
  ): Promise<GraphSubscription> {
    return this.fetchGraph<GraphSubscription>(`${graphBaseUrl}/subscriptions`, {
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
    });
  }

  async renewSubscription(
    input: RenewSubscriptionInput,
  ): Promise<GraphSubscription> {
    return this.fetchGraph<GraphSubscription>(
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

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.fetchGraph(
      `${graphBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  private async fetchFolders(url: string, depth: number): Promise<MailFolder[]> {
    const data = await this.fetchGraph<GraphCollection<GraphMailFolder>>(url);
    const folders: MailFolder[] = [];

    for (const folder of data.value ?? []) {
      if (!folder.id) {
        continue;
      }

      folders.push(mapGraphFolder(folder, depth));

      if ((folder.childFolderCount ?? 0) > 0) {
        folders.push(
          ...(await this.fetchFolders(
            `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
              folder.id,
            )}/childFolders?$top=100&${folderSelect}`,
            depth + 1,
          )),
        );
      }
    }

    if (data['@odata.nextLink']) {
      folders.push(...(await this.fetchFolders(data['@odata.nextLink'], depth)));
    }

    return folders;
  }

  private async tagWellKnownFolders(folders: MailFolder[]) {
    const knownFolderResults = await Promise.allSettled(
      wellKnownFolderNames.map(async (wellKnownName) => ({
        wellKnownName,
        folder: await this.fetchGraph<GraphMailFolder>(
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
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!isMicrosoftGraphUrl(url)) {
      throw new Error('Refusing to fetch a non-Microsoft Graph URL.');
    }

    const token = await this.authService.getAccessToken();
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
      'id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,from,toRecipients',
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
