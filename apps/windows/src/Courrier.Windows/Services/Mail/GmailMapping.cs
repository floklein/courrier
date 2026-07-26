using System.Text;
using System.Text.Json;
using Courrier.Windows.Models;
using MimeKit;

namespace Courrier.Windows.Services.Mail;

public static class GmailMapping
{
    private static readonly HashSet<string> HiddenSystemLabels =
    [
        "CHAT",
        "UNREAD"
    ];

    public static bool IsVisibleLabel(string id)
    {
        return !HiddenSystemLabels.Contains(id);
    }

    public static MailFolder MapLabel(JsonElement label)
    {
        var id = String(label, "id") ?? string.Empty;
        var name = String(label, "name") ?? id;
        var (displayName, kind, wellKnown) = id switch
        {
            "INBOX" => ("Inbox", FolderKind.Inbox, "inbox"),
            "DRAFT" => ("Drafts", FolderKind.Drafts, "drafts"),
            "SENT" => ("Sent", FolderKind.Sent, "sentitems"),
            "SPAM" => ("Spam", FolderKind.Junk, "junkemail"),
            "TRASH" => ("Trash", FolderKind.Trash, "deleteditems"),
            "STARRED" => ("Starred", FolderKind.Starred, "starred"),
            "IMPORTANT" => ("Important", FolderKind.Important, "important"),
            "CATEGORY_PERSONAL" => ("Primary", FolderKind.Folder, null),
            "CATEGORY_SOCIAL" => ("Social", FolderKind.Folder, null),
            "CATEGORY_PROMOTIONS" => ("Promotions", FolderKind.Folder, null),
            "CATEGORY_UPDATES" => ("Updates", FolderKind.Folder, null),
            "CATEGORY_FORUMS" => ("Forums", FolderKind.Folder, null),
            _ => (name, FolderKind.Folder, (string?)null)
        };
        return new MailFolder(
            id,
            displayName,
            kind,
            Integer(label, "messagesUnread"),
            Integer(label, "messagesTotal"),
            null,
            wellKnown);
    }

    public static MailMessageSummary MapSummary(JsonElement message, string fallbackFolderId)
    {
        var headers = Headers(message);
        var labels = Strings(message, "labelIds");
        var sender = ParseSingleAddress(Header(headers, "From"), "Unknown sender");
        var recipients = ParseAddressList(Header(headers, "To")).Select(address => address.Display).ToList();
        var cc = ParseAddressList(Header(headers, "Cc")).Select(address => address.Display).ToList();
        var replyTo = ParseAddressList(Header(headers, "Reply-To"));
        var folderId = labels.Contains(fallbackFolderId)
            ? fallbackFolderId
            : PreferredFolder(labels) ?? fallbackFolderId;
        var internalDate = String(message, "internalDate");
        var receivedAt = long.TryParse(internalDate, out var milliseconds)
            ? DateTimeOffset.FromUnixTimeMilliseconds(milliseconds)
            : DateTimeOffset.TryParse(Header(headers, "Date"), out var parsed)
                ? parsed
                : default;

        return new MailMessageSummary(
            String(message, "id") ?? string.Empty,
            folderId,
            sender,
            recipients,
            Header(headers, "Subject") ?? "(No subject)",
            String(message, "snippet") ?? string.Empty,
            receivedAt,
            !labels.Contains("UNREAD"),
            HasAttachments(Property(message, "payload")),
            labels.Contains("IMPORTANT") ? MailImportance.High : MailImportance.Normal,
            labels.Contains("STARRED"),
            false,
            labels.Contains("IMPORTANT"),
            String(message, "threadId"),
            Header(headers, "Message-ID"),
            replyTo,
            cc,
            labels);
    }

    public static MailMessageDetail MapDetail(JsonElement message, string fallbackFolderId)
    {
        var summary = MapSummary(message, fallbackFolderId);
        var payload = Property(message, "payload");
        var html = FindBody(payload, "text/html");
        var text = FindBody(payload, "text/plain");
        var attachments = new List<MailAttachment>();
        var inlineImages = new List<MailInlineImage>();
        CollectAttachments(payload, attachments, inlineImages);
        var bodyKind = html is not null ? MailBodyKind.Html : MailBodyKind.Text;
        var body = html ?? text ?? string.Empty;

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
            body,
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

    public static string DecodeBase64Url(string value)
    {
        return Encoding.UTF8.GetString(DecodeBytes(value));
    }

    public static byte[] DecodeBytes(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }

    public static string EncodeBase64Url(byte[] value)
    {
        return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static IReadOnlyDictionary<string, string> Headers(JsonElement message)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var payload = Property(message, "payload");
        foreach (var header in Array(payload, "headers"))
        {
            var name = String(header, "name");
            var value = String(header, "value");
            if (!string.IsNullOrWhiteSpace(name) && value is not null)
            {
                result[name] = value;
            }
        }

        return result;
    }

    private static string? Header(IReadOnlyDictionary<string, string> headers, string name)
    {
        return headers.TryGetValue(name, out var value) ? value : null;
    }

    private static MailAddress ParseSingleAddress(string? value, string fallback)
    {
        try
        {
            if (MailboxAddress.TryParse(value, out var mailbox))
            {
                return new MailAddress(mailbox.Name ?? string.Empty, mailbox.Address);
            }
        }
        catch (ParseException)
        {
        }

        return new MailAddress(fallback, string.Empty);
    }

    private static IReadOnlyList<MailAddress> ParseAddressList(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        try
        {
            return InternetAddressList.Parse(value)
                .Mailboxes
                .Select(mailbox => new MailAddress(mailbox.Name ?? string.Empty, mailbox.Address))
                .ToList();
        }
        catch (ParseException)
        {
            return [];
        }
    }

    private static string? FindBody(JsonElement? part, string mimeType)
    {
        if (part is not { ValueKind: JsonValueKind.Object })
        {
            return null;
        }

        if (string.Equals(String(part.Value, "mimeType"), mimeType, StringComparison.OrdinalIgnoreCase))
        {
            var data = String(Property(part, "body"), "data");
            if (!string.IsNullOrWhiteSpace(data))
            {
                return DecodeBase64Url(data);
            }
        }

        foreach (var child in Array(part, "parts"))
        {
            var result = FindBody(child, mimeType);
            if (result is not null)
            {
                return result;
            }
        }

        return null;
    }

    private static void CollectAttachments(
        JsonElement? part,
        ICollection<MailAttachment> attachments,
        ICollection<MailInlineImage> inlineImages)
    {
        if (part is not { ValueKind: JsonValueKind.Object })
        {
            return;
        }

        var fileName = String(part.Value, "filename");
        var body = Property(part, "body");
        var attachmentId = String(body, "attachmentId");
        var embeddedData = String(body, "data");
        var partId = String(part.Value, "partId");
        var contentId = NormalizeContentId(HeaderValue(part.Value, "Content-ID"));
        var providerId = attachmentId ??
            (!string.IsNullOrWhiteSpace(embeddedData) && !string.IsNullOrWhiteSpace(partId)
                ? $"part:{partId}"
                : !string.IsNullOrWhiteSpace(embeddedData) && !string.IsNullOrWhiteSpace(contentId)
                    ? $"inline:{contentId}"
                    : null);
        var isInline = IsInline(part.Value) || contentId.Length > 0;
        if (isInline &&
            !string.IsNullOrWhiteSpace(providerId) &&
            contentId.Length > 0)
        {
            inlineImages.Add(new MailInlineImage(
                providerId,
                contentId,
                String(part.Value, "mimeType") ?? "application/octet-stream",
                DecodeOptionalBytes(embeddedData)));
        }
        else if (!string.IsNullOrWhiteSpace(fileName) &&
                 !string.IsNullOrWhiteSpace(providerId))
        {
            attachments.Add(new MailAttachment(
                providerId,
                fileName,
                String(part.Value, "mimeType") ?? "application/octet-stream",
                Long(body, "size"),
                false));
        }

        foreach (var child in Array(part, "parts"))
        {
            CollectAttachments(child, attachments, inlineImages);
        }
    }

    private static bool IsInline(JsonElement part)
    {
        return Array(part, "headers").Any(header =>
            string.Equals(String(header, "name"), "Content-Disposition", StringComparison.OrdinalIgnoreCase) &&
            (String(header, "value")?.StartsWith("inline", StringComparison.OrdinalIgnoreCase) ?? false));
    }

    private static string? HeaderValue(JsonElement part, string name)
    {
        return Array(part, "headers")
            .Where(header => string.Equals(
                String(header, "name"),
                name,
                StringComparison.OrdinalIgnoreCase))
            .Select(header => String(header, "value"))
            .FirstOrDefault();
    }

    private static string NormalizeContentId(string? value)
    {
        return (value ?? string.Empty).Trim().Trim('<', '>');
    }

    private static byte[]? DecodeOptionalBytes(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        try
        {
            return DecodeBytes(value);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static bool HasAttachments(JsonElement? payload)
    {
        if (payload is not { ValueKind: JsonValueKind.Object })
        {
            return false;
        }

        if ((!string.IsNullOrWhiteSpace(String(Property(payload, "body"), "attachmentId")) ||
             !string.IsNullOrWhiteSpace(String(Property(payload, "body"), "data"))) &&
            !string.IsNullOrWhiteSpace(String(payload, "filename")))
        {
            return true;
        }

        return Array(payload, "parts").Any(HasAttachments);
    }

    public static string? PreferredFolder(IReadOnlyList<string> labels)
    {
        string[] order = ["INBOX", "DRAFT", "SENT", "IMPORTANT", "STARRED", "SPAM", "TRASH"];
        return order.FirstOrDefault(labels.Contains)
            ?? labels.FirstOrDefault(label => IsVisibleLabel(label) && label != "UNREAD");
    }

    private static JsonElement? Property(JsonElement value, string name)
    {
        return value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property)
            ? property
            : null;
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

    private static long Long(JsonElement? value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Number } element && element.TryGetInt64(out var number)
            ? number
            : 0;
    }

    private static IReadOnlyList<string> Strings(JsonElement value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Array } element
            ? element.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!)
                .ToList()
            : [];
    }

    private static IEnumerable<JsonElement> Array(JsonElement? value, string name)
    {
        var property = Property(value, name);
        return property is { ValueKind: JsonValueKind.Array } element
            ? element.EnumerateArray().ToList()
            : [];
    }
}
