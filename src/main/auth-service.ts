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
const scopes = ['User.Read', 'Mail.Read', 'offline_access'];

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
      if (error instanceof InteractionRequiredAuthError) {
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
      successTemplate:
        '<html><body><h1>Courrier sign-in complete</h1><p>You can return to Courrier.</p></body></html>',
      errorTemplate:
        '<html><body><h1>Courrier sign-in failed</h1><p>Return to Courrier and try again.</p></body></html>',
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
