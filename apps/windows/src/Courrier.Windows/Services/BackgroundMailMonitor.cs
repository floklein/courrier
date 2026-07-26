using Courrier.Windows.Models;
using Courrier.Windows.Services.Auth;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Services;

public sealed class BackgroundMailMonitor : IAsyncDisposable
{
    private readonly AccountManager _accounts;
    private readonly MailService _mail;
    private readonly INotificationService _notifications;
    private readonly AppSettings _settings;
    private readonly Dictionary<string, HashSet<string>> _knownInboxMessages = [];
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _checkGate = new(1, 1);
    private Task? _monitorTask;

    public BackgroundMailMonitor(
        AccountManager accounts,
        MailService mail,
        INotificationService notifications,
        AppSettings settings)
    {
        _accounts = accounts;
        _mail = mail;
        _notifications = notifications;
        _settings = settings;
    }

    public event EventHandler? MailChanged;

    public void Start()
    {
        _monitorTask ??= MonitorAsync(_lifetime.Token);
    }

    public async Task CheckNowAsync(CancellationToken cancellationToken = default)
    {
        if (!await _checkGate.WaitAsync(0, cancellationToken))
        {
            return;
        }
        try
        {
            await CheckAllAccountsAsync(cancellationToken);
        }
        finally
        {
            _checkGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        if (_monitorTask is not null)
        {
            try
            {
                await _monitorTask;
            }
            catch (OperationCanceledException)
            {
            }
        }
        _lifetime.Dispose();
        _checkGate.Dispose();
    }

    private async Task MonitorAsync(CancellationToken cancellationToken)
    {
        await CheckNowAsync(cancellationToken);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(
            Math.Clamp(_settings.NotificationPollingSeconds, 15, 3600)));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            await CheckNowAsync(cancellationToken);
        }
    }

    private async Task CheckAllAccountsAsync(CancellationToken cancellationToken)
    {
        var (accounts, _) = await _accounts.GetSessionAsync(cancellationToken);
        foreach (var account in accounts)
        {
            try
            {
                var folders = await _mail.GetFoldersAsync(account.Id, cancellationToken);
                var inbox = folders.FirstOrDefault(folder => folder.Kind == FolderKind.Inbox);
                if (inbox is null)
                {
                    continue;
                }
                var page = await _mail.GetMessagesAsync(
                    account.Id,
                    inbox.Id,
                    cancellationToken: cancellationToken);
                var currentIds = page.Items.Select(message => message.Id).ToHashSet();
                if (_knownInboxMessages.TryGetValue(account.Id, out var previous))
                {
                    foreach (var message in page.Items.Where(message =>
                                 !message.IsRead && !previous.Contains(message.Id)))
                    {
                        _notifications.ShowNewMail(account, message);
                    }
                    if (!previous.SetEquals(currentIds))
                    {
                        MailChanged?.Invoke(this, EventArgs.Empty);
                    }
                }
                _knownInboxMessages[account.Id] = currentIds;
            }
            catch (Exception exception) when (
                exception is HttpRequestException or InvalidOperationException)
            {
                // Connectivity and expired sessions are surfaced by the foreground UI.
            }
        }
    }
}
