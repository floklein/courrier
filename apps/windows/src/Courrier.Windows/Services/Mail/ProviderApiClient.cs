using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Courrier.Windows.Services.Mail;

public sealed class ProviderApiClient
{
    private readonly HttpClient _httpClient;

    public ProviderApiClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<JsonDocument> GetJsonAsync(
        IAuthProvider auth,
        string accountId,
        string url,
        IReadOnlyDictionary<string, string>? headers = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        AddHeaders(request, headers);
        return await SendJsonAsync(auth, accountId, request, cancellationToken);
    }

    public async Task<JsonDocument> SendJsonAsync(
        IAuthProvider auth,
        string accountId,
        HttpRequestMessage request,
        CancellationToken cancellationToken = default)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            await auth.GetAccessTokenAsync(accountId, cancellationToken));
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(content))
        {
            return JsonDocument.Parse("{}");
        }
        return JsonDocument.Parse(content);
    }

    public async Task SendAsync(
        IAuthProvider auth,
        string accountId,
        HttpRequestMessage request,
        CancellationToken cancellationToken = default)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            await auth.GetAccessTokenAsync(accountId, cancellationToken));
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HttpResponseMessage> SendPreauthorizedAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken = default)
    {
        if (request.RequestUri is not { Scheme: "https" })
        {
            throw new InvalidOperationException("A provider upload URL must use HTTPS.");
        }
        var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            await EnsureSuccessAsync(response, cancellationToken);
        }
        return response;
    }

    public static HttpRequestMessage JsonRequest(HttpMethod method, string url, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = new StringContent(
                JsonSerializer.Serialize(body),
                Encoding.UTF8,
                "application/json");
        }
        return request;
    }

    private static void AddHeaders(
        HttpRequestMessage request,
        IReadOnlyDictionary<string, string>? headers)
    {
        if (headers is null)
        {
            return;
        }

        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }
    }

    private static async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new ProviderRequestException(
            response.RequestMessage?.RequestUri,
            response.StatusCode,
            content);
    }
}

public sealed class ProviderRequestException : HttpRequestException
{
    public ProviderRequestException(Uri? requestUri, System.Net.HttpStatusCode statusCode, string detail)
        : base(
            $"Mail service request to {requestUri?.Host ?? "provider"} failed with HTTP {(int)statusCode}: {detail}",
            null,
            statusCode)
    {
        RequestUri = requestUri;
        Detail = detail;
    }

    public Uri? RequestUri { get; }
    public string Detail { get; }
}
