# Courrier

Courrier is a desktop mail client for Microsoft Outlook accounts. It is built
with Electron, React, Vite, Tailwind CSS, and Microsoft Graph.

The app signs in with Microsoft OAuth, reads folders and messages through Graph,
and provides a focused three-pane mail interface for browsing, searching, and
triaging messages.

## Features

- Microsoft sign-in with MSAL and a local desktop token cache
- Outlook folder navigation, including nested and well-known folders
- Message list pagination and Microsoft Graph search
- HTML and plain-text message rendering with sanitized HTML content
- Read/unread, move, reply draft UI, and move-to-trash actions
- Hardened Electron bridge with context isolation and trusted IPC checks
- Responsive layout for narrower desktop windows

> [!NOTE]
> Sending replies is not wired to Microsoft Graph yet. The reply composer UI is
> present, but its Send button is currently disabled.

## Tech Stack

- **Desktop shell:** Electron Forge
- **Build tooling:** Vite and TypeScript
- **UI:** React, Tailwind CSS, Radix UI primitives, lucide-react icons
- **Data:** TanStack Query and TanStack Router
- **Auth and mail:** MSAL Node, MSAL Node Extensions, Microsoft Graph
- **Testing:** Vitest and Testing Library

## Prerequisites

- Node.js and npm
- A Microsoft account with Outlook mail access
- A Microsoft Entra app registration for local desktop OAuth

## Getting Started

Install dependencies:

```powershell
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Set your Microsoft application client ID in `.env`:

```dotenv
MICROSOFT_CLIENT_ID=<Application client ID>
```

Start the app in development mode:

```powershell
npm start
```

Electron Forge starts the Electron main process, preload script, and Vite
renderer. In development, Chromium DevTools open automatically.

## Microsoft OAuth Setup

Courrier is a public desktop client, so it uses Microsoft OAuth without a client
secret. Create a Microsoft Entra app registration with a native redirect URI of:

```text
http://localhost
```

The app uses delegated Microsoft Graph access for the signed-in user. Mail
actions such as marking messages read, moving messages, and moving messages to
trash require mailbox write permission.

For the full setup flow, see [docs/oauth.md](docs/oauth.md).

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run Courrier in development mode. |
| `npm run package` | Package the Electron app locally. |
| `npm run make` | Create distributable installers/packages. |
| `npm run publish` | Publish Electron Forge artifacts. |
| `npm test` | Run the Vitest suite. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run lint` | Run ESLint for TypeScript and React files. |

## Project Structure

```text
src/
  main/          Electron main-process services, Microsoft auth, Graph client, IPC
  components/   Shared UI primitives
  data/         Local mail fixture data
  lib/          Shared types, API bridge helpers, Graph mappers, route helpers
  test/         Vitest setup
  theme/        Theme provider
  ui/           Mail client screens, panes, menus, and status views
docs/
  oauth.md      Microsoft OAuth registration and troubleshooting guide
```

## Security Notes

Courrier keeps Electron renderer privileges narrow:

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The preload script exposes only the typed `window.courrier` API.
- Main-process IPC handlers reject messages from untrusted pages.
- External navigation opens in the system browser instead of inside the app.
- Microsoft tokens are cached with MSAL Node Extensions where platform support
  is available.
