import AppKit
import Combine
import CourrierCore
import Foundation
import UniformTypeIdentifiers

@MainActor
final class ComposerModel: ObservableObject {
    @Published var draftID = UUID()
    @Published var to = ""
    @Published var cc = ""
    @Published var bcc = ""
    @Published var subject = ""
    @Published var body = NSAttributedString(string: "")
    @Published var attachments: [ComposeAttachment] = []
    @Published var showsCc = false
    @Published var showsBcc = false
    @Published private(set) var isSending = false
    @Published private(set) var autosaveState = AutosaveState.idle
    @Published var validationMessage: String?
    @Published private(set) var drafts: [PersistedDraft] = []
    @Published var recipientSuggestions: [PersonSuggestion] = []

    private(set) var accountID: String?
    private(set) var replyKind: ReplyKind?
    private(set) var original: MailMessageDetail?
    private var providerDraftID: String?
    private var providerMessageID: String?
    private var providerThreadID: String?
    private var autosaveDebounceTask: Task<Void, Never>?
    private var activeAutosaveTask: Task<Void, Never>?
    private var autosaveNeededAfterCurrent = false
    private var lastSavedSignature: String?
    private var finished = false
    private let mailbox: MailboxStore

    enum AutosaveState: String {
        case idle
        case saving
        case saved
        case failed
    }

    init(mailbox: MailboxStore) {
        self.mailbox = mailbox
    }

    var autosaveSignature: String {
        [
            draftID.uuidString, to, cc, bcc, subject, body.string,
            attachments.map(\.id.uuidString).joined(),
        ].joined(separator: "|")
    }

    func prepareNew(accountID requestedAccountID: String? = nil) {
        guard let accountID = requestedAccountID ?? mailbox.activeAccountID else { return }
        draftID = UUID()
        self.accountID = accountID
        replyKind = nil
        original = nil
        providerDraftID = nil
        providerMessageID = nil
        providerThreadID = nil
        to = ""
        cc = ""
        bcc = ""
        subject = ""
        body = NSAttributedString(string: "")
        attachments = []
        showsCc = false
        showsBcc = false
        validationMessage = nil
        autosaveState = .idle
        lastSavedSignature = nil
        finished = false
    }

    func prepareResponse(
        kind: ReplyKind,
        message: MailMessageDetail,
        accountID requestedAccountID: String? = nil
    ) {
        guard let accountID = requestedAccountID ?? mailbox.activeAccountID,
              let account = mailbox.accounts.first(where: { $0.id == accountID }) else {
            return
        }
        prepareNew(accountID: accountID)
        replyKind = kind
        original = message

        switch kind {
        case .reply:
            let target = message.summary.replyTo.first ?? message.summary.sender
            to = RecipientParser.serialize([target])
            subject = SubjectFormatter.reply(message.summary.subject)
        case .replyAll:
            var recipients = message.summary.replyTo.isEmpty
                ? [message.summary.sender]
                : message.summary.replyTo
            recipients += message.summary.recipients.flatMap {
                RecipientParser.parse($0).valid
            }
            recipients = deduplicated(recipients, excluding: account.email)
            let toEmails = Set(recipients.map { $0.email.lowercased() })
            let ccRecipients = deduplicated(
                message.summary.ccRecipients.flatMap {
                    RecipientParser.parse($0).valid
                },
                excluding: account.email
            ).filter { !toEmails.contains($0.email.lowercased()) }
            to = RecipientParser.serialize(recipients)
            cc = RecipientParser.serialize(ccRecipients)
            showsCc = !ccRecipients.isEmpty
            subject = SubjectFormatter.reply(message.summary.subject)
        case .forward:
            subject = SubjectFormatter.forward(message.summary.subject)
        }
    }

    func load(_ draft: PersistedDraft) {
        draftID = draft.id
        accountID = draft.accountID
        replyKind = draft.kind
        original = draft.original
        providerDraftID = draft.providerDraftID
        providerMessageID = draft.providerMessageID
        providerThreadID = draft.providerThreadID
        to = draft.to
        cc = draft.cc
        bcc = draft.bcc
        subject = draft.subject
        body = Self.attributedString(html: draft.bodyHTML)
        attachments = draft.attachments
        showsCc = !cc.isEmpty
        showsBcc = !bcc.isEmpty
        validationMessage = nil
        autosaveState = .saved
        lastSavedSignature = autosaveSignature
        finished = false
    }

    func refreshDrafts() async {
        let localDrafts = await mailbox.draftStore.drafts(
            accountID: mailbox.activeAccountID
        )
        let localProviderIDs = Set(localDrafts.compactMap(\.providerDraftID))
        let remote = (try? await mailbox.providerDrafts()) ?? []
        let remoteDrafts = remote
            .filter { !localProviderIDs.contains($0.providerDraftID) }
            .map { draft in
                PersistedDraft(
                    accountID: draft.accountID,
                    kind: draft.kind,
                    providerDraftID: draft.providerDraftID,
                    providerMessageID: draft.providerMessageID,
                    providerThreadID: draft.threadID,
                    to: RecipientParser.serialize(draft.to),
                    cc: RecipientParser.serialize(draft.cc),
                    bcc: RecipientParser.serialize(draft.bcc),
                    subject: draft.subject,
                    bodyHTML: draft.bodyHTML,
                    attachments: draft.attachments,
                    updatedAt: draft.updatedAt
                )
            }
        drafts = (localDrafts + remoteDrafts).sorted { $0.updatedAt > $1.updatedAt }
    }

    func deleteDraft(_ draft: PersistedDraft) async {
        if let providerDraftID = draft.providerDraftID {
            try? await mailbox.deleteProviderDraft(
                id: providerDraftID,
                accountID: draft.accountID
            )
        }
        try? await mailbox.draftStore.delete(id: draft.id)
        await refreshDrafts()
    }

    func scheduleAutosave() {
        guard !finished else { return }
        autosaveDebounceTask?.cancel()
        autosaveDebounceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(750))
            guard !Task.isCancelled, let self else { return }
            self.autosaveDebounceTask = nil
            self.enqueueAutosave()
        }
    }

    private func enqueueAutosave() {
        guard autosaveSignature != lastSavedSignature else { return }
        if activeAutosaveTask != nil {
            autosaveNeededAfterCurrent = true
            return
        }
        let signature = autosaveSignature
        activeAutosaveTask = Task { [weak self] in
            await self?.performAutosave()
            self?.finishAutosave(signature: signature)
        }
    }

    private func finishAutosave(signature: String) {
        activeAutosaveTask = nil
        if autosaveState == .saved || autosaveState == .idle {
            lastSavedSignature = signature
        }
        if autosaveNeededAfterCurrent || autosaveSignature != signature {
            autosaveNeededAfterCurrent = false
            scheduleAutosave()
        }
    }

    private func performAutosave() async {
        guard let accountID else { return }
        if autosaveState == .failed {
            validationMessage = nil
        }
        autosaveState = .saving
        do {
            let semanticallyEmpty = to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && cc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && bcc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && body.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && attachments.isEmpty
            if semanticallyEmpty, providerDraftID == nil {
                try? await mailbox.draftStore.delete(id: draftID)
                autosaveState = .idle
                return
            }

            var persisted = currentPersistedDraft(accountID: accountID)
            try await mailbox.draftStore.save(persisted)

            let saved = try await mailbox.saveProviderDraft(
                DraftSaveRequest(
                    providerDraftID: providerDraftID,
                    providerMessageID: providerMessageID,
                    kind: replyKind,
                    original: original,
                    threadID: providerThreadID,
                    message: composeMessage()
                ),
                accountID: accountID
            )
            providerDraftID = saved.providerDraftID
            providerMessageID = saved.providerMessageID
            providerThreadID = saved.threadID
            attachments = reconcileAttachments(saved.attachments, current: attachments)
            persisted = currentPersistedDraft(accountID: accountID)
            try await mailbox.draftStore.save(persisted)
            autosaveState = .saved
        } catch {
            autosaveState = .failed
            validationMessage = error.localizedDescription
        }
    }

    func send() async -> Bool {
        validationMessage = nil
        let toResult = RecipientParser.parse(to)
        let ccResult = RecipientParser.parse(cc)
        let bccResult = RecipientParser.parse(bcc)
        let invalid = toResult.invalid + ccResult.invalid + bccResult.invalid
        guard invalid.isEmpty else {
            validationMessage = "Check these addresses: \(invalid.joined(separator: ", "))"
            return false
        }
        guard !toResult.valid.isEmpty else {
            validationMessage = "Add at least one recipient."
            return false
        }
        let recipientCount = toResult.valid.count + ccResult.valid.count + bccResult.valid.count
        guard recipientCount <= 500 else {
            validationMessage = "A message can contain at most 500 recipients."
            return false
        }
        guard subject.count <= 998 else {
            validationMessage = "The subject can contain at most 998 characters."
            return false
        }
        guard attachments.count <= 100 else {
            validationMessage = "A message can contain at most 100 attachments."
            return false
        }
        guard !attachments.contains(where: { $0.data.count > 150 * 1024 * 1024 }) else {
            validationMessage = "Each attachment must be 150 MB or smaller."
            return false
        }
        guard accountID == mailbox.activeAccountID else {
            validationMessage = "Switch back to the account that owns this draft."
            return false
        }

        let html = bodyHTML()
        guard html.utf8.count <= 5_000_000 else {
            validationMessage = "The message body is too large."
            return false
        }
        let message = ComposeMessage(
            to: toResult.valid,
            cc: ccResult.valid,
            bcc: bccResult.valid,
            subject: subject,
            bodyHTML: html,
            attachments: attachments
        )
        isSending = true
        defer { isSending = false }
        do {
            autosaveDebounceTask?.cancel()
            autosaveDebounceTask = nil
            if let activeAutosaveTask {
                await activeAutosaveTask.value
            }
            let saved = try await mailbox.saveProviderDraft(
                DraftSaveRequest(
                    providerDraftID: providerDraftID,
                    providerMessageID: providerMessageID,
                    kind: replyKind,
                    original: original,
                    threadID: providerThreadID,
                    message: message
                ),
                accountID: accountID
            )
            providerDraftID = saved.providerDraftID
            try await mailbox.sendProviderDraft(
                id: saved.providerDraftID,
                accountID: accountID
            )
            try? await mailbox.draftStore.delete(id: draftID)
            lastSavedSignature = nil
            finished = true
            await refreshDrafts()
            return true
        } catch {
            validationMessage = error.localizedDescription
            return false
        }
    }

    func addFiles(_ urls: [URL]) {
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer {
                if access { url.stopAccessingSecurityScopedResource() }
            }
            guard let data = try? Data(contentsOf: url) else { continue }
            let contentType = UTType(filenameExtension: url.pathExtension)?
                .preferredMIMEType ?? "application/octet-stream"
            attachments.append(
                ComposeAttachment(
                    name: url.lastPathComponent,
                    contentType: contentType,
                    data: data
                )
            )
        }
    }

    func updateSuggestions(for value: String) async {
        let query = value
            .split(whereSeparator: { $0 == "," || $0 == ";" })
            .last?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let query, !query.isEmpty else {
            recipientSuggestions = []
            return
        }
        recipientSuggestions = await mailbox.people(query: query)
    }

    func chooseSuggestion(_ suggestion: PersonSuggestion, for field: RecipientFieldKind) {
        let address = MailAddress(name: suggestion.name, email: suggestion.email)
        switch field {
        case .to: to = appending(address, to: to)
        case .cc: cc = appending(address, to: cc)
        case .bcc: bcc = appending(address, to: bcc)
        }
        recipientSuggestions = []
    }

    func bodyHTML() -> String {
        let range = NSRange(location: 0, length: body.length)
        if let data = try? body.data(
            from: range,
            documentAttributes: [.documentType: NSAttributedString.DocumentType.html]
        ), let html = String(data: data, encoding: .utf8) {
            return HTMLSanitizer.sanitizeOutgoing(html)
        }
        return HTMLSanitizer.sanitizeOutgoing(
            HTMLSanitizer.plainTextToHTML(body.string)
        )
    }

    private func composeMessage() -> ComposeMessage {
        ComposeMessage(
            to: RecipientParser.parse(to).valid,
            cc: RecipientParser.parse(cc).valid,
            bcc: RecipientParser.parse(bcc).valid,
            subject: subject,
            bodyHTML: bodyHTML(),
            attachments: attachments
        )
    }

    private func currentPersistedDraft(accountID: String) -> PersistedDraft {
        PersistedDraft(
            id: draftID,
            accountID: accountID,
            kind: replyKind,
            original: original,
            providerDraftID: providerDraftID,
            providerMessageID: providerMessageID,
            providerThreadID: providerThreadID,
            to: to,
            cc: cc,
            bcc: bcc,
            subject: subject,
            bodyHTML: bodyHTML(),
            attachments: attachments
        )
    }

    private func reconcileAttachments(
        _ saved: [ComposeAttachment],
        current: [ComposeAttachment]
    ) -> [ComposeAttachment] {
        saved.map { remote in
            let local = current.first {
                $0.providerAttachmentID == remote.providerAttachmentID
                    || ($0.name == remote.name && $0.data.count == remote.data.count)
                    || ($0.name == remote.name && remote.data.isEmpty)
            }
            return ComposeAttachment(
                id: local?.id ?? remote.id,
                name: remote.name,
                contentType: remote.contentType,
                data: remote.data.isEmpty ? (local?.data ?? Data()) : remote.data,
                providerAttachmentID: remote.providerAttachmentID
            )
        }
    }

    private static func attributedString(html: String) -> NSAttributedString {
        let sanitized = HTMLSanitizer.sanitizeIncoming(html)
        guard let data = sanitized.data(using: .utf8),
              let value = try? NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue,
                ],
                documentAttributes: nil
              ) else {
            return NSAttributedString(string: "")
        }
        return value
    }

    func flushAutosave() async {
        guard !finished else { return }
        autosaveDebounceTask?.cancel()
        autosaveDebounceTask = nil
        if let activeAutosaveTask {
            await activeAutosaveTask.value
        }
        autosaveDebounceTask?.cancel()
        autosaveDebounceTask = nil
        guard autosaveSignature != lastSavedSignature else { return }
        await performAutosave()
        if autosaveState == .saved || autosaveState == .idle {
            lastSavedSignature = autosaveSignature
        }
    }

    func flushBeforeClose() {
        Task { [self] in
            await flushAutosave()
        }
    }

    private func deduplicated(_ values: [MailAddress], excluding email: String) -> [MailAddress] {
        var seen = Set([email.lowercased()])
        return values.filter {
            !$0.email.isEmpty && seen.insert($0.email.lowercased()).inserted
        }
    }

    private func appending(_ address: MailAddress, to value: String) -> String {
        let parts = value.split(whereSeparator: { $0 == "," || $0 == ";" })
        var prefix = parts.dropLast().map(String.init)
        prefix.append(RecipientParser.serialize([address]))
        return prefix.joined(separator: ", ") + ", "
    }
}

enum RecipientFieldKind {
    case to
    case cc
    case bcc
}
