import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage, shell } from 'electron';
import type { MailAccount } from '../lib/mail-types';
import type { MailAuthProvider } from './mail-provider';
import { AuthConfigurationError, AuthRequiredError } from './auth-service';
import { createAuthCallbackTemplate } from './auth-callback-template';

const googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const googleUserInfoUrl = 'https://openidconnect.googleapis.com/v1/userinfo';
const googleScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/contacts.readonly',
];
const tokenRefreshBufferMs = 60_000;

interface GoogleStoredAccount {
  providerAccountId: string;
  email: string;
  name?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  name?: string;
}

export class GoogleAuthProvider implements MailAuthProvider {
  readonly id = 'google' as const;
  readonly displayName = 'Google';
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor({
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  }: { clientId?: string; clientSecret?: string } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  getConfigurationError() {
    return this.clientId
      ? undefined
      : 'GOOGLE_CLIENT_ID is missing. Create a Google OAuth desktop client and set the client ID locally.';
  }

  async getAccounts(): Promise<MailAccount[]> {
    const accounts = await readStoredAccounts();
    return accounts.map(googleAccountFromStored);
  }

  async signIn(): Promise<MailAccount | undefined> {
    if (!this.clientId) {
      throw new AuthConfigurationError(
        'GOOGLE_CLIENT_ID is missing. Create a Google OAuth desktop client and set the client ID locally.',
      );
    }

    const verifier = randomSecret();
    const state = randomSecret();
    const { code, redirectUri } = await receiveAuthorizationCode({
      clientId: this.clientId,
      verifier,
      state,
    });
    const token = await this.exchangeCode({ code, redirectUri, verifier });

    if (!token.access_token) {
      throw new Error('Google did not return an access token.');
    }

    const profile = await fetchGoogleJson<GoogleUserInfo>(
      googleUserInfoUrl,
      token.access_token,
    );

    if (!profile.sub || !profile.email) {
      throw new Error('Google did not return account identity information.');
    }

    const stored: GoogleStoredAccount = {
      providerAccountId: profile.sub,
      email: profile.email,
      name: profile.name,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: getExpiresAt(token.expires_in),
    };

    await upsertStoredAccount(stored);
    return googleAccountFromStored(stored);
  }

  async signOut(accountId: string): Promise<void> {
    const providerAccountId = getGoogleProviderAccountId(accountId);
    const accounts = await readStoredAccounts();
    await writeStoredAccounts(
      accounts.filter((account) => account.providerAccountId !== providerAccountId),
    );
  }

  async getAccessToken(accountId: string): Promise<string> {
    const providerAccountId = getGoogleProviderAccountId(accountId);
    const accounts = await readStoredAccounts();
    const account = accounts.find(
      (candidate) => candidate.providerAccountId === providerAccountId,
    );

    if (!account) {
      throw new AuthRequiredError('Google sign-in is required.');
    }

    if (!isTokenExpired(account)) {
      return account.accessToken;
    }

    if (!account.refreshToken) {
      throw new AuthRequiredError('Google sign-in is required.');
    }

    const token = await this.refreshToken(account.refreshToken);

    if (!token.access_token) {
      throw new AuthRequiredError('Google sign-in is required.');
    }

    const updatedAccount = {
      ...account,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? account.refreshToken,
      expiresAt: getExpiresAt(token.expires_in),
    };
    await upsertStoredAccount(updatedAccount);
    return updatedAccount.accessToken;
  }

  private async exchangeCode({
    code,
    redirectUri,
    verifier,
  }: {
    code: string;
    redirectUri: string;
    verifier: string;
  }) {
    const body = new URLSearchParams({
      client_id: this.clientId ?? '',
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    return postGoogleToken(body);
  }

  private async refreshToken(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.clientId ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    return postGoogleToken(body);
  }
}

function googleAccountFromStored(account: GoogleStoredAccount): MailAccount {
  return {
    id: createGoogleAccountId(account.providerAccountId),
    providerId: 'google',
    providerAccountId: account.providerAccountId,
    email: account.email,
    name: account.name,
    label: account.name || account.email,
  };
}

export function createGoogleAccountId(providerAccountId: string) {
  return `google:${providerAccountId}`;
}

function getGoogleProviderAccountId(accountId: string) {
  return accountId.startsWith('google:')
    ? accountId.slice('google:'.length)
    : accountId;
}

async function receiveAuthorizationCode({
  clientId,
  state,
  verifier,
}: {
  clientId: string;
  state: string;
  verifier: string;
}): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', redirectUri);

      if (requestUrl.pathname !== '/') {
        response.writeHead(404).end();
        return;
      }

      if (requestUrl.searchParams.get('state') !== state) {
        response
          .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(createAuthCallbackTemplate({
            tone: 'error',
            title: 'Courrier sign-in failed',
            message: 'Google returned an unexpected sign-in state.',
          }));
        closeServer(server);
        reject(new Error('Google returned an unexpected OAuth state.'));
        return;
      }

      const error = requestUrl.searchParams.get('error');
      if (error) {
        response
          .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(createAuthCallbackTemplate({
            tone: 'error',
            title: 'Courrier sign-in failed',
            message: 'Something interrupted the Google sign-in. Return to Courrier and try again.',
          }));
        closeServer(server);
        reject(new Error(`Google sign-in failed: ${error}`));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Missing authorization code.');
        closeServer(server);
        reject(new Error('Google did not return an authorization code.'));
        return;
      }

      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(createAuthCallbackTemplate({
          tone: 'success',
          title: 'Courrier sign-in complete',
          message: 'Your Google account is connected. You can close this tab and return to Courrier.',
        }));
      closeServer(server);
      resolve({ code, redirectUri });
    });
    let redirectUri = '';

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        closeServer(server);
        reject(new Error('Could not start the Google OAuth callback server.'));
        return;
      }

      redirectUri = `http://127.0.0.1:${address.port}`;
      const authUrl = new URL(googleAuthUrl);
      authUrl.search = new URLSearchParams({
        access_type: 'offline',
        client_id: clientId,
        code_challenge: createCodeChallenge(verifier),
        code_challenge_method: 'S256',
        include_granted_scopes: 'true',
        prompt: 'consent',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: googleScopes.join(' '),
        state,
      }).toString();

      void shell.openExternal(authUrl.toString()).catch((error: unknown) => {
        closeServer(server);
        reject(error);
      });
    });
  });
}

async function postGoogleToken(body: URLSearchParams) {
  const response = await fetch(googleTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = (await response.json()) as GoogleTokenResponse;

  if (!response.ok) {
    throw new Error(
      `Google token request failed: ${data.error_description ?? data.error ?? response.status}`,
    );
  }

  return data;
}

async function fetchGoogleJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google profile request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function readStoredAccounts(): Promise<GoogleStoredAccount[]> {
  try {
    const body = await fs.readFile(getTokenStorePath());
    return JSON.parse(decryptTokenStore(body)) as GoogleStoredAccount[];
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writeStoredAccounts(accounts: GoogleStoredAccount[]) {
  const storePath = getTokenStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, encryptTokenStore(JSON.stringify(accounts)));
}

async function upsertStoredAccount(account: GoogleStoredAccount) {
  const accounts = await readStoredAccounts();
  const nextAccounts = accounts.filter(
    (candidate) => candidate.providerAccountId !== account.providerAccountId,
  );
  nextAccounts.push(account);
  await writeStoredAccounts(nextAccounts);
}

function encryptTokenStore(value: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    if (process.env.COURRIER_ALLOW_PLAINTEXT_TOKEN_CACHE !== 'true') {
      throw new AuthConfigurationError(
        'Encrypted Google token storage is unavailable. Set COURRIER_ALLOW_PLAINTEXT_TOKEN_CACHE=true only if you accept storing tokens without OS encryption.',
      );
    }

    return Buffer.from(`plain:${value}`, 'utf8');
  }

  return Buffer.concat([
    Buffer.from('safe:', 'utf8'),
    safeStorage.encryptString(value),
  ]);
}

function decryptTokenStore(value: Buffer) {
  const prefix = value.subarray(0, 5).toString('utf8');

  if (prefix === 'safe:') {
    return safeStorage.decryptString(value.subarray(5));
  }

  if (prefix === 'plain') {
    return value.toString('utf8').slice('plain:'.length);
  }

  return safeStorage.decryptString(value);
}

function getTokenStorePath() {
  return path.join(app.getPath('userData'), 'google-oauth-tokens.bin');
}

function createCodeChallenge(verifier: string) {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

function randomSecret() {
  return randomBytes(32).toString('base64url');
}

function getExpiresAt(expiresIn: number | undefined) {
  return expiresIn ? Date.now() + expiresIn * 1000 : undefined;
}

function isTokenExpired(account: GoogleStoredAccount) {
  return !account.expiresAt || account.expiresAt - tokenRefreshBufferMs <= Date.now();
}

function closeServer(server: http.Server) {
  server.close((error) => {
    if (error) {
      console.warn('Google OAuth callback server did not close cleanly.', error);
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
