# Courrier

Courrier is a native desktop mail client for Microsoft Outlook and Gmail. It
ships as two purpose-built applications:

- a Swift and SwiftUI application for macOS
- a C# and WinUI 3 application for Windows

The clients share provider behavior and the optional live-update relay
protocol, but not a web renderer. Navigation, commands, compose windows,
credential storage, notifications, file handling, and accessibility use the
native facilities of each platform.

## Features

- Microsoft and Google OAuth in the system browser
- Multiple signed-in accounts with add, switch, and individual sign-out
- Outlook folders and Gmail labels with unread and total counts
- Paginated message lists and folder or all-mail provider search
- HTML and plain-text reading with hardened native web views
- Native attachment open and save flows
- Read and unread, move, trash, archive, junk, star, flag, and importance
  actions according to provider capability
- Native multiple selection and bulk read, move, archive, and trash actions
- New message, reply, reply all, and forward
- To, Cc, and Bcc recipients with contact suggestions and validation
- Rich-text composition, multiple attachments, and file drag and drop
- Provider-backed drafts with 750 ms autosave and recovery
- Native appearance and notification preferences
- Optional Microsoft Graph and Gmail live updates through the relay
- Notification click routing to the matching account and message

Courrier deliberately exposes provider differences. Gmail supports stars but
not Outlook flags. Outlook supports flags but not Gmail stars. Delete moves a
message to the provider trash folder and does not permanently erase it.

## Native clients

### macOS

The macOS app uses SwiftUI `NavigationSplitView`, standard menus and keyboard
commands, AppKit rich text and file integration, Keychain, WebKit, and
UserNotifications. Compose and draft browsing use separate native windows.

Requirements:

- macOS 14 or later
- Xcode with Swift 5.10 or later

Configure it:

```bash
cp apps/macos/.env.example apps/macos/.env
```

Set at least one provider client ID in `apps/macos/.env`, then run:

```bash
pnpm start
```

You can also work directly with Swift:

```bash
swift run --package-path apps/macos Courrier
swift test --package-path apps/macos
```

See [the macOS client guide](apps/macos/README.md) for native behavior and
configuration details.

### Windows

The Windows app uses WinUI 3 and Windows App SDK controls, native command bars
and keyboard accelerators, MSAL encrypted persistence, Windows Credential
Manager, WebView2, file pickers, and Windows app notifications.

Requirements:

- Windows 10 version 1809 or later, or Windows 11
- .NET 8 SDK
- Visual Studio with the Windows application development workload

Copy `apps/windows/appsettings.example.json` to
`%LOCALAPPDATA%\Courrier\appsettings.json`, set at least one provider client ID,
then run:

```powershell
pnpm start
```

You can also work directly with .NET:

```powershell
dotnet run --project apps/windows/src/Courrier.Windows/Courrier.Windows.csproj
dotnet test apps/windows/Courrier.Windows.sln
```

See [the Windows client guide](apps/windows/README.md) for native behavior,
tooling, and configuration details.

## OAuth setup

Courrier is a public desktop client. Do not put a Microsoft client secret in
the application.

- [Microsoft OAuth setup](docs/oauth.md)
- [Google OAuth and Gmail setup](docs/google-oauth.md)

The native clients recognize these configuration values:

```dotenv
MICROSOFT_CLIENT_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_PUBSUB_TOPIC=
RELAY_PUBLIC_URL=
RELAY_ADMIN_TOKEN=
```

The Google client secret is optional for installed-app clients. Local
configuration files and credentials must not be committed.

## Repository structure

```text
apps/
  macos/          Native SwiftUI and AppKit client
  windows/        Native WinUI 3 client
  relay/          Optional Fastify webhook and WebSocket relay
packages/
  mail-contracts/ Validated relay wire protocol
  tsconfig/       Shared TypeScript configuration for services
docs/
  native-architecture.md
  oauth.md
  google-oauth.md
scripts/
  native.mjs      Selects the current platform for root commands
```

The Node workspace supports the relay and shared wire contract. Neither native
client uses Electron or a web-rendered application shell.

## Commands

| Command | Description |
| --- | --- |
| `pnpm start` | Run the native client for the current platform. |
| `pnpm dev:relay` | Run the optional relay in watch mode. |
| `pnpm build` | Build services and the current platform client. |
| `pnpm package` | Create a release build for the current platform. |
| `pnpm test` | Test services and the current platform client. |
| `pnpm build:macos` | Build the macOS client. |
| `pnpm test:macos` | Test the macOS core. |
| `pnpm build:windows` | Build the Windows solution. |
| `pnpm test:windows` | Test the Windows solution. |
| `pnpm lint` | Lint the TypeScript services and contracts. |
| `pnpm typecheck` | Type-check the TypeScript services and contracts. |

## Live update relay

The native apps work without the relay and can refresh in the foreground. The
relay adds Microsoft Graph webhook and Gmail Pub/Sub delivery, WebSocket
replay, event acknowledgement, and timely native notifications.

It exposes:

- `GET /health`
- authenticated `POST /relay/subscriptions`
- `POST /graph/notifications`
- `POST /google/pubsub`
- authenticated `/ws`

Relay environment variables:

```dotenv
RELAY_PUBLIC_URL=https://your-relay.example.com
RELAY_ADMIN_TOKEN=<shared relay admin token, at least 24 characters>
GOOGLE_PUBSUB_VERIFICATION_TOKEN=<optional push endpoint token>
PORT=3001
HOST=0.0.0.0
```

The current relay is intended for a self-hosted, single-user deployment. Its
bounded event store is in memory, so registrations and pending events do not
survive a restart and are not shared across instances. Do not distribute a
shared relay admin token in a public multi-user client.

## Security boundaries

- macOS credentials are stored in Keychain.
- Windows Microsoft credentials use encrypted MSAL persistence, and Google
  credentials use Windows Credential Manager.
- OAuth opens in the system browser and returns through a loopback redirect.
- HTML mail is sanitized and displayed with scripts, forms, plugins, popups,
  and arbitrary navigation disabled.
- External links open in the system browser.
- Provider capability checks prevent unsupported actions from appearing.
- Local configuration and tokens remain outside source control.

See [native architecture](docs/native-architecture.md) for the service
boundaries and platform ownership model.
