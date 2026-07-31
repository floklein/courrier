namespace Courrier.Windows.Models;

public enum ProviderId
{
    Microsoft,
    Google
}

public enum FolderKind
{
    Inbox,
    Drafts,
    Sent,
    Archive,
    Junk,
    Trash,
    Starred,
    Important,
    Folder
}

public enum MailImportance
{
    Low,
    Normal,
    High
}

public enum MailBodyKind
{
    Text,
    Html
}

public enum SearchScope
{
    CurrentFolder,
    AllMail
}

public enum ResponseKind
{
    New,
    Reply,
    ReplyAll,
    Forward
}

[Flags]
public enum MailCapabilities
{
    None = 0,
    Archive = 1,
    Junk = 2,
    Star = 4,
    Flag = 8,
    Important = 16
}

public sealed record MailAccount(
    string Id,
    ProviderId ProviderId,
    string ProviderAccountId,
    string Email,
    string? Name,
    string Label);

public sealed record MailAddress(string Name, string Email)
{
    public string Display => string.IsNullOrWhiteSpace(Name) ? Email : $"{Name} <{Email}>";
}

public sealed record MailFolder(
    string Id,
    string Label,
    FolderKind Kind,
    int UnreadCount,
    int TotalCount,
    string? ParentFolderId = null,
    string? WellKnownName = null,
    bool HasChildren = false,
    int Depth = 0)
{
    public string DisplayLabel => UnreadCount > 0 ? $"{Label}  {UnreadCount}" : Label;
}

public record MailMessageSummary(
    string Id,
    string FolderId,
    MailAddress Sender,
    IReadOnlyList<string> Recipients,
    string Subject,
    string Preview,
    DateTimeOffset ReceivedAt,
    bool IsRead,
    bool HasAttachments,
    MailImportance Importance,
    bool IsStarred = false,
    bool IsFlagged = false,
    bool IsImportant = false,
    string? ThreadId = null,
    string? InternetMessageId = null,
    IReadOnlyList<MailAddress>? ReplyTo = null,
    IReadOnlyList<string>? CcRecipients = null,
    IReadOnlyList<string>? MatchedFolderIds = null,
    string? FolderLabel = null)
{
    public string SenderDisplay => string.IsNullOrWhiteSpace(Sender.Name) ? Sender.Email : Sender.Name;
    public string ReceivedDisplay => ReceivedAt == default
        ? string.Empty
        : ReceivedAt.ToLocalTime().ToString(
            ReceivedAt.ToLocalTime().Date == DateTimeOffset.Now.Date ? "t" : "d");
}

public sealed record MailMessageDetail(
    string Id,
    string FolderId,
    MailAddress Sender,
    IReadOnlyList<string> Recipients,
    string Subject,
    string Preview,
    DateTimeOffset ReceivedAt,
    bool IsRead,
    bool HasAttachments,
    MailImportance Importance,
    MailBodyKind BodyKind,
    string Body,
    IReadOnlyList<MailAttachment> Attachments,
    bool IsStarred = false,
    bool IsFlagged = false,
    bool IsImportant = false,
    string? ThreadId = null,
    string? InternetMessageId = null,
    IReadOnlyList<MailAddress>? ReplyTo = null,
    IReadOnlyList<string>? CcRecipients = null,
    IReadOnlyList<MailInlineImage>? InlineImages = null)
    : MailMessageSummary(
        Id, FolderId, Sender, Recipients, Subject, Preview, ReceivedAt, IsRead,
        HasAttachments, Importance, IsStarred, IsFlagged, IsImportant, ThreadId,
        InternetMessageId, ReplyTo, CcRecipients);

public sealed record MailAttachment(
    string Id,
    string Name,
    string ContentType,
    long Size,
    bool IsInline = false);

public sealed record MailInlineImage(
    string Id,
    string ContentId,
    string ContentType,
    byte[]? Content = null);

public sealed record LocalAttachment(
    string Id,
    string Name,
    string ContentType,
    long Size,
    string Path);

public sealed record MailRecipient(string Email, string? Name = null)
{
    public string Display => string.IsNullOrWhiteSpace(Name) ? Email : $"{Name} <{Email}>";
}

public sealed record PersonSuggestion(string Id, string Name, string Email)
{
    public string Display => string.IsNullOrWhiteSpace(Name) ? Email : $"{Name} <{Email}>";
}

public sealed record PageResult<T>(IReadOnlyList<T> Items, string? NextPageToken = null);

public sealed record SearchRequest(
    string Query,
    SearchScope Scope,
    string? FolderId = null,
    string? NextPageToken = null,
    bool IncludeSpamAndTrash = false);

public sealed record MoveRequest(
    string MessageId,
    string SourceFolderId,
    string DestinationFolderId);

public sealed record ComposeRequest(
    IReadOnlyList<MailRecipient> To,
    IReadOnlyList<MailRecipient> Cc,
    IReadOnlyList<MailRecipient> Bcc,
    string Subject,
    string BodyHtml,
    IReadOnlyList<LocalAttachment> Attachments);

public sealed record ResponseRequest(
    ResponseKind Kind,
    string MessageId,
    IReadOnlyList<MailRecipient> To,
    IReadOnlyList<MailRecipient> Cc,
    IReadOnlyList<MailRecipient> Bcc,
    string BodyHtml,
    IReadOnlyList<LocalAttachment> Attachments);

public sealed record DraftRequest(
    string? ProviderDraftId,
    ResponseKind Kind,
    string? RelatedMessageId,
    IReadOnlyList<MailRecipient> To,
    IReadOnlyList<MailRecipient> Cc,
    IReadOnlyList<MailRecipient> Bcc,
    string Subject,
    string BodyHtml,
    IReadOnlyList<LocalAttachment> Attachments);

public sealed record MailDraft(
    string ProviderDraftId,
    string? ProviderMessageId,
    string AccountId,
    ResponseKind Kind,
    string? RelatedMessageId,
    IReadOnlyList<MailRecipient> To,
    IReadOnlyList<MailRecipient> Cc,
    IReadOnlyList<MailRecipient> Bcc,
    string Subject,
    string BodyHtml,
    IReadOnlyList<MailAttachment> Attachments,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record DownloadedAttachment(string Name, string ContentType, byte[] Content);
