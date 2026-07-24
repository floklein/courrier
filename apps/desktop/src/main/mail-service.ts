import type {
  MailFolder,
  MailActionCapability,
  MailMessageDetail,
  MailPersonSuggestion,
  MailDraftDetail,
  MailDraftSaveInput,
  MailDraftSummary,
  PagedMessages,
  ProviderId,
  ReplyToMessageInput,
  SearchMessagesInput,
  SendMailInput,
} from '@/lib/mail-types';
import {
  getProviderFromAccountId,
  type MailProvider,
  type MoveMessageInput,
} from '@/main/mail-provider';
import type { LocalAttachmentStore } from '@/main/local-attachment-store';

export class MailService {
  private readonly providersById: Map<ProviderId, MailProvider>;

  constructor(
    providers: MailProvider[],
    private readonly localAttachmentStore?: LocalAttachmentStore,
  ) {
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

  getCapabilities(accountId: string): Promise<MailActionCapability[]> {
    return this.getProvider(accountId).getCapabilities(accountId);
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

  searchMessages(
    accountId: string,
    input: SearchMessagesInput,
  ): Promise<PagedMessages> {
    return this.getProvider(accountId).searchMessages(accountId, input);
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

  archiveMessage(
    accountId: string,
    messageId: string,
    sourceFolderId: string,
  ): Promise<MailMessageDetail | undefined> {
    return this.getProvider(accountId).archiveMessage(
      accountId,
      messageId,
      sourceFolderId,
    );
  }

  markMessageJunkState(
    accountId: string,
    messageId: string,
    isJunk: boolean,
  ): Promise<MailMessageDetail | undefined> {
    return this.getProvider(accountId).markMessageJunkState(
      accountId,
      messageId,
      isJunk,
    );
  }

  setMessageStarState(
    accountId: string,
    messageId: string,
    isStarred: boolean,
  ): Promise<void> {
    return this.getProvider(accountId).setMessageStarState(
      accountId,
      messageId,
      isStarred,
    );
  }

  setMessageFlagState(
    accountId: string,
    messageId: string,
    isFlagged: boolean,
  ): Promise<void> {
    return this.getProvider(accountId).setMessageFlagState(
      accountId,
      messageId,
      isFlagged,
    );
  }

  setMessageImportantState(
    accountId: string,
    messageId: string,
    isImportant: boolean,
  ): Promise<void> {
    return this.getProvider(accountId).setMessageImportantState(
      accountId,
      messageId,
      isImportant,
    );
  }

  listPeople(
    accountId: string,
    query?: string,
  ): Promise<MailPersonSuggestion[]> {
    return this.getProvider(accountId).listPeople(accountId, query);
  }

  listDrafts(accountId: string): Promise<MailDraftSummary[]> {
    return this.getProvider(accountId).listDrafts(accountId);
  }

  getDraft(
    accountId: string,
    providerDraftId: string,
  ): Promise<MailDraftDetail> {
    return this.getProvider(accountId).getDraft(accountId, providerDraftId);
  }

  async saveDraft(
    accountId: string,
    input: MailDraftSaveInput,
  ): Promise<MailDraftDetail> {
    const providerInput = {
      ...input,
      attachments: await this.resolveDraftAttachments(input.attachments),
    };

    if (input.providerDraftId) {
      return this.getProvider(accountId).updateDraft(
        accountId,
        input.providerDraftId,
        providerInput,
      );
    }

    return this.getProvider(accountId).createDraft(accountId, providerInput);
  }

  deleteDraft(accountId: string, providerDraftId: string): Promise<void> {
    return this.getProvider(accountId).deleteDraft(accountId, providerDraftId);
  }

  sendDraft(accountId: string, providerDraftId: string): Promise<void> {
    return this.getProvider(accountId).sendDraft(accountId, providerDraftId);
  }

  async sendMessage(accountId: string, input: SendMailInput): Promise<void> {
    return this.getProvider(accountId).sendMessage(accountId, {
      ...input,
      attachments: await this.resolveLocalAttachments(input.attachments),
    });
  }

  async replyToMessage(accountId: string, input: ReplyToMessageInput): Promise<void> {
    return this.getProvider(accountId).replyToMessage(accountId, {
      ...input,
      attachments: await this.resolveLocalAttachments(input.attachments),
    });
  }

  downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ) {
    return this.getProvider(accountId).downloadAttachment(
      accountId,
      messageId,
      attachmentId,
    );
  }

  private async resolveLocalAttachments(attachments: SendMailInput['attachments']) {
    if (!attachments?.length) {
      return [];
    }

    if (!this.localAttachmentStore) {
      throw new Error('Local attachment storage is unavailable.');
    }

    return this.localAttachmentStore.resolveMany(attachments);
  }

  private async resolveDraftAttachments(attachments: MailDraftSaveInput['attachments']) {
    if (!attachments?.length) {
      return [];
    }

    const localAttachments = attachments.filter(
      (attachment) => !attachment.providerAttachmentId,
    );
    const providerAttachments = attachments.filter(
      (attachment) => attachment.providerAttachmentId,
    );

    if (!localAttachments.length) {
      return providerAttachments;
    }

    if (!this.localAttachmentStore) {
      throw new Error('Local attachment storage is unavailable.');
    }

    return [
      ...providerAttachments,
      ...(await this.localAttachmentStore.resolveMany(localAttachments)),
    ];
  }
}
