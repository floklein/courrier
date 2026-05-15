import { z } from 'zod';

export const ipcIdSchema = z.string().min(1).max(2048);

export const providerIdSchema = z.enum(['microsoft', 'google']);

export const mailPageTokenSchema = z.string().min(1).max(8192).optional();

export const mailSearchQuerySchema = z.string().max(512).optional();

export const mailPeopleQuerySchema = z.string().trim().max(128).optional();

export const mailComposeRecipientSchema = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  email: z.string().trim().email().max(320),
});

export const sendMailInputSchema = z.object({
  toRecipients: z.array(mailComposeRecipientSchema).min(1).max(500),
  subject: z.string().max(998),
  bodyHtml: z.string().min(1).max(5_000_000),
});

export const replyToMessageInputSchema = z.object({
  messageId: ipcIdSchema,
  bodyHtml: z.string().min(1).max(5_000_000),
});
