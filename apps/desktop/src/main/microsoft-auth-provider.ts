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
import type { MailAccount } from '../lib/mail-types';
import type { MailAuthProvider } from './mail-provider';
import { AuthConfigurationError, AuthRequiredError } from './auth-service';
import { createAuthCallbackTemplate } from './auth-callback-template';

const authority = 'https://login.microsoftonline.com/common';
const scopes = [
  'User.Read',
  'People.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'offline_access',
];

export class MicrosoftAuthProvider implements MailAuthProvider {
  readonly id = 'microsoft' as const;
  readonly displayName = 'Microsoft';
  private readonly clientId: string | undefined;
  private readonly pcaPromise: Promise<PublicClientApplication> | undefined;

  constructor(clientId = process.env.MICROSOFT_CLIENT_ID) {
    this.clientId = clientId;
    this.pcaPromise = clientId ? createPublicClient(clientId) : undefined;
  }

  getConfigurationError() {
    return this.clientId
      ? undefined
      : 'MICROSOFT_CLIENT_ID is missing. Create a Microsoft app registration and set the client ID locally.';
  }

  async getAccounts(): Promise<MailAccount[]> {
    if (!this.clientId || !this.pcaPromise) {
      return [];
    }

    const pca = await this.pcaPromise;
    const accounts = await this.getCachedAccounts(pca);
    return accounts.map(microsoftAccountFromMsal);
  }

  async signIn(): Promise<MailAccount | undefined> {
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

    return result?.account ? microsoftAccountFromMsal(result.account) : undefined;
  }

  async signOut(accountId: string): Promise<void> {
    const pca = await this.getConfiguredClient();
    const providerAccountId = getMicrosoftProviderAccountId(accountId);
    const account = await pca.getTokenCache().getAccountByHomeId(providerAccountId);

    if (account) {
      await pca.getTokenCache().removeAccount(account);
    }
  }

  async getAccessToken(accountId: string): Promise<string> {
    const pca = await this.getConfiguredClient();
    const providerAccountId = getMicrosoftProviderAccountId(accountId);
    const account = await pca.getTokenCache().getAccountByHomeId(providerAccountId);

    if (!account) {
      throw new AuthRequiredError('Microsoft sign-in is required.');
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
        throw new AuthRequiredError('Microsoft sign-in is required.');
      }

      throw error;
    }

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
}

function microsoftAccountFromMsal(account: AccountInfo): MailAccount {
  return {
    id: createMicrosoftAccountId(account.homeAccountId),
    providerId: 'microsoft',
    providerAccountId: account.homeAccountId,
    email: account.username,
    name: account.name,
    label: account.name || account.username,
  };
}

export function createMicrosoftAccountId(homeAccountId: string) {
  return `microsoft:${homeAccountId}`;
}

function getMicrosoftProviderAccountId(accountId: string) {
  return accountId.startsWith('microsoft:')
    ? accountId.slice('microsoft:'.length)
    : accountId;
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
