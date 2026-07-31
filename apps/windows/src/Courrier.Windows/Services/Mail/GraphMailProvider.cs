using System.Net.Http.Headers;
using System.Text.Json;
using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Mail;

public sealed class GraphMailProvider : IMailProvider
{
    private const string BaseUrl = "https://graph.microsoft.com/v1.0";
    private const string DraftStateProperty =
        "String {5f640a5e-821a-4d62-9a14-a242f04c62d2} Name CourrierDraftState";
    private const string MessageSelect =
        "id,parentFolderId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,flag,from,toRecipients,ccRecipients,replyTo,internetMessageId,conversationId";
    private const string DetailSelect =
        MessageSelect + ",body,createdDateTime,lastModifiedDateTime";
    private const string AttachmentSelect = "id,name,contentType,size,isInline,contentId";
    private static readonly string[] WellKnownFolders =
    [
        "inbox", "drafts", "sentitems", "archive", "deleteditems", "junkemail"
    ];

    private readonly IAuthProvider _auth;
    private readonly ProviderApiClient _api;
    private readonly MailHtmlSanitizer _htmlSanitizer;

    public GraphMailProvider(
        IEnumerable<IAuthProvider> authProviders,
        ProviderApiClient api,
        MailHtmlSanitizer htmlSanitizer)
    {
        _auth = authProviders.Single(provider => provider.Id == ProviderId.Microsoft);
        _api = api;
        _htmlSanitizer = htmlSanitizer;
    }

    public ProviderId Id => ProviderId.Microsoft;
    public MailCapabilities Capabilities =>
        MailCapabilities.Archive |
        MailCapabilities.Junk |
        MailCapabilities.Flag |
        MailCapabilities.Important;

    public async Task<IReadOnlyList<MailFolder>> GetFoldersAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        var folders = new List<MailFolder>();
        await LoadFoldersAsync(
            accountId,
            $"{BaseUrl}/me/mailFolders?includeHiddenFolders=true&$top=100&$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount",
            folders,
            cancellationToken);

        var wellKnownById = new Dictionary<string, string>(StringComparer.Ordinal);
        await Task.WhenAll(WellKnownFolders.Select(async name =>
        {
            try
            {
                using var document = await _api.GetJsonAsync(
                    _auth,
                    accountId,
                    $"{BaseUrl}/me/mailFolders/{name}?$select=id",
                    cancellationToken: cancellationToken);
                if (document.RootElement.TryGetProperty("id", out var id) && id.GetString() is { } value)
                {
                    lock (wellKnownById)
                    {
                        wellKnownById[value] = name;
                    }
                }
            }
            catch (ProviderRequestException)
            {
            }
        }));

        return FolderOrdering.Sort(folders.Select(folder =>
            wellKnownById.TryGetValue(folder.Id, out var name)
                ? folder with { WellKnownName = name, Kind = GraphMapping.MapFolderKind(name) }
                : folder));
    }

    public async Task<PageResult<MailMessageSummary>> GetMessagesAsync(
        string accountId,
        string folderId,
        string? nextPageToken = null,
        string? query = null,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateNextLink(nextPageToken)
            ?? BuildMessagesUrl(folderId, query);
        var headers = string.IsNullOrWhiteSpace(query)
            ? null
            : new Dictionary<string, string> { ["ConsistencyLevel"] = "eventual" };
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            url,
            headers,
            cancellationToken);
        return MapMessagePage(document.RootElement, folderId);
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
                request.FolderId ?? "inbox",
                request.NextPageToken,
                request.Query,
                cancellationToken);
        }

        var url = ValidateNextLink(request.NextPageToken)
            ?? $"{BaseUrl}/me/messages?$top=25&$select={MessageSelect}&$search={EncodeQuotedSearch(request.Query)}";
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            url,
            new Dictionary<string, string> { ["ConsistencyLevel"] = "eventual" },
            cancellationToken);
        var page = MapMessagePage(document.RootElement, request.FolderId ?? "inbox");
        var folders = await GetFoldersAsync(accountId, cancellationToken);
        var labels = folders.ToDictionary(folder => folder.Id, folder => folder.Label);
        return page with
        {
            Items = page.Items.Select(message => message with
            {
                FolderLabel = labels.GetValueOrDefault(message.FolderId)
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
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(messageId)}?$select={DetailSelect}&$expand=attachments($select={AttachmentSelect})",
            cancellationToken: cancellationToken);
        var detail = GraphMapping.MapDetail(document.RootElement, folderId);
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
        return PatchMessageAsync(accountId, messageId, new { isRead }, cancellationToken);
    }

    public async Task MoveAsync(
        string accountId,
        MoveRequest request,
        CancellationToken cancellationToken = default)
    {
        using var message = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(request.MessageId)}/move",
            new { destinationId = request.DestinationFolderId });
        using var response = await _api.SendJsonAsync(_auth, accountId, message, cancellationToken);
    }

    public Task TrashAsync(string accountId, string messageId, CancellationToken cancellationToken = default)
    {
        return MoveAsync(accountId, new MoveRequest(messageId, string.Empty, "deleteditems"), cancellationToken);
    }

    public Task ArchiveAsync(
        string accountId,
        string messageId,
        string sourceFolderId,
        CancellationToken cancellationToken = default)
    {
        return MoveAsync(accountId, new MoveRequest(messageId, sourceFolderId, "archive"), cancellationToken);
    }

    public Task SetJunkStateAsync(
        string accountId,
        string messageId,
        bool isJunk,
        CancellationToken cancellationToken = default)
    {
        return MoveAsync(
            accountId,
            new MoveRequest(messageId, string.Empty, isJunk ? "junkemail" : "inbox"),
            cancellationToken);
    }

    public Task SetStarStateAsync(
        string accountId,
        string messageId,
        bool isStarred,
        CancellationToken cancellationToken = default)
    {
        throw new NotSupportedException("Stars are not available for Microsoft accounts.");
    }

    public Task SetFlagStateAsync(
        string accountId,
        string messageId,
        bool isFlagged,
        CancellationToken cancellationToken = default)
    {
        return PatchMessageAsync(
            accountId,
            messageId,
            new { flag = new { flagStatus = isFlagged ? "flagged" : "notFlagged" } },
            cancellationToken);
    }

    public Task SetImportantStateAsync(
        string accountId,
        string messageId,
        bool isImportant,
        CancellationToken cancellationToken = default)
    {
        return PatchMessageAsync(
            accountId,
            messageId,
            new { importance = isImportant ? "high" : "normal" },
            cancellationToken);
    }

    public async Task<IReadOnlyList<PersonSuggestion>> FindPeopleAsync(
        string accountId,
        string? query,
        CancellationToken cancellationToken = default)
    {
        var search = string.IsNullOrWhiteSpace(query)
            ? string.Empty
            : $"&$search={EncodeQuotedSearch(query)}";
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{BaseUrl}/me/people?$top=10&$select=id,displayName,scoredEmailAddresses,userPrincipalName{search}",
            cancellationToken: cancellationToken);
        if (!document.RootElement.TryGetProperty("value", out var values))
        {
            return [];
        }

        return values.EnumerateArray().SelectMany(person =>
        {
            var id = GetString(person, "id") ?? Guid.NewGuid().ToString();
            var name = GetString(person, "displayName") ?? string.Empty;
            var addresses = person.TryGetProperty("scoredEmailAddresses", out var scored)
                ? scored.EnumerateArray()
                    .Select(address => GetString(address, "address"))
                    .Where(address => !string.IsNullOrWhiteSpace(address))
                    .Cast<string>()
                : [];
            var fallback = GetString(person, "userPrincipalName");
            return addresses.Append(fallback)
                .Where(address => !string.IsNullOrWhiteSpace(address))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(address => new PersonSuggestion($"{id}:{address}", name, address!));
        }).Take(10).ToList();
    }

    public async Task<IReadOnlyList<MailDraft>> GetDraftsAsync(
        string accountId,
        CancellationToken cancellationToken = default)
    {
        var result = new List<MailDraft>();
        string? url = DraftListUrl();
        while (url is not null)
        {
            using var document = await _api.GetJsonAsync(
                _auth, accountId, url, cancellationToken: cancellationToken);
            if (document.RootElement.TryGetProperty("value", out var values))
            {
                result.AddRange(values.EnumerateArray().Select(item => MapDraft(item, accountId)));
            }
            url = GetString(document.RootElement, "@odata.nextLink");
        }
        return result.OrderByDescending(draft => draft.UpdatedAt).ToList();
    }

    public async Task<MailDraft> GetDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            DraftUrl(providerDraftId),
            cancellationToken: cancellationToken);
        return MapDraft(document.RootElement, accountId);
    }

    public async Task<MailDraft> SaveDraftAsync(
        string accountId,
        DraftRequest request,
        CancellationToken cancellationToken = default)
    {
        request = request with { BodyHtml = _htmlSanitizer.SanitizeOutgoing(request.BodyHtml) };
        var providerBodyHtml = request.BodyHtml;
        if (request.Kind != ResponseKind.New && request.RelatedMessageId is not null)
        {
            var original = await GetMessageAsync(
                accountId,
                "inbox",
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
        string draftId;
        if (string.IsNullOrWhiteSpace(request.ProviderDraftId))
        {
            if (request.Kind == ResponseKind.New)
            {
                using var create = ProviderApiClient.JsonRequest(
                    HttpMethod.Post,
                    $"{BaseUrl}/me/messages",
                    DraftPayload(request, providerBodyHtml));
                using var response = await _api.SendJsonAsync(_auth, accountId, create, cancellationToken);
                draftId = GetString(response.RootElement, "id")
                    ?? throw new InvalidOperationException("Microsoft Graph did not return a draft ID.");
            }
            else
            {
                if (string.IsNullOrWhiteSpace(request.RelatedMessageId))
                {
                    throw new InvalidOperationException("A reply or forward draft requires its original message.");
                }
                var action = request.Kind switch
                {
                    ResponseKind.ReplyAll => "createReplyAll",
                    ResponseKind.Forward => "createForward",
                    _ => "createReply"
                };
                using var create = ProviderApiClient.JsonRequest(
                    HttpMethod.Post,
                    $"{BaseUrl}/me/messages/{Uri.EscapeDataString(request.RelatedMessageId)}/{action}",
                    new { });
                using var response = await _api.SendJsonAsync(_auth, accountId, create, cancellationToken);
                draftId = GetString(response.RootElement, "id")
                    ?? throw new InvalidOperationException("Microsoft Graph did not return a draft ID.");
                await PatchMessageAsync(
                    accountId,
                    draftId,
                    DraftPayload(request, providerBodyHtml),
                    cancellationToken);
            }
        }
        else
        {
            draftId = request.ProviderDraftId;
            await PatchMessageAsync(
                accountId,
                draftId,
                DraftPayload(request, providerBodyHtml),
                cancellationToken);
        }

        await ReplaceDraftAttachmentsAsync(accountId, draftId, request.Attachments, cancellationToken);
        return await GetDraftAsync(accountId, draftId, cancellationToken);
    }

    public async Task DeleteDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(providerDraftId)}");
        await _api.SendAsync(_auth, accountId, request, cancellationToken);
    }

    public async Task SendDraftAsync(
        string accountId,
        string providerDraftId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(providerDraftId)}/send");
        await _api.SendAsync(_auth, accountId, request, cancellationToken);
    }

    public async Task SendAsync(
        string accountId,
        ComposeRequest request,
        CancellationToken cancellationToken = default)
    {
        request = request with { BodyHtml = _htmlSanitizer.SanitizeOutgoing(request.BodyHtml) };
        if (request.Attachments.Count > 0)
        {
            var draft = await SaveDraftAsync(
                accountId,
                new DraftRequest(
                    null, ResponseKind.New, null, request.To, request.Cc, request.Bcc,
                    request.Subject, request.BodyHtml, request.Attachments),
                cancellationToken);
            await SendDraftAsync(accountId, draft.ProviderDraftId, cancellationToken);
            return;
        }

        using var message = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{BaseUrl}/me/sendMail",
            new
            {
                message = MessagePayload(request),
                saveToSentItems = true
            });
        await _api.SendAsync(_auth, accountId, message, cancellationToken);
    }

    public async Task RespondAsync(
        string accountId,
        ResponseRequest request,
        CancellationToken cancellationToken = default)
    {
        var draft = await SaveDraftAsync(
            accountId,
            new DraftRequest(
                null, request.Kind, request.MessageId, request.To, request.Cc, request.Bcc,
                string.Empty, request.BodyHtml, request.Attachments),
            cancellationToken);
        await SendDraftAsync(accountId, draft.ProviderDraftId, cancellationToken);
    }

    public async Task<DownloadedAttachment> DownloadAttachmentAsync(
        string accountId,
        string messageId,
        string attachmentId,
        CancellationToken cancellationToken = default)
    {
        using var document = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(messageId)}/attachments/{Uri.EscapeDataString(attachmentId)}",
            cancellationToken: cancellationToken);
        var root = document.RootElement;
        var content = GetString(root, "contentBytes")
            ?? throw new InvalidOperationException("Microsoft Graph did not return attachment content.");
        return new DownloadedAttachment(
            GetString(root, "name") ?? "attachment",
            GetString(root, "contentType") ?? "application/octet-stream",
            Convert.FromBase64String(content));
    }

    private async Task LoadFoldersAsync(
        string accountId,
        string initialUrl,
        ICollection<MailFolder> output,
        CancellationToken cancellationToken)
    {
        string? url = initialUrl;
        var childrenToLoad = new List<string>();
        while (url is not null)
        {
            using var document = await _api.GetJsonAsync(
                _auth, accountId, url, cancellationToken: cancellationToken);
            if (document.RootElement.TryGetProperty("value", out var values))
            {
                foreach (var item in values.EnumerateArray())
                {
                    var folder = GraphMapping.MapFolder(item);
                    output.Add(folder);
                    if (folder.HasChildren)
                    {
                        childrenToLoad.Add(folder.Id);
                    }
                }
            }
            url = GetString(document.RootElement, "@odata.nextLink");
        }

        foreach (var folderId in childrenToLoad)
        {
            await LoadFoldersAsync(
                accountId,
                $"{BaseUrl}/me/mailFolders/{Uri.EscapeDataString(folderId)}/childFolders?includeHiddenFolders=true&$top=100&$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount",
                output,
                cancellationToken);
        }
    }

    private PageResult<MailMessageSummary> MapMessagePage(JsonElement root, string folderId)
    {
        var items = root.TryGetProperty("value", out var values)
            ? values.EnumerateArray()
                .Where(item => !string.IsNullOrWhiteSpace(GetString(item, "id")))
                .Select(item => GraphMapping.MapSummary(item, folderId))
                .ToList()
            : [];
        return new PageResult<MailMessageSummary>(
            items,
            GetString(root, "@odata.nextLink"));
    }

    private Task PatchMessageAsync(
        string accountId,
        string messageId,
        object payload,
        CancellationToken cancellationToken)
    {
        return SendPatchAsync(
            accountId,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(messageId)}",
            payload,
            cancellationToken);
    }

    private async Task SendPatchAsync(
        string accountId,
        string url,
        object payload,
        CancellationToken cancellationToken)
    {
        using var request = ProviderApiClient.JsonRequest(HttpMethod.Patch, url, payload);
        await _api.SendAsync(_auth, accountId, request, cancellationToken);
    }

    private async Task ReplaceDraftAttachmentsAsync(
        string accountId,
        string draftId,
        IReadOnlyList<LocalAttachment> attachments,
        CancellationToken cancellationToken)
    {
        using var existing = await _api.GetJsonAsync(
            _auth,
            accountId,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(draftId)}/attachments?$select=id,name,contentType,size,isInline",
            cancellationToken: cancellationToken);
        var existingItems = existing.RootElement.TryGetProperty("value", out var existingValues)
            ? existingValues.EnumerateArray().ToList()
            : [];
        var existingAttachments = existingItems
            .Where(item => !GetBool(item, "isInline"))
            .Where(item => GetString(item, "id") is not null)
            .Select(item => new ProviderAttachmentDescriptor(
                GetString(item, "id")!,
                GetString(item, "name") ?? string.Empty,
                GetString(item, "contentType") ?? "application/octet-stream",
                GetLong(item, "size")))
            .ToList();
        var plan = AttachmentReconciliation.Plan(existingAttachments, attachments);

        foreach (var id in plan.DeleteIds)
        {
            using var delete = new HttpRequestMessage(
                HttpMethod.Delete,
                $"{BaseUrl}/me/messages/{Uri.EscapeDataString(draftId)}/attachments/{Uri.EscapeDataString(id)}");
            await _api.SendAsync(_auth, accountId, delete, cancellationToken);
        }

        foreach (var attachment in plan.Uploads)
        {
            if (attachment.Size > 150L * 1024 * 1024)
            {
                throw new NotSupportedException(
                    $"The Microsoft attachment {attachment.Name} is larger than 150 MB.");
            }
            if (attachment.Size > 3 * 1024 * 1024)
            {
                await UploadLargeAttachmentAsync(
                    accountId,
                    draftId,
                    attachment,
                    cancellationToken);
            }
            else
            {
                var bytes = await File.ReadAllBytesAsync(attachment.Path, cancellationToken);
                var payload = new Dictionary<string, object?>
                {
                    ["@odata.type"] = "#microsoft.graph.fileAttachment",
                    ["name"] = attachment.Name,
                    ["contentType"] = attachment.ContentType,
                    ["contentBytes"] = Convert.ToBase64String(bytes)
                };
                using var upload = ProviderApiClient.JsonRequest(
                    HttpMethod.Post,
                    $"{BaseUrl}/me/messages/{Uri.EscapeDataString(draftId)}/attachments",
                    payload);
                using var response = await _api.SendJsonAsync(
                    _auth,
                    accountId,
                    upload,
                    cancellationToken);
            }
        }
    }

    private async Task UploadLargeAttachmentAsync(
        string accountId,
        string draftId,
        LocalAttachment attachment,
        CancellationToken cancellationToken)
    {
        using var create = ProviderApiClient.JsonRequest(
            HttpMethod.Post,
            $"{BaseUrl}/me/messages/{Uri.EscapeDataString(draftId)}/attachments/createUploadSession",
            new
            {
                AttachmentItem = new
                {
                    attachmentType = "file",
                    name = attachment.Name,
                    size = attachment.Size,
                    contentType = attachment.ContentType
                }
            });
        using var session = await _api.SendJsonAsync(
            _auth,
            accountId,
            create,
            cancellationToken);
        var uploadUrl = GetString(session.RootElement, "uploadUrl")
            ?? throw new InvalidOperationException("Microsoft Graph did not return an attachment upload URL.");
        if (!Uri.TryCreate(uploadUrl, UriKind.Absolute, out var uploadUri) ||
            uploadUri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidOperationException("Microsoft Graph returned an invalid attachment upload URL.");
        }

        const int chunkSize = 320 * 1024 * 10;
        await using var stream = File.OpenRead(attachment.Path);
        var buffer = new byte[chunkSize];
        long offset = 0;
        while (offset < stream.Length)
        {
            var count = await stream.ReadAsync(buffer, cancellationToken);
            if (count == 0)
            {
                break;
            }
            using var request = new HttpRequestMessage(HttpMethod.Put, uploadUri)
            {
                Content = new ByteArrayContent(buffer, 0, count)
            };
            request.Content.Headers.ContentType =
                new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            request.Content.Headers.ContentRange =
                new System.Net.Http.Headers.ContentRangeHeaderValue(
                    offset,
                    offset + count - 1,
                    stream.Length);
            using var response = await _api.SendPreauthorizedAsync(request, cancellationToken);
            offset += count;
        }
        if (offset != stream.Length)
        {
            throw new IOException($"Could not finish uploading {attachment.Name}.");
        }
    }

    private static object DraftPayload(DraftRequest request, string providerBodyHtml)
    {
        return new
        {
            subject = request.Subject,
            body = new { contentType = "HTML", content = providerBodyHtml },
            toRecipients = GraphRecipients(request.To),
            ccRecipients = GraphRecipients(request.Cc),
            bccRecipients = GraphRecipients(request.Bcc),
            singleValueExtendedProperties = new[]
            {
                new
                {
                    id = DraftStateProperty,
                    value = JsonSerializer.Serialize(
                        new DraftState(request.Kind, request.RelatedMessageId, request.BodyHtml))
                }
            }
        };
    }

    private static object MessagePayload(ComposeRequest request)
    {
        return new
        {
            subject = request.Subject,
            body = new { contentType = "HTML", content = request.BodyHtml },
            toRecipients = GraphRecipients(request.To),
            ccRecipients = GraphRecipients(request.Cc),
            bccRecipients = GraphRecipients(request.Bcc)
        };
    }

    private static object[] GraphRecipients(IEnumerable<MailRecipient> recipients)
    {
        return recipients.Select(recipient => new
        {
            emailAddress = new
            {
                name = recipient.Name,
                address = recipient.Email
            }
        }).Cast<object>().ToArray();
    }

    private static MailDraft MapDraft(JsonElement message, string accountId)
    {
        var state = new DraftState(ResponseKind.New, null, null);
        if (message.TryGetProperty("singleValueExtendedProperties", out var properties))
        {
            var value = properties.EnumerateArray()
                .Where(property => GetString(property, "id") == DraftStateProperty)
                .Select(property => GetString(property, "value"))
                .FirstOrDefault();
            if (value is not null)
            {
                try
                {
                    state = JsonSerializer.Deserialize<DraftState>(value) ?? state;
                }
                catch (JsonException)
                {
                }
            }
        }

        var attachments = message.TryGetProperty("attachments", out var values)
            ? values.EnumerateArray().Select(item => new MailAttachment(
                GetString(item, "id") ?? string.Empty,
                GetString(item, "name") ?? "attachment",
                GetString(item, "contentType") ?? "application/octet-stream",
                GetLong(item, "size"),
                GetBool(item, "isInline"))).Where(item => !item.IsInline).ToList()
            : [];
        var body = message.TryGetProperty("body", out var bodyElement)
            ? GetString(bodyElement, "content") ?? string.Empty
            : string.Empty;
        return new MailDraft(
            GetString(message, "id") ?? string.Empty,
            GetString(message, "id"),
            accountId,
            state.Kind,
            state.RelatedMessageId,
            MapRecipients(message, "toRecipients"),
            MapRecipients(message, "ccRecipients"),
            MapRecipients(message, "bccRecipients"),
            GetString(message, "subject") ?? string.Empty,
            state.EditorBodyHtml ?? body,
            attachments,
            GetDate(message, "createdDateTime"),
            GetDate(message, "lastModifiedDateTime"));
    }

    private static IReadOnlyList<MailRecipient> MapRecipients(JsonElement message, string propertyName)
    {
        if (!message.TryGetProperty(propertyName, out var values))
        {
            return [];
        }
        return values.EnumerateArray().Select(item =>
        {
            var address = item.TryGetProperty("emailAddress", out var email) ? email : default;
            return new MailRecipient(
                GetString(address, "address") ?? string.Empty,
                GetString(address, "name"));
        }).Where(recipient => recipient.Email.Length > 0).ToList();
    }

    private static string DraftListUrl()
    {
        return $"{BaseUrl}/me/mailFolders/drafts/messages?$top=50&$select={DetailSelect},toRecipients,ccRecipients,bccRecipients&$expand=attachments($select={AttachmentSelect}),singleValueExtendedProperties($filter=id eq '{Uri.EscapeDataString(DraftStateProperty)}')";
    }

    private static string DraftUrl(string draftId)
    {
        return $"{BaseUrl}/me/messages/{Uri.EscapeDataString(draftId)}?$select={DetailSelect},toRecipients,ccRecipients,bccRecipients&$expand=attachments($select={AttachmentSelect}),singleValueExtendedProperties($filter=id eq '{Uri.EscapeDataString(DraftStateProperty)}')";
    }

    private static string BuildMessagesUrl(string folderId, string? query)
    {
        var search = string.IsNullOrWhiteSpace(query)
            ? "&$orderby=receivedDateTime desc"
            : $"&$search={EncodeQuotedSearch(query)}";
        return $"{BaseUrl}/me/mailFolders/{Uri.EscapeDataString(folderId)}/messages?$top=25&$select={MessageSelect}{search}";
    }

    private static string EncodeQuotedSearch(string query)
    {
        var escaped = query.Trim().Replace("\"", "\\\"", StringComparison.Ordinal);
        return Uri.EscapeDataString($"\"{escaped}\"");
    }

    private static string? ValidateNextLink(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !uri.Host.Equals("graph.microsoft.com", StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith("/v1.0/me/", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Microsoft Graph returned an invalid page link.");
        }
        return uri.ToString();
    }

    private static string? GetString(JsonElement element, string property)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(property, out var value) &&
               value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static long GetLong(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetInt64(out var result)
            ? result
            : 0;
    }

    private static bool GetBool(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;
    }

    private static DateTimeOffset GetDate(JsonElement element, string property)
    {
        return DateTimeOffset.TryParse(GetString(element, property), out var value) ? value : default;
    }

    private sealed record DraftState(
        ResponseKind Kind,
        string? RelatedMessageId,
        string? EditorBodyHtml);
}
