# Native application architecture

Courrier ships two independent native desktop clients:

- `apps/macos` is written in Swift with SwiftUI, AppKit, WebKit, Security,
  Network, and UserNotifications.
- `apps/windows` is written in C# with WinUI 3, the Windows App SDK, WebView2,
  MSAL, and Windows app notifications.

The applications share behavior and remote protocols, but they do not share a
rendering layer. Each client uses the platform navigation model, commands,
windows, credential storage, notifications, file pickers, and accessibility
semantics.

## Common behavioral contract

Both clients model the same mail concepts:

- provider and account identity
- nested folders or labels with unread and total counts
- paginated message summaries and full message details
- HTML and plain-text bodies
- remote and local attachments
- new message, reply, reply all, and forward drafts
- read state, move, trash, archive, junk, star, flag, and importance actions
- recipient suggestions and validated To, Cc, and Bcc recipients
- provider-backed search and pagination

Microsoft Graph and Gmail use different identifiers and action semantics. Each
native client keeps a provider abstraction and maps provider payloads into the
common model before updating its UI state.

## Authentication and local data

Courrier is a public OAuth client. Provider client IDs are local
configuration, and no provider client secret is required for Microsoft.

The macOS client stores account credentials in Keychain. The Windows client
uses MSAL encrypted persistence for Microsoft and Windows Credential Manager
for Google credentials. Draft recovery data, preferences, and non-secret
account metadata live in each platform's application support directory.

## Message rendering

HTML mail is displayed in a native web view after active content, unsafe URLs,
remote tracking resources, and event attributes are removed. Plain text is
rendered with native text controls. External links open in the system browser.

## Live updates

`apps/relay` remains a small optional service for Microsoft Graph webhooks and
Gmail Pub/Sub notifications. `packages/mail-contracts` defines its validated
wire messages. Native clients can register subscriptions, reconnect to the
relay WebSocket, acknowledge events, invalidate local mailbox state, and post
native notifications.

The relay is optional. Mail browsing and actions continue to work without it,
using explicit refresh and platform-appropriate foreground refresh behavior.

## Build boundaries

The Node workspace contains only the relay and its protocol contracts. It does
not contain a desktop renderer or shell.

Run the native client for the current platform:

```text
pnpm start
```

Build or test one platform explicitly:

```text
pnpm build:macos
pnpm test:macos
pnpm build:windows
pnpm test:windows
```

Windows builds require Windows with the .NET SDK, Visual Studio, and the
Windows App SDK workload. macOS builds require Xcode and Swift.
