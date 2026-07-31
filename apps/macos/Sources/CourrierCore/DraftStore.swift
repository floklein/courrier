import Foundation

public struct PersistedDraft: Codable, Identifiable, Sendable {
    public let id: UUID
    public let accountID: String
    public let kind: ReplyKind?
    public let original: MailMessageDetail?
    public var providerDraftID: String?
    public var providerMessageID: String?
    public var providerThreadID: String?
    public var to: String
    public var cc: String
    public var bcc: String
    public var subject: String
    public var bodyHTML: String
    public var attachments: [ComposeAttachment]
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        accountID: String,
        kind: ReplyKind? = nil,
        original: MailMessageDetail? = nil,
        providerDraftID: String? = nil,
        providerMessageID: String? = nil,
        providerThreadID: String? = nil,
        to: String = "",
        cc: String = "",
        bcc: String = "",
        subject: String = "",
        bodyHTML: String = "",
        attachments: [ComposeAttachment] = [],
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.accountID = accountID
        self.kind = kind
        self.original = original
        self.providerDraftID = providerDraftID
        self.providerMessageID = providerMessageID
        self.providerThreadID = providerThreadID
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.bodyHTML = bodyHTML
        self.attachments = attachments
        self.updatedAt = updatedAt
    }

    public var isEmpty: Bool {
        to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && cc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && bcc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && bodyHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && attachments.isEmpty
    }
}

public actor LocalDraftStore {
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()

    public init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let base = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? FileManager.default.temporaryDirectory
            self.fileURL = base
                .appendingPathComponent("Courrier", isDirectory: true)
                .appendingPathComponent("Drafts.json")
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
        decoder.dateDecodingStrategy = .iso8601
    }

    public func drafts(accountID: String? = nil) -> [PersistedDraft] {
        load()
            .filter { accountID == nil || $0.accountID == accountID }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public func draft(id: UUID) -> PersistedDraft? {
        load().first { $0.id == id }
    }

    public func save(_ draft: PersistedDraft) throws {
        var values = load()
        values.removeAll { $0.id == draft.id }
        if !draft.isEmpty {
            var updated = draft
            updated.updatedAt = Date()
            values.append(updated)
        }
        try persist(values)
    }

    public func delete(id: UUID) throws {
        try persist(load().filter { $0.id != id })
    }

    private func load() -> [PersistedDraft] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? decoder.decode([PersistedDraft].self, from: data)) ?? []
    }

    private func persist(_ drafts: [PersistedDraft]) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try encoder.encode(drafts).write(to: fileURL, options: .atomic)
    }
}
