using System.Text.Json;
using Microsoft.UI.Xaml;

namespace Courrier.Windows.Services;

public enum AppearancePreference
{
    System,
    Light,
    Dark
}

public sealed record UserPreferences
{
    public bool NotificationsEnabled { get; init; } = true;
    public bool ShowNotificationPreview { get; init; } = true;
    public bool SilentNotifications { get; init; }
    public AppearancePreference Appearance { get; init; } = AppearancePreference.System;
}

public sealed class PreferenceStore
{
    private readonly string _path;
    private readonly object _gate = new();

    public PreferenceStore()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Courrier");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "preferences.json");
        Current = Load();
    }

    public UserPreferences Current { get; private set; }
    public event EventHandler<UserPreferences>? Changed;

    public async Task SaveAsync(UserPreferences preferences)
    {
        var json = JsonSerializer.Serialize(
            preferences,
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
        await File.WriteAllTextAsync(_path, json);
        lock (_gate)
        {
            Current = preferences;
        }
        Changed?.Invoke(this, preferences);
    }

    public static ElementTheme ToTheme(AppearancePreference appearance)
    {
        return appearance switch
        {
            AppearancePreference.Light => ElementTheme.Light,
            AppearancePreference.Dark => ElementTheme.Dark,
            _ => ElementTheme.Default
        };
    }

    private UserPreferences Load()
    {
        try
        {
            return File.Exists(_path)
                ? JsonSerializer.Deserialize<UserPreferences>(
                    File.ReadAllText(_path),
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new UserPreferences()
                : new UserPreferences();
        }
        catch (Exception exception) when (exception is IOException or JsonException)
        {
            return new UserPreferences();
        }
    }
}

