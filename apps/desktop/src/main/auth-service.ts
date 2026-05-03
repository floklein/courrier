import type {
  AuthSession,
  MailAccount,
  ProviderConfigurationStatus,
  ProviderId,
} from '../lib/mail-types';
import type { RegisteredProvider } from './mail-provider';

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Sign-in is required.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class AuthService {
  private activeAccountId: string | undefined;
  private readonly providersById: Map<ProviderId, RegisteredProvider>;

  constructor(providers: RegisteredProvider[]) {
    this.providersById = new Map(
      providers.map((provider) => [provider.auth.id, provider]),
    );
  }

  async getSession(): Promise<AuthSession> {
    const accounts = await this.getAccounts();
    const providers = this.getProviderStatuses();
    const activeAccount = this.getActiveAccount(accounts);

    if (activeAccount) {
      this.activeAccountId = activeAccount.id;
      return {
        status: 'authenticated',
        activeAccount,
        accounts,
        providers,
      };
    }

    if (!providers.some((provider) => provider.isConfigured)) {
      return {
        status: 'configuration-error',
        message: 'No mail provider is configured. Set a Microsoft or Google client ID locally.',
        accounts,
        providers,
      };
    }

    return {
      status: 'unauthenticated',
      accounts,
      providers,
    };
  }

  async signIn(providerId: ProviderId): Promise<AuthSession> {
    const provider = this.getProvider(providerId);
    const configurationError = provider.auth.getConfigurationError();

    if (configurationError) {
      throw new AuthConfigurationError(configurationError);
    }

    const account = await provider.auth.signIn();

    if (account) {
      this.activeAccountId = account.id;
    }

    return this.getSession();
  }

  async switchAccount(accountId: string): Promise<AuthSession> {
    const accounts = await this.getAccounts();

    if (!accounts.some((account) => account.id === accountId)) {
      throw new AuthRequiredError('The selected mail account is not signed in.');
    }

    this.activeAccountId = accountId;
    return this.getSession();
  }

  async signOut(accountId?: string): Promise<AuthSession> {
    const accounts = await this.getAccounts();
    const account =
      accounts.find((candidate) => candidate.id === accountId) ??
      accounts.find((candidate) => candidate.id === this.activeAccountId) ??
      accounts[0];

    if (account) {
      await this.getProvider(account.providerId).auth.signOut(account.id);
    }

    if (!accountId || this.activeAccountId === account?.id) {
      this.activeAccountId = undefined;
    }

    return this.getSession();
  }

  async getAccounts() {
    const accountLists = await Promise.all(
      [...this.providersById.values()].map((provider) =>
        provider.auth.getAccounts(),
      ),
    );

    return accountLists.flat().sort(sortAccounts);
  }

  getActiveAccountId() {
    return this.activeAccountId;
  }

  private getActiveAccount(accounts: MailAccount[]) {
    if (this.activeAccountId) {
      const activeAccount = accounts.find(
        (account) => account.id === this.activeAccountId,
      );

      if (activeAccount) {
        return activeAccount;
      }

      this.activeAccountId = undefined;
    }

    return accounts[0];
  }

  private getProvider(providerId: ProviderId) {
    const provider = this.providersById.get(providerId);

    if (!provider) {
      throw new AuthConfigurationError(`Mail provider is not registered: ${providerId}`);
    }

    return provider;
  }

  private getProviderStatuses(): ProviderConfigurationStatus[] {
    return [...this.providersById.values()].map((provider) => {
      const message = provider.auth.getConfigurationError();

      return {
        providerId: provider.auth.id,
        displayName: provider.auth.displayName,
        isConfigured: !message,
        message,
      };
    });
  }
}

function sortAccounts(left: MailAccount, right: MailAccount) {
  const providerOrder = left.providerId.localeCompare(right.providerId);

  if (providerOrder !== 0) {
    return providerOrder;
  }

  return left.email.localeCompare(right.email);
}
