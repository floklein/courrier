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
  MailAddress,
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
  accountEmail,
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
  accountEmail?: string;
  mode: 'new' | 'reply' | 'replyAll' | 'forward';
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
  const ccInputId = useId();
  const bccInputId = useId();
  const subjectInputId = useId();
  const bodyInputId = useId();
  const initialRecipients = useMemo(
    () =>
      parseRecipients(
        initialDraft?.toValue ??
          getInitialResponseRecipients(mode, replyMessage, accountEmail).toValue,
      ),
    [accountEmail, initialDraft?.toValue, mode, replyMessage],
  );
  const initialCcRecipients = useMemo(
    () =>
      parseRecipients(
        initialDraft?.ccValue ??
          getInitialResponseRecipients(mode, replyMessage, accountEmail).ccValue,
      ),
    [accountEmail, initialDraft?.ccValue, mode, replyMessage],
  );
  const initialBccRecipients = useMemo(
    () => parseRecipients(initialDraft?.bccValue ?? ''),
    [initialDraft?.bccValue],
  );
  const [toRecipients, setToRecipients] = useState<MailComposeRecipient[]>(
    initialRecipients.valid,
  );
  const [ccRecipients, setCcRecipients] = useState<MailComposeRecipient[]>(
    initialCcRecipients.valid,
  );
  const [bccRecipients, setBccRecipients] = useState<MailComposeRecipient[]>(
    initialBccRecipients.valid,
  );
  const [toInputValue, setToInputValue] = useState(
    initialRecipients.invalid.join(', '),
  );
  const [ccInputValue, setCcInputValue] = useState(
    initialCcRecipients.invalid.join(', '),
  );
  const [bccInputValue, setBccInputValue] = useState(
    initialBccRecipients.invalid.join(', '),
  );
  const [isCcVisible, setIsCcVisible] = useState(
    Boolean(initialDraft?.ccValue) ||
      initialCcRecipients.valid.length > 0 ||
      initialCcRecipients.invalid.length > 0,
  );
  const [isBccVisible, setIsBccVisible] = useState(Boolean(initialDraft?.bccValue));
  const [subject, setSubject] = useState(
    initialDraft?.subject ?? getInitialResponseSubject(mode, replyMessage),
  );
  const [attachments, setAttachments] = useState<LocalMailAttachment[]>(
    initialDraft?.attachments ?? [],
  );
  const [editorValue, setEditorValue] = useState<RichTextMailEditorValue>({
    ...(initialDraft?.editorValue ?? emptyComposeWindowDraft.editorValue),
  });
  const [validationMessage, setValidationMessage] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isResponse = mode !== 'new';
  const currentDraft = useMemo<ComposeWindowDraft>(
    () => ({
      accountId,
      kind: mode,
      relatedMessageId: replyMessage?.id,
      toValue: serializeRecipients(toRecipients, toInputValue),
      ccValue: serializeRecipients(ccRecipients, ccInputValue),
      bccValue: serializeRecipients(bccRecipients, bccInputValue),
      subject,
      editorValue,
      attachments,
    }),
    [
      accountId,
      attachments,
      bccInputValue,
      bccRecipients,
      ccInputValue,
      ccRecipients,
      editorValue,
      mode,
      replyMessage?.id,
      subject,
      toInputValue,
      toRecipients,
    ],
  );
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const initialDraftValueRef = useRef<string | null>(null);

  if (initialDraftValueRef.current == null) {
    initialDraftValueRef.current = serializeDraftForDirtyCheck(currentDraft);
  }

  const isDirty =
    serializeDraftForDirtyCheck(currentDraft) !== initialDraftValueRef.current;

  useEffect(() => {
    if (isResponse) {
      return;
    }

    onDraftChange?.(currentDraft);
  }, [currentDraft, isResponse, onDraftChange]);

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

    const toResult = parsePendingRecipients(toRecipients, toInputValue, 'recipient');
    const ccResult = parsePendingRecipients(ccRecipients, ccInputValue, 'Cc recipient');
    const bccResult = parsePendingRecipients(
      bccRecipients,
      bccInputValue,
      'Bcc recipient',
    );

    if (!toResult.ok) {
      setValidationMessage(toResult.error);
      return;
    }

    if (!ccResult.ok) {
      setValidationMessage(ccResult.error);
      return;
    }

    if (!bccResult.ok) {
      setValidationMessage(bccResult.error);
      return;
    }

    if (mode !== 'new') {
      if (!replyMessage) {
        setValidationMessage('Select a message before responding.');
        return;
      }

      if (mode === 'forward' && toResult.recipients.length === 0) {
        setValidationMessage('Add at least one recipient.');
        return;
      }

      onReply({
        kind: mode,
        messageId: replyMessage.id,
        bodyHtml,
        toRecipients: toResult.recipients,
        ccRecipients: ccResult.recipients,
        bccRecipients: bccResult.recipients,
        attachments,
      });
      return;
    }

    if (toResult.recipients.length === 0) {
      setValidationMessage('Add at least one recipient.');
      return;
    }

    onSend({
      toRecipients: toResult.recipients,
      ccRecipients: ccResult.recipients,
      bccRecipients: bccResult.recipients,
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
        isReply={isResponse}
        isSending={isSending}
        replyMessage={replyMessage}
        useWindowHeader={useWindowHeader}
        onClose={handleClose}
        onMinimize={onMinimize}
        onMoveToWindow={onMoveToWindow}
      />

      <div
        className={cn(
          'flex min-h-0 flex-col gap-3 overflow-y-auto p-4',
          !isResponse && 'flex-1',
        )}
      >
        {mode !== 'reply' && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={toInputId}
                  className="text-xs font-medium text-muted-foreground"
                >
                  To
                </label>
                <div className="flex gap-2 text-xs">
                  {!isCcVisible && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setIsCcVisible(true)}
                    >
                      Cc
                    </button>
                  )}
                  {!isBccVisible && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setIsBccVisible(true)}
                    >
                      Bcc
                    </button>
                  )}
                </div>
              </div>
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
            {isCcVisible && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={ccInputId}
                  className="text-xs font-medium text-muted-foreground"
                >
                  Cc
                </label>
                <RecipientPicker
                  accountId={accountId}
                  id={ccInputId}
                  value={ccRecipients}
                  inputValue={ccInputValue}
                  disabled={isSending}
                  invalid={validationMessage.startsWith('Check Cc recipient')}
                  onChange={setCcRecipients}
                  onInputChange={setCcInputValue}
                />
              </div>
            )}
            {isBccVisible && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={bccInputId}
                  className="text-xs font-medium text-muted-foreground"
                >
                  Bcc
                </label>
                <RecipientPicker
                  accountId={accountId}
                  id={bccInputId}
                  value={bccRecipients}
                  inputValue={bccInputValue}
                  disabled={isSending}
                  invalid={validationMessage.startsWith('Check Bcc recipient')}
                  onChange={setBccRecipients}
                  onInputChange={setBccInputValue}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={subjectInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                Subject
              </label>
              {mode === 'new' ? (
                <Input
                  id={subjectInputId}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Subject"
                  disabled={isSending}
                />
              ) : (
                <p id={subjectInputId} className="truncate text-sm text-foreground">
                  {subject}
                </p>
              )}
            </div>
          </>
        )}

        <div className={cn('flex min-h-0 flex-col gap-1.5', !isResponse && 'flex-1')}>
          <label
            htmlFor={bodyInputId}
            className="text-xs font-medium text-muted-foreground"
          >
            Message
          </label>
          <RichTextMailEditor
            id={bodyInputId}
            className={cn(!isResponse && 'flex-1')}
            disabled={isSending}
            fill={!isResponse}
            initialValue={initialDraft?.editorValue}
            onPickAttachments={() => void addPickedAttachments()}
            placeholder={isResponse ? 'Write a response' : 'Write a message'}
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

function parsePendingRecipients(
  recipients: MailComposeRecipient[],
  inputValue: string,
  label: string,
):
  | { ok: true; recipients: MailComposeRecipient[] }
  | { ok: false; error: string } {
  const pendingRecipients = parseRecipients(inputValue);

  if (pendingRecipients.invalid.length > 0) {
    return {
      ok: false,
      error: `Check ${label}: ${pendingRecipients.invalid[0]}`,
    };
  }

  return {
    ok: true,
    recipients: dedupeRecipients([...recipients, ...pendingRecipients.valid]),
  };
}

function getInitialResponseSubject(
  mode: 'new' | 'reply' | 'replyAll' | 'forward',
  message: MailMessageDetail | undefined,
) {
  if (!message || mode === 'new') {
    return '';
  }

  if (mode === 'forward') {
    return /^fwd:/i.test(message.subject)
      ? message.subject
      : `Fwd: ${message.subject || '(No subject)'}`;
  }

  return /^re:/i.test(message.subject)
    ? message.subject
    : `Re: ${message.subject || '(No subject)'}`;
}

function getInitialResponseRecipients(
  mode: 'new' | 'reply' | 'replyAll' | 'forward',
  message: MailMessageDetail | undefined,
  accountEmail: string | undefined,
) {
  if (!message || mode === 'new' || mode === 'forward') {
    return { toValue: '', ccValue: '' };
  }

  const replyTargets =
    (message.replyTo?.length ?? 0) > 0 ? (message.replyTo ?? []) : [message.sender];
  const toRecipients =
    mode === 'replyAll'
      ? dedupeRecipients([
          ...toComposeRecipients(replyTargets),
          ...parseRecipients(message.recipients.join(', ')).valid,
        ]).filter((recipient) => !isOwnRecipient(recipient, accountEmail))
      : toComposeRecipients(replyTargets);
  const ccRecipients =
    mode === 'replyAll'
      ? parseRecipients((message.ccRecipients ?? []).join(', ')).valid.filter(
          (recipient) => !isOwnRecipient(recipient, accountEmail),
        )
      : [];

  return {
    toValue: serializeRecipients(toRecipients),
    ccValue: serializeRecipients(ccRecipients),
  };
}

function toComposeRecipients(addresses: MailAddress[]) {
  return addresses
    .filter((address) => address.email)
    .map((address) => ({ name: address.name, email: address.email }));
}

function isOwnRecipient(
  recipient: MailComposeRecipient,
  accountEmail: string | undefined,
) {
  return recipient.email.toLowerCase() === accountEmail?.toLowerCase();
}

function serializeDraftForDirtyCheck(draft: ComposeWindowDraft) {
  return JSON.stringify({
    toValue: draft.toValue.trim(),
    ccValue: draft.ccValue?.trim() ?? '',
    bccValue: draft.bccValue?.trim() ?? '',
    subject: draft.subject.trim(),
    editorHtml: draft.editorValue.html,
    editorText: draft.editorValue.text.trim(),
    attachments: (draft.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
    })),
  });
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
