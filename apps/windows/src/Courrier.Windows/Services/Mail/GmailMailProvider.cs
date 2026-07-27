using System.Text;
using System.Text.Json;
using Courrier.Windows.Models;
using MimeKit;
using MimeKit.Utils;

namespace Courrier.Windows.Services.Mail;

public sealed class GmailMailProvider : IMailProvider
{
    private const string GmailBaseUrl = "https://gmail.googleapis.com/gmail/v1";
    private const string PeopleBaseUrl = "https://people.googleapis.com/v1";
    private const string DraftStateHeader = "X-Courrier-Draft-State";
    private readonly IAuthProvider _auth;
    private readonly ProviderApiClient _api;
    private readonly AccountStore _accountStore;
    private readonly MailHtmlSanitizer _htmlSanitizer;

    public GmailMailProvider(
        IEnumerable<IAuthProvider> authProviders,
        ProviderApiClient api,
        AccountStore accountStore,
        MailHtmlSanitizer htmlSanitizer)
    {
        _auth = authProviders.Single(provider => provider.Id == ProviderId.Google);
        _api = api;
        _accountStore = accountStore;
        _htmlSanitizer = htmlSanitizer;
    }

    public ProviderId Id => ProviderId.Google;
    public MailCapabilities Capabilities =>
        MailCapabilities.Archive |
        MailCapabilities.Junk |
        MailCapabilities.Star |
        MailCapabilities.Important;

    public async Task<IReadOnlyList<MailFolder>> GetFoldersAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{GmailBaseUrl}/users/me/labels",
            cancellationToken: cancellationToken);
        if (!document.RootElement.TryGetProperty("labels", out var labels))
        {
            return [];
        }

        var hydrated = await Task.WhenAll(labels.EnumerateArray()
            .Where(label =>
                GetString(label, "id") is { } id &&
                GmailMapping.IsVisibleLabel(id))
            .Select(async label =>
            {
                var id = GetString(label, "id")!;
                using var detail = await _api.GetJsonAsync(
                    _auth,
                    accountId,
                    $"{GmailBaseUrl}/users/me/labels/{Uri.EscapeDataString(id)}",
                    cancellationToken: cancellationToken);
                return GmailMapping.MapLabel(detail.RootElement);
            }));
        return FolderOrdering.Sort(hydrated);
    }

    public async Task<PageResult<MailMessageSummary>> GetMessagesAsync(
        string accountId,
        string folderId,
        string? nextPageToken = null,
        string? query = null,
        CancellationToken cancellationToken = default)
    {
        var parameters = new Dictionary<string, string>
        {
            ["maxResults"] = "25",
            ["labelIds"] = folderId
        };
        if (!string.IsNullOrWhiteSpace(nextPageToken))
        {
            parameters["pageToken"] = nextPageToken;
        }
        if (!string.IsNullOrWhiteSpace(query))
        {
            parameters["q"] = query.Trim();
        }

        var url = BuildUrl($"{GmailBaseUrl}/users/me/messages", parameters);
        if (folderId.StartsWith("CATEGORY_", StringComparison.Ordinal))
        {
            url += "&labelIds=INBOX";
        }
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            url,
            cancellationToken: cancellationToken);
        return await MapMessagePageAsync(
            accountId,
            folderId,
            document.RootElement,
            cancellationToken);
    }

    public async Task<PageResult<MailMessageSummary>> SearchAsync(
        string accountId,
        SearchRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Scope == SearchScope.CurrentFolder)
        {
            return await GetMessagesAsync(
                accountId,
                request.FolderId ?? "INBOX",
                request.NextPageToken,
                request.Query,
                cancellationToken);
        }

        var parameters = new Dictionary<string, string>
        {
            ["maxResults"] = "25",
            ["q"] = request.Query.Trim()
        };
        if (!string.IsNullOrWhiteSpace(request.NextPageToken))
        {
            parameters["pageToken"] = request.NextPageToken;
        }
        if (request.IncludeSpamAndTrash)
        {
            parameters["includeSpamTrash"] = "true";
        }
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            BuildUrl($"{GmailBaseUrl}/users/me/messages", parameters),
            cancellationToken: cancellationToken);
        var page = await MapMessagePageAsync(
            accountId,
            request.FolderId ?? "INBOX",
            document.RootElement,
            cancellationToken);
        var folders = await GetFoldersAsync(accountId, cancellationToken);
        var labels = folders.ToDictionary(folder => folder.Id, folder => folder.Label);
        return page with
        {
            Items = page.Items.Select(message => message with
            {
                FolderId = GmailMapping.PreferredFolder(message.MatchedFolderIds ?? [])
                    ?? message.FolderId,
                FolderLabel = labels.GetValueOrDefault(
                    GmailMapping.PreferredFolder(message.MatchedFolderIds ?? [])
                    ?? message.FolderId)
            }).ToList()
        };
    }

    public async Task<MailMessageDetail> GetMessageAsync(
        string accountId,
        string folderId,
        string messageId,
        CancellationToken cancellationToken = default)
    {
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(messageId)}?format=full",
            cancellationToken: cancellationToken);
        var detail = GmailMapping.MapDetail(document.RootElement, folderId);
        if (detail.InlineImages is not { Count: > 0 })
        {
            return detail;
        }
        var hydrated = await Task.WhenAll(detail.InlineImages.Select(async image =>
        {
            if (image.Content is not null)
            {
                return image;
            }
            try
            {
                var content = await DownloadAttachmentAsync(
                    accountId,
                    messageId,
                    image.Id,
                    cancellationToken);
                return image with { Content = content.Content };
            }
            catch (Exception exception) when (
                exception is HttpRequestException or InvalidOperationException or FormatException)
            {
                return image;
            }
        }));
        return detail with { InlineImages = hydrated };
    }

    public Task SetReadStateAsync(
        string accountId,
        string messageId,
        bool isRead,
        CancellationToken cancellationToken = default)
    {
        return ModifyLabelsAsync(
            accountId,
            messageId,
            isRead ? [] : ["UNREAD"],
            isRead ? ["UNREAD"] : [],
            cancellationToken);
    }

    public Task MoveAsync(
        string accountId,
        MoveRequest request,
        CancellationToken cancellationToken = default)
    {
        var remove = request.SourceFolderId == request.DestinationFolderId ||
                     string.IsNullOrWhiteSpace(request.SourceFolderId)
            ? Array.Empty<string>()
            : [request.SourceFolderId];
        return ModifyLabelsAsync(
            accountId,
            request.MessageId,
            [request.DestinationFolderId],
            remove,
            cancellationToken);
    }

    public async Task TrashAsync(
        string accountId,
        string messageId,
        CancellationToken cancellationToken = default)
    {
        using var request = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(messageId)}/trash",
            new { });
        using var response = await _api.SendJsonAsync(_auth, accountId, request, cancellationToken);
    }

    public Task ArchiveAsync(
        string accountId,
        string messageId,
        string sourceFolderId,
        CancellationToken cancellationToken = default)
    {
        return ModifyLabelsAsync(accountId, messageId, [], ["INBOX"], cancellationToken);
    }

    public Task SetJunkStateAsync(
        string accountId,
        string messageId,
        bool isJunk,
        CancellationToken cancellationToken = default)
    {
        return ModifyLabelsAsync(
            accountId,
            messageId,
            isJunk ? ["SPAM"] : ["INBOX"],
            isJunk ? ["INBOX"] : ["SPAM"],
            cancellationToken);
    }

    public Task SetStarStateAsync(
        string accountId,
        string messageId,
        bool isStarred,
        CancellationToken cancellationToken = default)
    {
        return ModifyLabelsAsync(
            accountId,
            messageId,
            isStarred ? ["STARRED"] : [],
            isStarred ? [] : ["STARRED"],
            cancellationToken);
    }

    public Task SetFlagStateAsync(
        string accountId,
        string messageId,
        bool isFlagged,
        CancellationToken cancellationToken = default)
    {
        throw new NotSupportedException("Flags are not available for Google accounts.");
    }

    public Task SetImportantStateAsync(
        string accountId,
        string messageId,
        bool isImportant,
        CancellationToken cancellationToken = default)
    {
        return ModifyLabelsAsync(
            accountId,
            messageId,
            isImportant ? ["IMPORTANT"] : [],
            isImportant ? [] : ["IMPORTANT"],
            cancellationToken);
    }

    public async Task<IReadOnlyList<PersonSuggestion>> FindPeopleAsync(
        string accountId,
        string? query,
        CancellationToken cancellationToken = default)
    {
        var url = string.IsNullOrWhiteSpace(query)
            ? $"{PeopleBaseUrl}/people/me/connections?personFields=names,emailAddresses&pageSize=10"
            : BuildUrl(
                $"{PeopleBaseUrl}/people:searchContacts",
                new Dictionary<string, string>
                {
                    ["query"] = query.Trim(),
                    ["readMask"] = "names,emailAddresses",
                    ["pageSize"] = "10"
                });
        using var document = await _api.GetJsonAsync(
            _auth, accountId, url, cancellationToken: cancellationToken);
        IEnumerable<JsonElement> people;
        if (document.RootElement.TryGetProperty("results", out var results))
        {
            people = results.EnumerateArray()
                .Select(result => result.TryGetProperty("person", out var person) ? person : default)
                .ToList();
        }
        else if (document.RootElement.TryGetProperty("connections", out var connections))
        {
            people = connections.EnumerateArray().ToList();
        }
        else
        {
            people = [];
        }
        var suggestions = new List<PersonSuggestion>();
        foreach (var person in people)
        {
            if (person.ValueKind != JsonValueKind.Object)
            {
                continue;
            }
            var id = GetString(person, "resourceName") ?? Guid.NewGuid().ToString();
            var name = person.TryGetProperty("names", out var names)
                ? names.EnumerateArray().Select(value => GetString(value, "displayName")).FirstOrDefault()
                : null;
            if (!person.TryGetProperty("emailAddresses", out var addresses))
            {
                continue;
            }
            suggestions.AddRange(addresses.EnumerateArray()
                .Select(address => GetString(address, "value"))
                .Where(email => !string.IsNullOrWhiteSpace(email))
                .Select(email => new PersonSuggestion($"{id}:{email}", name ?? string.Empty, email!)));
        }
        return suggestions
            .DistinctBy(item => item.Email, StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToList();
    }

    public async Task<IReadOnlyList<MailDraft>> GetDraftsAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        var drafts = new List<MailDraft>();
        string? pageToken = null;
        do
        {
            var url = BuildUrl(
                $"{GmailBaseUrl}/users/me/drafts",
                new Dictionary<string, string?>
                {
                    ["maxResults"] = "50",
                    ["pageToken"] = pageToken
                });
            using var document = await _api.GetJsonAsync(
                _auth, accountId, url, cancellationToken: cancellationToken);
            if (document.RootElement.TryGetProperty("drafts", out var values))
            {
                var page = await Task.WhenAll(values.EnumerateArray()
                    .Select(item => GetString(item, "id"))
                    .Where(id => id is not null)
                    .Select(id => GetDraftAsync(accountId, id!, cancellationToken)));
                drafts.AddRange(page);
            }
            pageToken = GetString(document.RootElement, "nextPageToken");
        } while (!string.IsNullOrWhiteSpace(pageToken));
        return drafts.OrderByDescending(draft => draft.UpdatedAt).ToList();
    }

    public async Task<MailDraft> GetDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{GmailBaseUrl}/users/me/drafts/{Uri.EscapeDataString(providerDraftId)}?format=full",
            cancellationToken: cancellationToken);
        return MapDraft(document.RootElement, accountId);
    }

    public async Task<MailDraft> SaveDraftAsync(
        string accountId,
        DraftRequest request,
        CancellationToken cancellationToken = default)
    {
        request = request with { BodyHtml = _htmlSanitizer.SanitizeOutgoing(request.BodyHtml) };
        MailMessageDetail? original = null;
        var providerBodyHtml = request.BodyHtml;
        if (request.Kind != ResponseKind.New && request.RelatedMessageId is not null)
        {
            original = await GetMessageAsync(
                accountId,
                "INBOX",
                request.RelatedMessageId,
                cancellationToken);
            var quoted = original.BodyKind == MailBodyKind.Html
                ? _htmlSanitizer.SanitizeOutgoing(original.Body)
                : $"<pre>{System.Net.WebUtility.HtmlEncode(original.Body)}</pre>";
            providerBodyHtml = request.BodyHtml +
                "<br><br><blockquote style=\"border-left:2px solid #aaa;margin-left:0;padding-left:12px\">" +
                quoted +
                "</blockquote>";
        }
        var mime = await BuildDraftMimeAsync(
            accountId,
            request,
            providerBodyHtml,
            original,
            cancellationToken);
        var raw = await SerializeMimeAsync(mime, cancellationToken);
        var messagePayload = new Dictionary<string, object?> { ["raw"] = raw };
        if (request.Kind is ResponseKind.Reply or ResponseKind.ReplyAll &&
            original?.ThreadId is not null)
        {
            messagePayload["threadId"] = original.ThreadId;
        }
        var payload = new Dictionary<string, object?> { ["message"] = messagePayload };
        var isNew = string.IsNullOrWhiteSpace(request.ProviderDraftId);
        var url = isNew
            ? $"{GmailBaseUrl}/users/me/drafts"
            : $"{GmailBaseUrl}/users/me/drafts/{Uri.EscapeDataString(request.ProviderDraftId!)}";
        using var save = ProviderApiClient.JsonRequest(isNew ? HttpMethod.Post : HttpMethod.Put, url, payload);
        using var response = await _api.SendJsonAsync(_auth, accountId, save, cancellationToken);
        var draftId = GetString(response.RootElement, "id")
            ?? throw new InvalidOperationException("Gmail did not return a draft ID.");
        return await GetDraftAsync(accountId, draftId, cancellationToken);
    }

    public async Task DeleteDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"{GmailBaseUrl}/users/me/drafts/{Uri.EscapeDataString(providerDraftId)}");
        await _api.SendAsync(_auth, accountId, request, cancellationToken);
    }

    public async Task SendDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var request = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{GmailBaseUrl}/users/me/drafts/send",
            new { id = providerDraftId });
        using var response = await _api.SendJsonAsync(_auth, accountId, request, cancellationToken);
    }

    public async Task SendAsync(
        string accountId,
        ComposeRequest request,
        CancellationToken cancellationToken = default)
    {
        request = request with { BodyHtml = _htmlSanitizer.SanitizeOutgoing(request.BodyHtml) };
        var mime = await BuildMimeAsync(
            accountId,
            request.To,
            request.Cc,
            request.Bcc,
            request.Subject,
            request.BodyHtml,
            request.Attachments,
            cancellationToken);
        await SendMimeAsync(accountId, mime, null, cancellationToken);
    }

    public async Task RespondAsync(
        string accountId,
        ResponseRequest request,
        CancellationToken cancellationToken = default)
    {
        var original = await GetMessageAsync(
            accountId, "INBOX", request.MessageId, cancellationToken);
        var subject = request.Kind == ResponseKind.Forward
            ? PrefixSubject(original.Subject, "Fwd:")
            : PrefixSubject(original.Subject, "Re:");
        var quoted = original.BodyKind == MailBodyKind.Html
            ? _htmlSanitizer.SanitizeOutgoing(original.Body)
            : $"<pre>{System.Net.WebUtility.HtmlEncode(original.Body)}</pre>";
        var body = _htmlSanitizer.SanitizeOutgoing(request.BodyHtml) +
                   "<br><br><blockquote style=\"border-left:2px solid #aaa;margin-left:0;padding-left:12px\">" +
                   quoted +
                   "</blockquote>";
        var mime = await BuildMimeAsync(
            accountId,
            request.To,
            request.Cc,
            request.Bcc,
            subject,
            body,
            request.Attachments,
            cancellationToken);
        if (request.Kind != ResponseKind.Forward)
        {
            if (!string.IsNullOrWhiteSpace(original.InternetMessageId))
            {
                mime.InReplyTo = original.InternetMessageId;
                mime.References.Add(original.InternetMessageId);
            }
        }
        await SendMimeAsync(accountId, mime, original.ThreadId, cancellationToken);
    }

    public async Task<DownloadedAttachment> DownloadAttachmentAsync(
        string accountId,
        string messageId,
        string attachmentId,
        CancellationToken cancellationToken = default)
    {
        if (attachmentId.StartsWith("part:", StringComparison.Ordinal))
        {
            using var message = await _api.GetJsonAsync(
                _auth,
                accountId,
                $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(messageId)}?format=full",
                cancellationToken: cancellationToken);
            var partId = attachmentId["part:".Length..];
            var part = message.RootElement.TryGetProperty("payload", out var payload)
                ? FindPart(payload, partId)
                : null;
            var partData = part is { } value &&
                           value.TryGetProperty("body", out var body)
                ? GetString(body, "data")
                : null;
            if (part is null || string.IsNullOrWhiteSpace(partData))
            {
                throw new InvalidOperationException("Gmail attachment content was not found.");
            }
            return new DownloadedAttachment(
                GetString(part.Value, "filename") ?? "attachment",
                GetString(part.Value, "mimeType") ?? "application/octet-stream",
                GmailMapping.DecodeBytes(partData));
        }
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(messageId)}/attachments/{Uri.EscapeDataString(attachmentId)}",
            cancellationToken: cancellationToken);
        var data = GetString(document.RootElement, "data")
            ?? throw new InvalidOperationException("Gmail did not return attachment content.");
        return new DownloadedAttachment(
            "attachment",
            "application/octet-stream",
            GmailMapping.DecodeBytes(data));
    }

    private static JsonElement? FindPart(JsonElement part, string partId)
    {
        if (GetString(part, "partId") == partId)
        {
            return part;
        }
        if (!part.TryGetProperty("parts", out var children) ||
            children.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        foreach (var child in children.EnumerateArray())
        {
            var match = FindPart(child, partId);
            if (match is not null)
            {
                return match;
            }
        }
        return null;
    }

    private async Task<PageResult<MailMessageSummary>> MapMessagePageAsync(
        string accountId,
        string folderId,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        if (!root.TryGetProperty("messages", out var values))
        {
            return new PageResult<MailMessageSummary>([], GetString(root, "nextPageToken"));
        }
        var summaries = await Task.WhenAll(values.EnumerateArray()
            .Select(item => GetString(item, "id"))
            .Where(id => id is not null)
            .Select(async id =>
            {
                using var detail = await _api.GetJsonAsync(
                    _auth,
                    accountId,
                    $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(id!)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID",
                    cancellationToken: cancellationToken);
                return GmailMapping.MapSummary(detail.RootElement, folderId);
            }));
        return new PageResult<MailMessageSummary>(
            summaries,
            GetString(root, "nextPageToken"));
    }

    private async Task ModifyLabelsAsync(
        string accountId,
        string messageId,
        IReadOnlyList<string> add,
        IReadOnlyList<string> remove,
        CancellationToken cancellationToken)
    {
        using var request = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{GmailBaseUrl}/users/me/messages/{Uri.EscapeDataString(messageId)}/modify",
            new { addLabelIds = add, removeLabelIds = remove });
        using var response = await _api.SendJsonAsync(_auth, accountId, request, cancellationToken);
    }

    private async Task<MimeMessage> BuildDraftMimeAsync(
        string accountId,
        DraftRequest request,
        string providerBodyHtml,
        MailMessageDetail? original,
        CancellationToken cancellationToken)
    {
        var message = await BuildMimeAsync(
            accountId,
            request.To,
            request.Cc,
            request.Bcc,
            request.Subject,
            providerBodyHtml,
            request.Attachments,
            cancellationToken);
        if (request.Kind is ResponseKind.Reply or ResponseKind.ReplyAll &&
            original?.InternetMessageId is not null)
        {
            message.InReplyTo = original.InternetMessageId;
            message.References.Add(original.InternetMessageId);
        }
        var state = JsonSerializer.Serialize(
            new DraftState(request.Kind, request.RelatedMessageId, request.BodyHtml));
        message.Headers.Add(DraftStateHeader, Convert.ToBase64String(Encoding.UTF8.GetBytes(state)));
        return message;
    }

    private async Task<MimeMessage> BuildMimeAsync(
        string accountId,
        IReadOnlyList<MailRecipient> to,
        IReadOnlyList<MailRecipient> cc,
        IReadOnlyList<MailRecipient> bcc,
        string subject,
        string bodyHtml,
        IReadOnlyList<LocalAttachment> attachments,
        CancellationToken cancellationToken)
    {
        var state = await _accountStore.ReadAsync(cancellationToken);
        var account = state.Accounts.FirstOrDefault(candidate => candidate.Id == accountId)
            ?? throw new InvalidOperationException("The active Google account could not be found.");
        var message = new MimeMessage
        {
            Subject = subject,
            MessageId = MimeUtils.GenerateMessageId()
        };
        message.From.Add(new MailboxAddress(account.Name ?? string.Empty, account.Email));
        AddRecipients(message.To, to);
        AddRecipients(message.Cc, cc);
        AddRecipients(message.Bcc, bcc);
        var builder = new BodyBuilder { HtmlBody = bodyHtml };
        foreach (var attachment in attachments)
        {
            await using var stream = File.OpenRead(attachment.Path);
            var bytes = new byte[stream.Length];
            await stream.ReadExactlyAsync(bytes, cancellationToken);
            builder.Attachments.Add(
                attachment.Name,
                bytes,
                ContentType.Parse(attachment.ContentType));
        }
        message.Body = builder.ToMessageBody();
        return message;
    }

    private async Task SendMimeAsync(
        string accountId,
        MimeMessage message,
        string? threadId,
        CancellationToken cancellationToken)
    {
        var payload = new Dictionary<string, object?>
        {
            ["raw"] = await SerializeMimeAsync(message, cancellationToken)
        };
        if (!string.IsNullOrWhiteSpace(threadId))
        {
            payload["threadId"] = threadId;
        }
        using var request = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{GmailBaseUrl}/users/me/messages/send",
            payload);
        using var response = await _api.SendJsonAsync(_auth, accountId, request, cancellationToken);
    }

    private static async Task<string> SerializeMimeAsync(
        MimeMessage message,
        CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream();
        await message.WriteToAsync(stream, cancellationToken);
        return GmailMapping.EncodeBase64Url(stream.ToArray());
    }

    private static void AddRecipients(InternetAddressList target, IEnumerable<MailRecipient> recipients)
    {
        foreach (var recipient in recipients)
        {
            target.Add(new MailboxAddress(recipient.Name ?? string.Empty, recipient.Email));
        }
    }

    private static MailDraft MapDraft(JsonElement draft, string accountId)
    {
        if (!draft.TryGetProperty("message", out var message))
        {
            throw new InvalidOperationException("Gmail returned an invalid draft.");
        }
        var detail = GmailMapping.MapDetail(message, "DRAFT");
        var state = ReadDraftState(message);
        return new MailDraft(
            GetString(draft, "id") ?? string.Empty,
            detail.Id,
            accountId,
            state.Kind,
            state.RelatedMessageId,
            ParseRecipients(detail.Recipients),
            ParseRecipients(detail.CcRecipients ?? []),
            ParseRecipients(HeaderValues(message, "Bcc")),
            detail.Subject == "(No subject)" ? string.Empty : detail.Subject,
            state.EditorBodyHtml ?? detail.Body,
            detail.Attachments,
            detail.ReceivedAt,
            detail.ReceivedAt);
    }

    private static DraftState ReadDraftState(JsonElement message)
    {
        if (message.TryGetProperty("payload", out var payload) &&
            payload.TryGetProperty("headers", out var headers))
        {
            var value = headers.EnumerateArray()
                .Where(header =>
                    string.Equals(
                        GetString(header, "name"),
                        DraftStateHeader,
                        StringComparison.OrdinalIgnoreCase))
                .Select(header => GetString(header, "value"))
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(value))
            {
                try
                {
                    var json = Encoding.UTF8.GetString(Convert.FromBase64String(value));
                    return JsonSerializer.Deserialize<DraftState>(json)
                        ?? new DraftState(ResponseKind.New, null, null);
                }
                catch (Exception exception) when (
                    exception is JsonException or FormatException)
                {
                }
            }
        }
        return new DraftState(ResponseKind.New, null, null);
    }

    private static IReadOnlyList<MailRecipient> ParseRecipients(IEnumerable<string> values)
    {
        return values.SelectMany(value => RecipientParser.Parse(value).Valid).ToList();
    }

    private static IReadOnlyList<string> HeaderValues(JsonElement message, string name)
    {
        if (!message.TryGetProperty("payload", out var payload) ||
            !payload.TryGetProperty("headers", out var headers))
        {
            return [];
        }
        return headers.EnumerateArray()
            .Where(header => string.Equals(
                GetString(header, "name"),
                name,
                StringComparison.OrdinalIgnoreCase))
            .Select(header => GetString(header, "value"))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Cast<string>()
            .ToList();
    }

    private static string PrefixSubject(string subject, string prefix)
    {
        return subject.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? subject
            : $"{prefix} {subject}";
    }

    private static string BuildUrl<T>(
        string baseUrl,
        IReadOnlyDictionary<string, T> values)
    {
        var query = values
            .Where(pair => pair.Value is not null && pair.Value.ToString()!.Length > 0)
            .Select(pair =>
                $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!.ToString()!)}");
        return baseUrl + "?" + string.Join("&", query);
    }

    private static string? GetString(JsonElement element, string property)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(property, out var value) &&
               value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private sealed record DraftState(
        ResponseKind Kind,
        string? RelatedMessageId,
        string? EditorBodyHtml);
}
