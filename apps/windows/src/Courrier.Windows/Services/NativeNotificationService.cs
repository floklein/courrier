using Courrier.Windows.Models;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace Courrier.Windows.Services;

public sealed class NativeNotificationService : INotificationService
{
    private readonly PreferenceStore _preferences;
    private readonly object _gate = new();
    private readonly object _activationGate = new();
    private readonly Dictionary<string, PendingNotifications> _pending = [];
    private readonly HashSet<string> _seen = [];
    private readonly Queue<(string AccountId, string FolderId, string MessageId)> _pendingActivations = [];
    private EventHandler<(string AccountId, string FolderId, string MessageId)>? _openRequested;
    private bool _registered;

    public NativeNotificationService(PreferenceStore preferences)
    {
        _preferences = preferences;
    }

    public event EventHandler<(string AccountId, string FolderId, string MessageId)>? OpenRequested
    {
        add
        {
            (string AccountId, string FolderId, string MessageId)[] queued;
            lock (_activationGate)
            {
                _openRequested += value;
                queued = _pendingActivations.ToArray();
                _pendingActivations.Clear();
            }
            foreach (var target in queued)
            {
                value?.Invoke(this, target);
            }
        }
        remove
        {
            lock (_activationGate)
            {
                _openRequested -= value;
            }
        }
    }

    public void Initialize()
    {
        var manager = AppNotificationManager.Default;
        manager.NotificationInvoked += OnNotificationInvoked;
        try
        {
            manager.Register();
            _registered = true;
        }
        catch
        {
            manager.NotificationInvoked -= OnNotificationInvoked;
            throw;
        }
    }

    public void HandleActivationData(object? activationData)
    {
        if (activationData is AppNotificationActivatedEventArgs args)
        {
            RouteActivation(args.Argument);
        }
    }

    public void Shutdown()
    {
        if (!_registered)
        {
            return;
        }
        var manager = AppNotificationManager.Default;
        manager.NotificationInvoked -= OnNotificationInvoked;
        manager.Unregister();
        _registered = false;
    }

    public void ShowNewMail(MailAccount account, MailMessageSummary message)
    {
        var preferences = _preferences.Current;
        if (!preferences.NotificationsEnabled)
        {
            return;
        }
        lock (_gate)
        {
            var key = $"{account.Id}:{message.Id}";
            if (!_seen.Add(key))
            {
                return;
            }
            if (_seen.Count > 5_000)
            {
                _seen.Clear();
                _seen.Add(key);
            }
            if (!_pending.TryGetValue(account.Id, out var pending))
            {
                pending = new PendingNotifications(account, [], null);
                _pending[account.Id] = pending;
            }
            pending.Messages.Add(message);
            pending.Timer ??= new Timer(
                _ => Flush(account.Id),
                null,
                TimeSpan.FromSeconds(2),
                Timeout.InfiniteTimeSpan);
        }
    }

    private void Flush(string accountId)
    {
        PendingNotifications? pending;
        lock (_gate)
        {
            if (!_pending.Remove(accountId, out pending))
            {
                return;
            }
        }
        pending.Timer?.Dispose();
        if (pending.Messages.Count == 0)
        {
            return;
        }
        var message = pending.Messages[^1];
        var preferences = _preferences.Current;
        if (!preferences.NotificationsEnabled)
        {
            return;
        }
        var builder = new AppNotificationBuilder()
            .AddArgument("accountId", pending.Account.Id)
            .AddArgument("folderId", message.FolderId)
            .AddArgument("messageId", message.Id)
            .AddText(pending.Messages.Count > 1
                ? $"{pending.Messages.Count} new messages"
                : string.IsNullOrWhiteSpace(message.SenderDisplay)
                    ? "New message"
                    : message.SenderDisplay);
        if (preferences.ShowNotificationPreview)
        {
            if (pending.Messages.Count > 1)
            {
                builder.AddText(pending.Account.Label).AddText($"Latest: {message.Subject}");
            }
            else
            {
                builder.AddText(message.Subject).AddText(message.Preview);
            }
        }
        else
        {
            builder.AddText("New mail received");
        }
        if (preferences.SilentNotifications)
        {
            builder.MuteAudio();
        }
        var notification = builder.BuildNotification();
        AppNotificationManager.Default.Show(notification);
    }

    private void OnNotificationInvoked(
        AppNotificationManager sender,
        AppNotificationActivatedEventArgs args)
    {
        RouteActivation(args.Argument);
    }

    private void RouteActivation(string arguments)
    {
        var accountId = Value(arguments, "accountId");
        var folderId = Value(arguments, "folderId");
        var messageId = Value(arguments, "messageId");
        if (accountId is not null && folderId is not null && messageId is not null)
        {
            EventHandler<(string AccountId, string FolderId, string MessageId)>? handler;
            var target = (accountId, folderId, messageId);
            lock (_activationGate)
            {
                handler = _openRequested;
                if (handler is null)
                {
                    _pendingActivations.Enqueue(target);
                    return;
                }
            }
            handler.Invoke(this, target);
        }
    }

    private static string? Value(string arguments, string name)
    {
        return arguments.Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .Where(parts => Decode(parts[0]) == name)
            .Select(parts => Decode(parts[1]))
            .Where(value => value is not null)
            .FirstOrDefault();
    }

    private static string? Decode(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch (UriFormatException)
        {
            return null;
        }
    }

    private sealed record PendingNotifications(
        MailAccount Account,
        List<MailMessageSummary> Messages,
        Timer? InitialTimer)
    {
        public Timer? Timer { get; set; } = InitialTimer;
    }
}
