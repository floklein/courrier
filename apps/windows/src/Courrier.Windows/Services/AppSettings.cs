using System.Text.Json;

namespace Courrier.Windows.Services;

public sealed record AppSettings
{
    public string MicrosoftClientId { get; init; } = string.Empty;
    public string GoogleClientId { get; init; } = string.Empty;
    public string GoogleClientSecret { get; init; } = string.Empty;
    public string GooglePubSubTopic { get; init; } = string.Empty;
    public string RelayPublicUrl { get; init; } = string.Empty;
    public string RelayAdminToken { get; init; } = string.Empty;
    public bool AllowInsecureLoopbackRelayForDevelopment { get; init; }
    public int NotificationPollingSeconds { get; init; } = 60;

    public static AppSettings Load()
    {
        var candidates = new[]
        {
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Courrier",
                "appsettings.json"),
            Path.Combine(AppContext.BaseDirectory, "appsettings.json")
        };

        var settings = candidates
            .Where(File.Exists)
            .Select(Read)
            .FirstOrDefault(candidate => candidate is not null) ?? new AppSettings();

        return settings with
        {
            MicrosoftClientId = ReadEnvironment("MICROSOFT_CLIENT_ID", settings.MicrosoftClientId),
            GoogleClientId = ReadEnvironment("GOOGLE_CLIENT_ID", settings.GoogleClientId),
            GoogleClientSecret = ReadEnvironment("GOOGLE_CLIENT_SECRET", settings.GoogleClientSecret),
            GooglePubSubTopic = ReadEnvironment("GOOGLE_PUBSUB_TOPIC", settings.GooglePubSubTopic),
            RelayPublicUrl = ReadEnvironment("RELAY_PUBLIC_URL", settings.RelayPublicUrl),
            RelayAdminToken = ReadEnvironment("RELAY_ADMIN_TOKEN", settings.RelayAdminToken),
            AllowInsecureLoopbackRelayForDevelopment = ReadEnvironmentBool(
                "ALLOW_INSECURE_LOOPBACK_RELAY_FOR_DEVELOPMENT",
                settings.AllowInsecureLoopbackRelayForDevelopment)
        };
    }

    private static AppSettings? Read(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<AppSettings>(
                File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string ReadEnvironment(string name, string fallback)
    {
        return Environment.GetEnvironmentVariable(name)?.Trim() is { Length: > 0 } value
            ? value
            : fallback;
    }

    private static bool ReadEnvironmentBool(string name, bool fallback)
    {
        return bool.TryParse(Environment.GetEnvironmentVariable(name), out var value)
            ? value
            : fallback;
    }
}
