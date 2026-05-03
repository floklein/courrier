import 'dotenv/config';
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
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuthSession } from '../lib/mail-types';
import { createAuthCallbackTemplate } from './auth-callback-template';

const authority = 'https://login.microsoftonline.com/common';
const scopes = [
  'User.Read',
  'People.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'offline_access',
];

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Microsoft sign-in is required.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class AuthService {
  private readonly clientId: string | undefined;
  private readonly pcaPromise: Promise<PublicClientApplication> | undefined;
  private activeHomeAccountId: string | undefined;

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
      this.activeHomeAccountId = undefined;
      return { status: 'unauthenticated' };
    }

    try {
      const result = await pca.acquireTokenSilent({
        account,
        scopes,
      });
      const sessionAccount = result.account ?? account;

      this.rememberAccount(sessionAccount);
      return sessionFromAccount(sessionAccount);
    } catch (error) {
      if (
        error instanceof InteractionRequiredAuthError ||
        shouldPromptForInteractiveSignIn(error)
      ) {
        this.activeHomeAccountId = undefined;
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

    this.rememberAccount(result.account);
    return sessionFromAccount(result.account);
  }

  async signOut(): Promise<AuthSession> {
    const pca = await this.getConfiguredClient();
    const accounts = await this.getCachedAccounts(pca);
    this.activeHomeAccountId = undefined;

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
      throw new AuthRequiredError();
    }

    let result: AuthenticationResult;

    try {
      result = await pca.acquireTokenSilent({
        account,
        scopes,
      });
    } catch (error) {
      if (
        error instanceof InteractionRequiredAuthError ||
        shouldPromptForInteractiveSignIn(error)
      ) {
        this.activeHomeAccountId = undefined;
        throw new AuthRequiredError();
      }

      throw error;
    }

    if (!result.accessToken) {
      throw new Error('Microsoft did not return an access token.');
    }

    this.rememberAccount(result.account ?? account);
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
    const tokenCache = pca.getTokenCache();

    if (this.activeHomeAccountId) {
      const activeAccount = await tokenCache.getAccountByHomeId(
        this.activeHomeAccountId,
      );

      if (activeAccount) {
        return activeAccount;
      }

      this.activeHomeAccountId = undefined;
    }

    const accounts = await this.getCachedAccounts(pca);
    const account = accounts[0];

    if (account) {
      this.rememberAccount(account);
    }

    return account;
  }

  private async getCachedAccounts(pca: PublicClientApplication) {
    try {
      return await pca.getTokenCache().getAllAccounts();
    } catch (error) {
      if (!shouldResetEncryptedCache(error)) {
        throw error;
      }

      console.warn('Resetting unreadable Microsoft auth cache.', error);
      await resetAuthCache();
      return [];
    }
  }

  private rememberAccount(account: AccountInfo) {
    this.activeHomeAccountId = account.homeAccountId;
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
  const cachePath = getAuthCachePath();
  let persistence;

  try {
    persistence = await createEncryptedPersistence(cachePath);
  } catch (error) {
    if (shouldResetEncryptedCache(error)) {
      console.warn('Resetting unreadable Microsoft auth cache.', error);
      await fs.rm(cachePath, { force: true });
      persistence = await createEncryptedPersistence(cachePath);
    } else if (shouldUsePlaintextCacheFallback(error)) {
      if (process.env.COURRIER_ALLOW_PLAINTEXT_TOKEN_CACHE !== 'true') {
        throw new AuthConfigurationError(
          'Encrypted Microsoft token storage is unavailable. Set COURRIER_ALLOW_PLAINTEXT_TOKEN_CACHE=true only if you accept storing tokens without OS encryption.',
        );
      }

      console.warn('Using plaintext Microsoft auth cache fallback.', error);
      persistence = await FilePersistence.create(cachePath);
    } else {
      throw error;
    }
  }

  return new PersistenceCachePlugin(persistence);
}

function getAuthCachePath() {
  return path.join(app.getPath('userData'), 'msal-cache.json');
}

function resetAuthCache() {
  return fs.rm(getAuthCachePath(), { force: true });
}

function createEncryptedPersistence(cachePath: string) {
  return PersistenceCreator.createPersistence({
    cachePath,
    dataProtectionScope: DataProtectionScope.CurrentUser,
    serviceName: 'Courrier',
    accountName: 'MicrosoftGraphMail',
    usePlaintextFileOnLinux: false,
  });
}

export function shouldUsePlaintextCacheFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Dpapi bindings unavailable') ||
    message.includes('Dpapi is not supported on this platform')
  );
}

function shouldResetEncryptedCache(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Encryption/Decryption failed') ||
    message.includes('Error code: 13')
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
