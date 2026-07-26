# Courrier for macOS

Courrier for macOS is a native SwiftUI and AppKit mail client. It talks directly
to Microsoft Graph and the Gmail and People APIs. It does not embed a browser UI
or depend on the Electron app at runtime.

## What is implemented

- Microsoft Outlook and Google Gmail OAuth with PKCE and a loopback callback
- Multiple accounts, account switching, account addition, and sign-out
- OAuth access and refresh tokens stored in the macOS Keychain
- Native three-column navigation with folders or labels, messages, and reading
- 25-message pages with automatic pagination
- Folder and all-mail search, including Gmail spam and trash in all-mail search
- Source mailbox badges for all-mail results
- HTML mail in a JavaScript-free, non-persistent WebKit view
- Sanitization, a restrictive Content Security Policy, blocked remote images,
  and system-browser handling for safe external links
- Read and unread state, with unread messages marked read after a three-second
  reading delay
- Move, trash, archive, junk, star, flag, and importance actions according to
  provider capabilities
- Native multiple and range selection through the macOS `List`, with bulk read,
  move, trash, and archive actions
- Drag messages onto folders or labels
- A separate native compose window with rich text, recipient suggestions,
  reply, reply all, forward, Cc, Bcc, and file attachments
- Attachment open and save actions
- Provider-backed draft autosave after 750 ms, remote draft recovery, and a
  native Drafts browser
- A local draft cache that protects in-progress edits during temporary network
  failures
- Native commands, menus, context menus, and keyboard shortcuts
- Native new-mail notifications with enable, preview, and silent preferences
- System, light, and dark appearance preferences
- Optional relay registration and WebSocket live updates, with register,
  missed-event replay, and acknowledgement messages matching
  `packages/mail-contracts`
- A polling fallback when live updates are not configured or are unavailable

Provider differences are represented explicitly. Microsoft supports archive,
junk, flag, and importance. Gmail supports archive, junk, star, and importance.

## Requirements

- macOS 14 or newer
- Xcode with Swift 5.10 or newer
- A Microsoft native app registration, a Google desktop OAuth client, or both

## Configure OAuth

Copy the example:

```sh
cd apps/macos
cp .env.example .env
```

Set at least one client ID:

```dotenv
MICROSOFT_CLIENT_ID=<Microsoft application client ID>
GOOGLE_CLIENT_ID=<Google desktop OAuth client ID>
GOOGLE_CLIENT_SECRET=<optional desktop client secret>
```

For Microsoft, register a public desktop client and allow a loopback redirect.
The app requests `User.Read`, `People.Read`, `Mail.ReadWrite`, `Mail.Send`, and
`offline_access`.

For Google, enable Gmail API and People API. The app requests Gmail modify and
send access, contacts read access, and basic OpenID profile scopes. Google
desktop clients accept the random loopback port used during sign-in.

Never commit `.env`. The repository ignores it.

`swift run` reads `apps/macos/.env`. The locally bundled
`.build/Courrier.app` also finds that source file. If you move the app
elsewhere, place a copy at
`~/Library/Application Support/Courrier/.env`.

## Build, test, and run

From `apps/macos`:

```sh
swift build
swift test
swift run Courrier
```

To produce an ad hoc signed app bundle for local use:

```sh
chmod +x Scripts/build-app.sh
Scripts/build-app.sh
open .build/Courrier.app
```

Open the package in Xcode with:

```sh
open Package.swift
```

The package has a `CourrierCore` library, a `Courrier` app executable, and
mapping and core-logic tests.

## Relay live updates

The relay is optional. Add:

```dotenv
RELAY_PUBLIC_URL=https://relay.example.com
RELAY_ADMIN_TOKEN=<relay admin token>
```

For Gmail, also add:

```dotenv
GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/<topic>
```

On launch, Courrier creates or renews a provider push subscription, posts the
relay subscription record to `/relay/subscriptions`, connects to `/ws`,
registers its client token, handles replayed events, and acknowledges each
handled event. Microsoft uses `/graph/notifications`. Gmail uses
`/google/pubsub`.

The client ID, client state, relay authentication token, provider subscription,
expiration, and replay cursor are stored per account in Keychain. Courrier
renews before expiration and recreates subscriptions after lifecycle removal.
The one-minute poll remains active as a fallback.

## Deliberate parity limits

Notification identifiers use the provider message ID, so duplicate events for
the same message replace one another. Clicking a notification routes to its
folder and message. Notification coalescing is per message rather than per
conversation because Courrier does not yet have a conversation view.

Inline CID images remain blocked in some complex messages because the native
reader does not download and rewrite inline attachment references. External
images are intentionally blocked for privacy.

The composer enforces the desktop limits: 500 total recipients, 100
attachments, 150 MB per attachment, a 998-character subject, and 5 MB of HTML.
