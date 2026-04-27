import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
} from '@azure/msal-node';
import {
  DataProtectionScope,
  FilePersistence,
  PersistenceCachePlugin,
  PersistenceCreator,
} from '@azure/msal-node-extensions';
import { app, shell } from 'electron';
import path from 'node:path';
import type { AuthSession } from '../lib/mail-types';

const authority = 'https://login.microsoftonline.com/common';
const scopes = ['User.Read', 'Mail.ReadWrite', 'offline_access'];

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

export class AuthService {
  private readonly clientId: string | undefined;
  private readonly pcaPromise: Promise<PublicClientApplication> | undefined;

  constructor(clientId = process.env.MICROSOFT_CLIENT_ID) {
    this.clientId = clientId;
    this.pcaPromise = clientId ? createPublicClient(clientId) : undefined;
  }

  async getSession(): Promise<AuthSession> {
    if (!this.clientId || !this.pcaPromise) {
      return {
        status: 'configuration-error',
        message:
          'MICROSOFT_CLIENT_ID is missing. Create a Microsoft app registration and set the client ID locally.',
      };
    }

    const pca = await this.pcaPromise;
    const account = await this.getCachedAccount(pca);

    if (!account) {
      return { status: 'unauthenticated' };
    }

    try {
      const result = await pca.acquireTokenSilent({
        account,
        scopes,
      });

      return sessionFromAccount(result.account ?? account);
    } catch (error) {
      if (
        error instanceof InteractionRequiredAuthError ||
        shouldPromptForInteractiveSignIn(error)
      ) {
        return { status: 'unauthenticated' };
      }

      throw error;
    }
  }

  async signIn(): Promise<AuthSession> {
    const pca = await this.getConfiguredClient();
    const result = await pca.acquireTokenInteractive({
      scopes,
      openBrowser: async (url: string) => {
        await shell.openExternal(url);
      },
      successTemplate: createAuthCallbackTemplate({
        tone: 'success',
        title: 'Courrier sign-in complete',
        message:
          'Your Microsoft account is connected. You can close this tab and return to Courrier.',
      }),
      errorTemplate: createAuthCallbackTemplate({
        tone: 'error',
        title: 'Courrier sign-in failed',
        message:
          'Something interrupted the Microsoft sign-in. Return to Courrier and try again.',
      }),
    });

    if (!result?.account) {
      return { status: 'unauthenticated' };
    }

    return sessionFromAccount(result.account);
  }

  async signOut(): Promise<AuthSession> {
    const pca = await this.getConfiguredClient();
    const accounts = await pca.getTokenCache().getAllAccounts();

    await Promise.all(
      accounts.map((account: AccountInfo) =>
        pca.getTokenCache().removeAccount(account),
      ),
    );

    return { status: 'unauthenticated' };
  }

  async getAccessToken(): Promise<string> {
    const pca = await this.getConfiguredClient();
    const account = await this.getCachedAccount(pca);

    if (!account) {
      throw new Error('Microsoft sign-in is required.');
    }

    const result: AuthenticationResult = await pca.acquireTokenSilent({
      account,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error('Microsoft did not return an access token.');
    }

    return result.accessToken;
  }

  private async getConfiguredClient() {
    if (!this.clientId || !this.pcaPromise) {
      throw new AuthConfigurationError(
        'MICROSOFT_CLIENT_ID is missing. Create a Microsoft app registration and set the client ID locally.',
      );
    }

    return this.pcaPromise;
  }

  private async getCachedAccount(pca: PublicClientApplication) {
    const accounts = await pca.getTokenCache().getAllAccounts();
    return accounts[0];
  }
}

async function createPublicClient(clientId: string) {
  const cachePlugin = await createCachePlugin();
  const config: Configuration = {
    auth: {
      clientId,
      authority,
    },
    cache: cachePlugin ? { cachePlugin } : undefined,
  };

  return new PublicClientApplication(config);
}

async function createCachePlugin() {
  const cachePath = path.join(app.getPath('userData'), 'msal-cache.json');
  let persistence;

  try {
    persistence = await PersistenceCreator.createPersistence({
      cachePath,
      dataProtectionScope: DataProtectionScope.CurrentUser,
      serviceName: 'Courrier',
      accountName: 'MicrosoftGraphMail',
      usePlaintextFileOnLinux: false,
    });
  } catch (error) {
    if (!shouldUsePlaintextCacheFallback(error)) {
      throw error;
    }

    persistence = await FilePersistence.create(cachePath);
  }

  return new PersistenceCachePlugin(persistence);
}

export function shouldUsePlaintextCacheFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Dpapi bindings unavailable') ||
    message.includes('Dpapi is not supported on this platform')
  );
}

function shouldPromptForInteractiveSignIn(error: unknown) {
  const candidate = error as {
    errorCode?: string;
    errorMessage?: string;
    message?: string;
  };
  const errorCode = candidate.errorCode?.toLowerCase();
  const message = (
    candidate.errorMessage ??
    candidate.message ??
    String(error)
  ).toLowerCase();

  return (
    errorCode === 'invalid_grant' ||
    message.includes('invalid_grant') ||
    message.includes('aadsts70000') ||
    message.includes('must first sign in and grant')
  );
}

function sessionFromAccount(account: AccountInfo): AuthSession {
  return {
    status: 'authenticated',
    account: {
      homeAccountId: account.homeAccountId,
      username: account.username,
      name: account.name,
    },
  };
}

function createAuthCallbackTemplate({
  tone,
  title,
  message,
}: {
  tone: 'success' | 'error';
  title: string;
  message: string;
}) {
  const iconPath =
    tone === 'success'
      ? 'M5 13l4 4L19 7'
      : 'M12 8v4m0 4h.01';
  const statusColor = tone === 'success' ? 'var(--primary)' : 'var(--destructive)';
  const statusForeground =
    tone === 'success'
      ? 'var(--primary-foreground)'
      : 'var(--destructive-foreground)';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: oklch(1 0 0);
        --foreground: oklch(0.145 0 0);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.145 0 0);
        --primary: oklch(0.205 0 0);
        --primary-foreground: oklch(0.985 0 0);
        --secondary: oklch(0.97 0 0);
        --muted: oklch(0.97 0 0);
        --muted-foreground: oklch(0.556 0 0);
        --destructive: oklch(0.577 0.245 27.325);
        --destructive-foreground: oklch(0.985 0 0);
        --border: oklch(0.922 0 0);
        --ring: oklch(0.708 0 0);
        --radius: 0.5rem;
        --status: ${statusColor};
        --status-foreground: ${statusForeground};
        --status-surface: var(--secondary);
        --shadow: 0 24px 80px oklch(0.145 0 0 / 12%);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --background: oklch(0.145 0 0);
          --foreground: oklch(0.985 0 0);
          --card: oklch(0.205 0 0);
          --card-foreground: oklch(0.985 0 0);
          --primary: oklch(0.922 0 0);
          --primary-foreground: oklch(0.205 0 0);
          --secondary: oklch(0.269 0 0);
          --muted: oklch(0.269 0 0);
          --muted-foreground: oklch(0.708 0 0);
          --destructive: oklch(0.704 0.191 22.216);
          --destructive-foreground: oklch(0.985 0 0);
          --border: oklch(1 0 0 / 10%);
          --ring: oklch(0.556 0 0);
          --shadow: 0 24px 90px oklch(0 0 0 / 45%);
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 32px;
        background: var(--background);
        color: var(--foreground);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
      }

      main {
        width: min(100%, 460px);
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) + 18px);
        padding: 36px;
        background: var(--card);
        box-shadow: var(--shadow);
        text-align: center;
        backdrop-filter: blur(18px);
      }

      .icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 24px;
        display: grid;
        place-items: center;
        border-radius: calc(var(--radius) + 14px);
        background: var(--status-surface);
        color: var(--status);
      }

      svg {
        width: 32px;
        height: 32px;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.75rem, 7vw, 2.35rem);
        line-height: 1.05;
        letter-spacing: -0.04em;
        color: var(--card-foreground);
      }

      p {
        margin: 16px 0 0;
        color: var(--muted-foreground);
        font-size: 1rem;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="${iconPath}" />
        </svg>
      </div>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}
