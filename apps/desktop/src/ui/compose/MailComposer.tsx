import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { containsFiles, getFiles } from '@atlaskit/pragmatic-drag-and-drop/external/file';
import { Paperclip, Send, X } from 'lucide-react';
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  MailDraftSaveInput,
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
  onProviderDraftSent,
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
  onProviderDraftSent?: () => Promise<void> | void;
  onReply: (input: ReplyToMessageInput) => void;
  onSend: (input: SendMailInput) => void;
  useWindowHeader?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedDraftSignatureRef = useRef(
    initialDraft?.providerDraftId
      ? getComposeDraftSignature(initialDraft)
      : undefined,
  );
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
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
  const [providerDraftId, setProviderDraftId] = useState(
    initialDraft?.providerDraftId,
  );
  const [providerDraftMessageId, setProviderDraftMessageId] = useState(
    initialDraft?.providerDraftMessageId,
  );
  const [providerDraftAccountId, setProviderDraftAccountId] = useState(
    initialDraft?.providerDraftId ? initialDraft.accountId : undefined,
  );
  const providerDraftIdRef = useRef(initialDraft?.providerDraftId);
  const providerDraftMessageIdRef = useRef(initialDraft?.providerDraftMessageId);
  const providerDraftAccountIdRef = useRef(
    initialDraft?.providerDraftId ? initialDraft.accountId : undefined,
  );
  const [editorValue, setEditorValue] = useState<RichTextMailEditorValue>({
    ...(initialDraft?.editorValue ?? emptyComposeWindowDraft.editorValue),
  });
  const [validationMessage, setValidationMessage] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const [isSendingDraft, setIsSendingDraft] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isReply = mode === 'reply';
  const scopedProviderDraftId =
    providerDraftAccountId === accountId ? providerDraftId : undefined;
  const scopedProviderDraftMessageId =
    providerDraftAccountId === accountId ? providerDraftMessageId : undefined;
  const currentDraft = useMemo<ComposeWindowDraft>(
    () => ({
      accountId,
      providerDraftId: scopedProviderDraftId,
      providerDraftMessageId: scopedProviderDraftMessageId,
      kind: isReply ? 'reply' : 'new',
      relatedMessageId: replyMessage?.id,
      toValue: serializeRecipients(toRecipients, toInputValue),
      subject,
      editorValue,
      attachments,
    }),
    [
      accountId,
      attachments,
      editorValue,
      isReply,
      replyMessage?.id,
      scopedProviderDraftId,
      scopedProviderDraftMessageId,
      subject,
      toInputValue,
      toRecipients,
    ],
  );
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const isDirty =
    currentDraft.toValue.trim().length > 0 ||
    subject.trim().length > 0 ||
    editorValue.text.trim().length > 0 ||
    attachments.length > 0;

  const getDraftSaveInput = useCallback((): MailDraftSaveInput => {
    const pendingRecipients = parseRecipients(toInputValue);
    const draftBelongsToAccount =
      providerDraftAccountIdRef.current === accountId;

    return {
      providerDraftId: draftBelongsToAccount
        ? providerDraftIdRef.current
        : undefined,
      providerDraftMessageId: draftBelongsToAccount
        ? providerDraftMessageIdRef.current
        : undefined,
      kind: isReply ? 'reply' : 'new',
      relatedMessageId: replyMessage?.id,
      toRecipients: dedupeRecipients([
        ...toRecipients,
        ...pendingRecipients.valid,
      ]),
      toValue: currentDraft.toValue,
      subject: subject.trim(),
      bodyHtml: sanitizeOutgoingMailHtml(editorValue.html),
      editorValue,
      attachments,
    };
  }, [
    accountId,
    attachments,
    currentDraft.toValue,
    editorValue,
    isReply,
    replyMessage?.id,
    subject,
    toInputValue,
    toRecipients,
  ]);

  const runSaveDraft = useCallback(async ({ force = false } = {}) => {
    if (!isDirty || !accountId || isReply) {
      return undefined;
    }

    const draftInput = getDraftSaveInput();
    const draftSignature = getDraftSaveInputSignature(draftInput);

    if (!force && draftSignature === lastSavedDraftSignatureRef.current) {
      return undefined;
    }

    setAutosaveStatus('saving');

    try {
      const savedDraft = await api.drafts.save(accountId, draftInput);

      providerDraftIdRef.current = savedDraft.providerDraftId;
      providerDraftMessageIdRef.current = savedDraft.providerDraftMessageId;
      providerDraftAccountIdRef.current = accountId;
      setProviderDraftId(savedDraft.providerDraftId);
      setProviderDraftMessageId(savedDraft.providerDraftMessageId);
      setProviderDraftAccountId(accountId);
      setAttachments(savedDraft.attachments);
      lastSavedDraftSignatureRef.current = getDraftSaveInputSignature({
        ...draftInput,
        attachments: savedDraft.attachments,
      });
      setAutosaveStatus('saved');
      return savedDraft;
    } catch {
      setAutosaveStatus('failed');
      return undefined;
    }
  }, [accountId, getDraftSaveInput, isDirty, isReply]);

  const saveDraft = useCallback(
    (options: { force?: boolean } = {}) => {
      const queuedSave = saveQueueRef.current.then(
        () => runSaveDraft(options),
        () => runSaveDraft(options),
      );

      saveQueueRef.current = queuedSave.catch(() => undefined);
      return queuedSave;
    },
    [runSaveDraft],
  );

  useEffect(() => {
    if (isReply) {
      return;
    }

    onDraftChange?.(currentDraft);
  }, [currentDraft, isReply, onDraftChange]);

  useEffect(() => {
    if (!providerDraftAccountId || providerDraftAccountId === accountId) {
      return;
    }

    providerDraftIdRef.current = undefined;
    providerDraftMessageIdRef.current = undefined;
    providerDraftAccountIdRef.current = undefined;
    lastSavedDraftSignatureRef.current = undefined;
    setProviderDraftId(undefined);
    setProviderDraftMessageId(undefined);
    setProviderDraftAccountId(undefined);
    setAutosaveStatus('idle');
    setAttachments((current) =>
      current.filter((attachment) => !attachment.providerAttachmentId),
    );
  }, [accountId, providerDraftAccountId]);

  useEffect(() => {
    if (!isDirty || !accountId || isReply || isSending || isSendingDraft) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveDraft();
    }, 750);

    return () => window.clearTimeout(timeout);
  }, [
    accountId,
    currentDraft,
    isDirty,
    isReply,
    isSending,
    isSendingDraft,
    saveDraft,
  ]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

      onReply({ messageId: replyMessage.id, bodyHtml, attachments });
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

    if (scopedProviderDraftId) {
      await sendProviderDraft();
      return;
    }

    onSend({ toRecipients: recipients, subject: subject.trim(), bodyHtml, attachments });
  }

  async function sendProviderDraft() {
    if (isSendingDraft) {
      return;
    }

    setIsSendingDraft(true);

    try {
      const savedDraft = await saveDraft({ force: true });
      const draftId = savedDraft?.providerDraftId;

      if (!draftId) {
        setValidationMessage('Autosave failed. Keep the composer open and try again.');
        return;
      }

      await api.drafts.send(accountId, draftId);
      await onProviderDraftSent?.();
      onClose();
    } catch (error) {
      setValidationMessage(getErrorMessage(error));
    } finally {
      setIsSendingDraft(false);
    }
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

  async function handleClose() {
    if (isReply) {
      if (isDirty && !window.confirm('Discard this unsent reply?')) {
        return;
      }

      onClose();
      return;
    }

    if (isDirty && !scopedProviderDraftId) {
      const savedDraft = await saveDraft();

      if (!savedDraft && !window.confirm('Autosave failed. Discard this unsent message?')) {
        return;
      }
    }

    if (
      isDirty &&
      scopedProviderDraftId &&
      window.confirm('Discard this saved draft?')
    ) {
      await api.drafts.delete(accountId, scopedProviderDraftId);
      onClose();
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
        autosaveStatus={autosaveStatus}
        isReply={isReply}
        isSending={isSending || isSendingDraft}
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
                disabled={isSending || isSendingDraft}
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
            disabled={isSending || isSendingDraft}
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
                        disabled={isSending || isSendingDraft}
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
          disabled={isSending || isSendingDraft}
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSending || isSendingDraft}>
          <Send data-icon="inline-start" />
          {isSending || isSendingDraft ? 'Sending...' : 'Send'}
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

function getComposeDraftSignature(draft: ComposeWindowDraft) {
  return JSON.stringify({
    kind: draft.kind ?? 'new',
    relatedMessageId: draft.relatedMessageId,
    toValue: draft.toValue,
    ccValue: draft.ccValue,
    bccValue: draft.bccValue,
    subject: draft.subject.trim(),
    editorValue: draft.editorValue,
    attachments: getAttachmentSignature(draft.attachments ?? []),
  });
}

function getDraftSaveInputSignature(input: MailDraftSaveInput) {
  return JSON.stringify({
    kind: input.kind,
    relatedMessageId: input.relatedMessageId,
    toRecipients: input.toRecipients,
    toValue: input.toValue,
    ccValue: input.ccValue,
    bccValue: input.bccValue,
    subject: input.subject.trim(),
    bodyHtml: input.bodyHtml,
    editorValue: input.editorValue,
    attachments: getAttachmentSignature(input.attachments ?? []),
  });
}

function getAttachmentSignature(attachments: LocalMailAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    providerAttachmentId: attachment.providerAttachmentId,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
  }));
}

function getAttachmentErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Could not add attachment.';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not send draft.';
}
