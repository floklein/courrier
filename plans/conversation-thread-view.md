# Conversation And Thread View

## Current State

- Routes are folder-level or folder plus message ID: `/mail/$folderId` and `/mail/$folderId/$messageId`.
- `ReadingPane` renders one `MailMessageDetail`.
- Gmail API responses include `threadId`, but the mapper does not expose it.
- Microsoft Graph messages can expose `conversationId` and `conversationIndex`, but current `$select` lists omit both fields.
- Reply UI is attached to one selected message and does not understand a conversation.

## Scope

- Render a full conversation/thread in the reading pane when a message belongs to one.
- Keep single-message fallback for providers or messages without thread metadata.
- Let users reply, reply-all, forward, triage, and download attachments per message inside the conversation.
- Preserve list performance and avoid fetching entire conversations until a message is opened.

## Data Contracts

- Extend `MailMessageSummary` and `MailMessageDetail` with:
  - `threadId?: string`
  - `conversationId?: string`
  - `conversationSortKey?: string`
  - `parentFolderId?: string`
- Add a new type:
  - `MailConversation = { id: string; providerId: ProviderId; messages: MailMessageDetail[] }`
- Add provider method:
  - `getConversation(accountId, folderId, messageId): Promise<MailConversation>`
- Add query options:
  - `mailConversationQueryOptions(accountId, folderId, messageId)`
- Keep `getMessage` for direct detail fetches and tests.

## Provider Plan

- Microsoft Graph:
  - Add `conversationId`, `conversationIndex`, and `parentFolderId` to list/detail `$select`.
  - For a selected message with `conversationId`, fetch related messages through `/me/messages?$filter=conversationId eq '{conversationId}'`.
  - Select the same fields as message detail, including body and attachments.
  - Sort by `conversationIndex` when present, otherwise `receivedDateTime`.
  - Map each message's `parentFolderId` so actions use the right source folder.
- Gmail:
  - Expose `threadId` from message summary and detail.
  - Fetch the full thread with `users.threads.get`.
  - Map each thread message through the existing detail mapper.
  - Derive a usable folder/label for each message from `labelIds`; prefer the route folder when the message still has that label.

## Renderer Plan

- Replace the single-message body area in `ReadingPane` with a `ConversationPane`.
- Render message cards in chronological order:
  - newest expanded by default if it is the selected list message
  - older messages collapsed to sender, date, subject/preview, and recipients
  - unread messages clearly marked
- Keep the current attachment UI per message.
- Keep inline reply composer attached to the specific message being replied to.
- Add actions per message and an optional conversation-level More menu for bulk archive/delete after bulk actions exist.
- When a list row opens a conversation, scroll/focus the matching message within the conversation.

## Routing

- Minimal route change: keep `/mail/$folderId/$messageId` and load the conversation behind that selected message.
- Optional later route: `/mail/$folderId/thread/$threadId/$messageId` for shareable explicit thread URLs.
- Search results should still navigate to the matched message ID so the pane can scroll to the matching message in the thread.

## Tests

- Mapper tests for Graph conversation fields and Gmail thread IDs.
- Provider tests for Graph conversation fetch URL and ordering.
- Provider tests for Gmail `threads.get` mapping.
- Query tests for cache keys and invalidation from remote updates.
- Renderer tests for collapsed/expanded messages, per-message actions, and reply target selection.

## References

- Microsoft Graph message resource fields: https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
- Gmail threads guide: https://developers.google.com/workspace/gmail/api/guides/threads
- Gmail `threads.get`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get
