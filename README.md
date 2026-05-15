# Courrier

Courrier is a desktop mail client for Microsoft Outlook and Gmail accounts. It is a
pnpm/Turborepo monorepo with an Electron desktop app and a Fastify relay for
provider update notifications.

The app signs in with Microsoft or Google OAuth, reads folders and messages
through provider APIs, and provides a focused three-pane mail interface for
browsing, searching, and triaging messages.

## Features

- Microsoft sign-in with MSAL and Google sign-in with installed-app OAuth
- Outlook folder navigation and Gmail label navigation
- Message list pagination and provider search
- HTML and plain-text message rendering with sanitized HTML content
- Read/unread, move, compose, reply, and move-to-trash actions
- Hardened Electron bridge with context isolation and trusted IPC checks
- Responsive layout for narrower desktop windows

## Tech Stack

- **Desktop shell:** Electron Forge
- **Build tooling:** Vite and TypeScript
- **UI:** React, Tailwind CSS, shadcn/Base UI primitives, lucide-react icons
- **Data:** TanStack Query and TanStack Router
- **Auth and mail:** MSAL Node, MSAL Node Extensions, Microsoft Graph, Gmail API
- **Testing:** Vitest and Testing Library

## Prerequisites

- Node.js and pnpm
- A Microsoft account with Outlook mail access or a Google account with Gmail
- A Microsoft Entra app registration or Google OAuth desktop client

## Getting Started

Install dependencies:

```powershell
pnpm install
```

Create a local environment file:

```powershell
Copy-Item apps/desktop/.env.example apps/desktop/.env
```

Edit `apps/desktop/.env` and set at least one provider client ID:

```dotenv
MICROSOFT_CLIENT_ID=<Application client ID>
GOOGLE_CLIENT_ID=<Google OAuth desktop client ID>
GOOGLE_CLIENT_SECRET=<optional Google OAuth desktop client secret>
GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/<topic>
```

The relay variables are optional for basic local desktop use. Add them only when
you are running a Graph update relay.

Start the app in development mode:

```powershell
pnpm start
```

Electron Forge starts the Electron main process, preload script, and Vite
renderer. In development, Chromium DevTools open automatically.

## OAuth Setup

Courrier is a public desktop client, so it uses Microsoft OAuth without a client
secret. Create a Microsoft Entra app registration with a native redirect URI of:

```text
http://localhost
```

The app uses delegated Microsoft Graph access for the signed-in user. Mail
actions such as marking messages read, moving messages, and moving messages to
trash require mailbox write permission. Sending new messages and replies
requires mail send permission.

For the full Microsoft setup flow, see [docs/oauth.md](docs/oauth.md). For the
Google setup flow, see [docs/google-oauth.md](docs/google-oauth.md).

For Gmail, create a Google OAuth desktop client and enable the Gmail API and
People API. Gmail live updates use Gmail `watch` with a Cloud Pub/Sub topic.
Configure the Pub/Sub push subscription to deliver to:

```text
https://your-relay.example.com/google/pubsub
```

If you set `GOOGLE_PUBSUB_VERIFICATION_TOKEN` on the relay, include it as a
`token` query parameter in the push endpoint URL.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm start` | Run Courrier desktop in development mode. |
| `pnpm dev` | Run workspace development tasks after dependency builds. |
| `pnpm package` | Package the Electron app locally. |
| `pnpm make` | Create distributable installers/packages. |
| `pnpm test` | Run workspace Vitest suites. |
| `pnpm typecheck` | Run workspace TypeScript checks. |
| `pnpm lint` | Run workspace ESLint checks. |

## Project Structure

```text
apps/
  desktop/      Electron desktop app
  relay/        Fastify Graph webhook and WebSocket relay
packages/
  mail-contracts/ Zod schemas and shared relay/desktop event types
  tsconfig/     Shared TypeScript base config
docs/
  oauth.md      Microsoft OAuth registration and troubleshooting guide
  google-oauth.md Google OAuth, Gmail API, and Pub/Sub setup guide
```

## Update Relay

Microsoft Graph change notifications and Gmail Pub/Sub push notifications require
a public HTTPS webhook endpoint. The desktop app keeps provider tokens locally
and creates provider subscriptions, while `apps/relay` receives webhook POSTs and
pushes compact invalidation events to the desktop app over WebSocket.

The current relay is intended for a self-hosted, single-user deployment. It uses
an in-memory store with bounded event retention, so registrations and pending
events are lost on process restart and are not shared across multiple relay
instances. Add a durable `RelayStore` before running it as a production
multi-instance service.

Relay environment variables:

```dotenv
RELAY_PUBLIC_URL=https://your-relay.example.com
RELAY_ADMIN_TOKEN=<shared relay admin token, at least 24 chars>
GOOGLE_PUBSUB_VERIFICATION_TOKEN=<optional shared push endpoint token>
PORT=3001
HOST=0.0.0.0
```

`apps/relay` reads these values from the host process environment.
`apps/relay/.env.example` is a template unless your deployment runner loads it.

Desktop relay environment variables:

```dotenv
RELAY_PUBLIC_URL=https://your-relay.example.com
RELAY_ADMIN_TOKEN=<same shared relay admin token>
```

Because Courrier is a public desktop client, do not use the shared relay admin
token for a public multi-user relay. Treat it as a self-hosted deployment secret.

## Security Notes

Courrier keeps Electron renderer privileges narrow:

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The preload script exposes only the typed `window.courrier` API.
- Main-process IPC handlers reject messages from untrusted pages.
- Renderer windows trust only the packaged app file or the configured Vite
  development origin, not arbitrary localhost pages.
- External navigation opens in the system browser instead of inside the app.
- Remote resources in HTML mail are stripped by default before iframe rendering.
- Microsoft tokens are cached with MSAL Node Extensions where platform support
  is available.
- Plaintext token cache fallback is disabled by default. Set
  `COURRIER_ALLOW_PLAINTEXT_TOKEN_CACHE=true` only if you accept storing tokens
  without OS encryption on the current machine.
