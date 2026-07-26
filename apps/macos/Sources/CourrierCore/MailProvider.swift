import Foundation

public protocol MailProvider: Sendable {
    var id: ProviderID { get }

    func capabilities() async -> Set<MailActionCapability>
    func listFolders() async throws -> [MailFolder]
    func listMessages(
        folderID: String,
        nextPageToken: String?,
        search: String?
    ) async throws -> PagedMessages
    func searchMessages(
        query: String,
        scope: MailSearchScope,
        folderID: String?,
        nextPageToken: String?
    ) async throws -> PagedMessages
    func getMessage(folderID: String, messageID: String) async throws -> MailMessageDetail
    func markRead(messageID: String, isRead: Bool) async throws
    func move(messageID: String, from sourceFolderID: String, to destinationFolderID: String) async throws
    func trash(messageID: String) async throws
    func archive(messageID: String, from sourceFolderID: String) async throws
    func markJunk(messageID: String, isJunk: Bool) async throws
    func setStarred(messageID: String, isStarred: Bool) async throws
    func setFlagged(messageID: String, isFlagged: Bool) async throws
    func setImportant(messageID: String, isImportant: Bool) async throws
    func listPeople(query: String?) async throws -> [PersonSuggestion]
    func listDrafts() async throws -> [ProviderDraft]
    func getDraft(id: String) async throws -> ProviderDraft
    func saveDraft(_ request: DraftSaveRequest) async throws -> ProviderDraft
    func deleteDraft(id: String) async throws
    func sendDraft(id: String) async throws
    func send(_ message: ComposeMessage) async throws
    func reply(_ reply: ReplyMessage) async throws
    func downloadAttachment(messageID: String, attachmentID: String) async throws -> DownloadedAttachment
}

public struct MailPushSubscription: Codable, Sendable {
    public let id: String
    public let expirationDateTime: String
    public let resource: String?

    public init(id: String, expirationDateTime: String, resource: String? = nil) {
        self.id = id
        self.expirationDateTime = expirationDateTime
        self.resource = resource
    }
}

public protocol MailPushSubscriptionProvider: Sendable {
    func createPushSubscription(
        clientState: String,
        expirationDateTime: String,
        notificationURL: URL
    ) async throws -> MailPushSubscription
    func renewPushSubscription(
        id: String,
        expirationDateTime: String
    ) async throws -> MailPushSubscription
    func deletePushSubscription(id: String) async throws
}

public extension MailProvider {
    func searchMessages(
        query: String,
        scope: MailSearchScope,
        folderID: String?,
        nextPageToken: String?
    ) async throws -> PagedMessages {
        try await listMessages(
            folderID: folderID ?? "inbox",
            nextPageToken: nextPageToken,
            search: query
        )
    }

    func markJunk(messageID: String, isJunk: Bool) async throws {
        throw CourrierError.unsupported("Junk controls are not supported by this account.")
    }

    func setStarred(messageID: String, isStarred: Bool) async throws {
        throw CourrierError.unsupported("Stars are not supported by this account.")
    }

    func setFlagged(messageID: String, isFlagged: Bool) async throws {
        throw CourrierError.unsupported("Flags are not supported by this account.")
    }

    func setImportant(messageID: String, isImportant: Bool) async throws {
        throw CourrierError.unsupported("Importance is not supported by this account.")
    }
}

public enum ProviderRouting {
    public static func providerID(from accountID: String) -> ProviderID? {
        guard let prefix = accountID.split(separator: ":", maxSplits: 1).first else {
            return nil
        }
        return ProviderID(rawValue: String(prefix))
    }
}
