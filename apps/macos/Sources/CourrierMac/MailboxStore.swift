import AppKit
import Combine
import CourrierCore
import Foundation

@MainActor
final class MailboxStore: ObservableObject {
    @Published private(set) var accounts: [MailAccount] = []
    @Published var activeAccountID: String?
    @Published private(set) var folders: [MailFolder] = []
    @Published var selectedFolderID: String?
    @Published private(set) var messages: [MailMessageSummary] = []
    @Published var selectedMessageIDs: Set<String> = []
    @Published private(set) var selectedMessage: MailMessageDetail?
    @Published private(set) var capabilities: Set<MailActionCapability> = []
    @Published var searchText = ""
    @Published var searchScope = MailSearchScope.folder
    @Published private(set) var isLoadingFolders = false
    @Published private(set) var isLoadingMessages = false
    @Published private(set) var isLoadingDetail = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var isPerformingAction = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var transientMessage: String?
    @Published private(set) var liveUpdatesActive = false

    let configuration: AppConfiguration
    let repository: AccountRepository
    let draftStore: LocalDraftStore

    private let tokenBroker: AccessTokenBroker
    private var provider: (any MailProvider)?
    private var nextPageToken: String?
    private var appliedSearchText = ""
    private var relayClient: RelayLiveUpdateClient?
    private var knownInboxMessageIDs: Set<String>?
    private var transientTask: Task<Void, Never>?
    private var delayedReadTask: Task<Void, Never>?
    private var accountGeneration: UInt64 = 0
    private var folderRequestGeneration: UInt64 = 0
    private var messageRequestGeneration: UInt64 = 0
    private var detailRequestGeneration: UInt64 = 0
    private var actionRequestGeneration: UInt64 = 0

    var activeAccount: MailAccount? {
        accounts.first { $0.id == activeAccountID }
    }

    var selectedSummaries: [MailMessageSummary] {
        messages.filter { selectedMessageIDs.contains($0.id) }
    }

    init(
        configuration: AppConfiguration = .load(),
        repository: AccountRepository = AccountRepository(),
        draftStore: LocalDraftStore = LocalDraftStore()
    ) {
        self.configuration = configuration
        self.repository = repository
        self.draftStore = draftStore
        self.tokenBroker = AccessTokenBroker(
            configuration: configuration,
            repository: repository
        )
    }

    func load() async {
        accounts = await repository.accounts()
        guard !accounts.isEmpty else { return }
        let preferredID = UserDefaults.standard.string(forKey: "courrier.activeAccountID")
        let accountID = accounts.contains(where: { $0.id == preferredID })
            ? preferredID
            : accounts.first?.id
        await activate(accountID: accountID)
    }

    func signIn(provider providerID: ProviderID) async {
        clearError()
        do {
            let service = OAuthSignInService(
                configuration: configuration,
                repository: repository,
                openBrowser: { url in
                    await MainActor.run { NSWorkspace.shared.open(url) }
                }
            )
            let account = try await service.signIn(to: providerID)
            accounts = await repository.accounts()
            await activate(accountID: account.id)
        } catch {
            present(error)
        }
    }

    func signOut(accountID: String) async {
        do {
            let signingOutActiveAccount = accountID == activeAccountID
            if signingOutActiveAccount {
                accountGeneration &+= 1
                delayedReadTask?.cancel()
                delayedReadTask = nil
                await stopRelay(deleteRemote: true)
            }
            try await repository.remove(accountID: accountID)
            accounts = await repository.accounts()
            if signingOutActiveAccount, activeAccountID == accountID {
                await activate(accountID: accounts.first?.id)
            }
        } catch {
            present(error)
        }
    }

    func activate(accountID: String?) async {
        accountGeneration &+= 1
        let generation = accountGeneration
        delayedReadTask?.cancel()
        delayedReadTask = nil
        await stopRelay(deleteRemote: false)
        guard generation == accountGeneration else { return }
        activeAccountID = accountID
        selectedFolderID = nil
        selectedMessageIDs = []
        selectedMessage = nil
        folders = []
        messages = []
        nextPageToken = nil
        knownInboxMessageIDs = nil
        errorMessage = nil
        guard let accountID, let account = accounts.first(where: { $0.id == accountID }) else {
            provider = nil
            return
        }

        UserDefaults.standard.set(accountID, forKey: "courrier.activeAccountID")
        let broker = tokenBroker
        let accountTokenID = account.id
        let client = AuthorizedHTTPClient { forceRefresh in
            try await broker.accessToken(
                for: accountTokenID,
                forceRefresh: forceRefresh
            )
        }
        switch account.providerID {
        case .microsoft:
            provider = MicrosoftGraphProvider(account: account, client: client)
        case .google:
            provider = GmailProvider(
                account: account,
                client: client,
                pubSubTopic: configuration.googlePubSubTopic
            )
        }

        await loadFolders()
        guard generation == accountGeneration,
              activeAccountID == accountID else {
            return
        }
        if let provider {
            capabilities = await provider.capabilities()
        }
        guard generation == accountGeneration,
              activeAccountID == accountID else {
            return
        }
        let preferredFolder = folders.first(where: {
            $0.wellKnownName == "inbox"
        }) ?? folders.first
        selectedFolderID = preferredFolder?.id
        await loadMessages(reset: true)
        guard generation == accountGeneration,
              activeAccountID == accountID else {
            return
        }
        await startRelay()
    }

    func loadFolders() async {
        guard let provider else { return }
        folderRequestGeneration &+= 1
        let requestGeneration = folderRequestGeneration
        let generation = accountGeneration
        let accountID = activeAccountID
        isLoadingFolders = true
        defer {
            if requestGeneration == folderRequestGeneration {
                isLoadingFolders = false
            }
        }
        do {
            let loadedFolders = try await provider.listFolders()
            guard requestGeneration == folderRequestGeneration,
                  generation == accountGeneration,
                  accountID == activeAccountID else {
                return
            }
            folders = loadedFolders
        } catch {
            if requestGeneration == folderRequestGeneration,
               generation == accountGeneration,
               accountID == activeAccountID {
                present(error)
            }
        }
    }

    func selectFolder(_ folderID: String?) async {
        guard selectedFolderID == folderID else { return }
        selectedFolderID = folderID
        selectedMessageIDs = []
        selectedMessage = nil
        if searchScope == .folder {
            searchText = ""
            appliedSearchText = ""
        }
        await loadMessages(reset: true)
    }

    func applySearch() async {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != appliedSearchText else { return }
        appliedSearchText = trimmed
        selectedMessageIDs = []
        selectedMessage = nil
        await loadMessages(reset: true)
    }

    func searchScopeChanged() async {
        appliedSearchText = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        await loadMessages(reset: true)
    }

    func loadMessages(reset: Bool) async {
        guard let provider, let folderID = selectedFolderID else { return }
        messageRequestGeneration &+= 1
        let requestGeneration = messageRequestGeneration
        let generation = accountGeneration
        let accountID = activeAccountID
        let searchText = appliedSearchText
        let scope = searchScope
        if reset {
            isLoadingMessages = true
            nextPageToken = nil
        } else {
            guard nextPageToken != nil, !isLoadingMore else { return }
            isLoadingMore = true
        }
        defer {
            if requestGeneration == messageRequestGeneration {
                isLoadingMessages = false
                isLoadingMore = false
            }
        }

        do {
            let page: PagedMessages
            if searchText.isEmpty {
                page = try await provider.listMessages(
                    folderID: folderID,
                    nextPageToken: reset ? nil : nextPageToken,
                    search: nil
                )
            } else {
                page = try await provider.searchMessages(
                    query: searchText,
                    scope: scope,
                    folderID: folderID,
                    nextPageToken: reset ? nil : nextPageToken
                )
            }
            guard requestGeneration == messageRequestGeneration,
                  generation == accountGeneration,
                  accountID == activeAccountID,
                  folderID == selectedFolderID,
                  searchText == appliedSearchText,
                  scope == searchScope else {
                return
            }
            messages = reset ? page.messages : merge(messages, with: page.messages)
            nextPageToken = page.nextPageToken
            if reset, isInbox(folderID), appliedSearchText.isEmpty {
                detectNewInboxMessages(page.messages)
            }
        } catch {
            if requestGeneration == messageRequestGeneration,
               generation == accountGeneration,
               accountID == activeAccountID,
               folderID == selectedFolderID {
                present(error)
            }
        }
    }

    func loadMoreIfNeeded(after message: MailMessageSummary) async {
        guard message.id == messages.last?.id, nextPageToken != nil else { return }
        await loadMessages(reset: false)
    }

    func selectionChanged() async {
        delayedReadTask?.cancel()
        guard let id = selectedMessageIDs.first,
              let summary = messages.first(where: { $0.id == id }),
              let provider else {
            detailRequestGeneration &+= 1
            selectedMessage = nil
            return
        }
        detailRequestGeneration &+= 1
        let requestGeneration = detailRequestGeneration
        let generation = accountGeneration
        let accountID = activeAccountID
        isLoadingDetail = true
        defer {
            if requestGeneration == detailRequestGeneration {
                isLoadingDetail = false
            }
        }
        do {
            let detail = try await provider.getMessage(
                folderID: summary.folderID,
                messageID: summary.id
            )
            guard requestGeneration == detailRequestGeneration,
                  generation == accountGeneration,
                  accountID == activeAccountID,
                  selectedMessageIDs.contains(id) else {
                return
            }
            selectedMessage = detail
            if !detail.summary.isRead {
                delayedReadTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(3))
                    guard !Task.isCancelled else { return }
                    await self?.markReadAfterDelay(messageID: id)
                }
            }
        } catch {
            if requestGeneration == detailRequestGeneration,
               generation == accountGeneration,
               accountID == activeAccountID {
                present(error)
            }
        }
    }

    func refresh() async {
        let generation = accountGeneration
        let accountID = activeAccountID
        await loadFolders()
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return
        }
        await loadMessages(reset: true)
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return
        }
        if !selectedMessageIDs.isEmpty {
            await selectionChanged()
        }
    }

    func pollForNewMail() async {
        guard let provider,
              let inbox = folders.first(where: { $0.wellKnownName == "inbox" }) else {
            return
        }
        let generation = accountGeneration
        let accountID = activeAccountID
        do {
            let page = try await provider.listMessages(
                folderID: inbox.id,
                nextPageToken: nil,
                search: nil
            )
            guard generation == accountGeneration,
                  accountID == activeAccountID else {
                return
            }
            detectNewInboxMessages(page.messages)
            if selectedFolderID == inbox.id, appliedSearchText.isEmpty {
                messages = page.messages
                nextPageToken = page.nextPageToken
            }
            await loadFolders()
        } catch {
            // Polling is best effort. User-initiated actions still surface errors.
        }
    }

    func markSelected(isRead: Bool) async {
        await performSelected(removesMessages: false) { provider, message in
            try await provider.markRead(messageID: message.id, isRead: isRead)
        } localUpdate: { message in
            message.isRead = isRead
        }
    }

    func trashSelected() async {
        await performSelected(removesMessages: true) { provider, message in
            try await provider.trash(messageID: message.id)
        }
    }

    func archiveSelected() async {
        await performSelected(removesMessages: true) { provider, message in
            try await provider.archive(messageID: message.id, from: message.folderID)
        }
    }

    func moveSelected(to folderID: String) async {
        await performSelected(removesMessages: true) { provider, message in
            try await provider.move(
                messageID: message.id,
                from: message.folderID,
                to: folderID
            )
        }
    }

    func move(messageID: String, to folderID: String) async {
        selectedMessageIDs = [messageID]
        await moveSelected(to: folderID)
    }

    func markJunkSelected(isJunk: Bool) async {
        await performSelected(removesMessages: true) { provider, message in
            try await provider.markJunk(messageID: message.id, isJunk: isJunk)
        }
    }

    func toggleStar(_ message: MailMessageSummary) async {
        selectedMessageIDs = [message.id]
        let newValue = !message.isStarred
        await performSelected(removesMessages: false) { provider, value in
            try await provider.setStarred(messageID: value.id, isStarred: newValue)
        } localUpdate: { value in
            value.isStarred = newValue
        }
    }

    func toggleFlag(_ message: MailMessageSummary) async {
        selectedMessageIDs = [message.id]
        let newValue = !message.isFlagged
        await performSelected(removesMessages: false) { provider, value in
            try await provider.setFlagged(messageID: value.id, isFlagged: newValue)
        } localUpdate: { value in
            value.isFlagged = newValue
        }
    }

    func toggleImportant(_ message: MailMessageSummary) async {
        selectedMessageIDs = [message.id]
        let newValue = !message.isImportant
        await performSelected(removesMessages: false) { provider, value in
            try await provider.setImportant(messageID: value.id, isImportant: newValue)
        } localUpdate: { value in
            value.isImportant = newValue
        }
    }

    func people(query: String?) async -> [PersonSuggestion] {
        guard let provider else { return [] }
        let generation = accountGeneration
        let accountID = activeAccountID
        let people = (try? await provider.listPeople(query: query)) ?? []
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return []
        }
        return people
    }

    func providerDrafts(accountID requestedAccountID: String? = nil) async throws -> [ProviderDraft] {
        guard requestedAccountID == nil || requestedAccountID == activeAccountID,
              let provider else {
            throw CourrierError.authentication("Select an account to load drafts.")
        }
        let generation = accountGeneration
        let accountID = activeAccountID
        let drafts = try await provider.listDrafts()
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            throw CourrierError.authentication("The active account changed while loading drafts.")
        }
        return drafts
    }

    func saveProviderDraft(
        _ request: DraftSaveRequest,
        accountID requestedAccountID: String? = nil
    ) async throws -> ProviderDraft {
        guard requestedAccountID == nil || requestedAccountID == activeAccountID,
              let provider else {
            throw CourrierError.authentication("Select an account to save this draft.")
        }
        return try await provider.saveDraft(request)
    }

    func deleteProviderDraft(
        id: String,
        accountID requestedAccountID: String? = nil
    ) async throws {
        guard requestedAccountID == nil || requestedAccountID == activeAccountID,
              let provider else {
            throw CourrierError.authentication("Select an account to delete this draft.")
        }
        try await provider.deleteDraft(id: id)
    }

    func sendProviderDraft(id: String, accountID requestedAccountID: String? = nil) async throws {
        guard requestedAccountID == nil || requestedAccountID == activeAccountID,
              let provider else {
            throw CourrierError.authentication("Select an account before sending.")
        }
        let generation = accountGeneration
        let accountID = activeAccountID
        try await provider.sendDraft(id: id)
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return
        }
        showTransient("Message sent")
        await loadMessages(reset: true)
    }

    func send(_ message: ComposeMessage, reply: ReplyMessage?) async throws {
        guard let provider else {
            throw CourrierError.authentication("Select an account before sending.")
        }
        let generation = accountGeneration
        let accountID = activeAccountID
        if let reply {
            try await provider.reply(reply)
        } else {
            try await provider.send(message)
        }
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return
        }
        showTransient("Message sent")
        await loadMessages(reset: true)
    }

    func download(_ attachment: MailAttachment) async throws -> DownloadedAttachment {
        guard let provider, let message = selectedMessage else {
            throw CourrierError.invalidResponse("Select a message first.")
        }
        return try await provider.downloadAttachment(
            messageID: message.id,
            attachmentID: attachment.id
        )
    }

    func clearError() {
        errorMessage = nil
    }

    func openNotification(folderID: String, messageID: String) async {
        let generation = accountGeneration
        let accountID = activeAccountID
        searchText = ""
        appliedSearchText = ""
        searchScope = .folder
        if selectedFolderID != folderID {
            selectedFolderID = folderID
        }
        await loadMessages(reset: true)
        guard generation == accountGeneration,
              accountID == activeAccountID else {
            return
        }
        if !messages.contains(where: { $0.id == messageID }), let provider {
            if let detail = try? await provider.getMessage(
                folderID: folderID,
                messageID: messageID
            ) {
                guard generation == accountGeneration,
                      accountID == activeAccountID else {
                    return
                }
                messages.insert(detail.summary, at: 0)
            }
        }
        if messages.contains(where: { $0.id == messageID }) {
            selectedMessageIDs = [messageID]
            await selectionChanged()
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func performSelected(
        removesMessages: Bool,
        operation: @escaping (any MailProvider, MailMessageSummary) async throws -> Void,
        localUpdate: ((inout MailMessageSummary) -> Void)? = nil
    ) async {
        guard let provider else { return }
        let selected = selectedSummaries
        guard !selected.isEmpty else { return }
        actionRequestGeneration &+= 1
        let requestGeneration = actionRequestGeneration
        let generation = accountGeneration
        let accountID = activeAccountID
        isPerformingAction = true
        defer {
            if requestGeneration == actionRequestGeneration {
                isPerformingAction = false
            }
        }
        do {
            for message in selected {
                try await operation(provider, message)
                guard requestGeneration == actionRequestGeneration,
                      generation == accountGeneration,
                      accountID == activeAccountID else {
                    return
                }
            }
            if removesMessages {
                let ids = Set(selected.map(\.id))
                messages.removeAll { ids.contains($0.id) }
                selectedMessageIDs = []
                selectedMessage = nil
            } else if let localUpdate {
                for message in selected {
                    updateMessage(message.id, localUpdate)
                }
                if var detail = selectedMessage,
                   selectedMessageIDs.contains(detail.id) {
                    localUpdate(&detail.summary)
                    selectedMessage = detail
                }
            }
            await loadFolders()
        } catch {
            if requestGeneration == actionRequestGeneration,
               generation == accountGeneration,
               accountID == activeAccountID {
                present(error)
                await loadMessages(reset: true)
            }
        }
    }

    private func updateMessage(
        _ id: String,
        _ update: (inout MailMessageSummary) -> Void
    ) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        update(&messages[index])
    }

    private func markReadAfterDelay(messageID: String) async {
        guard selectedMessageIDs.contains(messageID),
              let provider,
              selectedMessage?.id == messageID,
              selectedMessage?.summary.isRead == false else {
            return
        }
        let generation = accountGeneration
        let accountID = activeAccountID
        do {
            try await provider.markRead(messageID: messageID, isRead: true)
            guard generation == accountGeneration,
                  accountID == activeAccountID,
                  selectedMessageIDs.contains(messageID) else {
                return
            }
            updateMessage(messageID) { $0.isRead = true }
            if var detail = selectedMessage {
                detail.summary.isRead = true
                selectedMessage = detail
            }
        } catch {
            present(error)
        }
    }

    private func startRelay() async {
        guard let provider,
              configuration.relayPublicURL != nil,
              configuration.relayAdminToken != nil,
              let pushProvider = provider as? any MailPushSubscriptionProvider,
              let account = activeAccount else {
            liveUpdatesActive = false
            return
        }
        let generation = accountGeneration
        let accountID = account.id
        let client = RelayLiveUpdateClient(
            account: account,
            provider: pushProvider,
            configuration: configuration
        ) { [weak self] event in
            await self?.handleRelayEvent(
                event,
                accountID: accountID,
                generation: generation
            )
        }
        relayClient = client
        do {
            try await client.start()
            guard generation == accountGeneration,
                  accountID == activeAccountID,
                  relayClient === client else {
                await client.stop(deleteRemoteSubscription: false)
                return
            }
            liveUpdatesActive = true
        } catch {
            if generation == accountGeneration,
               accountID == activeAccountID,
               relayClient === client {
                liveUpdatesActive = false
            }
            // Live updates are optional. Polling remains active.
        }
    }

    private func stopRelay(deleteRemote: Bool) async {
        let client = relayClient
        relayClient = nil
        liveUpdatesActive = false
        await client?.stop(deleteRemoteSubscription: deleteRemote)
    }

    private func handleRelayEvent(
        _ event: RelayChangeEvent,
        accountID: String,
        generation: UInt64
    ) async {
        guard generation == accountGeneration,
              accountID == activeAccountID,
              event.accountId == nil || event.accountId == accountID else {
            return
        }
        await pollForNewMail()
    }

    private func detectNewInboxMessages(_ inboxMessages: [MailMessageSummary]) {
        let unread = inboxMessages.filter { !$0.isRead }
        let ids = Set(unread.map(\.id))
        if let knownInboxMessageIDs {
            for message in unread where !knownInboxMessageIDs.contains(message.id) {
                NotificationCenter.default.post(
                    name: .courrierNewMail,
                    object: message
                )
            }
        }
        knownInboxMessageIDs = ids
    }

    private func isInbox(_ folderID: String) -> Bool {
        folders.first(where: { $0.id == folderID })?.wellKnownName == "inbox"
    }

    private func present(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    private func showTransient(_ message: String) {
        transientTask?.cancel()
        transientMessage = message
        transientTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            self?.transientMessage = nil
        }
    }

    private func merge(
        _ existing: [MailMessageSummary],
        with next: [MailMessageSummary]
    ) -> [MailMessageSummary] {
        var seen = Set(existing.map(\.id))
        return existing + next.filter { seen.insert($0.id).inserted }
    }
}

extension Notification.Name {
    static let courrierCompose = Notification.Name("courrier.compose")
    static let courrierReply = Notification.Name("courrier.reply")
    static let courrierReplyAll = Notification.Name("courrier.replyAll")
    static let courrierForward = Notification.Name("courrier.forward")
    static let courrierTrash = Notification.Name("courrier.trash")
    static let courrierArchive = Notification.Name("courrier.archive")
    static let courrierToggleRead = Notification.Name("courrier.toggleRead")
    static let courrierShowDrafts = Notification.Name("courrier.showDrafts")
    static let courrierNewMail = Notification.Name("courrier.newMail")
    static let courrierOpenNotification = Notification.Name("courrier.openNotification")
}
