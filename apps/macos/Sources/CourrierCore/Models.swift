import Foundation

public enum ProviderID: String, Codable, CaseIterable, Identifiable, Sendable {
    case microsoft
    case google

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .microsoft: "Microsoft Outlook"
        case .google: "Google Gmail"
        }
    }
}

public struct MailAccount: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let providerID: ProviderID
    public let providerAccountID: String
    public let email: String
    public let name: String

    public init(
        id: String,
        providerID: ProviderID,
        providerAccountID: String,
        email: String,
        name: String
    ) {
        self.id = id
        self.providerID = providerID
        self.providerAccountID = providerAccountID
        self.email = email
        self.name = name
    }
}

public enum FolderIcon: String, Codable, Sendable {
    case inbox
    case sent
    case folder
    case drafts
    case junk
    case archive
    case trash
    case starred
    case important

    public var systemName: String {
        switch self {
        case .inbox: "tray"
        case .sent: "paperplane"
        case .folder: "folder"
        case .drafts: "doc"
        case .junk: "xmark.bin"
        case .archive: "archivebox"
        case .trash: "trash"
        case .starred: "star"
        case .important: "exclamationmark.bubble"
        }
    }
}

public struct MailFolder: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let icon: FolderIcon
    public let unreadCount: Int
    public let totalCount: Int
    public let parentFolderID: String?
    public let wellKnownName: String?
    public let hasChildren: Bool
    public let depth: Int

    public init(
        id: String,
        label: String,
        icon: FolderIcon = .folder,
        unreadCount: Int = 0,
        totalCount: Int = 0,
        parentFolderID: String? = nil,
        wellKnownName: String? = nil,
        hasChildren: Bool = false,
        depth: Int = 0
    ) {
        self.id = id
        self.label = label
        self.icon = icon
        self.unreadCount = unreadCount
        self.totalCount = totalCount
        self.parentFolderID = parentFolderID
        self.wellKnownName = wellKnownName
        self.hasChildren = hasChildren
        self.depth = depth
    }
}

public struct MailAddress: Codable, Hashable, Sendable {
    public let name: String
    public let email: String

    public init(name: String = "", email: String) {
        self.name = name
        self.email = email
    }

    public var formatted: String {
        name.isEmpty ? email : "\(name) <\(email)>"
    }
}

public enum MailImportance: String, Codable, Sendable {
    case low
    case normal
    case high
}

public struct MailAttachment: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let contentType: String
    public let size: Int
    public let isInline: Bool

    public init(
        id: String,
        name: String,
        contentType: String = "application/octet-stream",
        size: Int,
        isInline: Bool = false
    ) {
        self.id = id
        self.name = name
        self.contentType = contentType
        self.size = size
        self.isInline = isInline
    }
}

public struct MailMessageSummary: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let folderID: String
    public let folderLabel: String?
    public let folderWellKnownName: String?
    public let matchedFolderIDs: [String]
    public let sender: MailAddress
    public let recipients: [String]
    public let ccRecipients: [String]
    public let replyTo: [MailAddress]
    public let subject: String
    public let preview: String
    public let receivedDateTime: String
    public var isRead: Bool
    public let hasAttachments: Bool
    public let importance: MailImportance
    public var isStarred: Bool
    public var isFlagged: Bool
    public var isImportant: Bool
    public let internetMessageID: String?
    public let threadID: String?
    public let conversationID: String?

    public init(
        id: String,
        folderID: String,
        folderLabel: String? = nil,
        folderWellKnownName: String? = nil,
        matchedFolderIDs: [String] = [],
        sender: MailAddress,
        recipients: [String] = [],
        ccRecipients: [String] = [],
        replyTo: [MailAddress] = [],
        subject: String,
        preview: String,
        receivedDateTime: String,
        isRead: Bool,
        hasAttachments: Bool,
        importance: MailImportance = .normal,
        isStarred: Bool = false,
        isFlagged: Bool = false,
        isImportant: Bool = false,
        internetMessageID: String? = nil,
        threadID: String? = nil,
        conversationID: String? = nil
    ) {
        self.id = id
        self.folderID = folderID
        self.folderLabel = folderLabel
        self.folderWellKnownName = folderWellKnownName
        self.matchedFolderIDs = matchedFolderIDs
        self.sender = sender
        self.recipients = recipients
        self.ccRecipients = ccRecipients
        self.replyTo = replyTo
        self.subject = subject
        self.preview = preview
        self.receivedDateTime = receivedDateTime
        self.isRead = isRead
        self.hasAttachments = hasAttachments
        self.importance = importance
        self.isStarred = isStarred
        self.isFlagged = isFlagged
        self.isImportant = isImportant
        self.internetMessageID = internetMessageID
        self.threadID = threadID
        self.conversationID = conversationID
    }

    public var date: Date {
        ISO8601DateFormatter.fractional.date(from: receivedDateTime)
            ?? ISO8601DateFormatter().date(from: receivedDateTime)
            ?? Date.distantPast
    }
}

public struct MailMessageDetail: Codable, Hashable, Identifiable, Sendable {
    public var summary: MailMessageSummary
    public let bodyContentType: BodyContentType
    public let bodyContent: String
    public let attachments: [MailAttachment]

    public init(
        summary: MailMessageSummary,
        bodyContentType: BodyContentType,
        bodyContent: String,
        attachments: [MailAttachment] = []
    ) {
        self.summary = summary
        self.bodyContentType = bodyContentType
        self.bodyContent = bodyContent
        self.attachments = attachments
    }

    public var id: String { summary.id }
}

public enum BodyContentType: String, Codable, Sendable {
    case html
    case text
}

public struct PagedMessages: Sendable {
    public let messages: [MailMessageSummary]
    public let nextPageToken: String?

    public init(messages: [MailMessageSummary], nextPageToken: String? = nil) {
        self.messages = messages
        self.nextPageToken = nextPageToken
    }
}

public enum MailSearchScope: String, CaseIterable, Identifiable, Sendable {
    case folder
    case all

    public var id: String { rawValue }
}

public enum MailActionCapability: String, Sendable {
    case archive
    case junk
    case star
    case flag
    case important
}

public struct PersonSuggestion: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let email: String

    public init(id: String, name: String, email: String) {
        self.id = id
        self.name = name
        self.email = email
    }
}

public struct ComposeAttachment: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let contentType: String
    public let data: Data
    public let providerAttachmentID: String?

    public init(
        id: UUID = UUID(),
        name: String,
        contentType: String = "application/octet-stream",
        data: Data,
        providerAttachmentID: String? = nil
    ) {
        self.id = id
        self.name = name
        self.contentType = contentType
        self.data = data
        self.providerAttachmentID = providerAttachmentID
    }
}

public struct ComposeMessage: Sendable {
    public let to: [MailAddress]
    public let cc: [MailAddress]
    public let bcc: [MailAddress]
    public let subject: String
    public let bodyHTML: String
    public let attachments: [ComposeAttachment]

    public init(
        to: [MailAddress],
        cc: [MailAddress] = [],
        bcc: [MailAddress] = [],
        subject: String,
        bodyHTML: String,
        attachments: [ComposeAttachment] = []
    ) {
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.bodyHTML = bodyHTML
        self.attachments = attachments
    }
}

public enum ReplyKind: String, Codable, Sendable {
    case reply
    case replyAll
    case forward
}

public struct ReplyMessage: Sendable {
    public let kind: ReplyKind
    public let original: MailMessageDetail
    public let message: ComposeMessage

    public init(kind: ReplyKind, original: MailMessageDetail, message: ComposeMessage) {
        self.kind = kind
        self.original = original
        self.message = message
    }
}

public struct ProviderDraft: Identifiable, Sendable {
    public let providerDraftID: String
    public let providerMessageID: String?
    public let accountID: String
    public let kind: ReplyKind?
    public let relatedMessageID: String?
    public let threadID: String?
    public let to: [MailAddress]
    public let cc: [MailAddress]
    public let bcc: [MailAddress]
    public let subject: String
    public let bodyHTML: String
    public let attachments: [ComposeAttachment]
    public let updatedAt: Date

    public init(
        providerDraftID: String,
        providerMessageID: String? = nil,
        accountID: String,
        kind: ReplyKind? = nil,
        relatedMessageID: String? = nil,
        threadID: String? = nil,
        to: [MailAddress] = [],
        cc: [MailAddress] = [],
        bcc: [MailAddress] = [],
        subject: String = "",
        bodyHTML: String = "",
        attachments: [ComposeAttachment] = [],
        updatedAt: Date = Date()
    ) {
        self.providerDraftID = providerDraftID
        self.providerMessageID = providerMessageID
        self.accountID = accountID
        self.kind = kind
        self.relatedMessageID = relatedMessageID
        self.threadID = threadID
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.bodyHTML = bodyHTML
        self.attachments = attachments
        self.updatedAt = updatedAt
    }

    public var id: String { providerDraftID }
}

public struct DraftSaveRequest: Sendable {
    public let providerDraftID: String?
    public let providerMessageID: String?
    public let kind: ReplyKind?
    public let original: MailMessageDetail?
    public let threadID: String?
    public let message: ComposeMessage

    public init(
        providerDraftID: String? = nil,
        providerMessageID: String? = nil,
        kind: ReplyKind? = nil,
        original: MailMessageDetail? = nil,
        threadID: String? = nil,
        message: ComposeMessage
    ) {
        self.providerDraftID = providerDraftID
        self.providerMessageID = providerMessageID
        self.kind = kind
        self.original = original
        self.threadID = threadID
        self.message = message
    }
}

public struct DownloadedAttachment: Sendable {
    public let name: String
    public let contentType: String
    public let data: Data

    public init(name: String, contentType: String, data: Data) {
        self.name = name
        self.contentType = contentType
        self.data = data
    }
}

public enum CourrierError: LocalizedError, Sendable {
    case configuration(String)
    case authentication(String)
    case invalidResponse(String)
    case requestFailed(status: Int, message: String)
    case unsupported(String)

    public var errorDescription: String? {
        switch self {
        case .configuration(let message),
             .authentication(let message),
             .invalidResponse(let message),
             .unsupported(let message):
            message
        case .requestFailed(let status, let message):
            "Request failed (\(status)): \(message)"
        }
    }
}

extension ISO8601DateFormatter {
    fileprivate static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
