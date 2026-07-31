# Courrier for Windows

Courrier for Windows is a native WinUI 3 mail client. It uses Windows controls, windowing, credential storage, file pickers, drag and drop, keyboard accelerators, dialogs, appearance settings, and App SDK notifications. It does not embed the web application UI.

## Features

- Outlook and Microsoft 365 sign-in with MSAL
- Gmail sign-in with the installed-app OAuth flow and PKCE
- Multiple accounts, account switching, adding accounts, and per-account sign-out
- Native folder and label navigation with unread counts
- 25-message pages, folder search, all-mail search, and source-folder labels
- HTML and plain-text reading with a strict HTML allowlist, controlled CID images, and disabled scripts
- Read and unread state, three-second automatic read delay, move, Trash, archive, junk, star, flag, and importance
- Native range selection and bulk read, move, Trash, and archive actions
- Drag selected messages onto a destination folder
- New message, reply, reply all, and forward in separate native compose windows
- Recipient suggestions from Microsoft People or Google People
- Attachment picker, file drop, open, save, and Graph large-file upload sessions
- Provider drafts, durable local recovery, 750 ms autosave, rich draft reopen, send, and discard
- Windows App SDK notifications with privacy, sound, deduplication, two-second burst coalescing, and click routing
- System, light, and dark appearance preferences
- Optional Graph and Gmail webhook relay updates with persisted replay cursors
- Polling fallback when relay updates are not configured or unavailable

## Requirements

- Windows 10 version 1809 or newer
- Visual Studio 2022 with the .NET desktop development workload and Windows application development tools
- .NET 8 SDK

The project is an unpackaged, self-contained Windows App SDK application. The target architectures are x86, x64, and ARM64.

## Configure OAuth

Copy the example settings file to the user configuration directory:

```powershell
$configDir = Join-Path $env:LOCALAPPDATA "Courrier"
New-Item -ItemType Directory -Force $configDir
Copy-Item .\appsettings.example.json (Join-Path $configDir "appsettings.json")
```

Edit `%LOCALAPPDATA%\Courrier\appsettings.json`.

For Microsoft, create a public desktop app registration that supports organizational and personal Microsoft accounts. Configure `http://localhost` as its redirect URI and grant these delegated permissions:

- `User.Read`
- `People.Read`
- `Mail.ReadWrite`
- `Mail.Send`

Put the application client ID in `MicrosoftClientId`. Do not create a client secret for a desktop public client.

For Google, create a Desktop app OAuth client, enable Gmail API and People API, and put its client ID in `GoogleClientId`. `GoogleClientSecret` is optional for installed-app clients. Courrier requests Gmail modify and send permissions plus read-only contacts. The callback uses `127.0.0.1` with a random loopback port.

The equivalent environment variables are also supported:

```text
MICROSOFT_CLIENT_ID
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_PUBSUB_TOPIC
RELAY_PUBLIC_URL
RELAY_ADMIN_TOKEN
ALLOW_INSECURE_LOOPBACK_RELAY_FOR_DEVELOPMENT
```

Environment variables override JSON settings.

## Optional live updates

Without relay configuration, Courrier checks inboxes on the interval in `NotificationPollingSeconds`.

To enable the existing Courrier relay:

1. Set an HTTPS `RelayPublicUrl` and `RelayAdminToken`.
2. For Gmail, set `GooglePubSubTopic` and point its Pub/Sub push subscription at the relay `/google/pubsub` endpoint.
3. Start Courrier. It creates or renews provider subscriptions, registers `/relay/subscriptions`, connects to `/ws`, replays after its last saved event ID, and acknowledges each event.

Relay authentication tokens and Graph client-state values are stored in Windows Credential Manager. Subscription IDs, expirations, and replay cursors are stored under `%LOCALAPPDATA%\Courrier`.

Plain HTTP and WebSocket relay connections are rejected. For local development only, `AllowInsecureLoopbackRelayForDevelopment` can enable an HTTP relay whose host resolves as loopback. It never permits insecure remote hosts.

## Build and test

From this directory on Windows:

```powershell
dotnet restore .\Courrier.Windows.sln
dotnet build .\Courrier.Windows.sln -c Debug -p:Platform=x64
dotnet test .\tests\Courrier.Windows.Tests\Courrier.Windows.Tests.csproj -c Debug
dotnet run --project .\src\Courrier.Windows\Courrier.Windows.csproj -p:Platform=x64
```

The test project covers Graph and Gmail mapping, inline CID handling, attachment reconciliation, relay endpoint policy, rich draft restoration, folder ordering, recipient parsing, base64url behavior, and HTML sanitization.

## Security

- Google refresh tokens use Windows Credential Manager.
- MSAL uses its Windows-protected persistent cache.
- Provider access tokens are added only to provider API requests.
- Relay client secrets use Windows Credential Manager.
- Incoming HTML is sanitized before WebView2 receives it.
- Scripts, forms, embedded objects, CSS, event handlers, and remote image sources are removed.
- Referenced inline PNG, JPEG, GIF, WebP, and BMP resources are downloaded through the provider API and rendered as controlled data URLs.
- Relay administration, account authentication, and client-state values require HTTPS and WSS outside explicit loopback development.
- WebView2 script execution is disabled and external links open in the default browser.
- Outgoing HTML uses a smaller composer allowlist.

## Deliberate limits

- Gmail's raw message endpoint has a lower practical total-message limit than the compose UI's 150 MB per-file guard. Gmail reports its provider error when the encoded message is too large.
- Remote images are not loaded. Unsupported or unavailable inline images are omitted, so some image-heavy mail can still look incomplete.
- The native composer round-trips bold, italic, underline, paragraphs, and links. More complex pasted formatting is reduced to the outgoing allowlist.
- The UI limits a message to 500 recipients, 100 attachments, 150 MB per attachment, 998 subject characters, and a 5 MB HTML body.

## Validation note

The source was created in a macOS workspace where `dotnet`, MSBuild, and the Windows SDK are not installed. XML structure and source-level checks can run there, but the WinUI project and tests must receive their final compile and runtime validation on Windows.
