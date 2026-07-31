using Courrier.Windows.Services;
using Courrier.Windows.Services.Auth;
using Courrier.Windows.Services.Mail;
using Courrier.Windows.ViewModels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Windows.AppLifecycle;
using Microsoft.UI.Xaml;

namespace Courrier.Windows;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
        Services = ConfigureServices();
    }

    public static IServiceProvider Services { get; private set; } = null!;
    public static MainWindow? MainWindow { get; private set; }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        object? activationData = null;
        try
        {
            activationData = AppInstance.GetCurrent().GetActivatedEventArgs()?.Data;
        }
        catch
        {
            // A regular launch continues when activation metadata is unavailable.
        }
        var notifications = Services.GetRequiredService<NativeNotificationService>();
        MainWindow = Services.GetRequiredService<MainWindow>();
        notifications.OpenRequested += Notifications_OpenRequested;
        try
        {
            notifications.Initialize();
        }
        catch
        {
            // Mail remains available when notifications cannot register.
        }
        try
        {
            notifications.HandleActivationData(activationData);
        }
        catch
        {
            // A malformed notification target does not block launch.
        }

        MainWindow.Closed += (_, _) =>
        {
            notifications.OpenRequested -= Notifications_OpenRequested;
            try
            {
                notifications.Shutdown();
            }
            catch
            {
                // Shutdown continues when notification cleanup is unavailable.
            }
        };
        MainWindow.Activate();
        Services.GetRequiredService<BackgroundMailMonitor>().Start();
        Services.GetRequiredService<RelayLiveUpdateService>().Start();
    }

    private static void Notifications_OpenRequested(
        object? sender,
        (string AccountId, string FolderId, string MessageId) target)
    {
        var window = MainWindow;
        if (window is null)
        {
            return;
        }
        window.DispatcherQueue.TryEnqueue(async () =>
        {
            window.Activate();
            await window.ViewModel.OpenFromNotificationAsync(
                target.AccountId,
                target.FolderId,
                target.MessageId);
        });
    }

    private static ServiceProvider ConfigureServices()
    {
        var services = new ServiceCollection();
        services.AddSingleton(AppSettings.Load());
        services.AddSingleton(new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(45)
        });
        services.AddSingleton<AccountStore>();
        services.AddSingleton<PreferenceStore>();
        services.AddSingleton<LocalDraftStore>();
        services.AddSingleton<ISecureTokenStore, SecureTokenStore>();
        services.AddSingleton<MicrosoftAuthProvider>();
        services.AddSingleton<GoogleAuthProvider>();
        services.AddSingleton<IAuthProvider>(provider =>
            provider.GetRequiredService<MicrosoftAuthProvider>());
        services.AddSingleton<IAuthProvider>(provider =>
            provider.GetRequiredService<GoogleAuthProvider>());
        services.AddSingleton<AccountManager>();
        services.AddSingleton<ProviderApiClient>();
        services.AddSingleton<MailHtmlSanitizer>();
        services.AddSingleton<GraphMailProvider>();
        services.AddSingleton<GmailMailProvider>();
        services.AddSingleton<IMailProvider>(provider =>
            provider.GetRequiredService<GraphMailProvider>());
        services.AddSingleton<IMailProvider>(provider =>
            provider.GetRequiredService<GmailMailProvider>());
        services.AddSingleton<MailService>();
        services.AddSingleton<NativeNotificationService>();
        services.AddSingleton<INotificationService>(provider =>
            provider.GetRequiredService<NativeNotificationService>());
        services.AddSingleton<BackgroundMailMonitor>();
        services.AddSingleton<RelayLiveUpdateService>();
        services.AddSingleton<ShellViewModel>();
        services.AddTransient<MainWindow>();
        return services.BuildServiceProvider();
    }
}
