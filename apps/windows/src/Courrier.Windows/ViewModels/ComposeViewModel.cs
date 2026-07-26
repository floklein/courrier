using System.Collections.ObjectModel;
using System.Net;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Courrier.Windows.Models;
using Courrier.Windows.Services;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.ViewModels;

public sealed partial class ComposeViewModel : ObservableObject
{
    private readonly MailService _mail;
    private readonly MailAccount _account;
    private readonly MailHtmlSanitizer _htmlSanitizer;
    private readonly LocalDraftStore _localDrafts;
    private readonly SemaphoreSlim _saveGate = new(1, 1);
    private readonly TaskCompletionSource<bool> _attachmentsReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private CancellationTokenSource? _autosave;
    private Task _scheduledAutosave = Task.CompletedTask;
    private bool _isClosing;
    private bool _isInitializing = true;
    private int _revision;
    private int _lastLocalSavedRevision;
    private int _lastProviderSavedRevision;

    public ComposeViewModel(
        MailService mail,
        MailHtmlSanitizer htmlSanitizer,
        LocalDraftStore localDrafts,
        MailAccount account,
        ResponseKind kind = ResponseKind.New,
        MailMessageDetail? original = null,
        MailDraft? draft = null,
        LocalComposeDraft? localDraft = null)
    {
        _mail = mail;
        _htmlSanitizer = htmlSanitizer;
        _localDrafts = localDrafts;
        _account = account;
        LocalDraftId = localDraft?.LocalDraftId ?? Guid.NewGuid().ToString("N");
        Kind = localDraft?.Kind ?? draft?.Kind ?? kind;
        RelatedMessageId = localDraft?.RelatedMessageId ?? draft?.RelatedMessageId ?? original?.Id;
        ProviderDraftId = localDraft?.ProviderDraftId ?? draft?.ProviderDraftId;
        ToText = localDraft?.ToText ?? (draft is not null
            ? string.Join(", ", draft.To.Select(recipient => recipient.Display))
            : InitialTo(kind, original, account.Email));
        CcText = localDraft?.CcText ?? (draft is not null
            ? string.Join(", ", draft.Cc.Select(recipient => recipient.Display))
            : InitialCc(kind, original, account.Email));
        BccText = localDraft?.BccText ?? (draft is null
            ? string.Empty
            : string.Join(", ", draft.Bcc.Select(recipient => recipient.Display)));
        Subject = localDraft?.Subject ?? draft?.Subject ?? InitialSubject(kind, original);
        BodyHtml = localDraft?.BodyHtml ?? draft?.BodyHtml ?? string.Empty;
        BodyText = localDraft?.BodyText ??
            (draft is null ? string.Empty : HtmlToPlainText(draft.BodyHtml));
        var missingLocalAttachment =
            localDraft?.Attachments.Any(item => !File.Exists(item.Path)) ?? false;
        foreach (var attachment in localDraft?.Attachments.Where(item => File.Exists(item.Path)) ?? [])
        {
            Attachments.Add(attachment);
        }
        hasAttachmentLoadError =
            (localDraft?.AttachmentRestoreIncomplete ?? false) ||
            missingLocalAttachment;
        if (hasAttachmentLoadError)
        {
            errorMessage =
                "Some original attachments could not be recovered. Reopen the original message and forward it again.";
        }
        isLoadingAttachments =
            localDraft is null &&
            (draft?.Attachments.Count > 0 ||
             (draft is null && kind == ResponseKind.Forward && original?.Attachments.Count > 0));
        if (!isLoadingAttachments)
        {
            _attachmentsReady.TrySetResult(true);
        }
        _lastLocalSavedRevision = localDraft is null ? -1 : 0;
        _lastProviderSavedRevision = draft is null ? -1 : 0;
        saveStatus = hasAttachmentLoadError
            ? "Attachment recovery needed"
            : draft is null ? "Not saved" : "Saved";
        SendCommand = new AsyncRelayCommand(SendAsync, CanSend);
        DiscardCommand = new AsyncRelayCommand(DiscardAsync, () => !IsBusy);
        _isInitializing = false;
    }

    public ObservableCollection<LocalAttachment> Attachments { get; } = [];
    public ObservableCollection<PersonSuggestion> Suggestions { get; } = [];

    public ResponseKind Kind { get; }
    public string LocalDraftId { get; }
    public string? RelatedMessageId { get; }
    public string? ProviderDraftId { get; private set; }
    public string WindowTitle => Kind switch
    {
        ResponseKind.Reply => "Reply",
        ResponseKind.ReplyAll => "Reply all",
        ResponseKind.Forward => "Forward",
        _ => "New message"
    };

    public IAsyncRelayCommand SendCommand { get; }
    public IAsyncRelayCommand DiscardCommand { get; }

    [ObservableProperty]
    private string toText = string.Empty;

    [ObservableProperty]
    private string ccText = string.Empty;

    [ObservableProperty]
    private string bccText = string.Empty;

    [ObservableProperty]
    private string subject = string.Empty;

    [ObservableProperty]
    private string bodyText = string.Empty;

    [ObservableProperty]
    private string bodyHtml = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEditingEnabled))]
    private bool isBusy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEditingEnabled))]
    private bool isLoadingAttachments;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEditingEnabled))]
    private bool hasAttachmentLoadError;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string saveStatus = "Not saved";

    public bool IsEditingEnabled => !IsBusy && !IsLoadingAttachments;

    public event EventHandler? CloseRequested;
    public event EventHandler? Sent;

    partial void OnToTextChanged(string value) => DraftChanged();
    partial void OnCcTextChanged(string value) => DraftChanged();
    partial void OnBccTextChanged(string value) => DraftChanged();
    partial void OnSubjectChanged(string value) => DraftChanged();

    partial void OnIsBusyChanged(bool value)
    {
        SendCommand.NotifyCanExecuteChanged();
        DiscardCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsLoadingAttachmentsChanged(bool value) => SendCommand.NotifyCanExecuteChanged();
    partial void OnHasAttachmentLoadErrorChanged(bool value) => SendCommand.NotifyCanExecuteChanged();

    public void AddAttachments(IEnumerable<LocalAttachment> attachments)
    {
        var incoming = attachments.ToList();
        if (Attachments.Count + incoming.Count > 100)
        {
            ErrorMessage = "A message can have at most 100 attachments.";
            return;
        }
        var oversized = incoming.FirstOrDefault(attachment => attachment.Size > 150L * 1024 * 1024);
        if (oversized is not null)
        {
            ErrorMessage = $"{oversized.Name} is larger than 150 MB.";
            return;
        }
        var existing = Attachments.Select(item => item.Path)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var attachment in incoming.Where(item => existing.Add(item.Path)))
        {
            Attachments.Add(attachment);
        }
        DraftChanged();
    }

    public void RemoveAttachment(LocalAttachment attachment)
    {
        Attachments.Remove(attachment);
        DraftChanged();
    }

    public void UpdateBody(string plainText, string html)
    {
        SetProperty(ref bodyText, plainText, nameof(BodyText));
        SetProperty(ref bodyHtml, _htmlSanitizer.SanitizeOutgoing(html), nameof(BodyHtml));
        DraftChanged();
    }

    public async Task LoadProviderAttachmentsAsync(
        MailDraft draft,
        CancellationToken cancellationToken = default)
    {
        if (draft.ProviderMessageId is null && draft.Attachments.Count > 0)
        {
            var exception = new InvalidOperationException(
                "This draft does not expose its attachment message.");
            CompleteAttachmentLoadFailure(exception, "Could not restore draft attachments");
            return;
        }
        await MaterializeAttachmentsAsync(
            draft.ProviderMessageId ?? string.Empty,
            draft.Attachments,
            "Could not restore draft attachments",
            cancellationToken);
    }

    public Task LoadOriginalForwardAttachmentsAsync(
        MailMessageDetail original,
        CancellationToken cancellationToken = default)
    {
        return MaterializeAttachmentsAsync(
            original.Id,
            original.Attachments.Where(attachment => !attachment.IsInline).ToList(),
            "Could not preserve forwarded attachments",
            cancellationToken);
    }

    private async Task MaterializeAttachmentsAsync(
        string messageId,
        IReadOnlyList<MailAttachment> attachments,
        string errorPrefix,
        CancellationToken cancellationToken)
    {
        if (attachments.Count == 0)
        {
            IsLoadingAttachments = false;
            _attachmentsReady.TrySetResult(true);
            return;
        }
        IsLoadingAttachments = true;
        SaveStatus = "Loading attachments";
        try
        {
            if (Attachments.Count + attachments.Count > 100)
            {
                throw new InvalidOperationException("A message can have at most 100 attachments.");
            }
            var oversized = attachments.FirstOrDefault(
                attachment => attachment.Size > 150L * 1024 * 1024);
            if (oversized is not null)
            {
                throw new InvalidOperationException(
                    $"{oversized.Name} is larger than 150 MB.");
            }
            var directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Courrier",
                "DraftAttachments",
                LocalDraftId);
            Directory.CreateDirectory(directory);
            var signatures = Attachments
                .Select(AttachmentSignature)
                .ToHashSet(StringComparer.Ordinal);
            foreach (var attachment in attachments)
            {
                var downloaded = await _mail.DownloadAttachmentAsync(
                    _account.Id,
                    messageId,
                    attachment.Id,
                    cancellationToken);
                var local = new LocalAttachment(
                    Guid.NewGuid().ToString(),
                    attachment.Name,
                    attachment.ContentType,
                    downloaded.Content.LongLength,
                    Path.Combine(
                        directory,
                        $"{Guid.NewGuid():N}-{SafeFileName(attachment.Name)}"));
                if (!signatures.Add(AttachmentSignature(local)))
                {
                    continue;
                }
                await File.WriteAllBytesAsync(local.Path, downloaded.Content, cancellationToken);
                Attachments.Add(local);
            }
            SaveStatus = "Saved";
            HasAttachmentLoadError = false;
            _attachmentsReady.TrySetResult(true);
        }
        catch (Exception exception)
        {
            CompleteAttachmentLoadFailure(exception, errorPrefix);
        }
        finally
        {
            IsLoadingAttachments = false;
        }
    }

    public async Task SuggestAsync(string query, CancellationToken cancellationToken = default)
    {
        if (query.Trim().Length < 2)
        {
            Suggestions.Clear();
            return;
        }
        try
        {
            var people = await _mail.FindPeopleAsync(_account.Id, query.Trim(), cancellationToken);
            Suggestions.Clear();
            foreach (var person in people)
            {
                Suggestions.Add(person);
            }
        }
        catch (HttpRequestException)
        {
            Suggestions.Clear();
        }
    }

    public async Task<bool> FlushDraftForCloseAsync()
    {
        _autosave?.Cancel();
        if (_isClosing)
        {
            return true;
        }
        if (!HasDraftContent())
        {
            _isClosing = true;
            return true;
        }
        try
        {
            await AwaitScheduledAutosaveAsync();
            await SaveLatestAsync();
            _isClosing = true;
            return true;
        }
        catch (Exception exception)
        {
            if (_lastLocalSavedRevision == _revision)
            {
                ErrorMessage =
                    $"Draft saved locally. Provider sync failed: {exception.Message}";
                SaveStatus = "Saved locally";
                _isClosing = true;
                return true;
            }
            ErrorMessage = $"Could not save this draft locally: {exception.Message}";
            SaveStatus = "Save failed";
            return false;
        }
    }

    private bool CanSend()
    {
        return IsEditingEnabled &&
               !HasAttachmentLoadError &&
               RecipientParser.Parse(ToText).Valid.Count > 0;
    }

    private async Task SendAsync()
    {
        _autosave?.Cancel();
        IsBusy = true;
        ErrorMessage = null;
        SaveStatus = "Sending";
        try
        {
            await AwaitScheduledAutosaveAsync();
            await _attachmentsReady.Task;
            await _saveGate.WaitAsync();
            try
            {
                var recipients = ReadRecipients();
                if (recipients is null)
                {
                    SaveStatus = "Not sent";
                    return;
                }
                var draft = await _mail.SaveDraftAsync(
                    _account.Id,
                    CreateDraftRequest(recipients.Value));
                ProviderDraftId = draft.ProviderDraftId;
                await _mail.SendDraftAsync(_account.Id, draft.ProviderDraftId);
                await DeleteLocalRecoveryAsync();
            }
            finally
            {
                _saveGate.Release();
            }
            SaveStatus = "Sent";
            _isClosing = true;
            Sent?.Invoke(this, EventArgs.Empty);
            CloseRequested?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
            SaveStatus = "Send failed";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task DiscardAsync()
    {
        _autosave?.Cancel();
        IsBusy = true;
        try
        {
            await AwaitScheduledAutosaveAsync();
            await _saveGate.WaitAsync();
            try
            {
                if (ProviderDraftId is not null)
                {
                    await _mail.DeleteDraftAsync(_account.Id, ProviderDraftId);
                }
                await DeleteLocalRecoveryAsync();
            }
            finally
            {
                _saveGate.Release();
            }
            _isClosing = true;
            CloseRequested?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void DraftChanged()
    {
        if (_isInitializing)
        {
            return;
        }
        SendCommand.NotifyCanExecuteChanged();
        if (_isClosing || IsBusy)
        {
            return;
        }
        SaveStatus = "Editing";
        var revision = ++_revision;
        _autosave?.Cancel();
        _autosave?.Dispose();
        _autosave = new CancellationTokenSource();
        _scheduledAutosave = AutosaveAfterDelayAsync(revision, _autosave.Token);
    }

    private async Task AutosaveAfterDelayAsync(int revision, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(750), cancellationToken);
            if (HasDraftContent())
            {
                await SaveRevisionAsync(revision);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
            SaveStatus = "Autosave failed";
        }
    }

    private async Task SaveRevisionAsync(int revision)
    {
        await _saveGate.WaitAsync();
        try
        {
            if (revision != _revision)
            {
                return;
            }
            await SaveCoreAsync(revision);
        }
        catch (Exception exception)
        {
            ErrorMessage = exception.Message;
            SaveStatus = _lastLocalSavedRevision == revision
                ? "Saved locally"
                : "Autosave failed";
        }
        finally
        {
            _saveGate.Release();
        }
    }

    private async Task SaveLatestAsync()
    {
        await _saveGate.WaitAsync();
        try
        {
            if (_lastLocalSavedRevision != _revision ||
                _lastProviderSavedRevision != _revision)
            {
                await SaveCoreAsync(_revision);
            }
        }
        finally
        {
            _saveGate.Release();
        }
    }

    private async Task SaveCoreAsync(int revision)
    {
        if (_lastLocalSavedRevision != revision)
        {
            await SaveLocalAsync(revision);
        }
        if (_lastProviderSavedRevision == revision)
        {
            SaveStatus = "Saved";
            return;
        }
        await _attachmentsReady.Task;
        if (HasAttachmentLoadError)
        {
            throw new InvalidOperationException(
                "Original attachments are incomplete, so the provider draft was not changed.");
        }
        var recipients = ReadDraftRecipients();
        SaveStatus = "Saving";
        var draft = await _mail.SaveDraftAsync(
            _account.Id,
            CreateDraftRequest(recipients));
        ProviderDraftId = draft.ProviderDraftId;
        _lastProviderSavedRevision = revision;
        await SaveLocalAsync(revision);
        SaveStatus = "Saved";
    }

    private async Task SaveLocalAsync(int revision)
    {
        await _localDrafts.SaveAsync(new LocalComposeDraft(
            LocalDraftId,
            _account.Id,
            ProviderDraftId,
            Kind,
            RelatedMessageId,
            ToText,
            CcText,
            BccText,
            Subject,
            BodyText,
            BodyHtml,
            Attachments.ToList(),
            HasAttachmentLoadError,
            DateTimeOffset.UtcNow));
        _lastLocalSavedRevision = revision;
    }

    private async Task DeleteLocalRecoveryAsync()
    {
        try
        {
            await _localDrafts.DeleteAsync(LocalDraftId);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            // A sent or discarded provider draft must not be reported as failed by local cleanup.
        }
    }

    private async Task AwaitScheduledAutosaveAsync()
    {
        try
        {
            await _scheduledAutosave;
        }
        catch (OperationCanceledException)
        {
        }
    }

    private (
        IReadOnlyList<MailRecipient> To,
        IReadOnlyList<MailRecipient> Cc,
        IReadOnlyList<MailRecipient> Bcc)? ReadRecipients(bool showErrors = true)
    {
        var to = RecipientParser.Parse(ToText);
        var cc = RecipientParser.Parse(CcText);
        var bcc = RecipientParser.Parse(BccText);
        var invalid = to.Invalid.Concat(cc.Invalid).Concat(bcc.Invalid).FirstOrDefault();
        if (invalid is not null)
        {
            if (showErrors)
            {
                ErrorMessage = $"Check recipient: {invalid}";
            }
            return null;
        }
        if (showErrors && to.Valid.Count == 0)
        {
            ErrorMessage = "Add at least one recipient.";
            return null;
        }
        return (to.Valid, cc.Valid, bcc.Valid);
    }

    private (
        IReadOnlyList<MailRecipient> To,
        IReadOnlyList<MailRecipient> Cc,
        IReadOnlyList<MailRecipient> Bcc) ReadDraftRecipients()
    {
        return (
            RecipientParser.Parse(ToText).Valid,
            RecipientParser.Parse(CcText).Valid,
            RecipientParser.Parse(BccText).Valid);
    }

    private DraftRequest CreateDraftRequest(
        (
            IReadOnlyList<MailRecipient> To,
            IReadOnlyList<MailRecipient> Cc,
            IReadOnlyList<MailRecipient> Bcc) recipients)
    {
        var request = new DraftRequest(
            ProviderDraftId,
            Kind,
            RelatedMessageId,
            recipients.To,
            recipients.Cc,
            recipients.Bcc,
            Subject.Trim(),
            _htmlSanitizer.SanitizeOutgoing(
                string.IsNullOrEmpty(BodyHtml) && !string.IsNullOrEmpty(BodyText)
                    ? PlainTextToHtml(BodyText)
                    : BodyHtml),
            Attachments.ToList());
        Validate(request);
        return request;
    }

    private bool HasDraftContent()
    {
        return !string.IsNullOrWhiteSpace(ToText) ||
               !string.IsNullOrWhiteSpace(CcText) ||
               !string.IsNullOrWhiteSpace(BccText) ||
               !string.IsNullOrWhiteSpace(Subject) ||
               !string.IsNullOrWhiteSpace(BodyText) ||
               Attachments.Count > 0;
    }

    private static string InitialTo(
        ResponseKind kind,
        MailMessageDetail? original,
        string ownEmail)
    {
        if (original is null || kind == ResponseKind.Forward)
        {
            return string.Empty;
        }
        var targets = kind == ResponseKind.ReplyAll
            ? (original.ReplyTo ?? [original.Sender])
                .Append(original.Sender)
                .Select(address => address.Display)
                .Concat(original.Recipients)
            : (original.ReplyTo is { Count: > 0 } ? original.ReplyTo : [original.Sender])
                .Select(address => address.Display);
        return string.Join(
            ", ",
            targets
                .Where(value => !ContainsEmail(value, ownEmail))
                .Distinct(StringComparer.OrdinalIgnoreCase));
    }

    private static string InitialCc(
        ResponseKind kind,
        MailMessageDetail? original,
        string ownEmail)
    {
        return kind == ResponseKind.ReplyAll && original?.CcRecipients is { } cc
            ? string.Join(
                ", ",
                cc.Where(value => !ContainsEmail(value, ownEmail))
                    .Distinct(StringComparer.OrdinalIgnoreCase))
            : string.Empty;
    }

    private static string InitialSubject(ResponseKind kind, MailMessageDetail? original)
    {
        if (original is null)
        {
            return string.Empty;
        }
        var prefix = kind == ResponseKind.Forward ? "Fwd:" : "Re:";
        return original.Subject.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? original.Subject
            : $"{prefix} {original.Subject}";
    }

    private static bool ContainsEmail(string value, string email)
    {
        return value.Contains(email, StringComparison.OrdinalIgnoreCase);
    }

    private static string PlainTextToHtml(string value)
    {
        return WebUtility.HtmlEncode(value)
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal);
    }

    private static string HtmlToPlainText(string value)
    {
        return WebUtility.HtmlDecode(
            System.Text.RegularExpressions.Regex.Replace(
                value.Replace("<br>", "\n", StringComparison.OrdinalIgnoreCase),
                "<[^>]+>",
                string.Empty));
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var result = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(result) ? "attachment" : result;
    }

    private void CompleteAttachmentLoadFailure(Exception exception, string errorPrefix)
    {
        HasAttachmentLoadError = true;
        ErrorMessage = $"{errorPrefix}: {exception.Message}";
        SaveStatus = "Attachment restore failed";
        _attachmentsReady.TrySetException(exception);
    }

    private static string AttachmentSignature(LocalAttachment attachment)
    {
        return $"{attachment.Name}\u001f{attachment.ContentType}\u001f{attachment.Size}";
    }

    private static void Validate(DraftRequest request)
    {
        var recipientCount = request.To.Count + request.Cc.Count + request.Bcc.Count;
        if (recipientCount > 500)
        {
            throw new InvalidOperationException("A message can have at most 500 recipients.");
        }
        if (request.Attachments.Count > 100)
        {
            throw new InvalidOperationException("A message can have at most 100 attachments.");
        }
        if (request.Attachments.Any(attachment => attachment.Size > 150L * 1024 * 1024))
        {
            throw new InvalidOperationException("Each attachment must be 150 MB or smaller.");
        }
        if (request.Subject.Length > 998)
        {
            throw new InvalidOperationException("The subject must be 998 characters or fewer.");
        }
        if (System.Text.Encoding.UTF8.GetByteCount(request.BodyHtml) > 5 * 1024 * 1024)
        {
            throw new InvalidOperationException("The message body must be 5 MB or smaller.");
        }
    }
}
