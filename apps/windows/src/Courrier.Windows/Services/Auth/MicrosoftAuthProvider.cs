using System.Security.Claims;
using Courrier.Windows.Models;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

namespace Courrier.Windows.Services.Auth;

public sealed class MicrosoftAuthProvider : IAuthProvider
{
    private static readonly string[] Scopes =
    [
        "User.Read",
        "People.Read",
        "Mail.ReadWrite",
        "Mail.Send"
    ];

    private readonly IPublicClientApplication? _client;
    private readonly AccountStore _accountStore;
    private readonly Task _cacheInitialization;

    public MicrosoftAuthProvider(AppSettings settings, AccountStore accountStore)
    {
        _accountStore = accountStore;
        if (string.IsNullOrWhiteSpace(settings.MicrosoftClientId))
        {
            ConfigurationError =
                "Add MicrosoftClientId to appsettings.json or set MICROSOFT_CLIENT_ID.";
            _cacheInitialization = Task.CompletedTask;
            return;
        }

        _client = PublicClientApplicationBuilder
            .Create(settings.MicrosoftClientId)
            .WithAuthority(AadAuthorityAudience.AzureAdAndPersonalMicrosoftAccount)
            .WithRedirectUri("http://localhost")
            .Build();
        _cacheInitialization = ConfigureCacheAsync(_client);
    }

    public ProviderId Id => ProviderId.Microsoft;
    public string DisplayName => "Microsoft";
    public string? ConfigurationError { get; }

    public async Task<IReadOnlyList<MailAccount>> GetAccountsAsync(
        CancellationToken cancellationToken = default)
    {
        var client = GetClient();
        await _cacheInitialization;
        var accounts = await client.GetAccountsAsync();
        return accounts.Select(MapAccount).ToList();
    }

    public async Task<MailAccount?> SignInAsync(CancellationToken cancellationToken = default)
    {
        var client = GetClient();
        await _cacheInitialization;
        var result = await client.AcquireTokenInteractive(Scopes)
            .WithUseEmbeddedWebView(false)
            .ExecuteAsync(cancellationToken);
        var account = MapAccount(result.Account, result.ClaimsPrincipal);
        await _accountStore.UpsertAccountAsync(account, cancellationToken);
        return account;
    }

    public async Task SignOutAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var client = GetClient();
        await _cacheInitialization;
        var providerAccountId = RemovePrefix(accountId);
        var account = (await client.GetAccountsAsync())
            .FirstOrDefault(candidate => candidate.HomeAccountId.Identifier == providerAccountId);
        if (account is not null)
        {
            await client.RemoveAsync(account);
        }
    }

    public async Task<string> GetAccessTokenAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        var client = GetClient();
        await _cacheInitialization;
        var providerAccountId = RemovePrefix(accountId);
        var account = (await client.GetAccountsAsync())
            .FirstOrDefault(candidate => candidate.HomeAccountId.Identifier == providerAccountId)
            ?? throw new InvalidOperationException("This Microsoft account is no longer signed in.");

        try
        {
            return (await client.AcquireTokenSilent(Scopes, account)
                .ExecuteAsync(cancellationToken)).AccessToken;
        }
        catch (MsalUiRequiredException)
        {
            return (await client.AcquireTokenInteractive(Scopes)
                .WithAccount(account)
                .WithPrompt(Prompt.NoPrompt)
                .WithUseEmbeddedWebView(false)
                .ExecuteAsync(cancellationToken)).AccessToken;
        }
    }

    private IPublicClientApplication GetClient()
    {
        return _client ?? throw new InvalidOperationException(ConfigurationError);
    }

    private static MailAccount MapAccount(IAccount account, ClaimsPrincipal? principal = null)
    {
        var name = principal?.FindFirst("name")?.Value;
        return new MailAccount(
            $"microsoft:{account.HomeAccountId.Identifier}",
            ProviderId.Microsoft,
            account.HomeAccountId.Identifier,
            account.Username,
            name,
            string.IsNullOrWhiteSpace(name) ? account.Username : name);
    }

    private static string RemovePrefix(string accountId)
    {
        return accountId.StartsWith("microsoft:", StringComparison.Ordinal)
            ? accountId["microsoft:".Length..]
            : accountId;
    }

    private static async Task ConfigureCacheAsync(IPublicClientApplication client)
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Courrier");
        Directory.CreateDirectory(directory);
        var properties = new StorageCreationPropertiesBuilder("msal.cache", directory).Build();
        var helper = await MsalCacheHelper.CreateAsync(properties);
        helper.VerifyPersistence();
        helper.RegisterCache(client.UserTokenCache);
    }
}

