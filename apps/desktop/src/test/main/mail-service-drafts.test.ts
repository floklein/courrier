import { describe, expect, it, vi } from 'vitest';
import type { MailDraftSaveInput } from '@/lib/mail-types';
import { MailService } from '@/main/mail-service';

const accountId = 'microsoft:account-1';

describe('MailService drafts', () => {
  it('forwards list, get, delete, and send operations to the account provider', async () => {
    const provider = createProvider();
    const summaries = [{ providerDraftId: 'draft-1' }];
    const detail = { providerDraftId: 'draft-1', subject: 'Draft subject' };
    provider.listDrafts.mockResolvedValue(summaries);
    provider.getDraft.mockResolvedValue(detail);
    const service = new MailService([provider as never]);

    await expect(service.listDrafts(accountId)).resolves.toBe(summaries);
    await expect(service.getDraft(accountId, 'draft-1')).resolves.toBe(detail);
    await service.deleteDraft(accountId, 'draft-1');
    await service.sendDraft(accountId, 'draft-1');

    expect(provider.listDrafts).toHaveBeenCalledWith(accountId);
    expect(provider.getDraft).toHaveBeenCalledWith(accountId, 'draft-1');
    expect(provider.deleteDraft).toHaveBeenCalledWith(accountId, 'draft-1');
    expect(provider.sendDraft).toHaveBeenCalledWith(accountId, 'draft-1');
  });

  it('creates a draft while resolving local files and retaining provider attachments', async () => {
    const provider = createProvider();
    const providerAttachment = {
      id: 'provider-attachment',
      providerAttachmentId: 'provider-attachment',
      name: 'existing.pdf',
      contentType: 'application/pdf',
      size: 20,
    };
    const localAttachment = {
      id: 'local-attachment',
      name: 'notes.txt',
      contentType: 'text/plain',
      size: 10,
    };
    const resolvedLocalAttachment = {
      ...localAttachment,
      path: 'C:\\temp\\notes.txt',
    };
    const localAttachmentStore = {
      resolveMany: vi.fn().mockResolvedValue([resolvedLocalAttachment]),
    };
    const createdDraft = { providerDraftId: 'draft-1' };
    provider.createDraft.mockResolvedValue(createdDraft);
    const service = new MailService(
      [provider as never],
      localAttachmentStore as never,
    );
    const input = createDraftSaveInput({
      attachments: [localAttachment, providerAttachment],
    });

    await expect(service.saveDraft(accountId, input)).resolves.toBe(createdDraft);

    expect(localAttachmentStore.resolveMany).toHaveBeenCalledWith([
      localAttachment,
    ]);
    expect(provider.createDraft).toHaveBeenCalledWith(accountId, {
      ...input,
      attachments: [providerAttachment, resolvedLocalAttachment],
    });
    expect(provider.updateDraft).not.toHaveBeenCalled();
  });

  it('updates an existing draft with its provider identifiers intact', async () => {
    const provider = createProvider();
    const updatedDraft = { providerDraftId: 'draft-1' };
    provider.updateDraft.mockResolvedValue(updatedDraft);
    const service = new MailService([provider as never]);
    const input = createDraftSaveInput({
      providerDraftId: 'draft-1',
      providerDraftMessageId: 'draft-message-1',
      kind: 'reply',
      relatedMessageId: 'message-1',
    });

    await expect(service.saveDraft(accountId, input)).resolves.toBe(updatedDraft);

    expect(provider.updateDraft).toHaveBeenCalledWith(
      accountId,
      'draft-1',
      {
        ...input,
        attachments: [],
      },
    );
    expect(provider.createDraft).not.toHaveBeenCalled();
  });
});

function createProvider() {
  return {
    id: 'microsoft' as const,
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    deleteDraft: vi.fn(),
    sendDraft: vi.fn(),
  };
}

function createDraftSaveInput(
  overrides: Partial<MailDraftSaveInput> = {},
): MailDraftSaveInput {
  return {
    kind: 'new',
    toRecipients: [{ name: 'Ada', email: 'ada@example.com' }],
    ccRecipients: [{ name: 'Grace', email: 'grace@example.com' }],
    bccRecipients: [{ name: 'Hidden', email: 'hidden@example.com' }],
    toValue: 'Ada <ada@example.com>',
    ccValue: 'Grace <grace@example.com>',
    bccValue: 'Hidden <hidden@example.com>',
    subject: 'Draft subject',
    bodyHtml: '<p>Draft body</p>',
    editorValue: {
      html: '<p>Draft body</p>',
      text: 'Draft body',
      isEmpty: false,
    },
    attachments: [],
    ...overrides,
  };
}
