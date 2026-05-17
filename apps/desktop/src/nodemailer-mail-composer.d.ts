declare module 'nodemailer/lib/mail-composer' {
  interface MailComposerAttachment {
    contentType?: string;
    filename?: string;
    path?: string;
  }

  interface MailComposerOptions {
    attachments?: MailComposerAttachment[];
    headers?: Record<string, string>;
    html?: string;
    subject?: string;
    text?: string;
    to?: string;
    cc?: string;
    bcc?: string;
  }

  export default class MailComposer {
    constructor(options: MailComposerOptions);
    compile(): {
      build(callback: (error: Error | null, message: Buffer) => void): void;
    };
  }
}
