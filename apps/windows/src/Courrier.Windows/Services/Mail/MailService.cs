using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Mail;

public sealed class MailService
{
    private readonly IReadOnlyDictionary<ProviderId, IMailProvider> _providers;

    public MailService(IEnumerable<IMailProvider> providers)
    {
        _providers = providers.ToDictionary(provider => provider.Id);
    }

    public IMailProvider GetProvider(string accountId)
    {
        var id = accountId.StartsWith("microsoft:", StringComparison.Ordinal)
            ? ProviderId.Microsoft
            : accountId.StartsWith("google:", StringComparison.Ordinal)
                ? ProviderId.Google
                : throw new InvalidOperationException($"Unknown mail account: {accountId}");
        return _providers[id];
    }

    public Task<IReadOnlyList<MailFolder>> GetFoldersAsync(
        string accountId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).GetFoldersAsync(accountId, cancellationToken);

    public Task<PageResult<MailMessageSummary>> GetMessagesAsync(
        string accountId,
        string folderId,
        string? pageToken = null,
        string? query = null,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).GetMessagesAsync(
            accountId, folderId, pageToken, query, cancellationToken);

    public Task<PageResult<MailMessageSummary>> SearchAsync(
        string accountId,
        SearchRequest request,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SearchAsync(accountId, request, cancellationToken);

    public Task<MailMessageDetail> GetMessageAsync(
        string accountId,
        string folderId,
        string messageId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).GetMessageAsync(
            accountId, folderId, messageId, cancellationToken);

    public Task<IReadOnlyList<PersonSuggestion>> FindPeopleAsync(
        string accountId,
        string? query,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).FindPeopleAsync(accountId, query, cancellationToken);

    public Task<IReadOnlyList<MailDraft>> GetDraftsAsync(
        string accountId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).GetDraftsAsync(accountId, cancellationToken);

    public Task<MailDraft> GetDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).GetDraftAsync(accountId, providerDraftId, cancellationToken);

    public Task<MailDraft> SaveDraftAsync(
        string accountId,
        DraftRequest request,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SaveDraftAsync(accountId, request, cancellationToken);

    public Task DeleteDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).DeleteDraftAsync(accountId, providerDraftId, cancellationToken);

    public Task SendDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SendDraftAsync(accountId, providerDraftId, cancellationToken);

    public Task SendAsync(
        string accountId,
        ComposeRequest request,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SendAsync(accountId, request, cancellationToken);

    public Task RespondAsync(
        string accountId,
        ResponseRequest request,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).RespondAsync(accountId, request, cancellationToken);

    public Task<DownloadedAttachment> DownloadAttachmentAsync(
        string accountId,
        string messageId,
        string attachmentId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).DownloadAttachmentAsync(
            accountId, messageId, attachmentId, cancellationToken);

    public Task MarkReadAsync(
        string accountId,
        string messageId,
        bool isRead,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SetReadStateAsync(accountId, messageId, isRead, cancellationToken);

    public Task MoveAsync(
        string accountId,
        MoveRequest request,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).MoveAsync(accountId, request, cancellationToken);

    public Task TrashAsync(
        string accountId,
        string messageId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).TrashAsync(accountId, messageId, cancellationToken);

    public Task ArchiveAsync(
        string accountId,
        string messageId,
        string folderId,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).ArchiveAsync(accountId, messageId, folderId, cancellationToken);

    public Task SetJunkAsync(
        string accountId,
        string messageId,
        bool isJunk,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SetJunkStateAsync(accountId, messageId, isJunk, cancellationToken);

    public Task SetStarAsync(
        string accountId,
        string messageId,
        bool isStarred,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SetStarStateAsync(accountId, messageId, isStarred, cancellationToken);

    public Task SetFlagAsync(
        string accountId,
        string messageId,
        bool isFlagged,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SetFlagStateAsync(accountId, messageId, isFlagged, cancellationToken);

    public Task SetImportantAsync(
        string accountId,
        string messageId,
        bool isImportant,
        CancellationToken cancellationToken = default) =>
        GetProvider(accountId).SetImportantStateAsync(accountId, messageId, isImportant, cancellationToken);

    public Task BulkMarkReadAsync(
        string accountId,
        IEnumerable<MailMessageSummary> messages,
        bool isRead,
        CancellationToken cancellationToken = default) =>
        Task.WhenAll(messages.Select(message =>
            MarkReadAsync(accountId, message.Id, isRead, cancellationToken)));

    public Task BulkMoveAsync(
        string accountId,
        IEnumerable<MailMessageSummary> messages,
        string destinationFolderId,
        CancellationToken cancellationToken = default) =>
        Task.WhenAll(messages.Select(message =>
            MoveAsync(
                accountId,
                new MoveRequest(message.Id, message.FolderId, destinationFolderId),
                cancellationToken)));

    public Task BulkArchiveAsync(
        string accountId,
        IEnumerable<MailMessageSummary> messages,
        CancellationToken cancellationToken = default) =>
        Task.WhenAll(messages.Select(message =>
            ArchiveAsync(accountId, message.Id, message.FolderId, cancellationToken)));

    public Task BulkTrashAsync(
        string accountId,
        IEnumerable<MailMessageSummary> messages,
        CancellationToken cancellationToken = default) =>
        Task.WhenAll(messages.Select(message =>
            TrashAsync(accountId, message.Id, cancellationToken)));
}

