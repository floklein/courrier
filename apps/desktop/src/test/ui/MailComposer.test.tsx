import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api-client';
import type { ComposeWindowDraft } from '@/lib/compose-window';
import type {
  MailDraftDetail,
  MailDraftSaveInput,
  MailMessageDetail,
} from '@/lib/mail-types';
import { MailComposer } from '@/ui/compose/MailComposer';

vi.mock('@atlaskit/pragmatic-drag-and-drop/external/adapter', () => ({
  dropTargetForExternal: vi.fn(() => vi.fn()),
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/external/file', () => ({
  containsFiles: vi.fn(() => false),
  getFiles: vi.fn(() => []),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    attachments: {
      pickLocal: vi.fn(),
      registerDroppedFiles: vi.fn(),
    },
    drafts: {
      save: vi.fn(async (accountId: string, input: MailDraftSaveInput) => ({
        providerDraftId: 'draft-1',
        providerDraftMessageId: 'message-draft-1',
        accountId,
        kind: input.kind,
        relatedMessageId: input.relatedMessageId,
        toValue: input.toValue,
        ccValue: input.ccValue,
        bccValue: input.bccValue,
        subject: input.subject,
        editorValue: input.editorValue,
        attachments: input.attachments ?? [],
        createdAt: '2026-07-24T10:00:00Z',
        updatedAt: '2026-07-24T10:00:00Z',
      })),
      delete: vi.fn(),
      send: vi.fn(),
    },
  },
}));

vi.mock('@/ui/compose/RichTextMailEditor', async () => {
  const React = await import('react');

  return {
    RichTextMailEditor({
      id,
      initialValue,
      value,
      onPickAttachments,
      onChange,
    }: {
      id?: string;
      initialValue?: { html: string; text: string; isEmpty: boolean };
      value?: { html: string; text: string; isEmpty: boolean };
      onPickAttachments?: () => void;
      onChange: (value: { html: string; text: string; isEmpty: boolean }) => void;
    }) {
      return React.createElement(
        'div',
        null,
        React.createElement('textarea', {
          id,
          'aria-label': 'Message body',
          value: value?.text ?? initialValue?.text ?? '',
          onChange: (event: { target: HTMLTextAreaElement }) => {
            const text = event.target.value;

            onChange({
              html: text ? `<p>${text}</p>` : '',
              text,
              isEmpty: text.length === 0,
            });
          },
        }),
        React.createElement(
          'button',
          {
            'aria-label': 'Attach test file',
            onClick: onPickAttachments,
            type: 'button',
          },
          'Attach',
        ),
      );
    },
  };
});

const replyMessage: MailMessageDetail = {
  id: 'message-1',
  folderId: 'inbox',
  sender: { name: 'Sender', email: 'sender@example.com' },
  recipients: ['Ada <ada@example.com>'],
  ccRecipients: ['Copy <copy@example.com>'],
  replyTo: [{ name: 'Replies', email: 'replies@example.com' }],
  subject: 'Hello',
  preview: 'Preview',
  receivedDateTime: '2026-05-16T12:00:00Z',
  isRead: false,
  hasAttachments: false,
  importance: 'normal',
  bodyContentType: 'text',
  bodyContent: 'Hello',
  attachments: [],
};

describe('MailComposer', () => {
  beforeEach(() => {
    vi.mocked(api.drafts.save)
      .mockReset()
      .mockImplementation(async (accountId, input) => ({
        providerDraftId: input.providerDraftId ?? 'draft-1',
        providerDraftMessageId:
          input.providerDraftMessageId ?? 'message-draft-1',
        accountId,
        kind: input.kind,
        relatedMessageId: input.relatedMessageId,
        toValue: input.toValue,
        ccValue: input.ccValue,
        bccValue: input.bccValue,
        subject: input.subject,
        editorValue: input.editorValue,
        attachments: input.attachments ?? [],
        createdAt: '2026-07-24T10:00:00Z',
        updatedAt: '2026-07-24T10:00:00Z',
      }));
    vi.mocked(api.drafts.delete).mockReset();
    vi.mocked(api.drafts.send).mockReset();
    vi.mocked(api.attachments.pickLocal).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('does not prompt when closing an untouched response composer', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onClose = vi.fn();

    renderComposer({ onClose });

    fireEvent.click(screen.getByLabelText('Cancel composer'));

    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('saves the latest edited response before closing', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onClose = vi.fn();

    renderComposer({ onClose });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Edited reply' },
    });
    fireEvent.click(screen.getByLabelText('Cancel composer'));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not rewrite an unchanged recovered provider draft', async () => {
    vi.useFakeTimers();

    renderComposer({
      initialDraft: createDraft({
        providerDraftId: 'draft-existing',
        providerDraftMessageId: 'message-existing',
      }),
      mode: 'new',
      onClose: vi.fn(),
    });

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(api.drafts.save).not.toHaveBeenCalled();
  });

  it('persists clearing all content from an existing provider draft', async () => {
    vi.useFakeTimers();

    renderComposer({
      initialDraft: createDraft({
        providerDraftId: 'draft-existing',
        providerDraftMessageId: 'message-existing',
        subject: '',
        toValue: '',
      }),
      mode: 'new',
      onClose: vi.fn(),
    });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: '' },
    });
    await act(() => vi.advanceTimersByTimeAsync(750));

    expect(api.drafts.save).toHaveBeenCalledWith(
      'microsoft:account-1',
      expect.objectContaining({
        providerDraftId: 'draft-existing',
        bodyHtml: '',
      }),
    );
  });

  it('serializes send behind the first provider save', async () => {
    const firstSave = createDeferred<ReturnType<typeof createSavedDraft>>();
    vi.mocked(api.drafts.save).mockReturnValueOnce(firstSave.promise);
    const onClose = vi.fn();

    renderComposer({
      initialDraft: createDraft(),
      mode: 'new',
      onClose,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(api.drafts.save).toHaveBeenCalledOnce());
    expect(api.drafts.send).not.toHaveBeenCalled();

    await act(async () => {
      firstSave.resolve(createSavedDraft());
      await firstSave.promise;
    });

    await waitFor(() =>
      expect(api.drafts.send).toHaveBeenCalledWith(
        'microsoft:account-1',
        'draft-1',
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('flushes the latest edit before keeping and closing a saved draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();

    renderComposer({
      initialDraft: createDraft({
        providerDraftId: 'draft-existing',
        providerDraftMessageId: 'message-existing',
      }),
      mode: 'new',
      onClose,
    });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Latest body' },
    });
    fireEvent.click(screen.getByLabelText('Cancel composer'));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('Discard this saved draft?');
    expect(api.drafts.save).toHaveBeenCalledWith(
      'microsoft:account-1',
      expect.objectContaining({
        providerDraftId: 'draft-existing',
        bodyHtml: '<p>Latest body</p>',
      }),
    );
    expect(api.drafts.delete).not.toHaveBeenCalled();
  });

  it('deletes a saved provider draft only after explicit discard', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();

    renderComposer({
      initialDraft: createDraft({
        providerDraftId: 'draft-existing',
        providerDraftMessageId: 'message-existing',
      }),
      mode: 'new',
      onClose,
    });
    fireEvent.click(screen.getByLabelText('Cancel composer'));

    await waitFor(() =>
      expect(api.drafts.delete).toHaveBeenCalledWith(
        'microsoft:account-1',
        'draft-existing',
      ),
    );
    expect(api.drafts.save).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('flushes before moving and transfers the authoritative provider IDs', async () => {
    const firstSave = createDeferred<ReturnType<typeof createSavedDraft>>();
    vi.mocked(api.drafts.save).mockReturnValueOnce(firstSave.promise);
    const onMoveToWindow = vi.fn();

    renderComposer({
      initialDraft: createDraft(),
      mode: 'new',
      onClose: vi.fn(),
      onMoveToWindow,
    });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Updated before moving' },
    });
    fireEvent.click(screen.getByLabelText('Move composer to window'));

    await waitFor(() => expect(api.drafts.save).toHaveBeenCalledOnce());
    expect(onMoveToWindow).not.toHaveBeenCalled();

    await act(async () => {
      firstSave.resolve(createSavedDraft());
      await firstSave.promise;
    });

    await waitFor(() =>
      expect(onMoveToWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          providerDraftId: 'draft-1',
          providerDraftMessageId: 'message-draft-1',
        }),
      ),
    );
  });

  it('preserves attachments added during an in-flight autosave and flushes them', async () => {
    vi.useFakeTimers();
    const firstSave = createDeferred<ReturnType<typeof createSavedDraft>>();
    vi.mocked(api.drafts.save).mockReturnValueOnce(firstSave.promise);
    vi.mocked(api.attachments.pickLocal).mockResolvedValueOnce([
      {
        id: 'local-b',
        name: 'second.txt',
        contentType: 'text/plain',
        size: 6,
      },
    ]);
    const onMoveToWindow = vi.fn();

    renderComposer({
      initialDraft: createDraft({
        attachments: [
          {
            id: 'local-a',
            name: 'first.txt',
            contentType: 'text/plain',
            size: 5,
          },
        ],
      }),
      mode: 'new',
      onClose: vi.fn(),
      onMoveToWindow,
    });
    fireEvent.change(screen.getByLabelText('Message body'), {
      target: { value: 'Starts autosave' },
    });
    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(api.drafts.save).toHaveBeenCalledOnce();
    vi.useRealTimers();

    fireEvent.click(screen.getByLabelText('Attach test file'));
    await screen.findByText('second.txt');
    fireEvent.click(screen.getByLabelText('Move composer to window'));

    await act(async () => {
      firstSave.resolve(
        createSavedDraft({
          attachments: [
            {
              id: 'provider-a',
              providerAttachmentId: 'provider-a',
              name: 'first.txt',
              contentType: 'text/plain',
              size: 5,
            },
          ],
        }),
      );
      await firstSave.promise;
    });

    await waitFor(() => expect(api.drafts.save).toHaveBeenCalledTimes(2));
    expect(api.drafts.save).toHaveBeenLastCalledWith(
      'microsoft:account-1',
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ name: 'first.txt' }),
          expect.objectContaining({ name: 'second.txt' }),
        ]),
      }),
    );
    await waitFor(() => expect(onMoveToWindow).toHaveBeenCalledOnce());
  });
});

function renderComposer({
  initialDraft,
  mode = 'replyAll',
  onClose,
  onMoveToWindow,
}: {
  initialDraft?: ComposeWindowDraft;
  mode?: 'new' | 'reply' | 'replyAll' | 'forward';
  onClose: () => void;
  onMoveToWindow?: (draft: ComposeWindowDraft) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MailComposer
          accountId="microsoft:account-1"
          accountEmail="ada@example.com"
          mode={mode}
          replyMessage={mode === 'new' ? undefined : replyMessage}
          initialDraft={initialDraft}
          isSending={false}
          error={null}
          onClose={onClose}
          onMoveToWindow={onMoveToWindow}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function createDraft(
  overrides: Partial<ComposeWindowDraft> = {},
): ComposeWindowDraft {
  return {
    accountId: 'microsoft:account-1',
    kind: 'new',
    toValue: 'Ada <ada@example.com>',
    ccValue: '',
    bccValue: '',
    subject: 'Draft lifecycle test',
    editorValue: {
      html: '<p>Draft body</p>',
      text: 'Draft body',
      isEmpty: false,
    },
    attachments: [],
    ...overrides,
  };
}

function createSavedDraft(
  overrides: Partial<MailDraftDetail> = {},
): MailDraftDetail {
  return {
    ...createSavedDraftBase(),
    ...overrides,
  };
}

function createSavedDraftBase() {
  return {
    providerDraftId: 'draft-1',
    providerDraftMessageId: 'message-draft-1',
    accountId: 'microsoft:account-1',
    kind: 'new' as const,
    toValue: 'Ada <ada@example.com>',
    ccValue: '',
    bccValue: '',
    subject: 'Draft lifecycle test',
    editorValue: {
      html: '<p>Draft body</p>',
      text: 'Draft body',
      isEmpty: false,
    },
    attachments: [],
    createdAt: '2026-07-24T10:00:00Z',
    updatedAt: '2026-07-24T10:00:00Z',
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}
