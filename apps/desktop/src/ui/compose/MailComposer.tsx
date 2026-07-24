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
  MailAddress,
  MailComposeRecipient,
  LocalMailAttachment,
  MailDraftSaveInput,
  MailMessageDetail,
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
  onFlushHandlerChange,
  onMinimize,
  onMoveToWindow,
  onProviderDraftChanged,
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
  onFlushHandlerChange?: (
    handler: (() => Promise<boolean>) | undefined,
  ) => void;
  onMinimize?: () => void;
  onMoveToWindow?: (draft: ComposeWindowDraft) => Promise<void> | void;
  onProviderDraftChanged?: () => Promise<void> | void;
  useWindowHeader?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedDraftSignatureRef = useRef(
    initialDraft?.providerDraftId
      ? getComposeDraftSignature(initialDraft)
      : undefined,
  );
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const isTransitioningRef = useRef(false);
  const shouldSaveOnUnmountRef = useRef(true);
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isComposerBusy = isSending || isSendingDraft || isTransitioning;
  const isResponse = mode !== 'new';
  const scopedProviderDraftId =
    providerDraftAccountId === accountId ? providerDraftId : undefined;
  const scopedProviderDraftMessageId =
    providerDraftAccountId === accountId ? providerDraftMessageId : undefined;
  const currentDraft = useMemo<ComposeWindowDraft>(
    () => ({
      accountId,
      providerDraftId: scopedProviderDraftId,
      providerDraftMessageId: scopedProviderDraftMessageId,
      kind: mode,
      relatedMessageId: replyMessage?.id ?? initialDraft?.relatedMessageId,
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
      initialDraft?.relatedMessageId,
      replyMessage?.id,
      scopedProviderDraftId,
      scopedProviderDraftMessageId,
      subject,
      toInputValue,
      toRecipients,
    ],
  );
  const hasBody = editorValue.text.trim().length > 0 && !editorValue.isEmpty;
  const currentDraftRef = useRef(currentDraft);
  currentDraftRef.current = currentDraft;
  const initialDraftValueRef = useRef<string | undefined>(undefined);

  if (initialDraftValueRef.current === undefined) {
    initialDraftValueRef.current = getComposeDraftSignature(currentDraft);
  }

  const currentDraftSignature = getComposeDraftSignature(currentDraft);
  const hasLocalChanges =
    currentDraftSignature !== initialDraftValueRef.current;
  const hasUnsavedChanges =
    currentDraftSignature !== lastSavedDraftSignatureRef.current;

  const runSaveDraft = useCallback(async ({ force = false } = {}) => {
    if (!accountId) {
      return undefined;
    }

    const draftSnapshot = currentDraftRef.current;
    const draftSignature = getComposeDraftSignature(draftSnapshot);
    const hasProviderDraft =
      providerDraftAccountIdRef.current === accountId &&
      Boolean(providerDraftIdRef.current);

    if (
      draftSignature === lastSavedDraftSignatureRef.current ||
      (!force &&
        !hasProviderDraft &&
        draftSignature === initialDraftValueRef.current)
    ) {
      return undefined;
    }

    const draftInput = getDraftSaveInput(
      draftSnapshot,
      hasProviderDraft ? providerDraftIdRef.current : undefined,
      hasProviderDraft ? providerDraftMessageIdRef.current : undefined,
    );
    setAutosaveStatus('saving');

    try {
      const savedDraft = await api.drafts.save(accountId, draftInput);
      const acknowledgedEditorValue =
        draftSnapshot.kind !== 'new'
          ? mergeSavedResponseEditorValue(
              savedDraft.editorValue,
              draftSnapshot.editorValue,
              currentDraftRef.current.editorValue,
            )
          : currentDraftRef.current.editorValue;
      const acknowledgedAttachments = reconcileSavedAttachments(
        draftSnapshot.attachments ?? [],
        savedDraft.attachments,
        currentDraftRef.current.attachments ?? [],
      );
      const acknowledgedDraft: ComposeWindowDraft = {
        ...draftSnapshot,
        providerDraftId: savedDraft.providerDraftId,
        providerDraftMessageId: savedDraft.providerDraftMessageId,
        editorValue:
          draftSnapshot.kind !== 'new'
            ? savedDraft.editorValue
            : draftSnapshot.editorValue,
        attachments: savedDraft.attachments,
      };

      providerDraftIdRef.current = savedDraft.providerDraftId;
      providerDraftMessageIdRef.current = savedDraft.providerDraftMessageId;
      providerDraftAccountIdRef.current = accountId;
      currentDraftRef.current = {
        ...currentDraftRef.current,
        providerDraftId: savedDraft.providerDraftId,
        providerDraftMessageId: savedDraft.providerDraftMessageId,
        editorValue: acknowledgedEditorValue,
        attachments: acknowledgedAttachments,
      };
      setProviderDraftId(savedDraft.providerDraftId);
      setProviderDraftMessageId(savedDraft.providerDraftMessageId);
      setProviderDraftAccountId(accountId);
      setAttachments(acknowledgedAttachments);
      if (draftSnapshot.kind !== 'new') {
        setEditorValue(acknowledgedEditorValue);
      }
      lastSavedDraftSignatureRef.current =
        getComposeDraftSignature(acknowledgedDraft);
      setAutosaveStatus('saved');
      void onProviderDraftChanged?.();
      return savedDraft;
    } catch {
      setAutosaveStatus('failed');
      return undefined;
    }
  }, [accountId, onProviderDraftChanged]);

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
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  useEffect(
    () => () => {
      const draftSignature = getComposeDraftSignature(currentDraftRef.current);
      const hasProviderDraft =
        providerDraftAccountIdRef.current === accountId &&
        Boolean(providerDraftIdRef.current);

      if (
        shouldSaveOnUnmountRef.current &&
        draftSignature !== lastSavedDraftSignatureRef.current &&
        (hasProviderDraft || draftSignature !== initialDraftValueRef.current)
      ) {
        void saveDraftRef.current({ force: true });
      }
    },
    [accountId],
  );

  useEffect(() => {
    onDraftChange?.(currentDraft);
  }, [currentDraft, onDraftChange]);

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
    if (
      !hasUnsavedChanges ||
      (!scopedProviderDraftId && !hasLocalChanges) ||
      !accountId ||
      isSending ||
      isSendingDraft ||
      isTransitioningRef.current
    ) {
      return;
    }

    setAutosaveStatus('saving');
    const timeout = window.setTimeout(() => {
      if (!isTransitioningRef.current) {
        void saveDraft();
      }
    }, 750);

    return () => window.clearTimeout(timeout);
  }, [
    accountId,
    currentDraft,
    hasLocalChanges,
    hasUnsavedChanges,
    isSending,
    isSendingDraft,
    saveDraft,
    scopedProviderDraftId,
  ]);

  useEffect(() => {
    const element = formRef.current;

    if (!element || isComposerBusy) {
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
  }, [isComposerBusy]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationMessage('');

    if (!hasBody) {
      setValidationMessage('Write a message before sending.');
      return;
    }

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

    if (
      mode !== 'new' &&
      !currentDraft.relatedMessageId &&
      !providerDraftIdRef.current
    ) {
      setValidationMessage('Select a message before responding.');
      return;
    }

    if (
      (mode === 'new' || mode === 'forward') &&
      toResult.recipients.length === 0
    ) {
      setValidationMessage('Add at least one recipient.');
      return;
    }

    await sendProviderDraft();
  }

  async function sendProviderDraft() {
    if (isSendingDraft) {
      return;
    }

    setComposerTransitioning(true);
    setIsSendingDraft(true);

    try {
      const didSave = await flushCurrentDraft({ ensureProviderDraft: true });
      const draftId =
        providerDraftAccountIdRef.current === accountId
          ? providerDraftIdRef.current
          : undefined;

      if (!didSave || !draftId) {
        setValidationMessage('Autosave failed. Keep the composer open and try again.');
        setComposerTransitioning(false);
        return;
      }

      await api.drafts.send(accountId, draftId);
      await onProviderDraftChanged?.();
      shouldSaveOnUnmountRef.current = false;
      onClose();
    } catch (error) {
      setValidationMessage(getErrorMessage(error));
      setComposerTransitioning(false);
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

  const flushCurrentDraft = useCallback(async ({
    ensureProviderDraft = false,
  }: {
    ensureProviderDraft?: boolean;
  } = {}) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const draftSignature = getComposeDraftSignature(currentDraftRef.current);
      const hasProviderDraft =
        providerDraftAccountIdRef.current === accountId &&
        Boolean(providerDraftIdRef.current);
      const needsSave =
        (!hasProviderDraft && ensureProviderDraft) ||
        (draftSignature !== lastSavedDraftSignatureRef.current &&
          (hasProviderDraft || draftSignature !== initialDraftValueRef.current));

      if (!needsSave) {
        return true;
      }

      const savedDraft = await saveDraft({ force: true });

      if (
        getComposeDraftSignature(currentDraftRef.current) ===
        lastSavedDraftSignatureRef.current
      ) {
        return true;
      }

      if (!savedDraft) {
        return false;
      }
    }

    return false;
  }, [accountId, saveDraft]);

  const flushAndClose = useCallback(async () => {
    setComposerTransitioning(true);
    const didSave = await flushCurrentDraft({ ensureProviderDraft: true });

    if (!didSave) {
      setComposerTransitioning(false);
      setValidationMessage(
        'Autosave failed. Keep the composer open and try again.',
      );
      return false;
    }

    shouldSaveOnUnmountRef.current = false;
    onClose();
    return true;
  }, [flushCurrentDraft, onClose]);

  useEffect(() => {
    onFlushHandlerChange?.(flushAndClose);

    return () => onFlushHandlerChange?.(undefined);
  }, [flushAndClose, onFlushHandlerChange]);

  async function handleMinimize() {
    if (!onMinimize) {
      return;
    }

    setComposerTransitioning(true);
    const didSave = await flushCurrentDraft({ ensureProviderDraft: true });

    if (!didSave) {
      setComposerTransitioning(false);
      setValidationMessage(
        'Autosave failed. Keep the composer open and try again.',
      );
      return;
    }

    onMinimize();
    setComposerTransitioning(false);
  }

  async function handleMoveToWindow() {
    if (!onMoveToWindow) {
      return;
    }

    setComposerTransitioning(true);
    const didSave = await flushCurrentDraft({ ensureProviderDraft: true });

    if (!didSave) {
      setComposerTransitioning(false);
      setValidationMessage(
        'Autosave failed. Keep the composer open and try again.',
      );
      return;
    }

    try {
      await onMoveToWindow({
        ...currentDraftRef.current,
        providerDraftId:
          providerDraftAccountIdRef.current === accountId
            ? providerDraftIdRef.current
            : undefined,
        providerDraftMessageId:
          providerDraftAccountIdRef.current === accountId
            ? providerDraftMessageIdRef.current
            : undefined,
      });
      shouldSaveOnUnmountRef.current = false;
    } catch (error) {
      setComposerTransitioning(false);
      setValidationMessage(getErrorMessage(error));
    }
  }

  async function handleClose() {
    if (isComposerBusy) {
      return;
    }

    setComposerTransitioning(true);
    setValidationMessage('');

    try {
      await saveQueueRef.current;
      const existingDraftId =
        providerDraftAccountIdRef.current === accountId
          ? providerDraftIdRef.current
          : undefined;

      if (
        existingDraftId &&
        window.confirm('Discard this saved draft?')
      ) {
        await api.drafts.delete(accountId, existingDraftId);
        await onProviderDraftChanged?.();
        shouldSaveOnUnmountRef.current = false;
        onClose();
        return;
      }

      const didSave = await flushCurrentDraft();

      if (
        !didSave &&
        !window.confirm(
          existingDraftId
            ? 'Autosave failed. Close without saving your latest changes?'
            : 'Autosave failed. Discard this unsent message?',
        )
      ) {
        setComposerTransitioning(false);
        return;
      }

      shouldSaveOnUnmountRef.current = false;
      onClose();
    } catch (error) {
      setComposerTransitioning(false);
      setValidationMessage(getErrorMessage(error));
    }
  }

  function setComposerTransitioning(isNextTransitioning: boolean) {
    isTransitioningRef.current = isNextTransitioning;
    setIsTransitioning(isNextTransitioning);
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
        isReply={isResponse}
        isSending={isComposerBusy}
        replyMessage={replyMessage}
        useWindowHeader={useWindowHeader}
        onClose={handleClose}
        onMinimize={onMinimize ? handleMinimize : undefined}
        onMoveToWindow={onMoveToWindow ? handleMoveToWindow : undefined}
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
                disabled={isComposerBusy}
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
                  disabled={isComposerBusy}
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
                  disabled={isComposerBusy}
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
                  disabled={isComposerBusy}
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
            disabled={isComposerBusy}
            fill={!isResponse}
            initialValue={initialDraft?.editorValue}
            value={editorValue}
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
                        disabled={isComposerBusy}
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
          disabled={isComposerBusy}
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isComposerBusy}>
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
    toValue: getRecipientValueSignature(draft.toValue),
    ccValue: getRecipientValueSignature(draft.ccValue ?? ''),
    bccValue: getRecipientValueSignature(draft.bccValue ?? ''),
    subject: draft.subject.trim(),
    bodyHtml: sanitizeOutgoingMailHtml(draft.editorValue.html),
    attachments: getAttachmentSignature(draft.attachments ?? []),
  });
}

function getRecipientValueSignature(value: string) {
  const parsed = parseRecipients(value);

  return {
    valid: parsed.valid.map((recipient) => ({
      name: recipient.name?.trim() ?? '',
      email: recipient.email.toLowerCase(),
    })),
    invalid: parsed.invalid.map((recipient) => recipient.trim()),
  };
}

function getDraftSaveInput(
  draft: ComposeWindowDraft,
  providerDraftId: string | undefined,
  providerDraftMessageId: string | undefined,
): MailDraftSaveInput {
  return {
    providerDraftId,
    providerDraftMessageId,
    kind: draft.kind ?? 'new',
    relatedMessageId: draft.relatedMessageId,
    toRecipients: parseRecipients(draft.toValue).valid,
    ccRecipients: parseRecipients(draft.ccValue ?? '').valid,
    bccRecipients: parseRecipients(draft.bccValue ?? '').valid,
    toValue: draft.toValue,
    ccValue: draft.ccValue,
    bccValue: draft.bccValue,
    subject: draft.subject.trim(),
    bodyHtml: sanitizeOutgoingMailHtml(draft.editorValue.html),
    editorValue: draft.editorValue,
    attachments: draft.attachments,
  };
}

function reconcileSavedAttachments(
  submitted: LocalMailAttachment[],
  saved: LocalMailAttachment[],
  current: LocalMailAttachment[],
) {
  const availableSaved = [...saved];
  const savedBySubmittedId = new Map<string, LocalMailAttachment>();

  for (const attachment of submitted) {
    const matchIndex = availableSaved.findIndex(
      (candidate) =>
        candidate.providerAttachmentId === attachment.providerAttachmentId ||
        (candidate.name === attachment.name &&
          candidate.contentType === attachment.contentType &&
          candidate.size === attachment.size),
    );

    if (matchIndex < 0) {
      continue;
    }

    savedBySubmittedId.set(
      attachment.id,
      availableSaved.splice(matchIndex, 1)[0],
    );
  }

  return current.map(
    (attachment) => savedBySubmittedId.get(attachment.id) ?? attachment,
  );
}

function mergeSavedResponseEditorValue(
  saved: RichTextMailEditorValue,
  submitted: RichTextMailEditorValue,
  current: RichTextMailEditorValue,
): RichTextMailEditorValue {
  if (current.html === submitted.html) {
    return saved;
  }

  const submittedIndex = submitted.html
    ? saved.html.indexOf(submitted.html)
    : -1;
  const html =
    submittedIndex >= 0
      ? `${saved.html.slice(0, submittedIndex)}${current.html}${saved.html.slice(
          submittedIndex + submitted.html.length,
        )}`
      : `${current.html}${saved.html}`;

  return {
    ...current,
    html,
  };
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
