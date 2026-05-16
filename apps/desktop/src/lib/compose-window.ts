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
  kind?: 'new' | 'reply' | 'replyAll' | 'forward';
  relatedMessageId?: string;
  toValue: string;
  ccValue?: string;
  bccValue?: string;
  subject: string;
  editorValue: ComposeEditorValue;
  attachments?: LocalMailAttachment[];
}

export const emptyComposeWindowDraft: ComposeWindowDraft = {
  accountId: '',
  kind: 'new',
  toValue: '',
  ccValue: '',
  bccValue: '',
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
  kind: z.enum(['new', 'reply', 'replyAll', 'forward']).optional(),
  relatedMessageId: z.string().min(1).max(2048).optional(),
  toValue: z.string().max(10_000),
  ccValue: z.string().max(10_000).optional(),
  bccValue: z.string().max(10_000).optional(),
  subject: z.string().max(998),
  editorValue: composeEditorValueSchema,
  attachments: z.array(localMailAttachmentSchema).max(100).optional(),
});
