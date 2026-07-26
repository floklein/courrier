using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Auth;

public sealed class GoogleAuthProvider : IAuthProvider
{
    private const string AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string UserInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
    private const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";
    private static readonly string[] Scopes =
    [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/contacts.readonly"
    ];

    private readonly AppSettings _settings;
    private readonly AccountStore _accountStore;
    private readonly ISecureTokenStore _tokenStore;
    private readonly HttpClient _httpClient;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _refreshLocks = new();

    public GoogleAuthProvider(
        AppSettings settings,
        AccountStore accountStore,
        ISecureTokenStore tokenStore,
        HttpClient httpClient)
    {
        _settings = settings;
        _accountStore = accountStore;
        _tokenStore = tokenStore;
        _httpClient = httpClient;
        if (string.IsNullOrWhiteSpace(settings.GoogleClientId))
        {
            ConfigurationError =
                "Add GoogleClientId to appsettings.json or set GOOGLE_CLIENT_ID.";
        }
    }

    public ProviderId Id => ProviderId.Google;
    public string DisplayName => "Google";
    public string? ConfigurationError { get; }

    public async Task<IReadOnlyList<MailAccount>> GetAccountsAsync(
        CancellationToken cancellationToken = default)
    {
        var state = await _accountStore.ReadAsync(cancellationToken);
        var accounts = new List<MailAccount>();
        foreach (var account in state.Accounts.Where(account => account.ProviderId == ProviderId.Google))
        {
            if (await _tokenStore.ReadAsync(TokenKey(account.Id)) is not null)
            {
                accounts.Add(account);
            }
        }

        return accounts;
    }

    public async Task<MailAccount?> SignInAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(48));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = Base64Url(RandomNumberGenerator.GetBytes(24));
        var port = ReserveLoopbackPort();
        var redirectUri = $"http://127.0.0.1:{port}/";

        using var listener = new HttpListener();
        listener.Prefixes.Add(redirectUri);
        listener.Start();

        var authorizationUrl = BuildUrl(AuthorizationEndpoint, new Dictionary<string, string>
        {
            ["client_id"] = _settings.GoogleClientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', Scopes),
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["state"] = state
        });
        Process.Start(new ProcessStartInfo(authorizationUrl) { UseShellExecute = true });

        var context = await listener.GetContextAsync().WaitAsync(cancellationToken);
        var code = context.Request.QueryString["code"];
        var returnedState = context.Request.QueryString["state"];
        var oauthError = context.Request.QueryString["error"];
        await WriteBrowserResponseAsync(context.Response, oauthError is null);
        listener.Stop();

        if (!string.IsNullOrWhiteSpace(oauthError))
        {
            throw new InvalidOperationException($"Google sign-in was not completed: {oauthError}.");
        }

        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(state),
                Encoding.UTF8.GetBytes(returnedState ?? string.Empty)))
        {
            throw new InvalidOperationException("Google sign-in returned an invalid state value.");
        }

        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("Google sign-in did not return an authorization code.");
        }

        var token = await ExchangeCodeAsync(code, verifier, redirectUri, cancellationToken);
        using var userInfoRequest = new HttpRequestMessage(HttpMethod.Get, UserInfoEndpoint);
        userInfoRequest.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.AccessToken);
        using var userInfoResponse = await _httpClient.SendAsync(userInfoRequest, cancellationToken);
        userInfoResponse.EnsureSuccessStatusCode();
        var user = await userInfoResponse.Content.ReadFromJsonAsync<GoogleUserInfo>(
            cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Google did not return account information.");
        if (string.IsNullOrWhiteSpace(user.Subject) || string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("Google did not return an account ID and email.");
        }

        var account = new MailAccount(
            $"google:{user.Subject}",
            ProviderId.Google,
            user.Subject,
            user.Email,
            user.Name,
            string.IsNullOrWhiteSpace(user.Name) ? user.Email : user.Name);
        await SaveTokenAsync(account.Id, token, cancellationToken);
        await _accountStore.UpsertAccountAsync(account, cancellationToken);
        return account;
    }

    public async Task SignOutAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var refreshLock = _refreshLocks.GetOrAdd(accountId, _ => new SemaphoreSlim(1, 1));
        await refreshLock.WaitAsync(cancellationToken);
        try
        {
            var envelope = await ReadTokenAsync(accountId);
            if (!string.IsNullOrWhiteSpace(envelope?.RefreshToken))
            {
                try
                {
                    using var response = await _httpClient.PostAsync(
                        RevokeEndpoint,
                        new FormUrlEncodedContent(new Dictionary<string, string>
                        {
                            ["token"] = envelope.RefreshToken
                        }),
                        cancellationToken);
                }
                catch (HttpRequestException)
                {
                    // Local sign-out still succeeds when token revocation is offline.
                }
            }

            await _tokenStore.DeleteAsync(TokenKey(accountId));
        }
        finally
        {
            refreshLock.Release();
        }
    }

    public async Task<string> GetAccessTokenAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var token = await ReadTokenAsync(accountId)
            ?? throw new InvalidOperationException("This Google account is no longer signed in.");
        if (token.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return token.AccessToken;
        }

        var refreshLock = _refreshLocks.GetOrAdd(accountId, _ => new SemaphoreSlim(1, 1));
        await refreshLock.WaitAsync(cancellationToken);
        try
        {
            token = await ReadTokenAsync(accountId)
                ?? throw new InvalidOperationException("This Google account is no longer signed in.");
            if (token.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
            {
                return token.AccessToken;
            }

            if (string.IsNullOrWhiteSpace(token.RefreshToken))
            {
                throw new InvalidOperationException("Google sign-in must be renewed.");
            }

            var values = new Dictionary<string, string>
            {
                ["client_id"] = _settings.GoogleClientId,
                ["refresh_token"] = token.RefreshToken,
                ["grant_type"] = "refresh_token"
            };
            AddClientSecret(values);
            using var response = await _httpClient.PostAsync(
                TokenEndpoint,
                new FormUrlEncodedContent(values),
                cancellationToken);
            await EnsureSuccessAsync(response, "Google token refresh", cancellationToken);
            var refreshed = await response.Content.ReadFromJsonAsync<GoogleTokenResponse>(
                cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Google did not return a refreshed token.");
            var next = new GoogleTokenEnvelope(
                refreshed.AccessToken,
                token.RefreshToken,
                DateTimeOffset.UtcNow.AddSeconds(refreshed.ExpiresIn),
                refreshed.Scope ?? token.Scope);
            await SaveTokenAsync(accountId, next, cancellationToken);
            return next.AccessToken;
        }
        finally
        {
            refreshLock.Release();
        }
    }

    private async Task<GoogleTokenEnvelope> ExchangeCodeAsync(
        string code,
        string verifier,
        string redirectUri,
        CancellationToken cancellationToken)
    {
        var values = new Dictionary<string, string>
        {
            ["client_id"] = _settings.GoogleClientId,
            ["code"] = code,
            ["code_verifier"] = verifier,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code"
        };
        AddClientSecret(values);
        using var response = await _httpClient.PostAsync(
            TokenEndpoint,
            new FormUrlEncodedContent(values),
            cancellationToken);
        await EnsureSuccessAsync(response, "Google sign-in", cancellationToken);
        var token = await response.Content.ReadFromJsonAsync<GoogleTokenResponse>(
            cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Google did not return an access token.");
        return new GoogleTokenEnvelope(
            token.AccessToken,
            token.RefreshToken ?? string.Empty,
            DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn),
            token.Scope ?? string.Empty);
    }

    private void AddClientSecret(IDictionary<string, string> values)
    {
        if (!string.IsNullOrWhiteSpace(_settings.GoogleClientSecret))
        {
            values["client_secret"] = _settings.GoogleClientSecret;
        }
    }

    private void EnsureConfigured()
    {
        if (ConfigurationError is not null)
        {
            throw new InvalidOperationException(ConfigurationError);
        }
    }

    private async Task<GoogleTokenEnvelope?> ReadTokenAsync(string accountId)
    {
        var value = await _tokenStore.ReadAsync(TokenKey(accountId));
        return value is null ? null : JsonSerializer.Deserialize<GoogleTokenEnvelope>(value);
    }

    private Task SaveTokenAsync(
        string accountId,
        GoogleTokenEnvelope token,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return _tokenStore.SaveAsync(TokenKey(accountId), JsonSerializer.Serialize(token));
    }

    private static string TokenKey(string accountId) => $"google-token:{accountId}";

    private static int ReserveLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string BuildUrl(string baseUrl, IReadOnlyDictionary<string, string> values)
    {
        return baseUrl + "?" + string.Join(
            "&",
            values.Select(pair =>
                $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
    }

    private static async Task WriteBrowserResponseAsync(HttpListenerResponse response, bool success)
    {
        var message = success
            ? "Courrier is connected. You can close this tab."
            : "Courrier could not complete sign-in. Return to the app for details.";
        var content = Encoding.UTF8.GetBytes(
            $"<!doctype html><meta charset=\"utf-8\"><title>Courrier</title><body><h1>{message}</h1></body>");
        response.ContentType = "text/html; charset=utf-8";
        response.ContentLength64 = content.Length;
        await response.OutputStream.WriteAsync(content);
        response.Close();
    }

    private static string Base64Url(byte[] value)
    {
        return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        string operation,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var detail = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            $"{operation} failed with HTTP {(int)response.StatusCode}: {detail}",
            null,
            response.StatusCode);
    }

    private sealed record GoogleTokenEnvelope(
        string AccessToken,
        string RefreshToken,
        DateTimeOffset ExpiresAt,
        string Scope);

    private sealed record GoogleTokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("scope")] string? Scope);

    private sealed record GoogleUserInfo(
        [property: JsonPropertyName("sub")] string Subject,
        [property: JsonPropertyName("email")] string Email,
        [property: JsonPropertyName("name")] string? Name);
}
