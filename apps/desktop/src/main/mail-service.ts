import type {
  MailFolder,
  MailMessageDetail,
  MailPersonSuggestion,
  PagedMessages,
  ProviderId,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import {
  getProviderFromAccountId,
  type MailProvider,
  type MoveMessageInput,
} from './mail-provider';

export class MailService {
  private readonly providersById: Map<ProviderId, MailProvider>;

  constructor(providers: MailProvider[]) {
    this.providersById = new Map(providers.map((provider) => [provider.id, provider]));
  }

  getProvider(accountId: string) {
    const providerId = getProviderFromAccountId(accountId);
    const provider = providerId ? this.providersById.get(providerId) : undefined;

    if (!provider) {
      throw new Error(`No mail provider is registered for account: ${accountId}`);
    }

    return provider;
  }

  listFolders(accountId: string): Promise<MailFolder[]> {
    return this.getProvider(accountId).listFolders(accountId);
  }

  listMessages(
    accountId: string,
    folderId: string,
    nextPageToken?: string,
    searchQuery?: string,
  ): Promise<PagedMessages> {
    return this.getProvider(accountId).listMessages(
      accountId,
      folderId,
      nextPageToken,
      searchQuery,
    );
  }

  getMessage(
    accountId: string,
    folderId: string,
    messageId: string,
  ): Promise<MailMessageDetail> {
    return this.getProvider(accountId).getMessage(accountId, folderId, messageId);
  }

  markMessageReadState(
    accountId: string,
    messageId: string,
    isRead: boolean,
  ): Promise<void> {
    return this.getProvider(accountId).markMessageReadState(
      accountId,
      messageId,
      isRead,
    );
  }

  moveMessage(
    accountId: string,
    input: MoveMessageInput,
  ): Promise<MailMessageDetail> {
    return this.getProvider(accountId).moveMessage(accountId, input);
  }

  deleteMessage(
    accountId: string,
    messageId: string,
  ): Promise<MailMessageDetail | undefined> {
    return this.getProvider(accountId).deleteMessage(accountId, messageId);
  }

  listPeople(
    accountId: string,
    query?: string,
  ): Promise<MailPersonSuggestion[]> {
    return this.getProvider(accountId).listPeople(accountId, query);
  }

  sendMessage(accountId: string, input: SendMailInput): Promise<void> {
    return this.getProvider(accountId).sendMessage(accountId, input);
  }

  replyToMessage(accountId: string, input: ReplyToMessageInput): Promise<void> {
    return this.getProvider(accountId).replyToMessage(accountId, input);
  }
}
