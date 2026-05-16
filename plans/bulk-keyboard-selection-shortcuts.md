# Bulk And Keyboard Selection Shortcuts

## Current State

- The route-selected message is the only selected message.
- `MessageListItem` is draggable one message at a time and its drag payload contains a single `MailMessageSummary`.
- `FolderRailItem` accepts a single-message drop and calls `onMoveMessage`.
- All mutations in `useMailActions` operate on one message.
- There is no keyboard navigation or selection model in `MessageList`.

## Scope

- Add list multiselect with platform-aware modifiers.
- Add keyboard selection and action shortcuts.
- Add bulk action toolbar/menu for selected messages.
- Add bulk drag-and-drop to folders.
- Keep the existing route selection behavior for normal clicks and reading.

## Chosen Libraries

- Add `@tanstack/react-hotkeys` for keyboard shortcut registration, key normalization, conflict warnings, and platform-aware display formatting.
- Use `Mod` hotkey definitions from `@tanstack/react-hotkeys` for primary shortcuts. `Mod+A` maps to Cmd+A on macOS and Ctrl+A on Windows/Linux.
- Use `formatForDisplay` from `@tanstack/react-hotkeys` to render the same hotkey definitions in shortcut hints.
- Keep `useMessageSelection` as a local reducer/hook, not a generic selection library. The route-selected message, folder/account/search resets, virtualized rows, and mail action payloads are app-specific enough that a generic selection package would need a wrapper anyway.
- Keep `@tanstack/react-virtual` for the message list.
- Keep `@tanstack/react-query` for bulk mutation state, cache snapshots, optimistic updates, invalidation, and partial failure recovery.
- Keep `@atlaskit/pragmatic-drag-and-drop` and `@atlaskit/pragmatic-drag-and-drop-live-region` for bulk drag-and-drop and announcements.
- Keep Base UI/shadcn menu primitives for dropdown/context menu behavior, and add the shadcn `Kbd` component with the shadcn CLI if it is not present yet.
- Do not add `react-hotkeys-hook`, `tinykeys`, React Aria/Stately selection, or another drag/drop library for this pass.

## Shortcut Modifiers

- Use `Primary` for the platform shortcut modifier: Ctrl on Windows/Linux and Cmd on macOS.
- Use `Alt/Option` for the secondary modifier: Alt on Windows/Linux and Option on macOS.
- Keyboard shortcut handling should use `Mod` in `@tanstack/react-hotkeys` anywhere the plan says `Primary`.
- Pointer shortcut handling should use a small local `isPrimaryModifier(event)` helper because hotkey libraries do not handle click modifiers.
- Render shortcut hints with the shadcn `Kbd` component. If it is not present yet, add it with the shadcn CLI rather than hand-rolling the component.

## Selection Model

- Add a `useMessageSelection` hook owned by `AuthenticatedMailClient` or `MessageList`.
- Track:
  - `selectedIds: Set<string>`
  - `anchorId?: string`
  - `activeId?: string`
  - current `folderId`
- Reset selection on folder/account/search changes unless the change is only message hydration for the same list.
- Click behavior:
  - Plain click opens the message and clears bulk selection.
  - Primary-click toggles a message in the selected set.
  - Alt/Option-click range-selects from `anchorId` to the clicked message. If no anchor exists, use the clicked message as anchor.
  - Preserve route navigation when a selected message is opened with Enter.
- Keyboard behavior:
  - Arrow Up/Down moves `activeId`.
  - Shift+Arrow Up/Down extends the range from anchor.
  - Primary+A selects all currently loaded messages when focus is in the message list.
  - Primary+click selects all from anchor to clicked item
  - Alt/Option+click adds clicked item to selection
  - Escape clears selection.
  - Delete moves selected messages to trash.
  - `e` archives selected messages when archive is available.
  - `j` or `!` marks selected messages as junk when junk is available.
  - `s` toggles star/flag when available.
  - `i` toggles important when available.
- Ignore shortcuts while focus is inside inputs, textareas, contenteditable editors, menus, dialogs, or the composer.

## Bulk Actions

- Add `BulkMailActionInput` with `messageIds`, `sourceFolderId`, and action-specific fields.
- Add bulk variants to `MailService` and `MailProvider`.
- Provider behavior:
  - Gmail: use `messages.batchModify` for label-based actions and read/unread; chunk at 1000 IDs.
  - Microsoft Graph: issue per-message requests with bounded concurrency because current code has no batch request support. Use optimistic UI but surface partial failures.
- Add bulk mutation helpers in `useMailActions`:
  - snapshot cache once for the full operation
  - update all affected rows/folder counts
  - restore on full failure
  - on partial failure, invalidate lists and show a visible error summary.

## Bulk Drag And Drop

- Extend `MailMessageDragData` to support:
  - `messages: MailMessageSummary[]`
  - `sourceFolderId`
  - `primaryMessageId`
- When a dragged row is selected, drag the full selection. When it is not selected, drag only that row.
- Update `MailDragPreview` to show sender/subject for one message and count plus first subject for many messages.
- `FolderRailItem` should call `onMoveMessages` for multi-message drops.
- Announce bulk moves through the live region with counts and destination folder label.

## Renderer Plan

- Add checkbox-like visual selection affordances in `MessageListItem` that appear on hover/focus/selection.
- Add a compact bulk toolbar above the list when `selectedIds.size > 0`.
- Add shortcut hints to bulk action dropdown and context menu items by composing `Kbd` inside the existing `DropdownMenuShortcut` and `ContextMenuShortcut` slots.
- Show platform-aware labels in those hints using `formatForDisplay`, such as `⌘ A` on macOS and `Ctrl+A` on Windows/Linux.
- Keep row heights stable so virtualization does not shift while selection controls appear.
- Ensure selected styling and route-selected styling are visually distinct.

## Tests

- Unit-test selection reducer/hook for Primary toggle, Alt/Option range, folder reset, and Primary+A.
- Renderer tests for shortcut handling and input/editor shortcut suppression.
- Drag tests for selected vs unselected row payloads.
- Provider tests for Gmail batch modify chunking and Microsoft bounded per-message operations.
- Cache tests for bulk removal and bulk state toggles.

## Risks

- Virtualized rows can unmount while selected; selection state must be independent of mounted DOM.
- Bulk operations can partially fail. The UI must not pretend every message moved when some provider requests failed.
- Keyboard shortcuts can conflict with compose/editor input. The shortcut gate is part of the feature, not a cleanup task.
