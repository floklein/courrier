# Real Triage Actions: Archive, Spam/Junk, Star/Flag, Important

## Current State

- `useMailActions` supports read/unread, move to arbitrary folder, and delete/move-to-trash.
- `MailActionMenu` exposes Reply, Mark read/unread, Move to, and Move to trash.
- `MailMessageSummary.importance` exists, but there is no persistent star/flag state or provider action for importance.
- Gmail labels already expose `SPAM`, `STARRED`, and `IMPORTANT` folders, but message summaries only map Gmail `IMPORTANT` into `importance: 'high'`.
- Microsoft folders are tagged with well-known names including `archive`, `deleteditems`, and `junkemail`.

## Scope

- Add real provider actions when the active provider supports them:
  - Archive
  - Mark as spam/junk
  - Star or flag
  - Mark important or normal
- Hide or disable actions only when the provider or account cannot perform them.
- Keep optimistic cache behavior consistent with read/unread and move.

## Provider Capabilities

| Action | Microsoft Graph | Gmail |
| --- | --- | --- |
| Archive | Move to well-known `archive` folder. | Remove `INBOX` label. |
| Spam/Junk | Move to well-known `junkemail` folder. | Add `SPAM`, remove `INBOX`. |
| Star/Flag | Patch message `flag.flagStatus` to `flagged` or `notFlagged`. | Add/remove `STARRED`. |
| Important | Patch `importance` to `high` or `normal`. | Add/remove `IMPORTANT`. |

## Data Contracts

- Add provider capability metadata:
  - `MailActionCapability = 'archive' | 'junk' | 'star' | 'flag' | 'important'`
  - `MailProvider.getCapabilities(accountId): Promise<MailActionCapability[]>` or static `capabilities` on provider implementations.
- Extend message state:
  - `isStarred?: boolean`
  - `isFlagged?: boolean`
  - `isImportant?: boolean`
  - keep `importance` for display and provider compatibility.
- Add `TriageMessageInput`:
  - `messageId`
  - `folderId`
  - `action`
  - optional `value` for toggle actions.
- Add IPC/preload/api methods:
  - `mail:archive-message`
  - `mail:mark-message-junk-state`
  - `mail:set-message-star-state`
  - `mail:set-message-flag-state`
  - `mail:set-message-important-state`

## Provider Plan

- Microsoft Graph:
  - Reuse `moveMessage` for archive and junk, with destination IDs `archive` and `junkemail`.
  - Add `patchMessage` helper for flag and importance.
  - Select and map `flag` in list/detail requests.
  - Continue mapping `importance` from Graph into both `importance` and `isImportant`.
- Gmail:
  - Reuse `modifyMessage` for archive, junk, star, and important.
  - Archive should remove `INBOX` and leave other labels intact.
  - Junk should add `SPAM` and remove `INBOX`; do not permanently delete.
  - Select/map `labelIds` into `isStarred`, `isImportant`, and read state.
  - Use `messages.batchModify` for the later bulk implementation.

## Renderer Plan

- Add toolbar buttons in `ReadingPane` for Archive and Star/Flag, with More menu entries for Junk and Important.
- Add the same actions to `MailActionMenu` for list context menus.
- Render a star/flag affordance in `MessageListItem` when available:
  - Gmail shows a star.
  - Microsoft shows a flag.
- Use capability metadata to choose labels/icons and avoid showing Gmail-only or Graph-only actions incorrectly.
- Update folder counts optimistically for archive/junk because those remove the message from the current folder.
- Update message state in cached list/detail data for star/flag/important without removing the row.

## Tests

- Provider tests for Graph move-to-archive, move-to-junk, flag patch, and importance patch.
- Provider tests for Gmail label additions/removals.
- Cache tests for toggle actions and removal actions.
- IPC schema tests for invalid actions and IDs.
- Renderer tests for action visibility by provider capability and optimistic state.

## References

- Microsoft Graph `move` message: https://learn.microsoft.com/en-us/graph/api/message-move?view=graph-rest-1.0
- Microsoft Graph `update` message fields: https://learn.microsoft.com/en-us/graph/api/message-update?view=graph-rest-1.0
- Gmail labels guide: https://developers.google.com/gmail/api/guides/labels
- Gmail `messages.modify`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify
- Gmail `messages.batchModify`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify
