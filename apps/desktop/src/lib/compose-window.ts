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
