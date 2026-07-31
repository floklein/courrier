using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Courrier.Windows.Models;
using Courrier.Windows.Services.Auth;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Services;

public sealed class RelayLiveUpdateService : IAsyncDisposable
{
    private const string GraphBaseUrl = "https://graph.microsoft.com/v1.0";
    private const string GmailBaseUrl = "https://gmail.googleapis.com/gmail/v1";
    private readonly AppSettings _settings;
    private readonly AccountManager _accounts;
    private readonly IReadOnlyDictionary<ProviderId, IAuthProvider> _authProviders;
    private readonly ProviderApiClient _providerApi;
    private readonly HttpClient _httpClient;
    private readonly ISecureTokenStore _secrets;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _socketGate = new();
    private readonly Dictionary<string, SocketWorker> _socketWorkers = [];
    private readonly string _statePath;
    private Task? _renewalTask;

    public RelayLiveUpdateService(
        AppSettings settings,
        AccountManager accounts,
        IEnumerable<IAuthProvider> authProviders,
        ProviderApiClient providerApi,
        HttpClient httpClient,
        ISecureTokenStore secrets)
    {
        _settings = settings;
        _accounts = accounts;
        _authProviders = authProviders.ToDictionary(provider => provider.Id);
        _providerApi = providerApi;
        _httpClient = httpClient;
        _secrets = secrets;
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Courrier");
        Directory.CreateDirectory(directory);
        _statePath = Path.Combine(directory, "relay-subscriptions.json");
    }

    public bool IsConfigured =>
        Uri.TryCreate(_settings.RelayPublicUrl, UriKind.Absolute, out var relay) &&
        RelayEndpointPolicy.IsAllowed(
            relay,
            _settings.AllowInsecureLoopbackRelayForDevelopment) &&
        !string.IsNullOrWhiteSpace(_settings.RelayAdminToken);

    public event EventHandler<RelayMailChange>? MailChanged;

    public void Start()
    {
        if (!IsConfigured || _renewalTask is not null)
        {
            return;
        }
        _accounts.AccountsChanged += Accounts_Changed;
        _renewalTask = RenewalLoopAsync(_lifetime.Token);
    }

    public async ValueTask DisposeAsync()
    {
        _accounts.AccountsChanged -= Accounts_Changed;
        _lifetime.Cancel();
        SocketWorker[] workers;
        lock (_socketGate)
        {
            workers = _socketWorkers.Values.ToArray();
            _socketWorkers.Clear();
        }
        foreach (var worker in workers)
        {
            worker.Cancellation.Cancel();
        }
        var tasks = workers.Select(worker => worker.Task)
            .Append(_renewalTask ?? Task.CompletedTask)
            .ToArray();
        try
        {
            await Task.WhenAll(tasks);
        }
        catch (OperationCanceledException)
        {
        }
        foreach (var worker in workers)
        {
            worker.Cancellation.Dispose();
        }
        _lifetime.Dispose();
        _refreshGate.Dispose();
        _stateGate.Dispose();
    }

    private void Accounts_Changed(object? sender, EventArgs e)
    {
        _ = RefreshSubscriptionsAsync(_lifetime.Token);
    }

    public async Task RemoveAccountAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        await _refreshGate.WaitAsync(cancellationToken);
        try
        {
            var (accounts, _) = await _accounts.GetSessionAsync(cancellationToken);
            var account = accounts.FirstOrDefault(candidate => candidate.Id == accountId);
            var document = await ReadStateAsync(cancellationToken);
            document.Accounts.TryGetValue(accountId, out var state);
            await StopSocketAsync(accountId);
            if (state is not null)
            {
                await TryUnregisterProviderAsync(account, state, cancellationToken);
                await TryUnregisterRelayAsync(accountId, cancellationToken);
                document.Accounts.Remove(accountId);
                await WriteStateAsync(document, cancellationToken);
            }
            await DeleteAccountSecretsAsync(accountId);
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    private async Task RenewalLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await RefreshSubscriptionsAsync(cancellationToken);
            await Task.Delay(TimeSpan.FromMinutes(30), cancellationToken);
        }
    }

    private async Task RefreshSubscriptionsAsync(CancellationToken cancellationToken)
    {
        if (!await _refreshGate.WaitAsync(0, cancellationToken))
        {
            return;
        }
        try
        {
            var (accounts, _) = await _accounts.GetSessionAsync(cancellationToken);
            var document = await ReadStateAsync(cancellationToken);
            var socketsToStart = new List<string>();
            foreach (var account in accounts)
            {
                var state = document.Accounts.GetValueOrDefault(account.Id)
                    ?? await CreateStateAsync(account.Id);
                if (state.ExpirationAt <= DateTimeOffset.UtcNow.AddHours(2))
                {
                    state = await CreateProviderSubscriptionAsync(account, state, cancellationToken);
                }
                await RegisterWithRelayAsync(account, state, cancellationToken);
                document.Accounts[account.Id] = state;
                if (!HasSocket(account.Id))
                {
                    socketsToStart.Add(account.Id);
                }
            }
            var activeIds = accounts.Select(account => account.Id).ToHashSet();
            foreach (var staleId in document.Accounts.Keys.Where(id => !activeIds.Contains(id)).ToList())
            {
                await StopSocketAsync(staleId);
                await TryUnregisterRelayAsync(staleId, cancellationToken);
                await DeleteAccountSecretsAsync(staleId);
                document.Accounts.Remove(staleId);
            }
            await WriteStateAsync(document, cancellationToken);
            foreach (var accountId in socketsToStart)
            {
                StartSocket(accountId);
            }
        }
        catch (Exception exception) when (
            exception is HttpRequestException or WebSocketException or InvalidOperationException)
        {
            // Polling remains active when relay setup or connectivity fails.
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    private async Task<RelayAccountState> CreateProviderSubscriptionAsync(
        MailAccount account,
        RelayAccountState state,
        CancellationToken cancellationToken)
    {
        var clientState = await _secrets.ReadAsync(ClientStateKey(account.Id))
            ?? throw new InvalidOperationException("Relay client state is unavailable.");
        if (account.ProviderId == ProviderId.Microsoft)
        {
            var notificationUrl = new Uri(new Uri(_settings.RelayPublicUrl), "/graph/notifications");
            var expiresAt = DateTimeOffset.UtcNow.AddDays(2);
            using var request = ProviderApiClient.JsonRequest(
                HttpMethod.Post,
                $"{GraphBaseUrl}/subscriptions",
                new
                {
                    changeType = "created,updated,deleted",
                    notificationUrl = notificationUrl.ToString(),
                    lifecycleNotificationUrl = notificationUrl.ToString(),
                    resource = "me/messages",
                    expirationDateTime = expiresAt.ToString("O"),
                    clientState
                });
            using var response = await _providerApi.SendJsonAsync(
                _authProviders[ProviderId.Microsoft],
                account.Id,
                request,
                cancellationToken);
            return state with
            {
                SubscriptionId = GetString(response.RootElement, "id"),
                ExpirationAt = DateTimeOffset.TryParse(
                    GetString(response.RootElement, "expirationDateTime"),
                    out var serverExpiration)
                    ? serverExpiration
                    : expiresAt
            };
        }

        if (string.IsNullOrWhiteSpace(_settings.GooglePubSubTopic))
        {
            return state with { ExpirationAt = DateTimeOffset.UtcNow.AddMinutes(30) };
        }
        using var watch = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{GmailBaseUrl}/users/me/watch",
            new
            {
                topicName = _settings.GooglePubSubTopic,
                labelIds = new[] { "INBOX" },
                labelFilterBehavior = "include"
            });
        using var watchResponse = await _providerApi.SendJsonAsync(
            _authProviders[ProviderId.Google],
            account.Id,
            watch,
            cancellationToken);
        var expiration = long.TryParse(
            GetString(watchResponse.RootElement, "expiration"),
            out var milliseconds)
            ? DateTimeOffset.FromUnixTimeMilliseconds(milliseconds)
            : DateTimeOffset.UtcNow.AddDays(6);
        return state with
        {
            SubscriptionId = null,
            ExpirationAt = expiration
        };
    }

    private async Task RegisterWithRelayAsync(
        MailAccount account,
        RelayAccountState state,
        CancellationToken cancellationToken)
    {
        var clientState = await _secrets.ReadAsync(ClientStateKey(account.Id))
            ?? throw new InvalidOperationException("Relay client state is unavailable.");
        var authToken = await _secrets.ReadAsync(AuthTokenKey(account.Id))
            ?? throw new InvalidOperationException("Relay authentication is unavailable.");
        var url = new Uri(new Uri(_settings.RelayPublicUrl), "/relay/subscriptions");
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    clientId = state.ClientId,
                    accountId = account.Id,
                    providerId = account.ProviderId == ProviderId.Microsoft ? "microsoft" : "google",
                    accountEmail = account.Email,
                    clientState,
                    authToken,
                    subscriptionId = state.SubscriptionId,
                    expirationDateTime = state.ExpirationAt == default
                        ? null
                        : state.ExpirationAt.ToString("O")
                }),
                Encoding.UTF8,
                "application/json")
        };
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _settings.RelayAdminToken);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task SocketLoopAsync(string accountId, CancellationToken cancellationToken)
    {
        var reconnectDelay = TimeSpan.FromSeconds(2);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var document = await ReadStateAsync(cancellationToken);
                if (!document.Accounts.TryGetValue(accountId, out var state))
                {
                    return;
                }
                var authToken = await _secrets.ReadAsync(AuthTokenKey(accountId));
                if (authToken is null)
                {
                    return;
                }
                using var socket = new ClientWebSocket();
                await socket.ConnectAsync(WebSocketUri(), cancellationToken);
                await SendSocketJsonAsync(socket, new
                {
                    type = "register",
                    clientId = state.ClientId,
                    token = authToken,
                    lastEventId = state.LastEventId
                }, cancellationToken);
                while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                {
                    var text = await ReceiveSocketTextAsync(socket, cancellationToken);
                    if (text is null)
                    {
                        break;
                    }
                    using var message = JsonDocument.Parse(text);
                    if (GetString(message.RootElement, "type") != "mail-change" ||
                        !message.RootElement.TryGetProperty("event", out var change))
                    {
                        continue;
                    }
                    var eventId = GetString(change, "id");
                    var targetAccountId = GetString(change, "accountId") ?? accountId;
                    MailChanged?.Invoke(this, new RelayMailChange(
                        targetAccountId,
                        GetString(change, "messageId"),
                        GetString(change, "kind") ?? "message-change"));
                    if (eventId is null)
                    {
                        continue;
                    }
                    state = state with { LastEventId = eventId };
                    document.Accounts[accountId] = state;
                    await WriteStateAsync(document, cancellationToken);
                    await SendSocketJsonAsync(
                        socket,
                        new { type = "ack", eventId },
                        cancellationToken);
                }
                reconnectDelay = TimeSpan.FromSeconds(2);
            }
            catch (Exception exception) when (
                exception is WebSocketException or HttpRequestException or JsonException)
            {
                await Task.Delay(reconnectDelay, cancellationToken);
                reconnectDelay = TimeSpan.FromSeconds(Math.Min(reconnectDelay.TotalSeconds * 2, 60));
            }
        }
    }

    private bool HasSocket(string accountId)
    {
        lock (_socketGate)
        {
            return _socketWorkers.ContainsKey(accountId);
        }
    }

    private void StartSocket(string accountId)
    {
        SocketWorker worker;
        lock (_socketGate)
        {
            if (_socketWorkers.ContainsKey(accountId))
            {
                return;
            }
            var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            worker = new SocketWorker(
                cancellation,
                SocketLoopAsync(accountId, cancellation.Token));
            _socketWorkers[accountId] = worker;
        }
        _ = ObserveSocketAsync(accountId, worker);
    }

    private async Task ObserveSocketAsync(string accountId, SocketWorker worker)
    {
        try
        {
            await worker.Task;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            lock (_socketGate)
            {
                if (_socketWorkers.TryGetValue(accountId, out var current) &&
                    ReferenceEquals(current, worker))
                {
                    _socketWorkers.Remove(accountId);
                }
            }
            worker.Cancellation.Dispose();
        }
    }

    private async Task StopSocketAsync(string accountId)
    {
        SocketWorker? worker;
        lock (_socketGate)
        {
            if (!_socketWorkers.Remove(accountId, out worker))
            {
                return;
            }
        }
        worker.Cancellation.Cancel();
        try
        {
            await worker.Task;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception) when (
            exception is WebSocketException or HttpRequestException or JsonException)
        {
        }
    }

    private async Task TryUnregisterProviderAsync(
        MailAccount? account,
        RelayAccountState state,
        CancellationToken cancellationToken)
    {
        if (account is null)
        {
            return;
        }
        try
        {
            if (account.ProviderId == ProviderId.Microsoft &&
                !string.IsNullOrWhiteSpace(state.SubscriptionId))
            {
                using var request = new HttpRequestMessage(
                    HttpMethod.Delete,
                    $"{GraphBaseUrl}/subscriptions/{Uri.EscapeDataString(state.SubscriptionId)}");
                await _providerApi.SendAsync(
                    _authProviders[ProviderId.Microsoft],
                    account.Id,
                    request,
                    cancellationToken);
            }
            else if (account.ProviderId == ProviderId.Google)
            {
                using var request = ProviderApiClient.JsonRequest(
                    HttpMethod.Post,
                    $"{GmailBaseUrl}/users/me/stop",
                    new { });
                await _providerApi.SendAsync(
                    _authProviders[ProviderId.Google],
                    account.Id,
                    request,
                    cancellationToken);
            }
        }
        catch (Exception exception) when (
            exception is HttpRequestException or InvalidOperationException)
        {
            // Local sign-out still clears relay access when provider cleanup is offline.
        }
    }

    private async Task TryUnregisterRelayAsync(
        string accountId,
        CancellationToken cancellationToken)
    {
        try
        {
            var url = new Uri(
                new Uri(_settings.RelayPublicUrl),
                $"/relay/subscriptions/{Uri.EscapeDataString(accountId)}");
            using var request = new HttpRequestMessage(HttpMethod.Delete, url);
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", _settings.RelayAdminToken);
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception exception) when (
            exception is HttpRequestException or InvalidOperationException or UriFormatException)
        {
            // Local secrets and state are still removed if relay cleanup is unavailable.
        }
    }

    private async Task DeleteAccountSecretsAsync(string accountId)
    {
        await _secrets.DeleteAsync(AuthTokenKey(accountId));
        await _secrets.DeleteAsync(ClientStateKey(accountId));
    }

    private async Task<RelayAccountState> CreateStateAsync(string accountId)
    {
        var state = new RelayAccountState(Guid.NewGuid().ToString(), null, default, null);
        await _secrets.SaveAsync(AuthTokenKey(accountId), Secret());
        await _secrets.SaveAsync(ClientStateKey(accountId), Secret());
        return state;
    }

    private async Task<RelayStateDocument> ReadStateAsync(CancellationToken cancellationToken)
    {
        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_statePath))
            {
                return new RelayStateDocument();
            }
            await using var stream = File.OpenRead(_statePath);
            return await JsonSerializer.DeserializeAsync<RelayStateDocument>(
                stream,
                cancellationToken: cancellationToken) ?? new RelayStateDocument();
        }
        catch (JsonException)
        {
            return new RelayStateDocument();
        }
        finally
        {
            _stateGate.Release();
        }
    }

    private async Task WriteStateAsync(
        RelayStateDocument document,
        CancellationToken cancellationToken)
    {
        await _stateGate.WaitAsync(cancellationToken);
        try
        {
            var temporary = _statePath + ".tmp";
            await using (var stream = File.Create(temporary))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    document,
                    cancellationToken: cancellationToken);
            }
            File.Move(temporary, _statePath, true);
        }
        finally
        {
            _stateGate.Release();
        }
    }

    private Uri WebSocketUri()
    {
        return RelayEndpointPolicy.WebSocketUri(new Uri(_settings.RelayPublicUrl));
    }

    private static async Task SendSocketJsonAsync(
        ClientWebSocket socket,
        object value,
        CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
        await socket.SendAsync(
            bytes,
            WebSocketMessageType.Text,
            true,
            cancellationToken);
    }

    private static async Task<string?> ReceiveSocketTextAsync(
        ClientWebSocket socket,
        CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }
            await stream.WriteAsync(buffer.AsMemory(0, result.Count), cancellationToken);
            if (result.EndOfMessage)
            {
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
    }

    private static string Secret()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }

    private static string AuthTokenKey(string accountId) => $"relay-auth:{accountId}";
    private static string ClientStateKey(string accountId) => $"relay-client-state:{accountId}";

    private static string? GetString(JsonElement element, string property)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(property, out var value) &&
               value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private sealed record RelayStateDocument
    {
        public Dictionary<string, RelayAccountState> Accounts { get; init; } = [];
    }

    private sealed record RelayAccountState(
        string ClientId,
        string? SubscriptionId,
        DateTimeOffset ExpirationAt,
        string? LastEventId);

    private sealed record SocketWorker(
        CancellationTokenSource Cancellation,
        Task Task);
}

public sealed record RelayMailChange(string AccountId, string? MessageId, string Kind);
