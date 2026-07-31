import Foundation

public struct GraphEmailAddressDTO: Codable, Sendable {
    public struct Address: Codable, Sendable {
        public let name: String?
        public let address: String?

        public init(name: String? = nil, address: String? = nil) {
            self.name = name
            self.address = address
        }
    }

    public let emailAddress: Address?

    public init(emailAddress: Address?) {
        self.emailAddress = emailAddress
    }
}

public struct GraphFolderDTO: Codable, Sendable {
    public let id: String?
    public let displayName: String?
    public let parentFolderId: String?
    public let totalItemCount: Int?
    public let unreadItemCount: Int?
    public let childFolderCount: Int?
    public let isHidden: Bool?

    public init(
        id: String?,
        displayName: String?,
        parentFolderId: String? = nil,
        totalItemCount: Int? = nil,
        unreadItemCount: Int? = nil,
        childFolderCount: Int? = nil,
        isHidden: Bool? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.parentFolderId = parentFolderId
        self.totalItemCount = totalItemCount
        self.unreadItemCount = unreadItemCount
        self.childFolderCount = childFolderCount
        self.isHidden = isHidden
    }
}

public struct GraphAttachmentDTO: Codable, Sendable {
    public let odataType: String?
    public let id: String?
    public let name: String?
    public let contentType: String?
    public let size: Int?
    public let isInline: Bool?
    public let contentBytes: String?

    enum CodingKeys: String, CodingKey {
        case odataType = "@odata.type"
        case id, name, contentType, size, isInline, contentBytes
    }
}

public struct GraphMessageDTO: Codable, Sendable {
    public struct Body: Codable, Sendable {
        public let contentType: String?
        public let content: String?
    }

    public struct Flag: Codable, Sendable {
        public let flagStatus: String?
    }

    public let id: String?
    public let parentFolderId: String?
    public let subject: String?
    public let bodyPreview: String?
    public let receivedDateTime: String?
    public let lastModifiedDateTime: String?
    public let isRead: Bool?
    public let hasAttachments: Bool?
    public let importance: String?
    public let flag: Flag?
    public let from: GraphEmailAddressDTO?
    public let toRecipients: [GraphEmailAddressDTO]?
    public let ccRecipients: [GraphEmailAddressDTO]?
    public let bccRecipients: [GraphEmailAddressDTO]?
    public let replyTo: [GraphEmailAddressDTO]?
    public let internetMessageId: String?
    public let conversationId: String?
    public let body: Body?
    public let attachments: [GraphAttachmentDTO]?
}

public enum MicrosoftGraphMapper {
    private static let folderOrder = [
        "inbox", "drafts", "sentitems", "archive", "deleteditems", "junkemail",
    ]

    public static func folder(
        _ folder: GraphFolderDTO,
        depth: Int = 0,
        wellKnownName: String? = nil
    ) -> MailFolder {
        let normalized = wellKnownName?.lowercased()
        return MailFolder(
            id: folder.id ?? "",
            label: folder.displayName?.nilIfEmpty ?? "Untitled folder",
            icon: icon(for: normalized),
            unreadCount: folder.unreadItemCount ?? 0,
            totalCount: folder.totalItemCount ?? 0,
            parentFolderID: folder.parentFolderId?.nilIfEmpty,
            wellKnownName: normalized,
            hasChildren: (folder.childFolderCount ?? 0) > 0,
            depth: depth
        )
    }

    public static func summary(
        folderID: String,
        message: GraphMessageDTO,
        folder: MailFolder? = nil
    ) -> MailMessageSummary {
        let importance = MailImportance(rawValue: message.importance ?? "") ?? .normal
        return MailMessageSummary(
            id: message.id ?? "",
            folderID: folderID,
            folderLabel: folder?.label,
            folderWellKnownName: folder?.wellKnownName,
            sender: address(message.from, fallback: "Unknown sender"),
            recipients: (message.toRecipients ?? []).map(format),
            ccRecipients: (message.ccRecipients ?? []).map(format),
            replyTo: (message.replyTo ?? []).map { address($0, fallback: "Unknown recipient") },
            subject: message.subject?.nilIfEmpty ?? "(No subject)",
            preview: message.bodyPreview ?? "",
            receivedDateTime: message.receivedDateTime ?? "",
            isRead: message.isRead ?? true,
            hasAttachments: message.hasAttachments ?? false,
            importance: importance,
            isFlagged: message.flag?.flagStatus == "flagged",
            isImportant: importance == .high,
            internetMessageID: message.internetMessageId?.nilIfEmpty,
            conversationID: message.conversationId?.nilIfEmpty
        )
    }

    public static func detail(folderID: String, message: GraphMessageDTO) -> MailMessageDetail {
        let attachments = (message.attachments ?? []).compactMap { item -> MailAttachment? in
            guard
                item.odataType == "#microsoft.graph.fileAttachment",
                item.isInline != true,
                let id = item.id,
                !id.isEmpty
            else {
                return nil
            }
            return MailAttachment(
                id: id,
                name: item.name?.nilIfEmpty ?? "attachment",
                contentType: item.contentType?.nilIfEmpty ?? "application/octet-stream",
                size: item.size ?? 0,
                isInline: item.isInline ?? false
            )
        }
        return MailMessageDetail(
            summary: summary(folderID: folderID, message: message),
            bodyContentType: message.body?.contentType?.lowercased() == "text" ? .text : .html,
            bodyContent: message.body?.content ?? "",
            attachments: attachments
        )
    }

    public static func sortedFolders(_ folders: [MailFolder]) -> [MailFolder] {
        let byID = Dictionary(uniqueKeysWithValues: folders.map { ($0.id, $0) })
        var children: [String: [MailFolder]] = [:]
        var roots: [MailFolder] = []
        for folder in folders {
            if let parent = folder.parentFolderID, byID[parent] != nil {
                children[parent, default: []].append(folder)
            } else {
                roots.append(folder)
            }
        }

        func sorted(_ values: [MailFolder]) -> [MailFolder] {
            values.sorted {
                let left = order(of: $0)
                let right = order(of: $1)
                if left != right { return left < right }
                let label = $0.label.localizedCaseInsensitiveCompare($1.label)
                return label == .orderedSame ? $0.id < $1.id : label == .orderedAscending
            }
        }

        var result: [MailFolder] = []
        var visited: Set<String> = []
        func visit(_ folder: MailFolder) {
            guard visited.insert(folder.id).inserted else { return }
            result.append(folder)
            sorted(children[folder.id] ?? []).forEach(visit)
        }
        sorted(roots).forEach(visit)
        return result
    }

    private static func order(of folder: MailFolder) -> Int {
        guard let wellKnownName = folder.wellKnownName,
              let index = folderOrder.firstIndex(of: wellKnownName) else {
            return folderOrder.count
        }
        return index
    }

    private static func icon(for name: String?) -> FolderIcon {
        switch name {
        case "inbox": .inbox
        case "drafts": .drafts
        case "sentitems": .sent
        case "archive": .archive
        case "deleteditems": .trash
        case "junkemail": .junk
        default: .folder
        }
    }

    private static func address(_ value: GraphEmailAddressDTO?, fallback: String) -> MailAddress {
        MailAddress(
            name: value?.emailAddress?.name?.nilIfEmpty ?? fallback,
            email: value?.emailAddress?.address ?? ""
        )
    }

    private static func format(_ value: GraphEmailAddressDTO) -> String {
        address(value, fallback: "Unknown recipient").formatted
    }
}

public final class MicrosoftGraphProvider: MailProvider, MailPushSubscriptionProvider, @unchecked Sendable {
    public let id = ProviderID.microsoft

    private static let base = "https://graph.microsoft.com"
    private static let messageSelect =
        "id,parentFolderId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,flag,from,toRecipients,ccRecipients,replyTo,internetMessageId,conversationId"
    private static let detailSelect =
        "\(messageSelect),bccRecipients,body"
    private static let attachmentSelect = "id,name,contentType,size,isInline"
    private static let wellKnownFolders = [
        "inbox", "drafts", "sentitems", "archive", "deleteditems", "junkemail",
    ]

    private let account: MailAccount
    private let client: AuthorizedHTTPClient

    public init(account: MailAccount, client: AuthorizedHTTPClient) {
        self.account = account
        self.client = client
    }

    public func capabilities() async -> Set<MailActionCapability> {
        [.archive, .junk, .flag, .important]
    }

    public func listFolders() async throws -> [MailFolder] {
        var folders = try await fetchFolderTree(
            path: "/v1.0/me/mailFolders",
            depth: 0
        )
        var knownIDs: [String: String] = [:]
        for name in Self.wellKnownFolders {
            let url = try URL.courrier(
                Self.base,
                path: "/v1.0/me/mailFolders/\(name)",
                queryItems: [.init(name: "$select", value: "id")]
            )
            if let folder = try? await client.json(GraphFolderDTO.self, from: url),
               let id = folder.id {
                knownIDs[id] = name
            }
        }
        folders = folders.map { folder in
            guard let name = knownIDs[folder.id] else { return folder }
            return MailFolder(
                id: folder.id,
                label: folder.label,
                icon: MicrosoftGraphMapper.folder(
                    GraphFolderDTO(
                        id: folder.id,
                        displayName: folder.label,
                        parentFolderId: folder.parentFolderID,
                        totalItemCount: folder.totalCount,
                        unreadItemCount: folder.unreadCount,
                        childFolderCount: folder.hasChildren ? 1 : 0
                    ),
                    depth: folder.depth,
                    wellKnownName: name
                ).icon,
                unreadCount: folder.unreadCount,
                totalCount: folder.totalCount,
                parentFolderID: folder.parentFolderID,
                wellKnownName: name,
                hasChildren: folder.hasChildren,
                depth: folder.depth
            )
        }
        return MicrosoftGraphMapper.sortedFolders(folders)
    }

    public func listMessages(
        folderID: String,
        nextPageToken: String?,
        search: String?
    ) async throws -> PagedMessages {
        let url: URL
        if let nextPageToken {
            url = try validatedPageURL(nextPageToken)
        } else {
            var items = [
                URLQueryItem(name: "$top", value: "25"),
                URLQueryItem(name: "$select", value: Self.messageSelect),
            ]
            if let search = search?.trimmingCharacters(in: .whitespacesAndNewlines),
               !search.isEmpty {
                items.append(.init(name: "$search", value: "\"\(search.replacingOccurrences(of: "\"", with: "\\\""))\""))
            } else {
                items.append(.init(name: "$orderby", value: "receivedDateTime desc"))
            }
            url = try URL.courrier(
                Self.base,
                path: "/v1.0/me/mailFolders/\(folderID.urlPathEncoded)/messages",
                queryItems: items
            )
        }
        let page = try await client.json(GraphCollection<GraphMessageDTO>.self, from: url)
        return PagedMessages(
            messages: (page.value ?? [])
                .filter { $0.id?.isEmpty == false }
                .map { MicrosoftGraphMapper.summary(folderID: folderID, message: $0) },
            nextPageToken: page.nextLink
        )
    }

    public func searchMessages(
        query: String,
        scope: MailSearchScope,
        folderID: String?,
        nextPageToken: String?
    ) async throws -> PagedMessages {
        if scope == .folder {
            return try await listMessages(
                folderID: folderID ?? "inbox",
                nextPageToken: nextPageToken,
                search: query
            )
        }
        let url: URL
        if let nextPageToken {
            url = try validatedPageURL(nextPageToken)
        } else {
            url = try URL.courrier(
                Self.base,
                path: "/v1.0/me/messages",
                queryItems: [
                    .init(name: "$top", value: "25"),
                    .init(name: "$select", value: Self.messageSelect),
                    .init(name: "$search", value: "\"\(query.replacingOccurrences(of: "\"", with: "\\\""))\""),
                ]
            )
        }
        let page = try await client.json(GraphCollection<GraphMessageDTO>.self, from: url)
        let folders = try await listFolders()
        let byID = Dictionary(uniqueKeysWithValues: folders.map { ($0.id, $0) })
        return PagedMessages(
            messages: (page.value ?? []).compactMap { value in
                guard let id = value.id, !id.isEmpty else { return nil }
                let parent = value.parentFolderId ?? folderID ?? "inbox"
                return MicrosoftGraphMapper.summary(
                    folderID: parent,
                    message: value,
                    folder: byID[parent]
                )
            },
            nextPageToken: page.nextLink
        )
    }

    public func getMessage(folderID: String, messageID: String) async throws -> MailMessageDetail {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(messageID.urlPathEncoded)",
            queryItems: [
                .init(name: "$select", value: Self.detailSelect),
                .init(name: "$expand", value: "attachments($select=\(Self.attachmentSelect))"),
            ]
        )
        let message = try await client.json(GraphMessageDTO.self, from: url)
        return MicrosoftGraphMapper.detail(folderID: folderID, message: message)
    }

    public func markRead(messageID: String, isRead: Bool) async throws {
        try await patchMessage(messageID, body: ["isRead": isRead])
    }

    public func move(
        messageID: String,
        from sourceFolderID: String,
        to destinationFolderID: String
    ) async throws {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(messageID.urlPathEncoded)/move"
        )
        _ = try await client.request(
            url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: ["destinationId": destinationFolderID])
        )
    }

    public func trash(messageID: String) async throws {
        try await move(messageID: messageID, from: "", to: "deleteditems")
    }

    public func archive(messageID: String, from sourceFolderID: String) async throws {
        try await move(messageID: messageID, from: sourceFolderID, to: "archive")
    }

    public func markJunk(messageID: String, isJunk: Bool) async throws {
        try await move(messageID: messageID, from: "", to: isJunk ? "junkemail" : "inbox")
    }

    public func setFlagged(messageID: String, isFlagged: Bool) async throws {
        try await patchMessage(
            messageID,
            body: ["flag": ["flagStatus": isFlagged ? "flagged" : "notFlagged"]]
        )
    }

    public func setImportant(messageID: String, isImportant: Bool) async throws {
        try await patchMessage(messageID, body: ["importance": isImportant ? "high" : "normal"])
    }

    public func listPeople(query: String?) async throws -> [PersonSuggestion] {
        var items = [
            URLQueryItem(name: "$top", value: "10"),
            URLQueryItem(name: "$select", value: "id,displayName,scoredEmailAddresses,userPrincipalName"),
        ]
        if let query = query?.trimmingCharacters(in: .whitespacesAndNewlines),
           !query.isEmpty {
            items.append(.init(name: "$search", value: "\"\(query.replacingOccurrences(of: "\"", with: "\\\""))\""))
        }
        let url = try URL.courrier(Self.base, path: "/v1.0/me/people", queryItems: items)
        let people = try await client.json(GraphCollection<GraphPerson>.self, from: url)
        var emails: Set<String> = []
        return (people.value ?? []).compactMap { person in
            guard let email = person.scoredEmailAddresses?
                .compactMap(\.address)
                .first(where: { !$0.isEmpty }) ?? person.userPrincipalName,
                  !email.isEmpty,
                  emails.insert(email.lowercased()).inserted else {
                return nil
            }
            return PersonSuggestion(
                id: person.id ?? email.lowercased(),
                name: person.displayName?.nilIfEmpty ?? email,
                email: email
            )
        }
    }

    public func listDrafts() async throws -> [ProviderDraft] {
        var drafts: [ProviderDraft] = []
        var url: URL? = try URL.courrier(
            Self.base,
            path: "/v1.0/me/mailFolders/drafts/messages",
            queryItems: [
                .init(name: "$top", value: "100"),
                .init(
                    name: "$select",
                    value: "\(Self.detailSelect),lastModifiedDateTime"
                ),
                .init(
                    name: "$expand",
                    value: "attachments($select=\(Self.attachmentSelect))"
                ),
            ]
        )
        while let pageURL = url {
            let page = try await client.json(
                GraphCollection<GraphMessageDTO>.self,
                from: pageURL
            )
            drafts += (page.value ?? []).compactMap {
                guard $0.id?.isEmpty == false else { return nil }
                return providerDraft(from: $0)
            }
            url = try page.nextLink.map(validatedPageURL)
        }
        return drafts
    }

    public func getDraft(id: String) async throws -> ProviderDraft {
        providerDraft(from: try await graphDraft(id: id))
    }

    public func saveDraft(_ request: DraftSaveRequest) async throws -> ProviderDraft {
        let draftID: String
        var existing: GraphMessageDTO?

        if let providerDraftID = request.providerDraftID {
            draftID = providerDraftID
            existing = try await graphDraft(id: providerDraftID)
        } else if let kind = request.kind, let original = request.original {
            let action: String = switch kind {
            case .reply: "createReply"
            case .replyAll: "createReplyAll"
            case .forward: "createForward"
            }
            let url = try URL.courrier(
                Self.base,
                path: "/v1.0/me/messages/\(original.id.urlPathEncoded)/\(action)"
            )
            let created = try await client.json(
                GraphMessageDTO.self,
                from: url,
                method: "POST",
                headers: ["Content-Type": "application/json"]
            )
            guard let id = created.id else {
                throw CourrierError.invalidResponse(
                    "Microsoft did not return a response draft identifier."
                )
            }
            draftID = id
            existing = created
        } else {
            draftID = try await createDraft(payload: messagePayload(request.message))
            existing = try await graphDraft(id: draftID)
        }

        var payload = messagePayload(request.message)
        payload["body"] = [
            "contentType": "HTML",
            "content": responseDraftBody(request),
        ]
        try await patchMessage(draftID, body: payload)
        try await reconcileDraftAttachments(
            existing: existing?.attachments ?? [],
            requested: request.message.attachments,
            draftID: draftID
        )
        let saved = try await graphDraft(id: draftID)
        return providerDraft(
            from: saved,
            kind: request.kind,
            relatedMessageID: request.original?.id,
            requestedAttachments: request.message.attachments
        )
    }

    public func deleteDraft(id: String) async throws {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(id.urlPathEncoded)"
        )
        _ = try await client.request(url, method: "DELETE")
    }

    public func sendDraft(id: String) async throws {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(id.urlPathEncoded)/send"
        )
        _ = try await client.request(url, method: "POST")
    }

    public func send(_ message: ComposeMessage) async throws {
        if message.attachments.isEmpty {
            let payload: [String: Any] = [
                "message": messagePayload(message),
                "saveToSentItems": true,
            ]
            let url = try URL.courrier(Self.base, path: "/v1.0/me/sendMail")
            _ = try await client.request(
                url,
                method: "POST",
                headers: ["Content-Type": "application/json"],
                body: try JSONSerialization.data(withJSONObject: payload)
            )
            return
        }

        let draft = try await createDraft(payload: messagePayload(message))
        try await addAttachments(message.attachments, to: draft)
        try await sendDraft(id: draft)
    }

    public func reply(_ reply: ReplyMessage) async throws {
        let action: String
        switch reply.kind {
        case .reply: action = "createReply"
        case .replyAll: action = "createReplyAll"
        case .forward: action = "createForward"
        }
        let createURL = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(reply.original.id.urlPathEncoded)/\(action)"
        )
        let draft = try await client.json(
            GraphMessageDTO.self,
            from: createURL,
            method: "POST",
            headers: ["Content-Type": "application/json"]
        )
        guard let draftID = draft.id else {
            throw CourrierError.invalidResponse("Microsoft did not return a response draft.")
        }

        var patch = messagePayload(reply.message)
        let originalBody = draft.body?.content ?? ""
        patch["body"] = [
            "contentType": "HTML",
            "content": "\(reply.message.bodyHTML)<br><br>\(originalBody)",
        ]
        try await patchMessage(draftID, body: patch)
        try await addAttachments(reply.message.attachments, to: draftID)
        try await sendDraft(id: draftID)
    }

    public func downloadAttachment(
        messageID: String,
        attachmentID: String
    ) async throws -> DownloadedAttachment {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(messageID.urlPathEncoded)/attachments/\(attachmentID.urlPathEncoded)"
        )
        let attachment = try await client.json(GraphAttachmentDTO.self, from: url)
        guard attachment.odataType == nil
                || attachment.odataType == "#microsoft.graph.fileAttachment",
              let bytes = attachment.contentBytes,
              let data = Data(base64Encoded: bytes) else {
            throw CourrierError.invalidResponse("Microsoft did not return this attachment.")
        }
        return DownloadedAttachment(
            name: attachment.name?.nilIfEmpty ?? "attachment",
            contentType: attachment.contentType?.nilIfEmpty ?? "application/octet-stream",
            data: data
        )
    }

    public func createPushSubscription(
        clientState: String,
        expirationDateTime: String,
        notificationURL: URL
    ) async throws -> MailPushSubscription {
        let url = try URL.courrier(Self.base, path: "/v1.0/subscriptions")
        let payload: [String: Any] = [
            "changeType": "created,updated,deleted",
            "notificationUrl": notificationURL.absoluteString,
            "lifecycleNotificationUrl": notificationURL.absoluteString,
            "resource": "me/messages",
            "expirationDateTime": expirationDateTime,
            "clientState": clientState,
        ]
        return try await client.json(
            MailPushSubscription.self,
            from: url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
    }

    public func renewPushSubscription(
        id: String,
        expirationDateTime: String
    ) async throws -> MailPushSubscription {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/subscriptions/\(id.urlPathEncoded)"
        )
        return try await client.json(
            MailPushSubscription.self,
            from: url,
            method: "PATCH",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(
                withJSONObject: ["expirationDateTime": expirationDateTime]
            )
        )
    }

    public func deletePushSubscription(id: String) async throws {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/subscriptions/\(id.urlPathEncoded)"
        )
        _ = try await client.request(url, method: "DELETE")
    }

    private func fetchFolderTree(path: String, depth: Int) async throws -> [MailFolder] {
        var url: URL? = try URL.courrier(
            Self.base,
            path: path,
            queryItems: [
                .init(name: "$top", value: "100"),
                .init(
                    name: "$select",
                    value: "id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount,isHidden"
                ),
            ]
        )
        var result: [MailFolder] = []
        while let pageURL = url {
            let page = try await client.json(GraphCollection<GraphFolderDTO>.self, from: pageURL)
            for value in page.value ?? [] where value.isHidden != true {
                let mapped = MicrosoftGraphMapper.folder(value, depth: depth)
                guard !mapped.id.isEmpty else { continue }
                result.append(mapped)
                if mapped.hasChildren {
                    result += try await fetchFolderTree(
                        path: "/v1.0/me/mailFolders/\(mapped.id.urlPathEncoded)/childFolders",
                        depth: depth + 1
                    )
                }
            }
            url = try page.nextLink.map(validatedPageURL)
        }
        return result
    }

    private func patchMessage(_ messageID: String, body: [String: Any]) async throws {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(messageID.urlPathEncoded)"
        )
        _ = try await client.request(
            url,
            method: "PATCH",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: body)
        )
    }

    private func createDraft(payload: [String: Any]) async throws -> String {
        let url = try URL.courrier(Self.base, path: "/v1.0/me/messages")
        let draft = try await client.json(
            GraphMessageDTO.self,
            from: url,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
        guard let id = draft.id else {
            throw CourrierError.invalidResponse("Microsoft did not return a draft identifier.")
        }
        return id
    }

    private func addAttachments(_ attachments: [ComposeAttachment], to draftID: String) async throws {
        for attachment in attachments {
            if attachment.data.count < 3 * 1024 * 1024 {
                let url = try URL.courrier(
                    Self.base,
                    path: "/v1.0/me/messages/\(draftID.urlPathEncoded)/attachments"
                )
                let payload: [String: Any] = [
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": attachment.name,
                    "contentType": attachment.contentType,
                    "contentBytes": attachment.data.base64EncodedString(),
                ]
                _ = try await client.request(
                    url,
                    method: "POST",
                    headers: ["Content-Type": "application/json"],
                    body: try JSONSerialization.data(withJSONObject: payload)
                )
            } else {
                try await uploadLargeAttachment(attachment, to: draftID)
            }
        }
    }

    private func uploadLargeAttachment(_ attachment: ComposeAttachment, to draftID: String) async throws {
        let sessionURL = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(draftID.urlPathEncoded)/attachments/createUploadSession"
        )
        let payload: [String: Any] = [
            "AttachmentItem": [
                "attachmentType": "file",
                "name": attachment.name,
                "size": attachment.data.count,
                "contentType": attachment.contentType,
            ],
        ]
        let session = try await client.json(
            GraphUploadSession.self,
            from: sessionURL,
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
        guard let uploadURL = URL(string: session.uploadUrl) else {
            throw CourrierError.invalidResponse("Microsoft returned an invalid attachment upload URL.")
        }

        let chunkSize = 3_276_800
        var offset = 0
        while offset < attachment.data.count {
            let end = min(offset + chunkSize, attachment.data.count)
            let chunk = attachment.data.subdata(in: offset..<end)
            var request = URLRequest(url: uploadURL)
            request.httpMethod = "PUT"
            request.httpBody = chunk
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue(String(chunk.count), forHTTPHeaderField: "Content-Length")
            request.setValue(
                "bytes \(offset)-\(end - 1)/\(attachment.data.count)",
                forHTTPHeaderField: "Content-Range"
            )
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode) else {
                throw CourrierError.invalidResponse("Microsoft could not upload \(attachment.name).")
            }
            offset = end
        }
    }

    private func messagePayload(_ message: ComposeMessage) -> [String: Any] {
        [
            "subject": message.subject,
            "body": ["contentType": "HTML", "content": message.bodyHTML],
            "toRecipients": message.to.map(graphRecipient),
            "ccRecipients": message.cc.map(graphRecipient),
            "bccRecipients": message.bcc.map(graphRecipient),
        ]
    }

    private func graphDraft(id: String) async throws -> GraphMessageDTO {
        let url = try URL.courrier(
            Self.base,
            path: "/v1.0/me/messages/\(id.urlPathEncoded)",
            queryItems: [
                .init(
                    name: "$select",
                    value: "\(Self.detailSelect),lastModifiedDateTime"
                ),
                .init(
                    name: "$expand",
                    value: "attachments($select=\(Self.attachmentSelect))"
                ),
            ]
        )
        return try await client.json(GraphMessageDTO.self, from: url)
    }

    private func providerDraft(
        from value: GraphMessageDTO,
        kind: ReplyKind? = nil,
        relatedMessageID: String? = nil,
        requestedAttachments: [ComposeAttachment] = []
    ) -> ProviderDraft {
        let attachments = (value.attachments ?? []).compactMap { item -> ComposeAttachment? in
            guard item.odataType == "#microsoft.graph.fileAttachment",
                  item.isInline != true,
                  let id = item.id else {
                return nil
            }
            let local = requestedAttachments.first {
                $0.providerAttachmentID == id
                    || ($0.providerAttachmentID == nil
                        && $0.name == (item.name ?? "")
                        && $0.data.count == (item.size ?? -1))
            }
            return ComposeAttachment(
                id: local?.id ?? UUID(),
                name: item.name?.nilIfEmpty ?? "attachment",
                contentType: item.contentType?.nilIfEmpty ?? "application/octet-stream",
                data: local?.data ?? Data(),
                providerAttachmentID: id
            )
        }
        return ProviderDraft(
            providerDraftID: value.id ?? "",
            providerMessageID: value.id,
            accountID: account.id,
            kind: kind ?? inferredDraftKind(subject: value.subject ?? ""),
            relatedMessageID: relatedMessageID,
            threadID: value.conversationId,
            to: graphAddresses(value.toRecipients),
            cc: graphAddresses(value.ccRecipients),
            bcc: graphAddresses(value.bccRecipients),
            subject: value.subject ?? "",
            bodyHTML: value.body?.content ?? "",
            attachments: attachments,
            updatedAt: graphDate(value.lastModifiedDateTime)
                ?? graphDate(value.receivedDateTime)
                ?? .distantPast
        )
    }

    private func graphDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func graphAddresses(_ values: [GraphEmailAddressDTO]?) -> [MailAddress] {
        (values ?? []).compactMap { value in
            guard let email = value.emailAddress?.address, !email.isEmpty else { return nil }
            return MailAddress(name: value.emailAddress?.name ?? "", email: email)
        }
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

    private func responseDraftBody(_ request: DraftSaveRequest) -> String {
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

    private func reconcileDraftAttachments(
        existing: [GraphAttachmentDTO],
        requested: [ComposeAttachment],
        draftID: String
    ) async throws {
        let retainedIDs = Set(requested.compactMap(\.providerAttachmentID))
        for attachment in existing {
            guard attachment.odataType == "#microsoft.graph.fileAttachment",
                  attachment.isInline != true,
                  let id = attachment.id,
                  !retainedIDs.contains(id) else {
                continue
            }
            let url = try URL.courrier(
                Self.base,
                path: "/v1.0/me/messages/\(draftID.urlPathEncoded)/attachments/\(id.urlPathEncoded)"
            )
            _ = try await client.request(url, method: "DELETE")
        }
        let additions = requested.filter { $0.providerAttachmentID == nil }
        try await addAttachments(additions, to: draftID)
    }

    private func graphRecipient(_ address: MailAddress) -> [String: Any] {
        ["emailAddress": ["name": address.name, "address": address.email]]
    }

    private func validatedPageURL(_ value: String) throws -> URL {
        guard let url = URL(string: value),
              url.scheme == "https",
              url.host == "graph.microsoft.com",
              url.path.hasPrefix("/v1.0/me/") else {
            throw CourrierError.invalidResponse(
                "Courrier refused an unexpected Microsoft pagination URL."
            )
        }
        return url
    }
}

private struct GraphCollection<Value: Decodable & Sendable>: Decodable, Sendable {
    let value: [Value]?
    let nextLink: String?

    enum CodingKeys: String, CodingKey {
        case value
        case nextLink = "@odata.nextLink"
    }
}

private struct GraphPerson: Decodable, Sendable {
    struct ScoredEmail: Decodable, Sendable {
        let address: String?
    }

    let id: String?
    let displayName: String?
    let scoredEmailAddresses: [ScoredEmail]?
    let userPrincipalName: String?
}

private struct GraphUploadSession: Decodable, Sendable {
    let uploadUrl: String
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }

    var urlPathEncoded: String {
        addingPercentEncoding(
            withAllowedCharacters: CharacterSet.alphanumerics.union(
                CharacterSet(charactersIn: "-._~")
            )
        ) ?? self
    }
}
