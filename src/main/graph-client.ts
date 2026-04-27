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
} from '../lib/mail-types';
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
  ): Promise<PagedMessages> {
    const url =
      getValidatedMessagePageUrl(folderId, nextPageUrl) ??
      `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(
        folderId,
      )}/messages?$top=25&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,from,toRecipients`;

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

  private async fetchGraph<T>(url: string): Promise<T> {
    if (!url.startsWith(graphBaseUrl)) {
      throw new Error('Refusing to fetch a non-Microsoft Graph URL.');
    }

    const token = await this.authService.getAccessToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Microsoft Graph request failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<T>;
  }
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
    throw new Error('Refusing to fetch an unexpected Microsoft Graph page URL.');
  }

  const graphBase = new URL(graphBaseUrl);
  const pathSegments = url.pathname.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  const isExpectedMessagePage =
    url.origin === graphBase.origin &&
    pathSegments.length === 6 &&
    pathSegments[1] === 'v1.0' &&
    pathSegments[2] === 'me' &&
    pathSegments[3] === 'mailFolders' &&
    pathSegments[4] === folderId &&
    pathSegments[5] === 'messages';

  if (!isExpectedMessagePage) {
    throw new Error('Refusing to fetch an unexpected Microsoft Graph page URL.');
  }

  return nextPageUrl;
}
