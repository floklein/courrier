import { z } from 'zod';
import { localMailAttachmentSchema } from '@/lib/mail-schemas';
import type { LocalMailAttachment } from '@/lib/mail-types';

export interface ComposeEditorValue {
  html: string;
  text: string;
  isEmpty: boolean;
}

export interface ComposeWindowDraft {
  accountId: string;
  toValue: string;
  subject: string;
  editorValue: ComposeEditorValue;
  attachments?: LocalMailAttachment[];
}

export const emptyComposeWindowDraft: ComposeWindowDraft = {
  accountId: '',
  toValue: '',
  subject: '',
  editorValue: {
    html: '',
    text: '',
    isEmpty: true,
  },
  attachments: [],
};

export const composeEditorValueSchema = z.object({
  html: z.string().max(5_000_000),
  text: z.string().max(1_000_000),
  isEmpty: z.boolean(),
});

export const composeWindowDraftSchema = z.object({
  accountId: z.string().min(1).max(2048),
  toValue: z.string().max(10_000),
  subject: z.string().max(998),
  editorValue: composeEditorValueSchema,
  attachments: z.array(localMailAttachmentSchema).max(100).optional(),
});
