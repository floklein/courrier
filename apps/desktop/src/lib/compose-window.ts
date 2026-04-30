import { z } from 'zod';

export interface ComposeEditorValue {
  html: string;
  text: string;
  isEmpty: boolean;
}

export interface ComposeWindowDraft {
  toValue: string;
  subject: string;
  editorValue: ComposeEditorValue;
}

export const emptyComposeWindowDraft: ComposeWindowDraft = {
  toValue: '',
  subject: '',
  editorValue: {
    html: '',
    text: '',
    isEmpty: true,
  },
};

export const composeEditorValueSchema = z.object({
  html: z.string().max(5_000_000),
  text: z.string().max(1_000_000),
  isEmpty: z.boolean(),
});

export const composeWindowDraftSchema = z.object({
  toValue: z.string().max(10_000),
  subject: z.string().max(998),
  editorValue: composeEditorValueSchema,
});
