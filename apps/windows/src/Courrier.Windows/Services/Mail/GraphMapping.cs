using System.Text.Json;
using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Mail;

public static class GraphMapping
{
    public static MailFolder MapFolder(JsonElement folder, int depth = 0)
    {
        var wellKnown = String(folder, "wellKnownName")?.ToLowerInvariant();
        return new MailFolder(
            String(folder, "id") ?? string.Empty,
            String(folder, "displayName") ?? "Untitled folder",
            MapFolderKind(wellKnown),
            Integer(folder, "unreadItemCount"),
            Integer(folder, "totalItemCount"),
            String(folder, "parentFolderId"),
            wellKnown,
            Integer(folder, "childFolderCount") > 0,
            depth);
    }

    public static MailMessageSummary MapSummary(JsonElement message, string folderId)
    {
        var importance = MapImportance(String(message, "importance"));
        return new MailMessageSummary(
            String(message, "id") ?? string.Empty,
            String(message, "parentFolderId") ?? folderId,
            MapAddress(Property(message, "from"), "Unknown sender"),
            MapAddressList(Property(message, "toRecipients")).Select(address => address.Display).ToList(),
            String(message, "subject") ?? "(No subject)",
            String(message, "bodyPreview") ?? string.Empty,
            Date(message, "receivedDateTime"),
            Boolean(message, "isRead", true),
            Boolean(message, "hasAttachments"),
            importance,
            false,
            String(Property(message, "flag"), "flagStatus") == "flagged",
            importance == MailImportance.High,
            null,
            String(message, "internetMessageId"),
            MapAddressList(Property(message, "replyTo")),
            MapAddressList(Property(message, "ccRecipients")).Select(address => address.Display).ToList());
    }

    public static MailMessageDetail MapDetail(JsonElement message, string folderId)
    {
        var summary = MapSummary(message, folderId);
        var body = Property(message, "body");
        var bodyKind = string.Equals(
            String(body, "contentType"),
            "text",
            StringComparison.OrdinalIgnoreCase)
            ? MailBodyKind.Text
            : MailBodyKind.Html;
        var attachmentItems = Array(message, "attachments")
            .Where(item =>
                String(item, "@odata.type") is null or "#microsoft.graph.fileAttachment")
            .ToList();
        var attachments = attachmentItems
            .Where(item => !Boolean(item, "isInline"))
            .Select(item => new MailAttachment(
                String(item, "id") ?? string.Empty,
                String(item, "name") ?? "attachment",
                String(item, "contentType") ?? "application/octet-stream",
                Long(item, "size"),
                false))
            .Where(attachment => attachment.Id.Length > 0)
            .ToList();
        var inlineImages = attachmentItems
            .Where(item => Boolean(item, "isInline"))
            .Select(item => new MailInlineImage(
                String(item, "id") ?? string.Empty,
                NormalizeContentId(String(item, "contentId")),
                String(item, "contentType") ?? "application/octet-stream",
                DecodeBase64(String(item, "contentBytes"))))
            .Where(image => image.Id.Length > 0 && image.ContentId.Length > 0)
            .ToList();

        return new MailMessageDetail(
            summary.Id,
            summary.FolderId,
            summary.Sender,
            summary.Recipients,
            summary.Subject,
            summary.Preview,
            summary.ReceivedAt,
            summary.IsRead,
            summary.HasAttachments,
            summary.Importance,
            bodyKind,
            String(body, "content") ?? string.Empty,
            attachments,
            summary.IsStarred,
            summary.IsFlagged,
            summary.IsImportant,
            summary.ThreadId,
            summary.InternetMessageId,
            summary.ReplyTo,
            summary.CcRecipients,
            inlineImages);
    }

    public static FolderKind MapFolderKind(string? wellKnownName)
    {
        return wellKnownName?.ToLowerInvariant() switch
        {
            "inbox" => FolderKind.Inbox,
            "drafts" => FolderKind.Drafts,
            "sentitems" => FolderKind.Sent,
            "archive" => FolderKind.Archive,
            "junkemail" => FolderKind.Junk,
            "deleteditems" => FolderKind.Trash,
            _ => FolderKind.Folder
        };
    }

    private static MailImportance MapImportance(string? value)
    {
        return value?.ToLowerInvariant() switch
        {
            "low" => MailImportance.Low,
            "high" => MailImportance.High,
            _ => MailImportance.Normal
        };
    }

    private static MailAddress MapAddress(JsonElement? wrapper, string fallbackName)
    {
        var emailAddress = Property(wrapper, "emailAddress");
        return new MailAddress(
            String(emailAddress, "name") ?? fallbackName,
            String(emailAddress, "address") ?? string.Empty);
    }

    private static IReadOnlyList<MailAddress> MapAddressList(JsonElement? array)
    {
        if (array is not { ValueKind: JsonValueKind.Array })
        {
            return [];
        }

        return array.Value.EnumerateArray()
            .Select(item => MapAddress(item, "Unknown recipient"))
            .ToList();
    }

    private static JsonElement? Property(JsonElement? value, string name)
    {
        return value is { ValueKind: JsonValueKind.Object } element &&
               element.TryGetProperty(name, out var property)
            ? property
            : null;
    }

    private static string? String(JsonElement value, string name) => String(Property(value, name));
    private static string? String(JsonElement? value, string name) => String(Property(value, name));
    private static string? String(JsonElement? value)
    {
        return value is { ValueKind: JsonValueKind.String } element ? element.GetString() : null;
    }

    private static int Integer(JsonElement value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Number } element && element.TryGetInt32(out var number)
            ? number
            : 0;
    }

    private static long Long(JsonElement value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Number } element && element.TryGetInt64(out var number)
            ? number
            : 0;
    }

    private static bool Boolean(JsonElement value, string name, bool fallback = false)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.True }
            ? true
            : property is { ValueKind: JsonValueKind.False }
                ? false
                : fallback;
    }

    private static DateTimeOffset Date(JsonElement value, string name)
    {
        return DateTimeOffset.TryParse(String(value, name), out var parsed)
            ? parsed
            : default;
    }

    private static string NormalizeContentId(string? value)
    {
        return (value ?? string.Empty).Trim().Trim('<', '>');
    }

    private static byte[]? DecodeBase64(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        try
        {
            return Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static IEnumerable<JsonElement> Array(JsonElement value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Array } element
            ? element.EnumerateArray().ToList()
            : [];
    }
}
