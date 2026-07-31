import Foundation

public struct GmailLabelDTO: Codable, Sendable {
    public let id: String?
    public let name: String?
    public let type: String?
    public let messagesTotal: Int?
    public let messagesUnread: Int?

    public init(
        id: String?,
        name: String?,
        type: String? = nil,
        messagesTotal: Int? = nil,
        messagesUnread: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.messagesTotal = messagesTotal
        self.messagesUnread = messagesUnread
    }
}

public struct GmailHeaderDTO: Codable, Sendable {
    public let name: String?
    public let value: String?
}

public struct GmailBodyDTO: Codable, Sendable {
    public let attachmentId: String?
    public let size: Int?
    public let data: String?
}

public struct GmailPartDTO: Codable, Sendable {
    public let partId: String?
    public let mimeType: String?
    public let filename: String?
    public let headers: [GmailHeaderDTO]?
    public let body: GmailBodyDTO?
    public let parts: [GmailPartDTO]?
}

public struct GmailMessageDTO: Codable, Sendable {
    public let id: String?
    public let threadId: String?
    public let labelIds: [String]?
    public let snippet: String?
    public let internalDate: String?
    public let payload: GmailPartDTO?

    public init(
        id: String?,
        threadId: String? = nil,
        labelIds: [String]? = nil,
        snippet: String? = nil,
        internalDate: String? = nil,
        payload: GmailPartDTO? = nil
    ) {
        self.id = id
        self.threadId = threadId
        self.labelIds = labelIds
        self.snippet = snippet
        self.internalDate = internalDate
        self.payload = payload
    }
}

public enum GmailMapper {
    private static let folderOrder = [
        "INBOX", "DRAFT", "SENT", "CATEGORY_PERSONAL", "TRASH", "SPAM",
        "CATEGORY_FORUMS", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL",
        "CATEGORY_UPDATES", "IMPORTANT", "STARRED",
    ]

    public static func folder(_ label: GmailLabelDTO) -> MailFolder {
        let id = label.id ?? ""
        return MailFolder(
            id: id,
            label: displayName(id: id, fallback: label.name),
            icon: icon(id: id),
            unreadCount: label.messagesUnread ?? 0,
            totalCount: label.messagesTotal ?? 0,
            wellKnownName: wellKnownName(id: id),
            hasChildren: false
        )
    }

    public static func sortedFolders(_ folders: [MailFolder]) -> [MailFolder] {
        folders.sorted {
            let left = folderOrder.firstIndex(of: $0.id) ?? folderOrder.count
            let right = folderOrder.firstIndex(of: $1.id) ?? folderOrder.count
            if left != right { return left < right }
            return $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }

    public static func summary(
        folderID: String,
        message: GmailMessageDTO,
        folder: MailFolder? = nil
    ) -> MailMessageSummary {
        let headers = headerMap(message.payload?.headers)
        let sender = parseAddress(headers["from"] ?? "")
        let labelIDs = message.labelIds ?? []
        return MailMessageSummary(
            id: message.id ?? "",
            folderID: folderID,
            folderLabel: folder?.label,
            folderWellKnownName: folder?.wellKnownName,
            matchedFolderIDs: labelIDs,
            sender: sender.email.isEmpty
                ? MailAddress(name: sender.name.isEmpty ? "Unknown sender" : sender.name, email: "")
                : sender,
            recipients: parseAddressList(headers["to"] ?? "").map(\.formatted),
            ccRecipients: parseAddressList(headers["cc"] ?? "").map(\.formatted),
            replyTo: parseAddressList(headers["reply-to"] ?? ""),
            subject: headers["subject"]?.nilIfEmpty ?? "(No subject)",
            preview: message.snippet ?? "",
            receivedDateTime: dateString(message, headers: headers),
            isRead: !labelIDs.contains("UNREAD"),
            hasAttachments: hasAttachments(message.payload),
            importance: labelIDs.contains("IMPORTANT") ? .high : .normal,
            isStarred: labelIDs.contains("STARRED"),
            isImportant: labelIDs.contains("IMPORTANT"),
            internetMessageID: headers["message-id"]?.nilIfEmpty,
            threadID: message.threadId?.nilIfEmpty
        )
    }

    public static func detail(folderID: String, message: GmailMessageDTO) -> MailMessageDetail {
        let body = extractBody(message.payload)
        return MailMessageDetail(
            summary: summary(folderID: folderID, message: message),
            bodyContentType: body.type,
            bodyContent: body.content,
            attachments: collectAttachments(message.payload)
        )
    }

    public static func preferredFolderID(_ labels: [String]) -> String? {
        let preferred = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"]
        return preferred.first(where: labels.contains)
            ?? labels.first(where: { !isHiddenLabel($0) })
    }

    public static func headerMap(_ headers: [GmailHeaderDTO]?) -> [String: String] {
        var result: [String: String] = [:]
        for header in headers ?? [] {
            if let name = header.name?.lowercased(), let value = header.value {
                result[name] = value
            }
        }
        return result
    }

    public static func findAttachment(
        _ part: GmailPartDTO?,
        id: String
    ) -> GmailPartDTO? {
        guard let part else { return nil }
        let filename = part.filename ?? ""
        if !filename.isEmpty,
           !isInline(part),
           part.body?.attachmentId == id || part.partId == id || filename == id {
            return part
        }
        for child in part.parts ?? [] {
            if let match = findAttachment(child, id: id) {
                return match
            }
        }
        return nil
    }

    static func containsInlineMIMEContent(_ part: GmailPartDTO?) -> Bool {
        guard let part else { return false }
        let headers = headerMap(part.headers)
        let mimeType = part.mimeType?.lowercased() ?? ""
        let isMultipart = mimeType.hasPrefix("multipart/")
        let hasEmbeddedReference = headers["content-id"]?.nilIfEmpty != nil
            || headers["content-location"]?.nilIfEmpty != nil
        let hasUnrepresentedLeafContent = !isMultipart
            && mimeType != "text/html"
            && mimeType != "text/plain"
            && part.filename?.nilIfEmpty == nil
            && (
                part.body?.attachmentId?.nilIfEmpty != nil
                    || part.body?.data?.nilIfEmpty != nil
                    || (part.body?.size ?? 0) > 0
            )
        if isInline(part)
            || hasEmbeddedReference
            || hasUnrepresentedLeafContent
            || (mimeType == "multipart/related" && (part.parts?.count ?? 0) > 1) {
            return true
        }
        return (part.parts ?? []).contains(where: containsInlineMIMEContent)
    }

    private static func displayName(id: String, fallback: String?) -> String {
        let names = [
            "INBOX": "Inbox", "DRAFT": "Drafts", "SENT": "Sent", "TRASH": "Trash",
            "SPAM": "Spam", "STARRED": "Starred", "IMPORTANT": "Important",
            "CATEGORY_PERSONAL": "Primary", "CATEGORY_SOCIAL": "Social",
            "CATEGORY_PROMOTIONS": "Promotions", "CATEGORY_UPDATES": "Updates",
            "CATEGORY_FORUMS": "Forums",
        ]
        return names[id] ?? fallback ?? id
    }

    private static func icon(id: String) -> FolderIcon {
        switch id {
        case "INBOX": .inbox
        case "DRAFT": .drafts
        case "SENT": .sent
        case "TRASH": .trash
        case "SPAM": .junk
        case "STARRED": .starred
        case "IMPORTANT": .important
        default: .folder
        }
    }

    private static func wellKnownName(id: String) -> String? {
        switch id {
        case "INBOX": "inbox"
        case "DRAFT": "drafts"
        case "SENT": "sentitems"
        case "TRASH": "deleteditems"
        case "SPAM": "junkemail"
        default: nil
        }
    }

    private static func dateString(
        _ message: GmailMessageDTO,
        headers: [String: String]
    ) -> String {
        if let raw = message.internalDate, let milliseconds = Double(raw) {
            return ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: milliseconds / 1000)
            )
        }
        if let raw = headers["date"], let date = MailDateParser.parse(raw) {
            return ISO8601DateFormatter().string(from: date)
        }
        return ""
    }

    private static func extractBody(_ part: GmailPartDTO?) -> (type: BodyContentType, content: String) {
        if let encoded = findBody(part, mimeType: "text/html") {
            return (.html, decodeBase64URLString(encoded))
        }
        if let encoded = findBody(part, mimeType: "text/plain") {
            return (.text, decodeBase64URLString(encoded))
        }
        return (.text, "")
    }

    private static func findBody(_ part: GmailPartDTO?, mimeType: String) -> String? {
        guard let part else { return nil }
        if part.mimeType == mimeType,
           part.filename?.isEmpty != false,
           let data = part.body?.data {
            return data
        }
        for child in part.parts ?? [] {
            if let match = findBody(child, mimeType: mimeType) {
                return match
            }
        }
        return nil
    }

    private static func hasAttachments(_ part: GmailPartDTO?) -> Bool {
        guard let part else { return false }
        if part.filename?.isEmpty == false, !isInline(part) {
            return true
        }
        return (part.parts ?? []).contains(where: hasAttachments)
    }

    private static func collectAttachments(_ part: GmailPartDTO?) -> [MailAttachment] {
        guard let part else { return [] }
        var attachments: [MailAttachment] = []
        if let filename = part.filename, !filename.isEmpty, !isInline(part) {
            attachments.append(
                MailAttachment(
                    id: part.body?.attachmentId ?? part.partId ?? filename,
                    name: filename,
                    contentType: part.mimeType ?? "application/octet-stream",
                    size: part.body?.size ?? 0
                )
            )
        }
        for child in part.parts ?? [] {
            attachments += collectAttachments(child)
        }
        return attachments
    }

    private static func isInline(_ part: GmailPartDTO) -> Bool {
        let disposition = part.headers?.first {
            $0.name?.caseInsensitiveCompare("Content-Disposition") == .orderedSame
        }?.value?.lowercased()
        return disposition?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces)
            == "inline"
    }

    private static func parseAddressList(_ value: String) -> [MailAddress] {
        RecipientParser.parse(value).valid
    }

    private static func parseAddress(_ value: String) -> MailAddress {
        parseAddressList(value).first ?? MailAddress(email: "")
    }

    private static func decodeBase64URLString(_ value: String) -> String {
        guard let data = Data(base64URL: value) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    private static func isHiddenLabel(_ id: String) -> Bool {
        id == "CHAT" || id == "UNREAD"
    }
}

public final class GmailProvider: MailProvider, MailPushSubscriptionProvider, @unchecked Sendable {
    public let id = ProviderID.google

    private static let gmailBase = "https://gmail.googleapis.com"
    private static let peopleBase = "https://people.googleapis.com"
    private static let metadataHeaders = [
        "From", "To", "Cc", "Reply-To", "Subject", "Date", "Message-ID", "References",
    ]

    private let account: MailAccount
    private let client: AuthorizedHTTPClient
    private let pubSubTopic: String?

    public init(
        account: MailAccount,
        client: AuthorizedHTTPClient,
        pubSubTopic: String? = nil
    ) {
        self.account = account
        self.client = client
        self.pubSubTopic = pubSubTopic
    }

    public func capabilities() async -> Set<MailActionCapability> {
        [.archive, .junk, .star, .important]
    }

    public func listFolders() async throws -> [MailFolder] {
        let listURL = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/labels"
        )
        let list = try await client.json(GmailLabelList.self, from: listURL)
        var folders: [MailFolder] = []
        for label in list.labels ?? [] {
            guard let id = label.id, id != "CHAT", id != "UNREAD" else { continue }
            let detailURL = try URL.courrier(
                Self.gmailBase,
                path: "/gmail/v1/users/me/labels/\(id.urlPathEncoded)"
            )
            let detail = (try? await client.json(GmailLabelDTO.self, from: detailURL)) ?? label
            folders.append(GmailMapper.folder(detail))
        }
        return GmailMapper.sortedFolders(folders)
    }

    public func listMessages(
        folderID: String,
        nextPageToken: String?,
        search: String?
    ) async throws -> PagedMessages {
        var items = [
            URLQueryItem(name: "maxResults", value: "25"),
            URLQueryItem(name: "labelIds", value: folderID),
        ]
        if let nextPageToken { items.append(.init(name: "pageToken", value: nextPageToken)) }
        if let search = search?.trimmingCharacters(in: .whitespacesAndNewlines),
           !search.isEmpty {
            items.append(.init(name: "q", value: search))
        }
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages",
            queryItems: items
        )
        let page = try await client.json(GmailMessageList.self, from: url)
        var messages: [MailMessageSummary] = []
        for reference in page.messages ?? [] {
            guard let id = reference.id else { continue }
            messages.append(try await getSummary(folderID: folderID, messageID: id))
        }
        return PagedMessages(messages: messages, nextPageToken: page.nextPageToken)
    }

    public func searchMessages(
        query: String,
        scope: MailSearchScope,
        folderID: String?,
        nextPageToken: String?
    ) async throws -> PagedMessages {
        if scope == .folder {
            return try await listMessages(
                folderID: folderID ?? "INBOX",
                nextPageToken: nextPageToken,
                search: query
            )
        }
        var items = [
            URLQueryItem(name: "maxResults", value: "25"),
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "includeSpamTrash", value: "true"),
        ]
        if let nextPageToken { items.append(.init(name: "pageToken", value: nextPageToken)) }
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages",
            queryItems: items
        )
        let page = try await client.json(GmailMessageList.self, from: url)
        let folders = try await listFolders()
        let byID = Dictionary(uniqueKeysWithValues: folders.map { ($0.id, $0) })
        var messages: [MailMessageSummary] = []
        for reference in page.messages ?? [] {
            guard let id = reference.id else { continue }
            let raw = try await getRawMessage(messageID: id, format: "metadata")
            let displayID = GmailMapper.preferredFolderID(raw.labelIds ?? [])
                ?? folderID
                ?? "INBOX"
            messages.append(
                GmailMapper.summary(folderID: displayID, message: raw, folder: byID[displayID])
            )
        }
        return PagedMessages(messages: messages, nextPageToken: page.nextPageToken)
    }

    public func getMessage(folderID: String, messageID: String) async throws -> MailMessageDetail {
        GmailMapper.detail(
            folderID: folderID,
            message: try await getRawMessage(messageID: messageID, format: "full")
        )
    }

    public func markRead(messageID: String, isRead: Bool) async throws {
        try await modify(
            messageID,
            add: isRead ? [] : ["UNREAD"],
            remove: isRead ? ["UNREAD"] : []
        )
    }

    public func move(
        messageID: String,
        from sourceFolderID: String,
        to destinationFolderID: String
    ) async throws {
        let source = archiveSourceLabel(sourceFolderID)
        try await modify(
            messageID,
            add: [destinationFolderID],
            remove: source == destinationFolderID ? [] : [source]
        )
    }

    public func trash(messageID: String) async throws {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages/\(messageID.urlPathEncoded)/trash"
        )
        _ = try await client.request(url, method: "POST")
    }

    public func archive(messageID: String, from sourceFolderID: String) async throws {
        try await modify(
            messageID,
            add: [],
            remove: [archiveSourceLabel(sourceFolderID)]
        )
    }

    public func markJunk(messageID: String, isJunk: Bool) async throws {
        try await modify(
            messageID,
            add: [isJunk ? "SPAM" : "INBOX"],
            remove: [isJunk ? "INBOX" : "SPAM"]
        )
    }

    public func setStarred(messageID: String, isStarred: Bool) async throws {
        try await modify(
            messageID,
            add: isStarred ? ["STARRED"] : [],
            remove: isStarred ? [] : ["STARRED"]
        )
    }

    public func setImportant(messageID: String, isImportant: Bool) async throws {
        try await modify(
            messageID,
            add: isImportant ? ["IMPORTANT"] : [],
            remove: isImportant ? [] : ["IMPORTANT"]
        )
    }

    public func listPeople(query: String?) async throws -> [PersonSuggestion] {
        let trimmed = query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let url: URL
        if trimmed.isEmpty {
            url = try URL.courrier(
                Self.peopleBase,
                path: "/v1/people/me/connections",
                queryItems: [
                    .init(name: "pageSize", value: "10"),
                    .init(name: "personFields", value: "names,emailAddresses"),
                    .init(name: "sortOrder", value: "LAST_MODIFIED_DESCENDING"),
                ]
            )
        } else {
            url = try URL.courrier(
                Self.peopleBase,
                path: "/v1/people:searchContacts",
                queryItems: [
                    .init(name: "query", value: trimmed),
                    .init(name: "pageSize", value: "10"),
                    .init(name: "readMask", value: "names,emailAddresses"),
                ]
            )
        }
        let data = try await client.request(url)
        let people: [GooglePerson]
        if trimmed.isEmpty {
            people = try JSONDecoder().decode(GoogleConnections.self, from: data).connections ?? []
        } else {
            people = try JSONDecoder().decode(GoogleSearchResults.self, from: data)
                .results?
                .compactMap(\.person) ?? []
        }
        var seen: Set<String> = []
        return people.flatMap { person in
            let name = person.names?.first(where: { $0.displayName?.isEmpty == false })?
                .displayName ?? ""
            return (person.emailAddresses ?? []).compactMap { entry -> PersonSuggestion? in
                guard let email = entry.value, !email.isEmpty,
                      seen.insert(email.lowercased()).inserted else {
                    return nil
                }
                return PersonSuggestion(
                    id: "\(person.resourceName ?? "person"):\(email.lowercased())",
                    name: name.isEmpty ? email : name,
                    email: email
                )
            }
        }
    }

    public func listDrafts() async throws -> [ProviderDraft] {
        var drafts: [ProviderDraft] = []
        var nextPageToken: String?
        repeat {
            var items = [URLQueryItem(name: "maxResults", value: "100")]
            if let nextPageToken {
                items.append(.init(name: "pageToken", value: nextPageToken))
            }
            let url = try URL.courrier(
                Self.gmailBase,
                path: "/gmail/v1/users/me/drafts",
                queryItems: items
            )
            let page = try await client.json(GmailDraftList.self, from: url)
            for reference in page.drafts ?? [] {
                guard let id = reference.id else { continue }
                drafts.append(try await getDraft(id: id))
            }
            nextPageToken = page.nextPageToken
        } while nextPageToken != nil
        return drafts
    }

    public func getDraft(id: String) async throws -> ProviderDraft {
        let draft = try await gmailDraft(id: id)
        guard let message = draft.message, let messageID = message.id else {
            throw CourrierError.invalidResponse("Gmail did not return the draft message.")
        }
        let detail = GmailMapper.detail(folderID: "DRAFT", message: message)
        var attachments: [ComposeAttachment] = []
        for attachment in detail.attachments {
            let downloaded = try await downloadAttachment(
                messageID: messageID,
                attachmentID: attachment.id
            )
            attachments.append(
                ComposeAttachment(
                    name: downloaded.name,
                    contentType: downloaded.contentType,
                    data: downloaded.data,
                    providerAttachmentID: attachment.id
                )
            )
        }
        let headers = GmailMapper.headerMap(message.payload?.headers)
        let state = headers["x-courrier-draft-state"].flatMap(decodeDraftState)
        let bodyHTML = detail.bodyContentType == .html
            ? detail.bodyContent
            : HTMLSanitizer.plainTextToHTML(detail.bodyContent)
        return ProviderDraft(
            providerDraftID: draft.id ?? id,
            providerMessageID: messageID,
            accountID: account.id,
            kind: state?.kind ?? inferredDraftKind(subject: detail.summary.subject),
            relatedMessageID: state?.relatedMessageID,
            threadID: message.threadId,
            to: RecipientParser.parse(headers["to"] ?? "").valid,
            cc: RecipientParser.parse(headers["cc"] ?? "").valid,
            bcc: RecipientParser.parse(headers["bcc"] ?? "").valid,
            subject: detail.summary.subject == "(No subject)" ? "" : detail.summary.subject,
            bodyHTML: bodyHTML,
            attachments: attachments,
            updatedAt: detail.summary.date
        )
    }

    public func saveDraft(_ request: DraftSaveRequest) async throws -> ProviderDraft {
        if let providerDraftID = request.providerDraftID {
            let existing = try await gmailDraft(id: providerDraftID)
            if GmailMapper.containsInlineMIMEContent(existing.message?.payload) {
                throw CourrierError.unsupported(
                    "Courrier cannot safely update this Gmail draft because it contains "
                        + "inline images or embedded content. Remove that content in Gmail, "
                        + "or save this message as a new draft."
                )
            }
        }
        let messageBody = draftBody(request)
        let message = ComposeMessage(
            to: request.message.to,
            cc: request.message.cc,
            bcc: request.message.bcc,
            subject: request.message.subject,
            bodyHTML: messageBody,
            attachments: request.message.attachments
        )
        let state = GmailDraftState(
            kind: request.kind,
            relatedMessageID: request.original?.id
        )
        let stateData = try JSONEncoder().encode(state).base64URLEncodedString()
        let threadID = request.threadID
            ?? (request.kind == .forward ? nil : request.original?.summary.threadID)
        let raw = MIMEBuilder.build(
            from: MailAddress(name: account.name, email: account.email),
            message: message,
            inReplyTo: request.kind == .forward
                ? nil
                : request.original?.summary.internetMessageID,
            references: request.kind == .forward
                ? nil
                : request.original?.summary.internetMessageID,
            extraHeaders: ["X-Courrier-Draft-State": stateData]
        )
        var gmailMessage: [String: Any] = ["raw": raw.base64URLEncodedString()]
        if let threadID { gmailMessage["threadId"] = threadID }
        let payload: [String: Any]
        let url: URL
        let method: String
        if let providerDraftID = request.providerDraftID {
            url = try URL.courrier(
                Self.gmailBase,
                path: "/gmail/v1/users/me/drafts/\(providerDraftID.urlPathEncoded)"
            )
            method = "PUT"
            payload = ["id": providerDraftID, "message": gmailMessage]
        } else {
            url = try URL.courrier(
                Self.gmailBase,
                path: "/gmail/v1/users/me/drafts"
            )
            method = "POST"
            payload = ["message": gmailMessage]
        }
        let saved = try await client.json(
            GmailDraftDTO.self,
            from: url,
            method: method,
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
        guard let id = saved.id ?? request.providerDraftID else {
            throw CourrierError.invalidResponse("Gmail did not return a draft identifier.")
        }
        return try await getDraft(id: id)
    }

    public func deleteDraft(id: String) async throws {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/drafts/\(id.urlPathEncoded)"
        )
        _ = try await client.request(url, method: "DELETE")
    }

    public func sendDraft(id: String) async throws {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/drafts/send"
        )
        _ = try await client.request(
            url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: ["id": id])
        )
    }

    public func send(_ message: ComposeMessage) async throws {
        let raw = MIMEBuilder.build(
            from: MailAddress(name: account.name, email: account.email),
            message: message
        )
        try await sendRaw(raw, threadID: nil)
    }

    public func reply(_ reply: ReplyMessage) async throws {
        let original = reply.original
        let bodyHTML: String
        if reply.kind == .forward {
            let originalBody = original.bodyContentType == .html
                ? original.bodyContent
                : "<pre>\(HTMLSanitizer.escape(original.bodyContent))</pre>"
            bodyHTML = """
            \(reply.message.bodyHTML)<br><br><blockquote>
            <p>Forwarded message</p>
            <p><strong>From:</strong> \(HTMLSanitizer.escape(original.summary.sender.formatted))<br>
            <strong>Date:</strong> \(HTMLSanitizer.escape(original.summary.receivedDateTime))<br>
            <strong>Subject:</strong> \(HTMLSanitizer.escape(original.summary.subject))<br>
            <strong>To:</strong> \(HTMLSanitizer.escape(original.summary.recipients.joined(separator: ", ")))</p>
            \(originalBody)</blockquote>
            """
        } else {
            bodyHTML = reply.message.bodyHTML
        }
        let message = ComposeMessage(
            to: reply.message.to,
            cc: reply.message.cc,
            bcc: reply.message.bcc,
            subject: reply.message.subject,
            bodyHTML: bodyHTML,
            attachments: reply.message.attachments
        )
        let raw = MIMEBuilder.build(
            from: MailAddress(name: account.name, email: account.email),
            message: message,
            inReplyTo: reply.kind == .forward ? nil : original.summary.internetMessageID,
            references: reply.kind == .forward ? nil : original.summary.internetMessageID
        )
        try await sendRaw(raw, threadID: reply.kind == .forward ? nil : original.summary.threadID)
    }

    public func downloadAttachment(
        messageID: String,
        attachmentID: String
    ) async throws -> DownloadedAttachment {
        let message = try await getRawMessage(messageID: messageID, format: "full")
        guard let part = GmailMapper.findAttachment(message.payload, id: attachmentID) else {
            throw CourrierError.invalidResponse("Gmail could not find this attachment.")
        }

        let data: Data
        if let encoded = part.body?.data, let decoded = Data(base64URL: encoded) {
            data = decoded
        } else if let providerID = part.body?.attachmentId {
            let url = try URL.courrier(
                Self.gmailBase,
                path: "/gmail/v1/users/me/messages/\(messageID.urlPathEncoded)/attachments/\(providerID.urlPathEncoded)"
            )
            let payload = try await client.json(GmailAttachmentData.self, from: url)
            guard let decoded = Data(base64URL: payload.data) else {
                throw CourrierError.invalidResponse("Gmail returned unreadable attachment data.")
            }
            data = decoded
        } else {
            throw CourrierError.invalidResponse("Gmail did not return this attachment.")
        }
        return DownloadedAttachment(
            name: part.filename?.nilIfEmpty ?? "attachment",
            contentType: part.mimeType?.nilIfEmpty ?? "application/octet-stream",
            data: data
        )
    }

    public func createPushSubscription(
        clientState: String,
        expirationDateTime: String,
        notificationURL: URL
    ) async throws -> MailPushSubscription {
        try await createGmailWatch(expirationDateTime: expirationDateTime)
    }

    public func renewPushSubscription(
        id: String,
        expirationDateTime: String
    ) async throws -> MailPushSubscription {
        try await createGmailWatch(expirationDateTime: expirationDateTime)
    }

    public func deletePushSubscription(id: String) async throws {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/stop"
        )
        _ = try await client.request(url, method: "POST")
    }

    private func createGmailWatch(
        expirationDateTime: String
    ) async throws -> MailPushSubscription {
        guard let pubSubTopic, !pubSubTopic.isEmpty else {
            throw CourrierError.configuration(
                "Set GOOGLE_PUBSUB_TOPIC to enable Gmail live updates."
            )
        }
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/watch"
        )
        let response = try await client.json(
            GmailWatchResponse.self,
            from: url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(
                withJSONObject: [
                    "topicName": pubSubTopic,
                    "labelFilterBehavior": "include",
                    "labelIds": ["INBOX"],
                ]
            )
        )
        let expiration = response.expiration
            .flatMap(Double.init)
            .map { ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: $0 / 1000)) }
            ?? expirationDateTime
        return MailPushSubscription(
            id: response.historyId ?? account.providerAccountID,
            expirationDateTime: expiration,
            resource: account.email
        )
    }

    private func getSummary(folderID: String, messageID: String) async throws -> MailMessageSummary {
        GmailMapper.summary(
            folderID: folderID,
            message: try await getRawMessage(messageID: messageID, format: "metadata")
        )
    }

    private func getRawMessage(messageID: String, format: String) async throws -> GmailMessageDTO {
        var items = [URLQueryItem(name: "format", value: format)]
        if format == "metadata" {
            items += Self.metadataHeaders.map {
                URLQueryItem(name: "metadataHeaders", value: $0)
            }
        }
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages/\(messageID.urlPathEncoded)",
            queryItems: items
        )
        return try await client.json(GmailMessageDTO.self, from: url)
    }

    private func modify(_ messageID: String, add: [String], remove: [String]) async throws {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages/\(messageID.urlPathEncoded)/modify"
        )
        _ = try await client.request(
            url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(
                withJSONObject: ["addLabelIds": add, "removeLabelIds": remove]
            )
        )
    }

    private func sendRaw(_ data: Data, threadID: String?) async throws {
        var payload: [String: Any] = ["raw": data.base64URLEncodedString()]
        if let threadID { payload["threadId"] = threadID }
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/messages/send"
        )
        _ = try await client.request(
            url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
    }

    private func archiveSourceLabel(_ folderID: String?) -> String {
        guard let folderID,
              folderID != "INBOX",
              !folderID.hasPrefix("CATEGORY_") else {
            return "INBOX"
        }
        return folderID
    }

    private func gmailDraft(id: String) async throws -> GmailDraftDTO {
        let url = try URL.courrier(
            Self.gmailBase,
            path: "/gmail/v1/users/me/drafts/\(id.urlPathEncoded)",
            queryItems: [.init(name: "format", value: "full")]
        )
        return try await client.json(GmailDraftDTO.self, from: url)
    }

    private func draftBody(_ request: DraftSaveRequest) -> String {
        guard let kind = request.kind, let original = request.original else {
            return request.message.bodyHTML
        }
        let originalBody = original.bodyContentType == .html
            ? original.bodyContent
            : "<pre>\(HTMLSanitizer.escape(original.bodyContent))</pre>"
        let header: String
        switch kind {
        case .reply, .replyAll:
            header = """
            <p>On \(HTMLSanitizer.escape(original.summary.receivedDateTime)), \
            \(HTMLSanitizer.escape(original.summary.sender.formatted)) wrote:</p>
            """
        case .forward:
            header = """
            <p>Forwarded message</p>
            <p><strong>From:</strong> \(HTMLSanitizer.escape(original.summary.sender.formatted))<br>
            <strong>Date:</strong> \(HTMLSanitizer.escape(original.summary.receivedDateTime))<br>
            <strong>Subject:</strong> \(HTMLSanitizer.escape(original.summary.subject))<br>
            <strong>To:</strong> \(HTMLSanitizer.escape(original.summary.recipients.joined(separator: ", ")))</p>
            """
        }
        return "\(request.message.bodyHTML)<br><br><blockquote>\(header)\(originalBody)</blockquote>"
    }

    private func inferredDraftKind(subject: String) -> ReplyKind? {
        if subject.range(of: #"^\s*re:"#,
                         options: [.regularExpression, .caseInsensitive]) != nil {
            return .reply
        }
        if subject.range(of: #"^\s*fwd?:"#,
                         options: [.regularExpression, .caseInsensitive]) != nil {
            return .forward
        }
        return nil
    }

    private func decodeDraftState(_ value: String) -> GmailDraftState? {
        guard let data = Data(base64URL: value) else { return nil }
        return try? JSONDecoder().decode(GmailDraftState.self, from: data)
    }
}

public enum MIMEBuilder {
    public static func build(
        from: MailAddress,
        message: ComposeMessage,
        inReplyTo: String? = nil,
        references: String? = nil,
        extraHeaders: [String: String] = [:]
    ) -> Data {
        let boundary = "courrier-\(UUID().uuidString)"
        var headers = [
            "From: \(format(from))",
            "To: \(message.to.map(format).joined(separator: ", "))",
            "Subject: \(encodedWord(message.subject))",
            "MIME-Version: 1.0",
        ]
        if !message.cc.isEmpty {
            headers.append("Cc: \(message.cc.map(format).joined(separator: ", "))")
        }
        if !message.bcc.isEmpty {
            headers.append("Bcc: \(message.bcc.map(format).joined(separator: ", "))")
        }
        if let inReplyTo {
            headers.append("In-Reply-To: \(sanitizeHeader(inReplyTo))")
        }
        if let references {
            headers.append("References: \(sanitizeHeader(references))")
        }
        for (name, value) in extraHeaders.sorted(by: { $0.key < $1.key }) {
            let safeName = name.filter { $0.isLetter || $0.isNumber || $0 == "-" }
            guard !safeName.isEmpty else { continue }
            headers.append("\(safeName): \(sanitizeHeader(value))")
        }

        var lines = headers
        if message.attachments.isEmpty {
            lines += [
                "Content-Type: text/html; charset=utf-8",
                "Content-Transfer-Encoding: base64",
                "",
                wrappedBase64(Data(message.bodyHTML.utf8)),
            ]
        } else {
            lines += [
                "Content-Type: multipart/mixed; boundary=\"\(boundary)\"",
                "",
                "--\(boundary)",
                "Content-Type: text/html; charset=utf-8",
                "Content-Transfer-Encoding: base64",
                "",
                wrappedBase64(Data(message.bodyHTML.utf8)),
            ]
            for attachment in message.attachments {
                let safeName = sanitizeHeader(attachment.name)
                lines += [
                    "--\(boundary)",
                    "Content-Type: \(sanitizeHeader(attachment.contentType)); name=\"\(safeName)\"",
                    "Content-Disposition: attachment; filename=\"\(safeName)\"",
                    "Content-Transfer-Encoding: base64",
                    "",
                    wrappedBase64(attachment.data),
                ]
            }
            lines.append("--\(boundary)--")
        }
        return Data(lines.joined(separator: "\r\n").utf8)
    }

    private static func format(_ address: MailAddress) -> String {
        guard !address.name.isEmpty else { return sanitizeHeader(address.email) }
        return "\(encodedDisplayName(address.name)) <\(sanitizeHeader(address.email))>"
    }

    private static func encodedWord(_ value: String) -> String {
        let safe = sanitizeUnstructuredHeader(value)
        guard !safe.unicodeScalars.allSatisfy(\.isASCII) else { return safe }
        var chunks: [Data] = []
        var current = Data()
        for scalar in safe.unicodeScalars {
            let bytes = Data(String(scalar).utf8)
            if !current.isEmpty, current.count + bytes.count > 45 {
                chunks.append(current)
                current = Data()
            }
            current.append(bytes)
        }
        if !current.isEmpty {
            chunks.append(current)
        }
        return chunks.map {
            "=?UTF-8?B?\($0.base64EncodedString())?="
        }.joined(separator: " ")
    }

    private static func encodedDisplayName(_ value: String) -> String {
        let safe = sanitizeUnstructuredHeader(value)
        guard safe.unicodeScalars.allSatisfy(\.isASCII) else {
            return encodedWord(safe)
        }
        let escaped = safe
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    private static func wrappedBase64(_ data: Data) -> String {
        let encoded = Array(data.base64EncodedString().utf8)
        guard !encoded.isEmpty else { return "" }
        return stride(from: 0, to: encoded.count, by: 76).map { start in
            String(
                decoding: encoded[start..<min(start + 76, encoded.count)],
                as: UTF8.self
            )
        }.joined(separator: "\r\n")
    }

    private static func sanitizeUnstructuredHeader(_ value: String) -> String {
        value.replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }

    private static func sanitizeHeader(_ value: String) -> String {
        sanitizeUnstructuredHeader(value)
            .replacingOccurrences(of: "\"", with: "'")
    }
}

private struct GmailLabelList: Decodable, Sendable {
    let labels: [GmailLabelDTO]?
}

private struct GmailMessageReference: Decodable, Sendable {
    let id: String?
}

private struct GmailMessageList: Decodable, Sendable {
    let messages: [GmailMessageReference]?
    let nextPageToken: String?
}

private struct GmailDraftDTO: Decodable, Sendable {
    let id: String?
    let message: GmailMessageDTO?
}

private struct GmailDraftList: Decodable, Sendable {
    let drafts: [GmailDraftDTO]?
    let nextPageToken: String?
}

private struct GmailDraftState: Codable, Sendable {
    let kind: ReplyKind?
    let relatedMessageID: String?
}

private struct GmailAttachmentData: Decodable, Sendable {
    let data: String
}

private struct GmailWatchResponse: Decodable, Sendable {
    let historyId: String?
    let expiration: String?
}

private struct GooglePerson: Decodable, Sendable {
    struct Name: Decodable, Sendable {
        let displayName: String?
    }

    struct Email: Decodable, Sendable {
        let value: String?
    }

    let resourceName: String?
    let names: [Name]?
    let emailAddresses: [Email]?
}

private struct GoogleConnections: Decodable, Sendable {
    let connections: [GooglePerson]?
}

private struct GoogleSearchResults: Decodable, Sendable {
    struct Result: Decodable, Sendable {
        let person: GooglePerson?
    }

    let results: [Result]?
}

private enum MailDateParser {
    static func parse(_ value: String) -> Date? {
        let formats = [
            "EEE, d MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "d MMM yyyy HH:mm:ss Z",
        ]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            if let date = formatter.date(from: value) {
                return date
            }
        }
        return nil
    }
}

private extension Data {
    init?(base64URL: String) {
        var value = base64URL
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        self.init(base64Encoded: value)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    var urlPathEncoded: String {
        addingPercentEncoding(
            withAllowedCharacters: CharacterSet.alphanumerics.union(
                CharacterSet(charactersIn: "-._~")
            )
        ) ?? self
    }
}
