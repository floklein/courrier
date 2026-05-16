# Compose: Cc, Bcc, Reply All, Forward

## Current State

- `apps/desktop/src/lib/mail-types.ts` only models `toRecipients` for new mail and only `messageId`, `bodyHtml`, and attachments for replies.
- `apps/desktop/src/ui/compose/MailComposer.tsx` stores one recipient field (`toValue`) and hides recipients/subject in reply mode.
- `GraphClient.replyToMessage` uses Microsoft Graph `createReply`, patches the draft body, adds local attachments, and sends the draft.
- `GmailClient.replyToMessage` constructs raw MIME from original headers and sends it into the original Gmail `threadId`.
- Message detail data does not expose `ccRecipients`, `bccRecipients`, `replyTo`, `internetMessageId`, or stable thread/conversation identifiers, so the UI cannot compute reply-all targets or forward context yet.

## Scope

- Add Cc and Bcc support for new mail, reply-all, and forward.
- Add explicit Reply, Reply all, and Forward actions in reading pane, list context menu, and any bulk action surfaces that remain single-message only.
- Preserve provider semantics: Graph should use provider reply-all/forward draft APIs, while Gmail should build standards-compliant raw MIME and set `threadId` for replies.
- Keep existing attachment picking and dropped-file attachment behavior.

## Data And IPC

- Extend `MailComposeRecipient` usage into `SendMailInput`:
  - `toRecipients: MailComposeRecipient[]`
  - `ccRecipients?: MailComposeRecipient[]`
  - `bccRecipients?: MailComposeRecipient[]`
- Replace the reply-specific contract with a shared response contract:
  - `ReplyToMessageInput` can become `RespondToMessageInput`.
  - Include `kind: 'reply' | 'replyAll' | 'forward'`, `messageId`, `bodyHtml`, optional recipients, and attachments.
  - For replies, `toRecipients` may be optional because providers can create a reply draft. For forwards, require at least one recipient.
- Update `mail-schemas.ts`, `ipc.ts`, `preload.ts`, `api-client.ts`, and tests together so renderer and main process stay type-aligned.
- Extend `MailMessageDetail` with:
  - `ccRecipients: string[]`
  - `replyTo: MailAddress[]`
  - `internetMessageId?: string`
  - `threadId?: string` for Gmail and `conversationId?: string` for Graph

## Provider Plan

- Microsoft Graph:
  - Include `ccRecipients` and `bccRecipients` in `sendMail` and in the draft path used when local attachments are present.
  - Implement `replyAllToMessage` with `POST /me/messages/{id}/createReplyAll`, then patch body and user-selected attachments, then send the draft.
  - Implement `forwardMessage` with `createForward`; set To/Cc/Bcc through the draft request or a follow-up `PATCH`, then send the draft after attachments are added.
  - Keep using draft-send flows where attachments are involved so large attachment upload sessions remain supported.
- Gmail:
  - Add `cc` and `bcc` support to `createRawMail` and outgoing MIME headers.
  - For reply-all, derive recipients from `Reply-To` if present, otherwise `From`, plus original `To` and `Cc`, excluding the active account's own address and deduping by normalized email.
  - Keep `In-Reply-To`, `References`, and `threadId` for replies and reply-all.
  - For forward, fetch the full original message, prefill a forwarded body block, and send a new raw MIME message. Decide whether original attachments are included by default; if included, reuse `downloadAttachment` and attach them as new MIME attachments with a visible failure state for oversized or unavailable attachments.

## Renderer Plan

- Refactor `MailComposer` recipient state into a reusable recipient-field model keyed by `to`, `cc`, and `bcc`.
- Add compact Cc/Bcc reveal controls beside the To field; once a field has data, keep it visible.
- In reply mode, show the response mode and target recipients in a compact header. Allow expanding recipient editing for reply-all and forward.
- Add `Reply all` and `Forward` toolbar buttons in `ReadingPane`; keep `Reply` as the primary action.
- Update `MailActionMenu` to include Reply all and Forward for a selected message.
- Update `ComposeWindowDraft` so detached compose windows can carry Cc/Bcc and response mode.

## Tests

- Unit-test recipient parsing/serialization with Cc/Bcc fields.
- Add IPC schema tests for valid/invalid Cc/Bcc and forward payloads.
- Add Graph tests for `createReplyAll`, `createForward`, Cc/Bcc send payloads, and attachment draft behavior.
- Add Gmail tests for Cc/Bcc raw MIME headers, reply-all recipient exclusion/deduping, and forward MIME shape.
- Add renderer tests for revealing Cc/Bcc, preserving draft values, and dispatching the right response kind.

## References

- Microsoft Graph `createReplyAll`: https://learn.microsoft.com/en-us/graph/api/message-createreplyall?view=graph-rest-1.0
- Microsoft Graph `createForward`: https://learn.microsoft.com/en-us/graph/api/message-createforward?view=graph-rest-1.0
- Gmail drafts and send support: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
