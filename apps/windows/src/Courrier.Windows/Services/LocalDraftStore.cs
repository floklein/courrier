using System.Text.Json;
using Courrier.Windows.Models;

namespace Courrier.Windows.Services;

public sealed class LocalDraftStore
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _root;

    public LocalDraftStore()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Courrier",
            "ComposeDrafts");
        Directory.CreateDirectory(_root);
    }

    public async Task<LocalComposeDraft> SaveAsync(
        LocalComposeDraft draft,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var directory = DraftDirectory(draft.LocalDraftId);
            var attachmentDirectory = Path.Combine(directory, "attachments");
            Directory.CreateDirectory(attachmentDirectory);
            var persistedAttachments = new List<LocalAttachment>();
            foreach (var attachment in draft.Attachments)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!File.Exists(attachment.Path))
                {
                    throw new FileNotFoundException(
                        $"The draft attachment {attachment.Name} is no longer available.",
                        attachment.Path);
                }
                var destination = Path.Combine(
                    attachmentDirectory,
                    $"{SafeId(attachment.Id)}-{SafeFileName(attachment.Name)}");
                if (!Path.GetFullPath(attachment.Path).Equals(
                        Path.GetFullPath(destination),
                        StringComparison.OrdinalIgnoreCase))
                {
                    var sourceInfo = new FileInfo(attachment.Path);
                    var destinationInfo = new FileInfo(destination);
                    if (!destinationInfo.Exists ||
                        destinationInfo.Length != sourceInfo.Length ||
                        destinationInfo.LastWriteTimeUtc < sourceInfo.LastWriteTimeUtc)
                    {
                        await using var source = File.OpenRead(attachment.Path);
                        await using var target = File.Create(destination);
                        await source.CopyToAsync(target, cancellationToken);
                        File.SetLastWriteTimeUtc(destination, sourceInfo.LastWriteTimeUtc);
                    }
                }
                persistedAttachments.Add(attachment with { Path = destination });
            }

            var persisted = draft with
            {
                Attachments = persistedAttachments,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "draft.json");
            var temporary = path + ".tmp";
            await File.WriteAllTextAsync(
                temporary,
                JsonSerializer.Serialize(persisted),
                cancellationToken);
            File.Move(temporary, path, true);
            return persisted;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<LocalComposeDraft?> LoadForProviderAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            foreach (var path in Directory.EnumerateFiles(
                         _root,
                         "draft.json",
                         SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var draft = JsonSerializer.Deserialize<LocalComposeDraft>(
                        await File.ReadAllTextAsync(path, cancellationToken));
                    if (draft?.AccountId == accountId &&
                        draft.ProviderDraftId == providerDraftId)
                    {
                        return draft;
                    }
                }
                catch (JsonException)
                {
                    // A damaged local recovery file must not block provider drafts.
                }
            }
            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<LocalComposeDraft?> LoadLatestPendingAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var drafts = new List<LocalComposeDraft>();
            foreach (var path in Directory.EnumerateFiles(
                         _root,
                         "draft.json",
                         SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var draft = JsonSerializer.Deserialize<LocalComposeDraft>(
                        await File.ReadAllTextAsync(path, cancellationToken));
                    if (draft?.AccountId == accountId &&
                        string.IsNullOrWhiteSpace(draft.ProviderDraftId))
                    {
                        drafts.Add(draft);
                    }
                }
                catch (JsonException)
                {
                    // A damaged local recovery file must not block other drafts.
                }
            }
            return drafts.OrderByDescending(draft => draft.UpdatedAt).FirstOrDefault();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DeleteAsync(
        string localDraftId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var directory = DraftDirectory(localDraftId);
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private string DraftDirectory(string localDraftId)
    {
        if (!Guid.TryParseExact(localDraftId, "N", out var parsed))
        {
            throw new InvalidOperationException("The local draft ID is invalid.");
        }
        return Path.Combine(_root, parsed.ToString("N"));
    }

    private static string SafeId(string value)
    {
        return Guid.TryParse(value, out var parsed)
            ? parsed.ToString("N")
            : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(value)))[..16];
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var result = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(result) ? "attachment" : result;
    }
}

public sealed record LocalComposeDraft(
    string LocalDraftId,
    string AccountId,
    string? ProviderDraftId,
    ResponseKind Kind,
    string? RelatedMessageId,
    string ToText,
    string CcText,
    string BccText,
    string Subject,
    string BodyText,
    string BodyHtml,
    IReadOnlyList<LocalAttachment> Attachments,
    bool AttachmentRestoreIncomplete,
    DateTimeOffset UpdatedAt);
