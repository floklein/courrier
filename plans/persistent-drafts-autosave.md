# Persistent Drafts And Autosave

## Current State

- `useComposeStore` keeps the new-message overlay draft in renderer memory only.
- Detached compose windows receive an initial `ComposeWindowDraft` through a main-process map keyed by `webContents.id`; closing the window removes that in-memory entry.
- Reply drafts are local component state in `ReadingPane` and `MailComposer`.
- `LocalAttachmentStore` maps attachment IDs to file paths in memory; after app restart, stored attachment IDs cannot be resolved.
- There is no draft list, recovery prompt, autosave timestamp, or provider-backed draft ID.

## Scope

- Persist unsent compose state in the provider's dedicated Drafts folder across window close, app restart, and renderer crash.
- Autosave all compose modes: new message, reply, reply-all, and forward.
- Restore drafts from the provider, not from a local Courrier draft store.
- Preserve attachments by uploading them to the provider draft when autosave succeeds.
- Avoid silently discarding dirty drafts. Closing a composer should either keep the autosaved draft or explicitly discard it.

## Provider-Backed Draft Model

- Do not persist draft bodies, recipients, subjects, or draft lists in local JSON files.
- Add provider draft APIs to `MailProvider` and `MailService`:
  - `listDrafts(accountId): Promise<MailDraftSummary[]>`
  - `getDraft(accountId, providerDraftId): Promise<MailDraftDetail>`
  - `createDraft(accountId, input): Promise<MailDraftDetail>`
  - `updateDraft(accountId, providerDraftId, input): Promise<MailDraftDetail>`
  - `deleteDraft(accountId, providerDraftId): Promise<void>`
  - `sendDraft(accountId, providerDraftId): Promise<void>`
- Draft record fields exposed to the renderer:
  - `providerDraftId`
  - `providerDraftMessageId?: string`
  - `accountId`
  - `kind: 'new' | 'reply' | 'replyAll' | 'forward'`
  - `relatedMessageId?: string`
  - `toValue`, `ccValue`, `bccValue`
  - `subject`
  - `editorValue`
  - `attachments: Array<{ id, name, contentType, size, providerAttachmentId?: string }>`
  - `createdAt`, `updatedAt`
- Microsoft Graph:
  - create new-message drafts in the mailbox Drafts folder with `/me/messages`
  - create reply/reply-all/forward drafts through the Graph draft actions, then update the draft message
  - update recipients, subject, body, and attachments on the provider draft
  - send with `/me/messages/{draftId}/send`
- Gmail:
  - create/update provider drafts with `users.drafts.create` and `users.drafts.update`
  - keep the Gmail draft ID and underlying message ID
  - send with `users.drafts.send`

## Autosave Flow

- Extend `ComposeWindowDraft` to include `providerDraftId`, `providerDraftMessageId`, `kind`, Cc/Bcc values, and `relatedMessageId`.
- Add IPC handlers:
  - `draft:list`
  - `draft:get`
  - `draft:save`
  - `draft:delete`
  - `draft:send`
- Debounce renderer autosave at roughly 750 ms after edits and flush immediately before minimize, detach-to-window, close, and send.
- Keep autosave orchestration in the main process, not browser storage, so multiple windows and trusted IPC checks remain centralized.
- Local renderer/main-process draft state is only an ephemeral editing cache until the provider write returns.
- On successful send/reply/forward, send the provider draft and clear only ephemeral Courrier state.
- If autosave fails, show an inline non-blocking error in the composer and keep the editor open.

## Attachment Handling

- Picked/dropped local files stay in `LocalAttachmentStore` only until they are uploaded to the provider draft.
- After upload, restored drafts should display provider attachment metadata from the draft itself.
- Do not rely on local file paths for restart recovery.
- If an attachment upload fails, keep the composer open and show the failed attachment as not yet saved to the provider draft.
- Sending should use the provider draft, including the provider-stored attachments.

## Renderer Plan

- Add a draft picker/recovery entry point in `FolderRail` or compose button menu when provider drafts exist.
- When opening compose, create or reuse a provider draft immediately.
- When closing a dirty composer, change the current discard prompt into a choice between saving/closing and discard.
- Show `Saved`/`Saving...`/`Autosave failed` state in `MailComposerHeader`.
- Keep detached compose windows and overlay composer editing the same provider draft when the user moves between them.
- Invalidate the provider Drafts folder query after create, update, send, or delete.

## Tests

- Provider tests for Graph draft create/update/delete/send, including reply draft updates and attachment upload.
- Provider tests for Gmail `users.drafts.create`, `users.drafts.update`, `users.drafts.send`, and draft ID/message ID mapping.
- Add IPC tests for draft payload validation, trusted sender checks, and provider error surfacing.
- Add renderer tests for debounce save, close behavior, restore behavior, provider Drafts picker, and send cleanup.
- Add attachment tests for upload success, upload failure, and restored provider attachment metadata.

## References

- Gmail draft resource: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
- Microsoft Graph draft/send overview: https://learn.microsoft.com/en-us/graph/outlook-create-send-messages
