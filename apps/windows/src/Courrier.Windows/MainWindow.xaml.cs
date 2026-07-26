using System.ComponentModel;
using System.Text;
using System.Text.Json;
using Courrier.Windows.Models;
using Courrier.Windows.Services;
using Courrier.Windows.Services.Mail;
using Courrier.Windows.ViewModels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;

namespace Courrier.Windows;

public sealed partial class MainWindow : Window
{
    private readonly MailService _mail;
    private readonly PreferenceStore _preferences;
    private readonly RelayLiveUpdateService _relay;
    private readonly BackgroundMailMonitor _monitor;
    private readonly MailHtmlSanitizer _htmlSanitizer;
    private readonly LocalDraftStore _localDrafts;
    private readonly HashSet<ComposeWindow> _composeWindows = [];
    private long _renderGeneration;

    public MainWindow(
        ShellViewModel viewModel,
        MailService mail,
        BackgroundMailMonitor monitor,
        PreferenceStore preferences,
        RelayLiveUpdateService relay,
        MailHtmlSanitizer htmlSanitizer,
        LocalDraftStore localDrafts)
    {
        ViewModel = viewModel;
        _mail = mail;
        _preferences = preferences;
        _relay = relay;
        _monitor = monitor;
        _htmlSanitizer = htmlSanitizer;
        _localDrafts = localDrafts;
        InitializeComponent();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Courrier.ico"));
        RootGrid.RequestedTheme = PreferenceStore.ToTheme(_preferences.Current.Appearance);
        _preferences.Changed += Preferences_Changed;
        ViewModel.PropertyChanged += ViewModel_PropertyChanged;
        ViewModel.SessionChanged += (_, _) => DispatcherQueue.TryEnqueue(UpdateSessionState);
        ViewModel.MessageOpened += (_, message) =>
            DispatcherQueue.TryEnqueue(() => RenderMessageAsync(message));
        monitor.MailChanged += (_, _) =>
            DispatcherQueue.TryEnqueue(async () => await ViewModel.RefreshIfActiveAsync());
        relay.MailChanged += Relay_MailChanged;
        Activated += MainWindow_Activated;
        Closed += MainWindow_Closed;
        _ = InitializeAsync();
    }

    public ShellViewModel ViewModel { get; }

    private async Task InitializeAsync()
    {
        await ViewModel.InitializeAsync();
        UpdateSessionState();
    }

    private void MainWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState != WindowActivationState.Deactivated)
        {
            _ = ViewModel.RefreshIfActiveAsync();
        }
    }

    private void MainWindow_Closed(object sender, WindowEventArgs args)
    {
        ViewModel.PropertyChanged -= ViewModel_PropertyChanged;
        _preferences.Changed -= Preferences_Changed;
        _relay.MailChanged -= Relay_MailChanged;
    }

    private void Relay_MailChanged(object? sender, RelayMailChange change)
    {
        DispatcherQueue.TryEnqueue(async () =>
        {
            await _monitor.CheckNowAsync();
            await ViewModel.RefreshIfActiveAsync();
        });
    }

    private void Preferences_Changed(object? sender, UserPreferences preferences)
    {
        DispatcherQueue.TryEnqueue(() =>
            RootGrid.RequestedTheme = PreferenceStore.ToTheme(preferences.Appearance));
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs args)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            if (args.PropertyName == nameof(ViewModel.ErrorMessage))
            {
                ErrorBar.Message = ViewModel.ErrorMessage ?? string.Empty;
                ErrorBar.IsOpen = ViewModel.ErrorMessage is not null;
                OnboardingError.Message = ViewModel.ErrorMessage ?? string.Empty;
                OnboardingError.IsOpen = ViewModel.ErrorMessage is not null;
            }
            if (args.PropertyName == nameof(ViewModel.IsSignedIn))
            {
                UpdateSessionState();
            }
        });
    }

    private void UpdateSessionState()
    {
        OnboardingGrid.Visibility = ViewModel.IsSignedIn ? Visibility.Collapsed : Visibility.Visible;
        MailGrid.Visibility = ViewModel.IsSignedIn ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void NewMessage_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.SelectedAccount is { } account)
        {
            try
            {
                var pending = await _localDrafts.LoadLatestPendingAsync(account.Id);
                if (pending is not null)
                {
                    var dialog = new ContentDialog
                    {
                        XamlRoot = RootGrid.XamlRoot,
                        Title = "Recover unsynced draft?",
                        Content =
                            "Courrier saved a draft locally because it could not sync with your mail provider.",
                        PrimaryButtonText = "Recover draft",
                        SecondaryButtonText = "Start new message",
                        CloseButtonText = "Cancel",
                        DefaultButton = ContentDialogButton.Primary
                    };
                    var result = await dialog.ShowAsync();
                    if (result == ContentDialogResult.Primary)
                    {
                        OpenComposer(pending.Kind, localDraft: pending);
                        return;
                    }
                    if (result != ContentDialogResult.Secondary)
                    {
                        return;
                    }
                }
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException or JsonException)
            {
                ShowError($"Could not read local draft recovery: {exception.Message}");
            }
        }
        OpenComposer(ResponseKind.New);
    }

    private void Reply_Click(object sender, RoutedEventArgs e)
    {
        OpenComposer(ResponseKind.Reply);
    }

    private void ReplyAll_Click(object sender, RoutedEventArgs e)
    {
        OpenComposer(ResponseKind.ReplyAll);
    }

    private void Forward_Click(object sender, RoutedEventArgs e)
    {
        OpenComposer(ResponseKind.Forward);
    }

    private void OpenComposer(
        ResponseKind kind,
        MailDraft? draft = null,
        LocalComposeDraft? localDraft = null)
    {
        if (ViewModel.SelectedAccount is null ||
            (kind != ResponseKind.New &&
             ViewModel.MessageDetail is null &&
             draft is null &&
             localDraft is null))
        {
            return;
        }
        var original = draft is null && localDraft is null ? ViewModel.MessageDetail : null;
        var viewModel = new ComposeViewModel(
            _mail,
            _htmlSanitizer,
            _localDrafts,
            ViewModel.SelectedAccount,
            kind,
            original,
            draft,
            localDraft);
        var window = new ComposeWindow(viewModel);
        _composeWindows.Add(window);
        window.Closed += (_, _) =>
        {
            _composeWindows.Remove(window);
            _ = ViewModel.RefreshIfActiveAsync();
        };
        window.Activate();
        if (draft is not null && localDraft is null)
        {
            _ = viewModel.LoadProviderAttachmentsAsync(draft);
        }
        else if (draft is null && kind == ResponseKind.Forward && original is not null)
        {
            _ = viewModel.LoadOriginalForwardAttachmentsAsync(original);
        }
    }

    private void FolderList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is MailFolder folder)
        {
            FolderList.SelectedItem = folder;
            ViewModel.SelectedFolder = folder;
        }
    }

    private void MessageList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is MailMessageSummary message)
        {
            ViewModel.SelectedMessage = message;
        }
    }

    private async void MessageList_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (ViewModel.SelectedFolder?.Kind != FolderKind.Drafts ||
            ViewModel.SelectedAccount is null ||
            ViewModel.SelectedMessage is null)
        {
            return;
        }
        try
        {
            var account = ViewModel.SelectedAccount;
            var message = ViewModel.SelectedMessage;
            var drafts = await _mail.GetDraftsAsync(account.Id);
            if (ViewModel.SelectedAccount?.Id != account.Id ||
                ViewModel.SelectedMessage?.Id != message.Id)
            {
                return;
            }
            var draft = drafts.FirstOrDefault(candidate =>
                candidate.ProviderMessageId == message.Id ||
                candidate.ProviderDraftId == message.Id);
            if (draft is not null)
            {
                var localDraft = await _localDrafts.LoadForProviderAsync(
                    account.Id,
                    draft.ProviderDraftId);
                if (ViewModel.SelectedAccount?.Id != account.Id)
                {
                    return;
                }
                OpenComposer(draft.Kind, draft, localDraft);
            }
        }
        catch (Exception exception)
        {
            ShowError(exception.Message);
        }
    }

    private void SearchBox_QuerySubmitted(
        AutoSuggestBox sender,
        AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        ViewModel.SearchText = args.QueryText;
        _ = ViewModel.SearchCommand.ExecuteAsync(null);
    }

    private void SearchScope_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox comboBox &&
            comboBox.SelectedItem is ComboBoxItem item)
        {
            ViewModel.SearchScope = (string?)item.Tag == "All"
                ? SearchScope.AllMail
                : SearchScope.CurrentFolder;
        }
    }

    private void FocusSearch_Click(object sender, RoutedEventArgs e)
    {
        SearchBox.Focus(FocusState.Keyboard);
    }

    private async void Settings_Click(object sender, RoutedEventArgs e)
    {
        var current = _preferences.Current;
        var notifications = new ToggleSwitch
        {
            Header = "Notifications",
            OnContent = "Enabled",
            OffContent = "Disabled",
            IsOn = current.NotificationsEnabled
        };
        var previews = new ToggleSwitch
        {
            Header = "Message previews",
            OnContent = "Show sender, subject, and preview",
            OffContent = "Hide mail content",
            IsOn = current.ShowNotificationPreview
        };
        var silent = new ToggleSwitch
        {
            Header = "Sound",
            OnContent = "Silent",
            OffContent = "Use system sound",
            IsOn = current.SilentNotifications
        };
        var appearance = new ComboBox
        {
            Header = "Appearance",
            HorizontalAlignment = HorizontalAlignment.Stretch,
            ItemsSource = Enum.GetValues<AppearancePreference>(),
            SelectedItem = current.Appearance
        };
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(notifications);
        content.Children.Add(previews);
        content.Children.Add(silent);
        content.Children.Add(appearance);
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = "Courrier settings",
            Content = content,
            PrimaryButtonText = "Save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _preferences.SaveAsync(new UserPreferences
            {
                NotificationsEnabled = notifications.IsOn,
                ShowNotificationPreview = previews.IsOn,
                SilentNotifications = silent.IsOn,
                Appearance = appearance.SelectedItem is AppearancePreference selected
                    ? selected
                    : AppearancePreference.System
            });
        }
    }

    private void MessageList_DragItemsStarting(
        object sender,
        DragItemsStartingEventArgs e)
    {
        var ids = e.Items.OfType<MailMessageSummary>().Select(message => message.Id).ToList();
        if (ids.Count == 0)
        {
            e.Cancel = true;
            return;
        }
        e.Data.SetText(string.Join("\n", ids));
        e.Data.RequestedOperation = DataPackageOperation.Move;
    }

    private async void FolderList_DragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.Text) &&
            FindFolderAt(e.GetPosition(FolderList)) is not null)
        {
            e.AcceptedOperation = DataPackageOperation.Move;
            e.DragUIOverride.Caption = "Move messages";
            e.DragUIOverride.IsCaptionVisible = true;
        }
        await Task.CompletedTask;
    }

    private async void FolderList_Drop(object sender, DragEventArgs e)
    {
        var folder = FindFolderAt(e.GetPosition(FolderList));
        if (folder is null || !e.DataView.Contains(StandardDataFormats.Text))
        {
            return;
        }
        var ids = (await e.DataView.GetTextAsync())
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet();
        var messages = ViewModel.Messages.Where(message => ids.Contains(message.Id)).ToList();
        await ViewModel.MoveMessagesAsync(messages, folder);
    }

    private MailFolder? FindFolderAt(Windows.Foundation.Point point)
    {
        return VisualTreeHelper.FindElementsInHostCoordinates(point, FolderList)
            .OfType<FrameworkElement>()
            .Select(element => element.DataContext)
            .OfType<MailFolder>()
            .FirstOrDefault();
    }

    private IReadOnlyList<MailMessageSummary> SelectedMessages()
    {
        var selected = MessageList.SelectedItems.OfType<MailMessageSummary>().ToList();
        if (selected.Count == 0 && ViewModel.SelectedMessage is not null)
        {
            selected.Add(ViewModel.SelectedMessage);
        }
        return selected;
    }

    private async void ArchiveSelection_Click(object sender, RoutedEventArgs e)
    {
        await ViewModel.ArchiveMessagesAsync(SelectedMessages());
    }

    private async void TrashSelection_Click(object sender, RoutedEventArgs e)
    {
        await ViewModel.TrashMessagesAsync(SelectedMessages());
    }

    private async void ToggleBulkRead_Click(object sender, RoutedEventArgs e)
    {
        var messages = SelectedMessages();
        if (messages.Count > 0)
        {
            await ViewModel.MarkMessagesReadAsync(messages, messages.Any(message => !message.IsRead));
        }
    }

    private async void MoveSelection_Click(object sender, RoutedEventArgs e)
    {
        var messages = SelectedMessages();
        if (messages.Count == 0)
        {
            return;
        }
        var picker = new ComboBox
        {
            Header = "Destination",
            ItemsSource = ViewModel.Folders
                .Where(folder => folder.Id != ViewModel.SelectedFolder?.Id)
                .ToList(),
            DisplayMemberPath = "Label",
            HorizontalAlignment = HorizontalAlignment.Stretch
        };
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = "Move messages",
            Content = picker,
            PrimaryButtonText = "Move",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary &&
            picker.SelectedItem is MailFolder destination)
        {
            await ViewModel.MoveMessagesAsync(messages, destination);
        }
    }

    private async Task RenderMessageAsync(MailMessageDetail? message)
    {
        var generation = Interlocked.Increment(ref _renderGeneration);
        ReadingPlaceholder.Visibility = message is null ? Visibility.Visible : Visibility.Collapsed;
        ReadingContent.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
        if (message is null)
        {
            HtmlBody.NavigateToString("<html></html>");
            TextBody.Text = string.Empty;
            return;
        }
        if (message.BodyKind == MailBodyKind.Text)
        {
            HtmlBody.Visibility = Visibility.Collapsed;
            TextBodyScroller.Visibility = Visibility.Visible;
            TextBody.Text = message.Body;
            return;
        }

        TextBodyScroller.Visibility = Visibility.Collapsed;
        HtmlBody.Visibility = Visibility.Visible;
        await HtmlBody.EnsureCoreWebView2Async();
        HtmlBody.CoreWebView2.Settings.IsScriptEnabled = false;
        HtmlBody.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;
        HtmlBody.CoreWebView2.Settings.IsStatusBarEnabled = false;
        if (generation != Volatile.Read(ref _renderGeneration))
        {
            return;
        }
        HtmlBody.NavigateToString(WrapMessageHtml(
            _htmlSanitizer.SanitizeIncoming(
                message.Body,
                message.InlineImages ?? [])));
    }

    private async void HtmlBody_NavigationStarting(
        Microsoft.UI.Xaml.Controls.WebView2 sender,
        CoreWebView2NavigationStartingEventArgs args)
    {
        if (args.Uri is "about:blank" || args.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        args.Cancel = true;
        if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
            uri.Scheme is "http" or "https")
        {
            await Launcher.LaunchUriAsync(uri);
        }
    }

    private async void Attachment_Open_Click(object sender, RoutedEventArgs e)
    {
        var attachment = (sender as MenuFlyoutItem)?.CommandParameter as MailAttachment;
        if (attachment is null ||
            ViewModel.SelectedAccount is null ||
            ViewModel.MessageDetail is null)
        {
            return;
        }
        try
        {
            var content = await _mail.DownloadAttachmentAsync(
                ViewModel.SelectedAccount.Id,
                ViewModel.MessageDetail.Id,
                attachment.Id);
            var directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Courrier",
                "OpenedAttachments");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, SafeFileName(attachment.Name));
            await File.WriteAllBytesAsync(path, content.Content);
            var file = await StorageFile.GetFileFromPathAsync(path);
            await Launcher.LaunchFileAsync(file);
        }
        catch (Exception exception)
        {
            ShowError(exception.Message);
        }
    }

    private async void Attachment_Save_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as MenuFlyoutItem)?.CommandParameter is not MailAttachment attachment ||
            ViewModel.SelectedAccount is null ||
            ViewModel.MessageDetail is null)
        {
            return;
        }
        try
        {
            var content = await _mail.DownloadAttachmentAsync(
                ViewModel.SelectedAccount.Id,
                ViewModel.MessageDetail.Id,
                attachment.Id);
            var picker = new FileSavePicker
            {
                SuggestedFileName = attachment.Name
            };
            picker.FileTypeChoices.Add("Attachment", [Path.GetExtension(attachment.Name) is { Length: > 0 } extension ? extension : ".bin"]);
            WinRT.Interop.InitializeWithWindow.Initialize(
                picker,
                WinRT.Interop.WindowNative.GetWindowHandle(this));
            var file = await picker.PickSaveFileAsync();
            if (file is not null)
            {
                await File.WriteAllBytesAsync(file.Path, content.Content);
            }
        }
        catch (Exception exception)
        {
            ShowError(exception.Message);
        }
    }

    private void ShowError(string message)
    {
        ErrorBar.Message = message;
        ErrorBar.IsOpen = true;
    }

    private static string WrapMessageHtml(string body)
    {
        var style =
            "html{color-scheme:light dark}body{font-family:'Segoe UI',sans-serif;font-size:14px;line-height:1.55;margin:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin-left:0;padding-left:12px;border-left:2px solid #888}";
        return "<!doctype html><html><head><meta charset=\"utf-8\">" +
               "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'\">" +
               $"<style>{style}</style></head><body>{body}</body></html>";
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var result = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(result) ? "attachment" : result;
    }
}
