using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Courrier.Windows.Models;
using Courrier.Windows.Services;
using Courrier.Windows.Services.Auth;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.ViewModels;

public sealed partial class ShellViewModel : ObservableObject
{
    private readonly AccountManager _accounts;
    private readonly MailService _mail;
    private readonly RelayLiveUpdateService _relay;
    private CancellationTokenSource? _accountLoad;
    private CancellationTokenSource? _folderLoad;
    private CancellationTokenSource? _messageLoad;
    private CancellationTokenSource? _messageDetailLoad;
    private CancellationTokenSource? _readDelay;
    private Task _activeAccountLoad = Task.CompletedTask;
    private Task _activeMessageLoad = Task.CompletedTask;
    private long _accountGeneration;
    private long _folderGeneration;
    private long _messageGeneration;
    private long _detailGeneration;
    private int _busyDepth;

    public ShellViewModel(
        AccountManager accounts,
        MailService mail,
        RelayLiveUpdateService relay)
    {
        _accounts = accounts;
        _mail = mail;
        _relay = relay;
        InitializeCommand = new AsyncRelayCommand(InitializeAsync);
        SignInMicrosoftCommand = new AsyncRelayCommand(
            () => SignInAsync(ProviderId.Microsoft),
            () => !IsBusy);
        SignInGoogleCommand = new AsyncRelayCommand(
            () => SignInAsync(ProviderId.Google),
            () => !IsBusy);
        SignOutCommand = new AsyncRelayCommand(SignOutAsync, () => SelectedAccount is not null && !IsBusy);
        RefreshCommand = new AsyncRelayCommand(RefreshAsync, () => SelectedFolder is not null && !IsBusy);
        SearchCommand = new AsyncRelayCommand(SearchAsync, () => SelectedFolder is not null && !IsBusy);
        LoadMoreCommand = new AsyncRelayCommand(LoadMoreAsync, () => NextPageToken is not null && !IsBusy);
        ToggleReadCommand = new AsyncRelayCommand(ToggleReadAsync, () => SelectedMessage is not null && !IsBusy);
        ArchiveCommand = new AsyncRelayCommand(ArchiveAsync, () => SelectedMessage is not null && !IsBusy);
        TrashCommand = new AsyncRelayCommand(TrashAsync, () => SelectedMessage is not null && !IsBusy);
        JunkCommand = new AsyncRelayCommand(JunkAsync, () => SelectedMessage is not null && !IsBusy);
        ToggleStarOrFlagCommand = new AsyncRelayCommand(
            ToggleStarOrFlagAsync,
            () => SelectedMessage is not null && !IsBusy);
        ToggleImportantCommand = new AsyncRelayCommand(
            ToggleImportantAsync,
            () => SelectedMessage is not null && !IsBusy);
    }

    public ObservableCollection<MailAccount> Accounts { get; } = [];
    public ObservableCollection<MailFolder> Folders { get; } = [];
    public ObservableCollection<MailMessageSummary> Messages { get; } = [];

    public IAsyncRelayCommand InitializeCommand { get; }
    public IAsyncRelayCommand SignInMicrosoftCommand { get; }
    public IAsyncRelayCommand SignInGoogleCommand { get; }
    public IAsyncRelayCommand SignOutCommand { get; }
    public IAsyncRelayCommand RefreshCommand { get; }
    public IAsyncRelayCommand SearchCommand { get; }
    public IAsyncRelayCommand LoadMoreCommand { get; }
    public IAsyncRelayCommand ToggleReadCommand { get; }
    public IAsyncRelayCommand ArchiveCommand { get; }
    public IAsyncRelayCommand TrashCommand { get; }
    public IAsyncRelayCommand JunkCommand { get; }
    public IAsyncRelayCommand ToggleStarOrFlagCommand { get; }
    public IAsyncRelayCommand ToggleImportantCommand { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsSignedIn))]
    [NotifyPropertyChangedFor(nameof(AccountLabel))]
    private MailAccount? selectedAccount;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FolderLabel))]
    private MailFolder? selectedFolder;

    [ObservableProperty]
    private MailMessageSummary? selectedMessage;

    [ObservableProperty]
    private MailMessageDetail? messageDetail;

    [ObservableProperty]
    private bool isBusy;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string searchText = string.Empty;

    [ObservableProperty]
    private SearchScope searchScope = SearchScope.CurrentFolder;

    [ObservableProperty]
    private string? nextPageToken;

    [ObservableProperty]
    private string statusText = "Ready";

    public bool IsSignedIn => SelectedAccount is not null;
    public string AccountLabel => SelectedAccount?.Label ?? "No account";
    public string FolderLabel => SelectedFolder?.Label ?? "Mail";
    public MailCapabilities Capabilities =>
        SelectedAccount is null ? MailCapabilities.None : _mail.GetProvider(SelectedAccount.Id).Capabilities;

    public event EventHandler? SessionChanged;
    public event EventHandler<MailMessageDetail?>? MessageOpened;

    partial void OnSelectedAccountChanged(MailAccount? oldValue, MailAccount? newValue)
    {
        NotifyCommands();
        if (oldValue?.Id == newValue?.Id)
        {
            SessionChanged?.Invoke(this, EventArgs.Empty);
            return;
        }
        var generation = Interlocked.Increment(ref _accountGeneration);
        CancelAndDispose(ref _accountLoad);
        CancelAndDispose(ref _folderLoad);
        CancelAndDispose(ref _messageLoad);
        CancelAndDispose(ref _messageDetailLoad);
        CancelAndDispose(ref _readDelay);
        Interlocked.Increment(ref _folderGeneration);
        Interlocked.Increment(ref _messageGeneration);
        Interlocked.Increment(ref _detailGeneration);
        if (newValue is not null)
        {
            _accountLoad = new CancellationTokenSource();
            _activeAccountLoad = ActivateAccountAsync(
                newValue,
                generation,
                _accountLoad.Token);
        }
        else if (newValue is null)
        {
            SelectedFolder = null;
            SelectedMessage = null;
            Folders.Clear();
            Messages.Clear();
            NextPageToken = null;
        }
        SessionChanged?.Invoke(this, EventArgs.Empty);
    }

    partial void OnSelectedFolderChanged(MailFolder? oldValue, MailFolder? newValue)
    {
        NotifyCommands();
        if (oldValue?.Id == newValue?.Id)
        {
            return;
        }
        Interlocked.Increment(ref _folderGeneration);
        CancelAndDispose(ref _messageLoad);
        CancelAndDispose(ref _messageDetailLoad);
        CancelAndDispose(ref _readDelay);
        Interlocked.Increment(ref _messageGeneration);
        Interlocked.Increment(ref _detailGeneration);
        if (newValue is not null)
        {
            SearchText = SearchScope == SearchScope.CurrentFolder ? string.Empty : SearchText;
            _activeMessageLoad = StartMessageLoadAsync();
        }
        else if (newValue is null)
        {
            SelectedMessage = null;
            Messages.Clear();
            NextPageToken = null;
        }
    }

    partial void OnSelectedMessageChanged(MailMessageSummary? oldValue, MailMessageSummary? newValue)
    {
        NotifyCommands();
        var generation = Interlocked.Increment(ref _detailGeneration);
        CancelAndDispose(ref _messageDetailLoad);
        CancelAndDispose(ref _readDelay);
        if (newValue is null)
        {
            MessageDetail = null;
            MessageOpened?.Invoke(this, null);
            return;
        }
        if (SelectedAccount is { } account)
        {
            _messageDetailLoad = new CancellationTokenSource();
            _ = OpenMessageAsync(
                account,
                newValue,
                generation,
                _messageDetailLoad.Token);
        }
    }

    partial void OnIsBusyChanged(bool value)
    {
        NotifyCommands();
    }

    public async Task InitializeAsync()
    {
        await RunAsync(async () =>
        {
            var (accounts, active) = await _accounts.GetSessionAsync();
            Replace(Accounts, accounts);
            if (active is not null)
            {
                SelectedAccount = Accounts.First(account => account.Id == active.Id);
            }
            else
            {
                SessionChanged?.Invoke(this, EventArgs.Empty);
            }
        }, "Loading accounts");
    }

    public async Task OpenFromNotificationAsync(
        string accountId,
        string folderId,
        string messageId)
    {
        var account = Accounts.FirstOrDefault(candidate => candidate.Id == accountId);
        if (account is null)
        {
            await InitializeAsync();
            account = Accounts.FirstOrDefault(candidate => candidate.Id == accountId);
        }
        if (account is null)
        {
            return;
        }
        SelectedAccount = account;
        await _activeAccountLoad;
        var folder = Folders.FirstOrDefault(candidate => candidate.Id == folderId)
            ?? Folders.FirstOrDefault(candidate => candidate.Kind == FolderKind.Inbox);
        if (folder is null)
        {
            return;
        }
        SelectedFolder = folder;
        await _activeMessageLoad;
        SelectedMessage = Messages.FirstOrDefault(candidate => candidate.Id == messageId);
    }

    public async Task MoveMessagesAsync(
        IReadOnlyList<MailMessageSummary> messages,
        MailFolder destination)
    {
        if (SelectedAccount is null || messages.Count == 0)
        {
            return;
        }
        await RunAsync(async () =>
        {
            await _mail.BulkMoveAsync(SelectedAccount.Id, messages, destination.Id);
            RemoveMessages(messages);
            await RefreshFoldersAsync();
        }, $"Moving {messages.Count} message{(messages.Count == 1 ? string.Empty : "s")}");
    }

    public async Task ArchiveMessagesAsync(IReadOnlyList<MailMessageSummary> messages)
    {
        if (SelectedAccount is null || messages.Count == 0)
        {
            return;
        }
        await RunAsync(async () =>
        {
            await _mail.BulkArchiveAsync(SelectedAccount.Id, messages);
            RemoveMessages(messages);
            await RefreshFoldersAsync();
        }, "Archiving messages");
    }

    public async Task TrashMessagesAsync(IReadOnlyList<MailMessageSummary> messages)
    {
        if (SelectedAccount is null || messages.Count == 0)
        {
            return;
        }
        await RunAsync(async () =>
        {
            await _mail.BulkTrashAsync(SelectedAccount.Id, messages);
            RemoveMessages(messages);
            await RefreshFoldersAsync();
        }, "Moving messages to Trash");
    }

    public async Task MarkMessagesReadAsync(
        IReadOnlyList<MailMessageSummary> messages,
        bool isRead)
    {
        if (SelectedAccount is null || messages.Count == 0)
        {
            return;
        }
        await RunAsync(async () =>
        {
            await _mail.BulkMarkReadAsync(SelectedAccount.Id, messages, isRead);
            ReplaceMessages(messages.Select(message => message with { IsRead = isRead }));
        }, isRead ? "Marking messages read" : "Marking messages unread");
    }

    public Task RefreshIfActiveAsync()
    {
        return IsBusy || SelectedFolder is null ? Task.CompletedTask : RefreshAsync();
    }

    private async Task SignInAsync(ProviderId providerId)
    {
        await RunAsync(async () =>
        {
            var account = await _accounts.SignInAsync(providerId);
            if (account is null)
            {
                return;
            }
            var (accounts, _) = await _accounts.GetSessionAsync();
            Replace(Accounts, accounts);
            SelectedAccount = Accounts.First(candidate => candidate.Id == account.Id);
        }, $"Signing in with {providerId}");
    }

    private async Task SignOutAsync()
    {
        if (SelectedAccount is null)
        {
            return;
        }
        var accountId = SelectedAccount.Id;
        await RunAsync(async () =>
        {
            await _relay.RemoveAccountAsync(accountId);
            await _accounts.SignOutAsync(accountId);
            var (accounts, active) = await _accounts.GetSessionAsync();
            SelectedAccount = null;
            Replace(Accounts, accounts);
            SelectedAccount = active is null
                ? null
                : Accounts.First(account => account.Id == active.Id);
            if (SelectedAccount is null)
            {
                Folders.Clear();
                Messages.Clear();
                SessionChanged?.Invoke(this, EventArgs.Empty);
            }
        }, "Signing out");
    }

    private async Task ActivateAccountAsync(
        MailAccount account,
        long generation,
        CancellationToken cancellationToken)
    {
        await RunAsync(async () =>
        {
            await _accounts.SwitchAsync(account.Id, cancellationToken);
            if (!IsCurrentAccount(account.Id, generation))
            {
                return;
            }
            SelectedMessage = null;
            SelectedFolder = null;
            Messages.Clear();
            NextPageToken = null;
            var folderGeneration = Interlocked.Increment(ref _folderGeneration);
            CancelAndDispose(ref _folderLoad);
            _folderLoad = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var folders = await _mail.GetFoldersAsync(account.Id, _folderLoad.Token);
            if (!IsCurrentAccount(account.Id, generation) ||
                folderGeneration != Volatile.Read(ref _folderGeneration))
            {
                return;
            }
            Replace(Folders, folders);
            SelectedFolder = Folders.FirstOrDefault(folder => folder.Kind == FolderKind.Inbox)
                ?? Folders.FirstOrDefault();
            OnPropertyChanged(nameof(Capabilities));
        }, $"Opening {account.Email}");
    }

    private async Task RefreshFoldersAsync(CancellationToken cancellationToken = default)
    {
        if (SelectedAccount is null)
        {
            return;
        }
        var accountId = SelectedAccount.Id;
        var accountGeneration = Volatile.Read(ref _accountGeneration);
        var currentId = SelectedFolder?.Id;
        var folders = await _mail.GetFoldersAsync(accountId, cancellationToken);
        if (!IsCurrentAccount(accountId, accountGeneration))
        {
            return;
        }
        Replace(Folders, folders);
        if (currentId is not null)
        {
            selectedFolder = Folders.FirstOrDefault(folder => folder.Id == currentId);
            OnPropertyChanged(nameof(SelectedFolder));
            OnPropertyChanged(nameof(FolderLabel));
        }
    }

    private Task StartMessageLoadAsync()
    {
        if (SelectedAccount is null || SelectedFolder is null)
        {
            return Task.CompletedTask;
        }
        CancelAndDispose(ref _messageLoad);
        _messageLoad = new CancellationTokenSource();
        var generation = Interlocked.Increment(ref _messageGeneration);
        return LoadMessagesAsync(
            SelectedAccount,
            SelectedFolder,
            Volatile.Read(ref _accountGeneration),
            Volatile.Read(ref _folderGeneration),
            generation,
            SearchText,
            SearchScope,
            _messageLoad.Token);
    }

    private async Task LoadMessagesAsync(
        MailAccount account,
        MailFolder folder,
        long accountGeneration,
        long folderGeneration,
        long messageGeneration,
        string searchText,
        SearchScope searchScope,
        CancellationToken cancellationToken)
    {
        await RunAsync(async () =>
        {
            SelectedMessage = null;
            var page = string.IsNullOrWhiteSpace(searchText)
                ? await _mail.GetMessagesAsync(
                    account.Id,
                    folder.Id,
                    cancellationToken: cancellationToken)
                : await _mail.SearchAsync(
                    account.Id,
                    new SearchRequest(
                        searchText,
                        searchScope,
                        folder.Id,
                        IncludeSpamAndTrash: searchScope == SearchScope.AllMail),
                    cancellationToken);
            if (!IsCurrentMessageLoad(
                    account.Id,
                    folder.Id,
                    accountGeneration,
                    folderGeneration,
                    messageGeneration))
            {
                return;
            }
            Replace(Messages, page.Items);
            NextPageToken = page.NextPageToken;
        }, $"Loading {folder.Label}");
    }

    private Task RefreshAsync()
    {
        _activeMessageLoad = StartMessageLoadAsync();
        return _activeMessageLoad;
    }

    private Task SearchAsync()
    {
        _activeMessageLoad = StartMessageLoadAsync();
        return _activeMessageLoad;
    }

    private async Task LoadMoreAsync()
    {
        if (SelectedAccount is null || SelectedFolder is null || NextPageToken is null)
        {
            return;
        }
        var account = SelectedAccount;
        var folder = SelectedFolder;
        var nextPageToken = NextPageToken;
        var searchText = SearchText;
        var searchScope = SearchScope;
        var accountGeneration = Volatile.Read(ref _accountGeneration);
        var folderGeneration = Volatile.Read(ref _folderGeneration);
        CancelAndDispose(ref _messageLoad);
        _messageLoad = new CancellationTokenSource();
        var messageGeneration = Interlocked.Increment(ref _messageGeneration);
        var cancellationToken = _messageLoad.Token;
        _activeMessageLoad = RunAsync(async () =>
        {
            var page = string.IsNullOrWhiteSpace(searchText)
                ? await _mail.GetMessagesAsync(
                    account.Id,
                    folder.Id,
                    nextPageToken,
                    cancellationToken: cancellationToken)
                : await _mail.SearchAsync(
                    account.Id,
                    new SearchRequest(
                        searchText,
                        searchScope,
                        folder.Id,
                        nextPageToken,
                        searchScope == SearchScope.AllMail),
                    cancellationToken);
            if (!IsCurrentMessageLoad(
                    account.Id,
                    folder.Id,
                    accountGeneration,
                    folderGeneration,
                    messageGeneration))
            {
                return;
            }
            foreach (var message in page.Items.Where(item =>
                         Messages.All(existing => existing.Id != item.Id)))
            {
                Messages.Add(message);
            }
            NextPageToken = page.NextPageToken;
        }, "Loading more messages");
        await _activeMessageLoad;
    }

    private async Task OpenMessageAsync(
        MailAccount account,
        MailMessageSummary message,
        long generation,
        CancellationToken cancellationToken)
    {
        var accountId = account.Id;
        try
        {
            StatusText = "Loading message";
            var detail = await _mail.GetMessageAsync(
                accountId,
                message.FolderId,
                message.Id,
                cancellationToken);
            if (!IsCurrentDetail(accountId, message.Id, generation))
            {
                return;
            }
            MessageDetail = detail;
            MessageOpened?.Invoke(this, detail);
            StatusText = "Ready";
            if (!detail.IsRead)
            {
                _readDelay = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                await Task.Delay(TimeSpan.FromSeconds(3), _readDelay.Token);
                if (IsCurrentDetail(accountId, message.Id, generation))
                {
                    await _mail.MarkReadAsync(accountId, message.Id, true, _readDelay.Token);
                    UpdateSelected(message with { IsRead = true });
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
            StatusText = "Could not open message";
        }
    }

    private Task ToggleReadAsync()
    {
        return SelectedMessage is null
            ? Task.CompletedTask
            : SetSelectedReadAsync(!SelectedMessage.IsRead);
    }

    private async Task SetSelectedReadAsync(bool isRead)
    {
        if (SelectedAccount is null || SelectedMessage is null)
        {
            return;
        }
        var message = SelectedMessage;
        await RunAsync(async () =>
        {
            await _mail.MarkReadAsync(SelectedAccount.Id, message.Id, isRead);
            UpdateSelected(message with { IsRead = isRead });
        }, isRead ? "Marking read" : "Marking unread");
    }

    private Task ArchiveAsync()
    {
        return SelectedMessage is null
            ? Task.CompletedTask
            : ArchiveMessagesAsync([SelectedMessage]);
    }

    private Task TrashAsync()
    {
        return SelectedMessage is null
            ? Task.CompletedTask
            : TrashMessagesAsync([SelectedMessage]);
    }

    private async Task JunkAsync()
    {
        if (SelectedAccount is null || SelectedMessage is null)
        {
            return;
        }
        var message = SelectedMessage;
        var isInJunk = SelectedFolder?.Kind == FolderKind.Junk;
        await RunAsync(async () =>
        {
            await _mail.SetJunkAsync(SelectedAccount.Id, message.Id, !isInJunk);
            Messages.Remove(message);
            SelectedMessage = null;
            await RefreshFoldersAsync();
        }, isInJunk ? "Moving to Inbox" : "Moving to Junk");
    }

    private async Task ToggleStarOrFlagAsync()
    {
        if (SelectedAccount is null || SelectedMessage is null)
        {
            return;
        }
        var message = SelectedMessage;
        await RunAsync(async () =>
        {
            if (SelectedAccount.ProviderId == ProviderId.Google)
            {
                await _mail.SetStarAsync(SelectedAccount.Id, message.Id, !message.IsStarred);
                UpdateSelected(message with { IsStarred = !message.IsStarred });
            }
            else
            {
                await _mail.SetFlagAsync(SelectedAccount.Id, message.Id, !message.IsFlagged);
                UpdateSelected(message with { IsFlagged = !message.IsFlagged });
            }
        }, SelectedAccount.ProviderId == ProviderId.Google ? "Updating star" : "Updating flag");
    }

    private async Task ToggleImportantAsync()
    {
        if (SelectedAccount is null || SelectedMessage is null)
        {
            return;
        }
        var message = SelectedMessage;
        await RunAsync(async () =>
        {
            await _mail.SetImportantAsync(
                SelectedAccount.Id,
                message.Id,
                !message.IsImportant);
            UpdateSelected(message with
            {
                IsImportant = !message.IsImportant,
                Importance = message.IsImportant ? MailImportance.Normal : MailImportance.High
            });
        }, "Updating importance");
    }

    private void UpdateSelected(MailMessageSummary updated)
    {
        var index = Messages.IndexOf(Messages.First(message => message.Id == updated.Id));
        Messages[index] = updated;
        SelectedMessage = updated;
        if (MessageDetail?.Id == updated.Id)
        {
            MessageDetail = MessageDetail with
            {
                IsRead = updated.IsRead,
                IsStarred = updated.IsStarred,
                IsFlagged = updated.IsFlagged,
                IsImportant = updated.IsImportant,
                Importance = updated.Importance
            };
            MessageOpened?.Invoke(this, MessageDetail);
        }
    }

    private void ReplaceMessages(IEnumerable<MailMessageSummary> replacements)
    {
        foreach (var replacement in replacements)
        {
            var existing = Messages.FirstOrDefault(message => message.Id == replacement.Id);
            if (existing is not null)
            {
                Messages[Messages.IndexOf(existing)] = replacement;
            }
        }
    }

    private void RemoveMessages(IEnumerable<MailMessageSummary> messages)
    {
        var ids = messages.Select(message => message.Id).ToHashSet();
        foreach (var candidate in Messages.Where(message => ids.Contains(message.Id)).ToList())
        {
            Messages.Remove(candidate);
        }
        if (SelectedMessage is not null && ids.Contains(SelectedMessage.Id))
        {
            SelectedMessage = null;
        }
    }

    private async Task RunAsync(Func<Task> action, string status)
    {
        _busyDepth++;
        if (_busyDepth == 1)
        {
            IsBusy = true;
            ErrorMessage = null;
        }
        StatusText = status;
        try
        {
            await action();
            StatusText = "Ready";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Canceled";
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
            StatusText = "Action failed";
        }
        finally
        {
            _busyDepth--;
            if (_busyDepth == 0)
            {
                IsBusy = false;
            }
        }
    }

    private bool IsCurrentAccount(string accountId, long generation)
    {
        return SelectedAccount?.Id == accountId &&
               generation == Volatile.Read(ref _accountGeneration);
    }

    private bool IsCurrentMessageLoad(
        string accountId,
        string folderId,
        long accountGeneration,
        long folderGeneration,
        long messageGeneration)
    {
        return IsCurrentAccount(accountId, accountGeneration) &&
               SelectedFolder?.Id == folderId &&
               folderGeneration == Volatile.Read(ref _folderGeneration) &&
               messageGeneration == Volatile.Read(ref _messageGeneration);
    }

    private bool IsCurrentDetail(string accountId, string messageId, long generation)
    {
        return SelectedAccount?.Id == accountId &&
               SelectedMessage?.Id == messageId &&
               generation == Volatile.Read(ref _detailGeneration);
    }

    private static void CancelAndDispose(ref CancellationTokenSource? source)
    {
        source?.Cancel();
        source?.Dispose();
        source = null;
    }

    private void NotifyCommands()
    {
        SignInMicrosoftCommand.NotifyCanExecuteChanged();
        SignInGoogleCommand.NotifyCanExecuteChanged();
        SignOutCommand.NotifyCanExecuteChanged();
        RefreshCommand.NotifyCanExecuteChanged();
        SearchCommand.NotifyCanExecuteChanged();
        LoadMoreCommand.NotifyCanExecuteChanged();
        ToggleReadCommand.NotifyCanExecuteChanged();
        ArchiveCommand.NotifyCanExecuteChanged();
        TrashCommand.NotifyCanExecuteChanged();
        JunkCommand.NotifyCanExecuteChanged();
        ToggleStarOrFlagCommand.NotifyCanExecuteChanged();
        ToggleImportantCommand.NotifyCanExecuteChanged();
    }

    private static void Replace<T>(ObservableCollection<T> collection, IEnumerable<T> items)
    {
        collection.Clear();
        foreach (var item in items)
        {
            collection.Add(item);
        }
    }
}
