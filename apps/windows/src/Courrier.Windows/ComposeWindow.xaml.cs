using System.ComponentModel;
using Courrier.Windows.Models;
using Courrier.Windows.Services;
using Courrier.Windows.Services.Mail;
using Courrier.Windows.ViewModels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;

namespace Courrier.Windows;

public sealed partial class ComposeWindow : Window
{
    private bool _settingInitialText = true;
    private bool _allowClose;
    private bool _closeFlushRunning;
    private CancellationTokenSource? _suggestions;

    public ComposeWindow(ComposeViewModel viewModel)
    {
        ViewModel = viewModel;
        InitializeComponent();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Courrier.ico"));
        var preferences = App.Services.GetRequiredService<PreferenceStore>();
        RootGrid.RequestedTheme = PreferenceStore.ToTheme(preferences.Current.Appearance);
        Title = viewModel.WindowTitle;
        ViewModel.PropertyChanged += ViewModel_PropertyChanged;
        ViewModel.CloseRequested += ViewModel_CloseRequested;
        AppWindow.Closing += AppWindow_Closing;
        Closed += ComposeWindow_Closed;
        Activated += ComposeWindow_Activated;
    }

    public ComposeViewModel ViewModel { get; }

    private void ComposeWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (!_settingInitialText)
        {
            return;
        }
        if (string.IsNullOrWhiteSpace(ViewModel.BodyHtml))
        {
            BodyEditor.Document.SetText(TextSetOptions.None, ViewModel.BodyText);
        }
        else
        {
            BodyEditor.Document.SetText(
                TextSetOptions.FormatRtf,
                RichTextHtmlConverter.ToRtf(ViewModel.BodyHtml));
        }
        _settingInitialText = false;
        ToBox.Focus(FocusState.Programmatic);
    }

    private void ComposeWindow_Closed(object sender, WindowEventArgs args)
    {
        ViewModel.PropertyChanged -= ViewModel_PropertyChanged;
        ViewModel.CloseRequested -= ViewModel_CloseRequested;
        AppWindow.Closing -= AppWindow_Closing;
        _suggestions?.Cancel();
    }

    private void ViewModel_CloseRequested(object? sender, EventArgs args)
    {
        _allowClose = true;
        Close();
    }

    private async void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_allowClose)
        {
            return;
        }
        args.Cancel = true;
        if (_closeFlushRunning)
        {
            return;
        }
        _closeFlushRunning = true;
        try
        {
            if (!_settingInitialText)
            {
                SyncBody();
            }
            if (await ViewModel.FlushDraftForCloseAsync())
            {
                _allowClose = true;
                Close();
            }
        }
        finally
        {
            _closeFlushRunning = false;
        }
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName == nameof(ViewModel.ErrorMessage))
        {
            ErrorBar.Message = ViewModel.ErrorMessage ?? string.Empty;
            ErrorBar.IsOpen = ViewModel.ErrorMessage is not null;
        }
    }

    private void BodyEditor_TextChanged(object sender, RoutedEventArgs e)
    {
        if (_settingInitialText)
        {
            return;
        }
        BodyEditor.Document.GetText(TextGetOptions.UseCrlf, out var text);
        ViewModel.UpdateBody(
            text.TrimEnd('\r'),
            RichTextHtmlConverter.ToHtml(BodyEditor.Document));
    }

    private async void Recipient_TextChanged(
        AutoSuggestBox sender,
        AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }
        _suggestions?.Cancel();
        _suggestions?.Dispose();
        _suggestions = new CancellationTokenSource();
        var fragment = sender.Text
            .Split(',', ';')
            .LastOrDefault()?
            .Trim() ?? string.Empty;
        try
        {
            await Task.Delay(200, _suggestions.Token);
            await ViewModel.SuggestAsync(fragment, _suggestions.Token);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void Recipient_SuggestionChosen(
        AutoSuggestBox sender,
        AutoSuggestBoxSuggestionChosenEventArgs args)
    {
        if (args.SelectedItem is not PersonSuggestion suggestion)
        {
            return;
        }
        var current = sender.Text;
        var separator = Math.Max(current.LastIndexOf(','), current.LastIndexOf(';'));
        var prefix = separator >= 0 ? current[..(separator + 1)] + " " : string.Empty;
        sender.Text = prefix + suggestion.Display + ", ";
    }

    private async void Attach_Click(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            ViewMode = PickerViewMode.List
        };
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(
            picker,
            WinRT.Interop.WindowNative.GetWindowHandle(this));
        var files = await picker.PickMultipleFilesAsync();
        ViewModel.AddAttachments(await ToAttachmentsAsync(files));
    }

    private void BodyEditor_DragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
            e.DragUIOverride.Caption = "Attach files";
        }
    }

    private async void BodyEditor_Drop(object sender, DragEventArgs e)
    {
        if (!e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            return;
        }
        var items = await e.DataView.GetStorageItemsAsync();
        ViewModel.AddAttachments(await ToAttachmentsAsync(items.OfType<StorageFile>()));
    }

    private void RemoveAttachment_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: LocalAttachment attachment })
        {
            ViewModel.RemoveAttachment(attachment);
        }
    }

    private async void Discard_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = RootGrid.XamlRoot,
            Title = "Discard this draft?",
            Content = "The draft and its attachments will be removed.",
            PrimaryButtonText = "Discard",
            CloseButtonText = "Keep editing",
            DefaultButton = ContentDialogButton.Close
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await ViewModel.DiscardCommand.ExecuteAsync(null);
        }
    }

    private void Bold_Click(object sender, RoutedEventArgs e)
    {
        BodyEditor.Document.Selection.CharacterFormat.Bold =
            BodyEditor.Document.Selection.CharacterFormat.Bold == FormatEffect.On
                ? FormatEffect.Off
                : FormatEffect.On;
        SyncBody();
        BodyEditor.Focus(FocusState.Programmatic);
    }

    private void Italic_Click(object sender, RoutedEventArgs e)
    {
        BodyEditor.Document.Selection.CharacterFormat.Italic =
            BodyEditor.Document.Selection.CharacterFormat.Italic == FormatEffect.On
                ? FormatEffect.Off
                : FormatEffect.On;
        SyncBody();
        BodyEditor.Focus(FocusState.Programmatic);
    }

    private void Underline_Click(object sender, RoutedEventArgs e)
    {
        BodyEditor.Document.Selection.CharacterFormat.Underline =
            BodyEditor.Document.Selection.CharacterFormat.Underline == UnderlineType.Single
                ? UnderlineType.None
                : UnderlineType.Single;
        SyncBody();
        BodyEditor.Focus(FocusState.Programmatic);
    }

    private void SyncBody()
    {
        BodyEditor.Document.GetText(TextGetOptions.UseCrlf, out var text);
        ViewModel.UpdateBody(
            text.TrimEnd('\r'),
            RichTextHtmlConverter.ToHtml(BodyEditor.Document));
    }

    private static async Task<IReadOnlyList<LocalAttachment>> ToAttachmentsAsync(
        IEnumerable<StorageFile> files)
    {
        var attachments = new List<LocalAttachment>();
        foreach (var file in files)
        {
            var properties = await file.GetBasicPropertiesAsync();
            attachments.Add(new LocalAttachment(
                Guid.NewGuid().ToString(),
                file.Name,
                file.ContentType ?? "application/octet-stream",
                (long)properties.Size,
                file.Path));
        }
        return attachments;
    }
}
