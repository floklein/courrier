using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Auth;

public sealed class AccountManager
{
    private readonly IReadOnlyDictionary<ProviderId, IAuthProvider> _providers;
    private readonly AccountStore _store;

    public AccountManager(IEnumerable<IAuthProvider> providers, AccountStore store)
    {
        _providers = providers.ToDictionary(provider => provider.Id);
        _store = store;
    }

    public IReadOnlyList<IAuthProvider> Providers => _providers.Values.ToList();
    public event EventHandler? AccountsChanged;

    public async Task<(IReadOnlyList<MailAccount> Accounts, MailAccount? Active)> GetSessionAsync(
        CancellationToken cancellationToken = default)
    {
        var state = await _store.ReadAsync(cancellationToken);
        var results = await Task.WhenAll(_providers.Values.Select(async provider =>
        {
            try
            {
                return await provider.GetAccountsAsync(cancellationToken);
            }
            catch
            {
                return [];
            }
        }));
        var accounts = results
            .SelectMany(result => result)
            .DistinctBy(account => account.Id)
            .OrderBy(account => account.Email, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var active = accounts.FirstOrDefault(account => account.Id == state.ActiveAccountId)
            ?? accounts.FirstOrDefault();

        if (active?.Id != state.ActiveAccountId)
        {
            await _store.SetActiveAsync(active?.Id, cancellationToken);
        }

        return (accounts, active);
    }

    public async Task<MailAccount?> SignInAsync(
        ProviderId providerId,
        CancellationToken cancellationToken = default)
    {
        var account = await _providers[providerId].SignInAsync(cancellationToken);
        if (account is not null)
        {
            await _store.UpsertAccountAsync(account, cancellationToken);
            AccountsChanged?.Invoke(this, EventArgs.Empty);
        }

        return account;
    }

    public Task SwitchAsync(string accountId, CancellationToken cancellationToken = default)
    {
        return _store.SetActiveAsync(accountId, cancellationToken);
    }

    public async Task SignOutAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var state = await _store.ReadAsync(cancellationToken);
        var account = state.Accounts.FirstOrDefault(candidate => candidate.Id == accountId);
        if (account is null)
        {
            return;
        }

        await _providers[account.ProviderId].SignOutAsync(accountId, cancellationToken);
        await _store.RemoveAccountAsync(accountId, cancellationToken);
        AccountsChanged?.Invoke(this, EventArgs.Empty);
    }
}
