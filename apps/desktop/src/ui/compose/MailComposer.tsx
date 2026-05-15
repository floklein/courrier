import { Send } from 'lucide-react';
import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  emptyComposeWindowDraft,
  type ComposeWindowDraft,
} from '../../lib/compose-window';
import type {
  MailComposeRecipient,
  MailMessageDetail,
  ReplyToMessageInput,
  SendMailInput,
} from '../../lib/mail-types';
import {
  parseRecipients,
  sanitizeOutgoingMailHtml,
  serializeRecipients,
} from '../../lib/mail/mail-compose-utils';
import { cn } from '../../lib/utils';
import { MailComposerHeader } from './MailComposerHeader';
import { RecipientPicker } from './RecipientPicker';
import { RichTextMailEditor, type RichTextMailEditorValue } from './RichTextMailEditor';

export function MailComposer({
  accountId,
  mode,
  isSending,
  error,
  replyMessage,
  initialDraft,
  className,
  onClose,
  onDraftChange,
  onMinimize,
  onMoveToWindow,
  onReply,
  onSend,
  useWindowHeader,
}: {
  accountId: string;
  mode: 'new' | 'reply';
  isSending: boolean;
  error: Error | null;
  replyMessage?: MailMessageDetail;
  initialDraft?: ComposeWindowDraft;
  className?: string;
  onClose: () => void;
  onDraftChange?: (draft: ComposeWindowDraft) => void;
  onMinimize?: () => void;
  onMoveToWindow?: (draft: ComposeWindowDraft) => void;
  onReply: (input: ReplyToMessageInput) => void;
  onSend: (input: SendMailInput) => void;
  useWindowHeader?: boolean;
}) {
  const toInputId = useId();
  const subjectInputId = useId();
  const bodyInputId = useId();
  const initialRecipients = useMemo(
    () => parseRecipients(initialDraft?.toValue ?? ''),
    [initialDraft?.toValue],
  );
  const [toRecipients, setToRecipients] = useState<MailComposeRecipient[]>(
    initialRecipients.valid,
  );
  const [toInputValue, setToInputValue] = useState(
    initialRecipients.invalid.join(', '),
  );
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [editorValue, setEditorValue] = useState<RichTextMailEditorValue>({
    ...(initialDraft?.editorValue ?? emptyComposeWindowDraft.editorValue),
  });
  const [validationMessage, setValidationMessage] = useState('');
  const isReply = mode === 'reply';
  const currentDraft = useMemo<ComposeWindowDraft>(
    () => ({
      accountId,
      toValue: serializeRecipients(toRecipients, toInputValue),
      subject,
      editorValue,
    }),
    [accountId, editorValue, subject, toInputValue, toRecipients],
  );
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const isDirty =
    currentDraft.toValue.trim().length > 0 ||
    subject.trim().length > 0 ||
    editorValue.text.trim().length > 0;

  useEffect(() => {
    if (isReply) {
      return;
    }

    onDraftChange?.(currentDraft);
  }, [currentDraft, isReply, onDraftChange]);

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

    const pendingRecipients = parseRecipients(toInputValue);

    if (pendingRecipients.invalid.length > 0) {
      setValidationMessage(`Check recipient: ${pendingRecipients.invalid[0]}`);
      return;
    }

    const recipients = dedupeRecipients([
      ...toRecipients,
      ...pendingRecipients.valid,
    ]);

    if (recipients.length === 0) {
      setValidationMessage('Add at least one recipient.');
      return;
    }

    onSend({
      toRecipients: recipients,
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
      <MailComposerHeader
        currentDraft={currentDraft}
        isReply={isReply}
        isSending={isSending}
        replyMessage={replyMessage}
        useWindowHeader={useWindowHeader}
        onClose={handleClose}
        onMinimize={onMinimize}
        onMoveToWindow={onMoveToWindow}
      />

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
              <RecipientPicker
                accountId={accountId}
                id={toInputId}
                value={toRecipients}
                inputValue={toInputValue}
                disabled={isSending}
                invalid={validationMessage.startsWith('Check recipient')}
                onChange={setToRecipients}
                onInputChange={setToInputValue}
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

        <div className={cn('flex min-h-0 flex-col gap-1.5', !isReply && 'flex-1')}>
          <label
            htmlFor={bodyInputId}
            className="text-xs font-medium text-muted-foreground"
          >
            Message
          </label>
          <RichTextMailEditor
            id={bodyInputId}
            className="flex-1"
            disabled={isSending}
            initialValue={initialDraft?.editorValue}
            placeholder={isReply ? 'Write a reply' : 'Write a message'}
            onChange={setEditorValue}
          />
        </div>

        {(validationMessage || error) && (
          <p className="text-sm text-destructive">
            {validationMessage || error?.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={isSending}
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSending}>
          <Send data-icon="inline-start" />
          {isSending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </form>
  );
}

function dedupeRecipients(recipients: MailComposeRecipient[]) {
  const deduped: MailComposeRecipient[] = [];
  const seenEmails = new Set<string>();

  for (const recipient of recipients) {
    const email = recipient.email.toLowerCase();

    if (seenEmails.has(email)) {
      continue;
    }

    seenEmails.add(email);
    deduped.push(recipient);
  }

  return deduped;
}
