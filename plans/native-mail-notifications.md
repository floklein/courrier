# Native Notifications On Mail Reception

## Current State

- `MailSubscriptionManager` receives provider remote-change events from the relay and sends `mail:remote-change` IPC events to renderer windows.
- The renderer invalidates TanStack Query caches in `invalidateRemoteMailUpdate`.
- The main process does not inspect whether a remote event is a new inbox message.
- No native `Notification` objects are created.
- Gmail relay events currently contain a `historyId`-like subscription ID but no message ID; Graph events may contain `messageId`.
- There is no tray integration today, and closing all windows quits the app outside macOS.

## Scope

- Show native OS notifications for newly received mail.
- Avoid notifications for sends, moves, deletes, read-state changes, and old backfilled events.
- Clicking a notification focuses Courrier and opens the message or thread.
- Closing the main window should keep Courrier running in the tray so notifications can continue.
- Support Microsoft and Gmail as accurately as their remote events allow.

## Main-Process Architecture

- Add `MailNotificationService` in `apps/desktop/src/main/mail-notification-service.ts`.
- Construct it in `main.ts` beside `MailSubscriptionManager`.
- Let `MailSubscriptionManager` call the service before or after `sendRemoteChangeToRenderers`.
- Keep notification creation in the main process using Electron `Notification`, not the renderer Web Notifications API.
- Add a persisted per-account notification state file under `app.getPath('userData')`:
  - recent notified message IDs with bounded retention
  - Gmail last processed history ID
  - app startup timestamp to suppress old events from initial catch-up

## Provider Detection

- Microsoft Graph:
  - Only consider `message-change` events with `changeType: 'created'`.
  - Use the event `messageId` when present.
  - Add provider support to fetch a message by ID without requiring the current folder route. The provider can request `/me/messages/{id}` with `parentFolderId`, sender, recipients, subject, preview, received time, read state, and conversation metadata.
  - Notify only when `parentFolderId` is the inbox folder or maps to inbox, and the message is unread.
- Gmail:
  - Use `users.history.list` from the stored start history ID to resolve new message additions and label changes.
  - Process `messagesAdded` and `labelsAdded` records that add `INBOX` and are not already read.
  - Hydrate candidate messages through `getMessageSummary`.
  - On Gmail history `404`, perform a full inbox sync baseline and do not notify for the backfill.

## Notification UX

- Use title as sender display name or email.
- Use body as subject plus preview, truncated defensively.
- Use app icon from `getWindowIconPath()`.
- Coalesce bursts:
  - one message: sender and subject
  - multiple messages from same account within a short window: count and account label
- On click:
  - focus an existing main window or create one if none exists
  - navigate renderer to `/mail/$folderId/$messageId` once the window is ready
  - if exact folder is unknown, navigate to inbox and let the message/conversation fetch recover.
- Do not add notification reply actions in the first pass; reply needs compose context, autosaved drafts, and provider response mode first.

## Tray And App Lifecycle

- Add a main-process tray controller beside `MailNotificationService`.
- Keep a main-window reference instead of treating `createWindow` as fire-and-forget.
- When native notifications are enabled and supported, closing the main window should hide it to the tray instead of quitting the app.
- The app must continue running mail subscriptions while the main window is hidden.
- Double-clicking the tray icon opens/focuses the main window.
- Right-clicking the tray icon opens a context menu with:
  - `Open`, which opens/focuses the main window
  - `Close`, which explicitly quits the app
- Use an explicit quit path for tray `Close` so the main-window `close` handler does not just hide the window again.
- Keep compose-window close behavior separate; closing a compose window should still close that compose window.
- Revisit `window-all-closed`: outside macOS it should not quit when the main window was hidden for notifications, but it should still quit on the explicit tray `Close` path.

## Settings And Safety

- Add an app-level setting in user data:
  - notifications enabled/disabled
  - include preview text enabled/disabled
  - silent mode enabled/disabled
- Expose those settings from a `Notifications` submenu in the user menu.
  - Use the existing `DropdownMenuSub`, `DropdownMenuSubTrigger`, and `DropdownMenuSubContent` pattern in `UserMenu`.
  - Keep toggles inside the submenu so notification controls do not become top-level user menu rows.
  - Disable or explain unavailable options when `Notification.isSupported()` is false.
- Default to enabled only when `Notification.isSupported()` returns true.
- Provide a visible error/log path when the OS rejects or fails notification display.
- Never include Bcc or hidden recipient data in notification text.

## Tests

- Unit-test Graph event filtering and Gmail history resolution.
- Test duplicate suppression and startup backfill suppression.
- Test Notification service with a mocked Electron `Notification`.
- Test click routing by mocking `BrowserWindow` and renderer readiness.
- Test tray lifecycle with mocked `Tray`, `Menu`, `BrowserWindow`, and explicit quit state:
  - main-window close hides when notifications are enabled
  - tray double-click opens/focuses the main window
  - tray `Open` opens/focuses the main window
  - tray `Close` quits instead of hiding again
- Add relay/contract tests if event payload needs to carry additional Gmail history fields.

## References

- Electron `Notification`: https://www.electronjs.org/docs/latest/api/notification
- Electron notifications tutorial: https://www.electronjs.org/docs/latest/tutorial/notifications
- Gmail history list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
