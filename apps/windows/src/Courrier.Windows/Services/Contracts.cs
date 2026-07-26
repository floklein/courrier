using Courrier.Windows.Models;

namespace Courrier.Windows.Services;

public interface IAuthProvider
{
    ProviderId Id { get; }
    string DisplayName { get; }
    string? ConfigurationError { get; }
    Task<IReadOnlyList<MailAccount>> GetAccountsAsync(CancellationToken cancellationToken = default);
    Task<MailAccount?> SignInAsync(CancellationToken cancellationToken = default);
    Task SignOutAsync(string accountId, CancellationToken cancellationToken = default);
    Task<string> GetAccessTokenAsync(string accountId, CancellationToken cancellationToken = default);
}

public interface IMailProvider
{
    ProviderId Id { get; }
    MailCapabilities Capabilities { get; }
    Task<IReadOnlyList<MailFolder>> GetFoldersAsync(string accountId, CancellationToken cancellationToken = default);
    Task<PageResult<MailMessageSummary>> GetMessagesAsync(
        string accountId,
        string folderId,
        string? nextPageToken = null,
        string? query = null,
        CancellationToken cancellationToken = default);
    Task<PageResult<MailMessageSummary>> SearchAsync(
        string accountId,
        SearchRequest request,
        CancellationToken cancellationToken = default);
    Task<MailMessageDetail> GetMessageAsync(
        string accountId,
        string folderId,
        string messageId,
        CancellationToken cancellationToken = default);
    Task SetReadStateAsync(string accountId, string messageId, bool isRead, CancellationToken cancellationToken = default);
    Task MoveAsync(string accountId, MoveRequest request, CancellationToken cancellationToken = default);
    Task TrashAsync(string accountId, string messageId, CancellationToken cancellationToken = default);
    Task ArchiveAsync(string accountId, string messageId, string sourceFolderId, CancellationToken cancellationToken = default);
    Task SetJunkStateAsync(string accountId, string messageId, bool isJunk, CancellationToken cancellationToken = default);
    Task SetStarStateAsync(string accountId, string messageId, bool isStarred, CancellationToken cancellationToken = default);
    Task SetFlagStateAsync(string accountId, string messageId, bool isFlagged, CancellationToken cancellationToken = default);
    Task SetImportantStateAsync(string accountId, string messageId, bool isImportant, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PersonSuggestion>> FindPeopleAsync(string accountId, string? query, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<MailDraft>> GetDraftsAsync(string accountId, CancellationToken cancellationToken = default);
    Task<MailDraft> GetDraftAsync(string accountId, string providerDraftId, CancellationToken cancellationToken = default);
    Task<MailDraft> SaveDraftAsync(string accountId, DraftRequest request, CancellationToken cancellationToken = default);
    Task DeleteDraftAsync(string accountId, string providerDraftId, CancellationToken cancellationToken = default);
    Task SendDraftAsync(string accountId, string providerDraftId, CancellationToken cancellationToken = default);
    Task SendAsync(string accountId, ComposeRequest request, CancellationToken cancellationToken = default);
    Task RespondAsync(string accountId, ResponseRequest request, CancellationToken cancellationToken = default);
    Task<DownloadedAttachment> DownloadAttachmentAsync(
        string accountId,
        string messageId,
        string attachmentId,
        CancellationToken cancellationToken = default);
}

public interface ISecureTokenStore
{
    Task SaveAsync(string key, string value);
    Task<string?> ReadAsync(string key);
    Task DeleteAsync(string key);
}

public interface INotificationService
{
    void Initialize();
    void ShowNewMail(MailAccount account, MailMessageSummary message);
}
