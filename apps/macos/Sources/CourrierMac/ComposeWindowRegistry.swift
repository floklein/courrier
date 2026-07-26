import CourrierCore
import Foundation
import SwiftUI

@MainActor
final class ComposeWindowRegistry: ObservableObject {
    enum Payload {
        case new(accountID: String?)
        case response(accountID: String?, kind: ReplyKind, message: MailMessageDetail)
        case draft(PersistedDraft)
    }

    private var payloads: [UUID: Payload] = [:]

    func register(_ payload: Payload) -> UUID {
        let id = UUID()
        payloads[id] = payload
        return id
    }

    func payload(for id: UUID) -> Payload? {
        payloads[id]
    }

    func discard(_ id: UUID) {
        payloads[id] = nil
    }
}

struct ComposerSceneView: View {
    @StateObject private var composer: ComposerModel
    private let windowID: UUID
    private let registry: ComposeWindowRegistry

    init(
        mailbox: MailboxStore,
        registry: ComposeWindowRegistry,
        windowID: UUID,
        payload: ComposeWindowRegistry.Payload?
    ) {
        let composer = ComposerModel(mailbox: mailbox)
        switch payload {
        case .new(let accountID):
            composer.prepareNew(accountID: accountID)
        case .response(let accountID, let kind, let message):
            composer.prepareResponse(
                kind: kind,
                message: message,
                accountID: accountID
            )
        case .draft(let draft):
            composer.load(draft)
        case nil:
            composer.prepareNew()
        }
        _composer = StateObject(wrappedValue: composer)
        self.windowID = windowID
        self.registry = registry
    }

    var body: some View {
        ComposerWindowView()
            .environmentObject(composer)
            .onDisappear {
                composer.flushBeforeClose()
                registry.discard(windowID)
            }
    }
}
