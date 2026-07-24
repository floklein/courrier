import { z } from 'zod';

export const ipcIdSchema = z.string().min(1).max(2048);

export const providerIdSchema = z.enum(['microsoft', 'google']);

export const mailActionCapabilitySchema = z.enum([
  'archive',
  'junk',
  'star',
  'flag',
  'important',
]);

export const mailPageTokenSchema = z.string().min(1).max(8192).optional();

export const mailSearchQuerySchema = z.string().max(512).optional();

export const mailSearchScopeSchema = z.enum(['folder', 'all']);

export const searchMessagesInputSchema = z.object({
  query: z.string().trim().min(1).max(512),
  scope: mailSearchScopeSchema,
  folderId: ipcIdSchema.optional(),
  nextPageToken: mailPageTokenSchema,
  includeSpamTrash: z.boolean().optional(),
});

export const mailPeopleQuerySchema = z.string().trim().max(128).optional();

export const mailComposeRecipientSchema = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  email: z.string().trim().email().max(320),
});

export const localMailAttachmentSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(512),
  contentType: z.string().max(255),
  size: z.number().int().nonnegative().max(150 * 1024 * 1024),
  providerAttachmentId: z.string().min(1).max(2048).optional(),
});

export const sendMailInputSchema = z.object({
  toRecipients: z.array(mailComposeRecipientSchema).min(1).max(500),
  ccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
  bccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
  subject: z.string().max(998),
  bodyHtml: z.string().min(1).max(5_000_000),
  attachments: z.array(localMailAttachmentSchema).max(100).optional(),
});

export const replyToMessageInputSchema = z.object({
  kind: z.enum(['reply', 'replyAll', 'forward']).optional(),
  messageId: ipcIdSchema,
  bodyHtml: z.string().min(1).max(5_000_000),
  toRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
  ccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
  bccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
  attachments: z.array(localMailAttachmentSchema).max(100).optional(),
});

export const mailDraftSaveInputSchema = z
  .object({
    providerDraftId: ipcIdSchema.optional(),
    providerDraftMessageId: ipcIdSchema.optional(),
    kind: z.enum(['new', 'reply', 'replyAll', 'forward']),
    relatedMessageId: ipcIdSchema.optional(),
    toRecipients: z.array(mailComposeRecipientSchema).max(500),
    ccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
    bccRecipients: z.array(mailComposeRecipientSchema).max(500).optional(),
    toValue: z.string().max(10_000),
    ccValue: z.string().max(10_000).optional(),
    bccValue: z.string().max(10_000).optional(),
    subject: z.string().max(998),
    bodyHtml: z.string().max(5_000_000),
    editorValue: z.object({
      html: z.string().max(5_000_000),
      text: z.string().max(1_000_000),
      isEmpty: z.boolean(),
    }),
    attachments: z.array(localMailAttachmentSchema).max(100).optional(),
  })
  .superRefine((input, context) => {
    const recipientCount =
      input.toRecipients.length +
      (input.ccRecipients?.length ?? 0) +
      (input.bccRecipients?.length ?? 0);

    if (recipientCount > 500) {
      context.addIssue({
        code: 'custom',
        message: 'A draft can contain at most 500 recipients.',
        path: ['toRecipients'],
      });
    }

    if (input.kind !== 'new' && !input.relatedMessageId) {
      context.addIssue({
        code: 'custom',
        message: 'Response drafts require a related message ID.',
        path: ['relatedMessageId'],
      });
    }
  });
