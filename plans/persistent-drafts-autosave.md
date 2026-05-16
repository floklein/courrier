# Persistent Drafts And Autosave

## Current State

- `useComposeStore` keeps the new-message overlay draft in renderer memory only.
- Detached compose windows receive an initial `ComposeWindowDraft` through a main-process map keyed by `webContents.id`; closing the window removes that in-memory entry.
- Reply drafts are local component state in `ReadingPane` and `MailComposer`.
- `LocalAttachmentStore` maps attachment IDs to file paths in memory; after app restart, stored attachment IDs cannot be resolved.
- There is no draft list, recovery prompt, autosave timestamp, or provider-backed draft ID.

## Scope

- Persist unsent compose state across window close, app restart, and renderer crash.
- Autosave all compose modes: new message, reply, reply-all, and forward.
- Preserve enough attachment information to restore draft UI safely, while detecting missing local files before send.
- Avoid silently discarding dirty drafts. Closing a composer should either keep the autosaved draft or explicitly discard it.

## Storage Model

- Add a main-process `DraftStore` under `apps/desktop/src/main/draft-store.ts`.
- Store JSON in `app.getPath('userData')/drafts.json` or one JSON file per draft under `app.getPath('userData')/drafts/`.
- Validate every read/write with a Zod schema in `apps/desktop/src/lib/draft-schemas.ts`.
- Write atomically: serialize to a temporary file in the same directory, then rename it into place.
- Draft record fields:
  - `id`
  - `accountId`
  - `kind: 'new' | 'reply' | 'replyAll' | 'forward'`
  - `relatedMessageId?: string`
  - `toValue`, `ccValue`, `bccValue`
  - `subject`
  - `editorValue`
  - `attachments: Array<{ id, name, contentType, size, sourcePath }>`
  - `createdAt`, `updatedAt`
  - optional provider fields for a later provider-sync pass: `providerDraftId?: string`, `providerDraftMessageId?: string`

## Autosave Flow

- Extend `ComposeWindowDraft` to include `id`, `kind`, Cc/Bcc values, and `relatedMessageId`.
- Add IPC handlers:
  - `draft:list`
  - `draft:get`
  - `draft:save`
  - `draft:delete`
  - `draft:resolve-attachments`
- Debounce renderer autosave at roughly 750 ms after edits and flush immediately before minimize, detach-to-window, close, and send.
- Keep autosave in the main process, not browser storage, so multiple windows and trusted IPC checks remain centralized.
- On successful send/reply/forward, delete the local draft after provider send succeeds.
- If autosave fails, show an inline non-blocking error in the composer and keep the editor open.

## Attachment Recovery

- Persist original file paths and metadata for picked/dropped files.
- On draft restore, stat each source path and show missing files as unavailable chips rather than dropping them.
- Add a `LocalAttachmentStore.registerRestoredFiles` path that recreates valid local attachment IDs from persisted paths.
- Block sending only when the user tries to send a draft with unavailable attachments, and offer remove/re-pick actions in the composer.

## Provider-Backed Draft Sync

- Phase 1 should be local persistence only because it is needed for crash/window recovery and does not require extra provider edge cases.
- Phase 2 can sync local drafts to providers:
  - Graph: create/update message drafts with To/Cc/Bcc/body/subject and send with `/send`.
  - Gmail: use `users.drafts.create`, `users.drafts.update`, and `users.drafts.send`.
- Provider sync must keep a local shadow draft as source of truth until provider writes are confirmed.
- Do not autosave every keystroke to providers; use a longer debounce and explicit conflict handling for failures.

## Renderer Plan

- Add a draft picker/recovery entry point in `FolderRail` or compose button menu when saved drafts exist.
- When opening compose, create or reuse a draft ID immediately.
- When closing a dirty composer, change the current discard prompt into a choice between saving/closing and discard.
- Show `Saved`/`Saving...`/`Autosave failed` state in `MailComposerHeader`.
- Keep detached compose windows and overlay composer editing the same draft record when the user moves between them.

## Tests

- Unit-test `DraftStore` validation, atomic writes, corrupt-file recovery, and per-draft deletion.
- Add IPC tests for draft payload validation and trusted sender checks.
- Add renderer tests for debounce save, close behavior, restore behavior, and send cleanup.
- Add attachment restore tests for valid files, missing files, and oversized files.

## References

- Gmail draft resource: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
- Microsoft Graph draft/send overview: https://learn.microsoft.com/en-us/graph/outlook-create-send-messages
