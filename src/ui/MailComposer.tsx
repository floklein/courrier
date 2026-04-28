import DOMPurify from 'dompurify';
import { Send, X } from 'lucide-react';
import { FormEvent, useId, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type {
  MailComposeRecipient,
  MailMessageDetail,
  ReplyToMessageInput,
  SendMailInput,
} from '../lib/mail-types';
import { cn } from '../lib/utils';
import { RichTextMailEditor, type RichTextMailEditorValue } from './RichTextMailEditor';

const outgoingMailTags = [
  'a',
  'blockquote',
  'br',
  'em',
  'li',
  'ol',
  'p',
  's',
  'strong',
  'u',
  'ul',
];

const outgoingMailAttributes = ['href', 'rel', 'target'];

export function MailComposer({
  mode,
  isSending,
  error,
  replyMessage,
  className,
  onClose,
  onReply,
  onSend,
}: {
  mode: 'new' | 'reply';
  isSending: boolean;
  error: Error | null;
  replyMessage?: MailMessageDetail;
  className?: string;
  onClose: () => void;
  onReply: (input: ReplyToMessageInput) => void;
  onSend: (input: SendMailInput) => void;
}) {
  const toInputId = useId();
  const subjectInputId = useId();
  const [toValue, setToValue] = useState('');
  const [subject, setSubject] = useState('');
  const [editorValue, setEditorValue] = useState<RichTextMailEditorValue>({
    html: '',
    text: '',
    isEmpty: true,
  });
  const [validationMessage, setValidationMessage] = useState('');
  const isReply = mode === 'reply';
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const isDirty =
    toValue.trim().length > 0 ||
    subject.trim().length > 0 ||
    editorValue.text.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationMessage('');

    if (!hasBody) {
      setValidationMessage('Write a message before sending.');
      return;
    }

    const bodyHtml = sanitizeOutgoingMailHtml(editorValue.html);

    if (isReply) {
      if (!replyMessage) {
        setValidationMessage('Select a message before replying.');
        return;
      }

      onReply({
        messageId: replyMessage.id,
        bodyHtml,
      });
      return;
    }

    const recipients = parseRecipients(toValue);

    if (recipients.invalid.length > 0) {
      setValidationMessage(`Check recipient: ${recipients.invalid[0]}`);
      return;
    }

    if (recipients.valid.length === 0) {
      setValidationMessage('Add at least one recipient.');
      return;
    }

    onSend({
      toRecipients: recipients.valid,
      subject: subject.trim(),
      bodyHtml,
    });
  }

  function handleClose() {
    if (
      isDirty &&
      !window.confirm('Discard this unsent message?')
    ) {
      return;
    }

    onClose();
  }

  return (
    <form
      className={cn('flex min-h-0 flex-col overflow-hidden bg-card', className)}
      onSubmit={handleSubmit}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-3 border-b px-4',
          isReply
            ? 'py-4'
            : 'app-window-header app-window-controls-end h-16',
        )}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {isReply ? `Reply to ${replyMessage?.sender.name ?? 'message'}` : 'New message'}
          </h2>
          {isReply && replyMessage && (
            <p className="truncate text-xs text-muted-foreground">
              {replyMessage.subject}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close composer"
          disabled={isSending}
          onClick={handleClose}
        >
          <X data-icon="inline-start" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {!isReply && (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={toInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                To
              </label>
              <Input
                id={toInputId}
                value={toValue}
                onChange={(event) => setToValue(event.target.value)}
                placeholder="name@example.com"
                disabled={isSending}
                aria-invalid={validationMessage.startsWith('Check recipient')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={subjectInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                Subject
              </label>
              <Input
                id={subjectInputId}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Subject"
                disabled={isSending}
              />
            </div>
          </>
        )}

        <RichTextMailEditor
          className={cn(!isReply && 'flex-1')}
          disabled={isSending}
          placeholder={isReply ? 'Write a reply' : 'Write a message'}
          onChange={setEditorValue}
        />

        {(validationMessage || error) && (
          <p className="text-sm text-destructive">
            {validationMessage || error?.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
        <Button
          type="button"
          variant="outline"
          disabled={isSending}
          onClick={handleClose}
        >
          Close
        </Button>
        <Button type="submit" disabled={isSending}>
          <Send data-icon="inline-start" />
          {isSending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </form>
  );
}

function parseRecipients(value: string) {
  const entries = value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const valid: MailComposeRecipient[] = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const recipient = parseRecipient(entry);

    if (!recipient) {
      invalid.push(entry);
      continue;
    }

    valid.push(recipient);
  }

  return { valid, invalid };
}

function parseRecipient(value: string): MailComposeRecipient | undefined {
  const namedMatch = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const name = namedMatch?.[1]?.replace(/^"|"$/g, '').trim();
  const email = (namedMatch?.[2] ?? value).trim();

  if (!isValidEmail(email)) {
    return undefined;
  }

  return name ? { name, email } : { email };
}

function isValidEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function sanitizeOutgoingMailHtml(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: outgoingMailTags,
    ALLOWED_ATTR: outgoingMailAttributes,
    ALLOW_DATA_ATTR: false,
  });
}
