import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { containsFiles, getFiles } from '@atlaskit/pragmatic-drag-and-drop/external/file';
import { Paperclip, Send, X } from 'lucide-react';
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { api } from '@/lib/api-client';
import {
  emptyComposeWindowDraft,
  type ComposeWindowDraft,
} from '@/lib/compose-window';
import type {
  MailComposeRecipient,
  LocalMailAttachment,
  MailMessageDetail,
  ReplyToMessageInput,
  SendMailInput,
} from '@/lib/mail-types';
import {
  parseRecipients,
  sanitizeOutgoingMailHtml,
  serializeRecipients,
} from '@/lib/mail/mail-compose-utils';
import { cn } from '@/lib/utils';
import { MailComposerHeader } from '@/ui/compose/MailComposerHeader';
import { RecipientPicker } from '@/ui/compose/RecipientPicker';
import { RichTextMailEditor, type RichTextMailEditorValue } from '@/ui/compose/RichTextMailEditor';

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
  const formRef = useRef<HTMLFormElement>(null);
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
  const [attachments, setAttachments] = useState<LocalMailAttachment[]>(
    initialDraft?.attachments ?? [],
  );
  const [editorValue, setEditorValue] = useState<RichTextMailEditorValue>({
    ...(initialDraft?.editorValue ?? emptyComposeWindowDraft.editorValue),
  });
  const [validationMessage, setValidationMessage] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isReply = mode === 'reply';
  const currentDraft = useMemo<ComposeWindowDraft>(
    () => ({
      accountId,
      toValue: serializeRecipients(toRecipients, toInputValue),
      subject,
      editorValue,
      attachments,
    }),
    [accountId, attachments, editorValue, subject, toInputValue, toRecipients],
  );
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const isDirty =
    currentDraft.toValue.trim().length > 0 ||
    subject.trim().length > 0 ||
    editorValue.text.trim().length > 0 ||
    attachments.length > 0;

  useEffect(() => {
    if (isReply) {
      return;
    }

    onDraftChange?.(currentDraft);
  }, [currentDraft, isReply, onDraftChange]);

  useEffect(() => {
    const element = formRef.current;

    if (!element || isSending) {
      return;
    }

    return dropTargetForExternal({
      element,
      canDrop: ({ source }) => containsFiles({ source }),
      onDragEnter: () => setIsDraggingFiles(true),
      onDragLeave: () => setIsDraggingFiles(false),
      onDrop: ({ source }) => {
        setIsDraggingFiles(false);
        void addDroppedAttachments(getFiles({ source }));
      },
    });
  }, [isSending]);

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
        attachments,
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
      attachments,
    });
  }

  async function addPickedAttachments() {
    setValidationMessage('');

    try {
      addAttachments(await api.attachments.pickLocal());
    } catch (error) {
      setValidationMessage(getAttachmentErrorMessage(error));
    }
  }

  async function addDroppedAttachments(files: File[]) {
    setValidationMessage('');

    try {
      addAttachments(await api.attachments.registerDroppedFiles(files));
    } catch (error) {
      setValidationMessage(getAttachmentErrorMessage(error));
    }
  }

  function addAttachments(nextAttachments: LocalMailAttachment[]) {
    setAttachments((current) => {
      const existingIds = new Set(current.map((attachment) => attachment.id));

      return [
        ...current,
        ...nextAttachments.filter((attachment) => !existingIds.has(attachment.id)),
      ];
    });
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
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
      ref={formRef}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-[inherit] bg-card',
        className,
      )}
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
            onPickAttachments={() => void addPickedAttachments()}
            placeholder={isReply ? 'Write a reply' : 'Write a message'}
            onChange={setEditorValue}
          />
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted/40 pr-1 pl-2 text-sm"
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{attachment.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(attachment.size)}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${attachment.name}`}
                        disabled={isSending}
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        <X data-icon="inline-start" />
                      </Button>
                    }
                  />
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

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

      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-foreground">
          Drop files to attach
        </div>
      )}
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

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Could not add attachment.';
}
