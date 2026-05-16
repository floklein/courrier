# Global Search: Search All Folders

## Current State

- `useMailClientState` stores one `searchQuery` tied to the current folder.
- `MessageList` placeholder says `Search {folderLabel}` and resets search on folder changes.
- `mailMessagesQueryOptions` calls `api.mail.listMessages(accountId, folderId, pageToken, searchQuery)`.
- Graph search is implemented inside folder message listing.
- Gmail search is implemented with both `labelIds=folderId` and `q=search`, so it remains folder-scoped.

## Scope

- Add an all-folders search mode.
- Keep current folder-scoped search available.
- Toggle between folder search and global search with shadcn Tabs under the search bar.
- Show which folder/label each result belongs to.
- Preserve provider pagination and safe next-page URL validation.

## Data Contracts

- Add `MailSearchScope = 'folder' | 'all'`.
- Add `SearchMessagesInput`:
  - `query`
  - `scope`
  - `folderId?: string`
  - `nextPageToken?: string`
  - `includeSpamTrash?: boolean`
- Add `MailSearchResultSummary` or extend `MailMessageSummary` with:
  - `folderLabel?: string`
  - `folderWellKnownName?: string`
  - `matchedFolderIds?: string[]` for Gmail labels.
- Add provider method:
  - `searchMessages(accountId, input): Promise<PagedMessages>`
- Keep `listMessages` folder-specific for normal folder navigation.

## Provider Plan

- Microsoft Graph:
  - Use `/me/messages?$search="..."` for global search with the existing selected summary fields.
  - Include `parentFolderId` in `$select` so the renderer can display the folder label.
  - Validate Graph next links for the `/me/messages` collection separately from folder message next links.
  - Respect the Graph result limit and surface a "showing top results" message if the provider caps results.
- Gmail:
  - For global search, call `users.messages.list` without `labelIds`.
  - Pass `q` directly after trimming and use `includeSpamTrash` when the user opts into spam/trash results.
  - Hydrate each result through `getMessageSummary`.
  - Map `labelIds` into folder labels using the cached folder list.

## Renderer Plan

- Update `MessageList` search header:
  - default scope is current folder
  - add shadcn `Tabs` under the search input for `This folder` and `All mail`
  - install the shadcn `tabs` component with the shadcn CLI if it is not already present
  - keep `TabsTrigger` elements inside `TabsList`; the message list itself remains the shared result view rather than separate tab panels
  - when in all-mail mode, use placeholder `Search all mail`
- Do not clear global search just because the route folder changes if the user remains in search mode.
- Show result count as loaded results, not total mailbox matches.
- Add folder/label badges to search-result rows.
- Opening a result should navigate to the result's real folder when known, otherwise keep current folder and load by message ID through a provider fallback.
- Ensure remote invalidations invalidate global search query keys as well as folder query keys.

## Tests

- Query-option tests for folder search vs global search keys.
- Graph tests for global search URL, `$select`, and next-link validation.
- Gmail tests confirming global search omits `labelIds` and honors `includeSpamTrash`.
- Renderer tests for the shadcn Tabs scope toggle under the search bar, placeholder text, reset behavior, and result folder badges.

## References

- Microsoft Graph list messages across mailbox: https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- Microsoft Graph `$search` for messages: https://learn.microsoft.com/en-us/graph/search-query-parameter
- Gmail message list search parameters: https://developers.google.com/workspace/gmail/api/guides/list-messages
