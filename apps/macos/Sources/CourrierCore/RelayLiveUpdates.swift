import Foundation
import Security

enum RelayEndpointPolicy {
    static func httpBaseURL(from url: URL) throws -> URL {
        try normalized(url, webSocket: false)
    }

    static func webSocketBaseURL(from url: URL) throws -> URL {
        try normalized(url, webSocket: true)
    }

    private static func normalized(_ url: URL, webSocket: Bool) throws -> URL {
        guard var components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        ), let scheme = components.scheme?.lowercased(),
        let host = components.host?.lowercased(),
        components.user == nil,
        components.password == nil,
        components.query == nil,
        components.fragment == nil else {
            throw CourrierError.configuration("The relay URL is invalid.")
        }

        let secure = scheme == "https" || scheme == "wss"
        let insecure = scheme == "http" || scheme == "ws"
        let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1", "[::1]"]
        guard secure || (insecure && loopbackHosts.contains(host)) else {
            throw CourrierError.configuration(
                "The relay URL must use HTTPS or WSS. Insecure relay URLs are allowed only for localhost development."
            )
        }

        components.scheme = webSocket
            ? (secure ? "wss" : "ws")
            : (secure ? "https" : "http")
        guard let normalized = components.url else {
            throw CourrierError.configuration("The relay URL is invalid.")
        }
        return normalized
    }
}

public struct RelayChangeEvent: Codable, Sendable {
    public let id: String
    public let clientId: String
    public let accountId: String?
    public let providerId: ProviderID?
    public let subscriptionId: String
    public let resource: String?
    public let receivedAt: String
    public let kind: Kind
    public let changeType: String
    public let messageId: String?
    public let historyId: String?

    public enum Kind: String, Codable, Sendable {
        case messageChange = "message-change"
        case lifecycle
    }
}

public actor RelayLiveUpdateClient {
    public typealias EventHandler = @Sendable (RelayChangeEvent) async -> Void

    private let account: MailAccount
    private let provider: any MailPushSubscriptionProvider
    private let configuration: AppConfiguration
    private let transport: any HTTPTransport
    private let onEvent: EventHandler
    private let stateStore: RelayStateStore
    private var state: RelayPersistedState
    private var subscription: MailPushSubscription?
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var renewalTask: Task<Void, Never>?
    private var stopped = true
    private var lifecycleGeneration: UInt64 = 0

    public init(
        account: MailAccount,
        provider: any MailPushSubscriptionProvider,
        configuration: AppConfiguration,
        transport: any HTTPTransport = URLSessionTransport(),
        onEvent: @escaping EventHandler
    ) {
        self.account = account
        self.provider = provider
        self.configuration = configuration
        self.transport = transport
        self.onEvent = onEvent
        let stateStore = RelayStateStore()
        self.stateStore = stateStore
        self.state = (try? stateStore.load(accountID: account.id))
            ?? RelayPersistedState.initial()
    }

    public func start() async throws {
        guard let configuredRelayURL = configuration.relayPublicURL,
              configuration.relayAdminToken != nil else {
            return
        }
        let relayURL = try RelayEndpointPolicy.httpBaseURL(from: configuredRelayURL)
        lifecycleGeneration &+= 1
        let generation = lifecycleGeneration
        stopped = false
        let activeSubscription = try await ensureSubscription(
            relayURL: relayURL,
            generation: generation
        )
        try requireActive(generation)
        subscription = activeSubscription
        saveState()
        try await registerWithRelay(generation: generation)
        try await connect(generation: generation)
        scheduleRenewal(generation: generation)
    }

    public func stop(deleteRemoteSubscription: Bool = false) async {
        lifecycleGeneration &+= 1
        let generation = lifecycleGeneration
        stopped = true
        reconnectTask?.cancel()
        reconnectTask = nil
        renewalTask?.cancel()
        renewalTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        if deleteRemoteSubscription, let subscription {
            do {
                try await provider.deletePushSubscription(id: subscription.id)
                guard generation == lifecycleGeneration, stopped else { return }
                state.subscriptionID = nil
                state.expirationDateTime = nil
                self.subscription = nil
                try stateStore.delete(accountID: account.id)
            } catch {
                guard generation == lifecycleGeneration, stopped else { return }
                saveState()
            }
        } else {
            saveState()
        }
    }

    private func registerWithRelay(generation: UInt64) async throws {
        try requireActive(generation)
        guard let configuredBase = configuration.relayPublicURL,
              let adminToken = configuration.relayAdminToken,
              let url = URL(
                  string: "/relay/subscriptions",
                  relativeTo: try RelayEndpointPolicy.httpBaseURL(from: configuredBase)
              )?.absoluteURL else {
            return
        }
        let body = RelaySubscriptionRegistration(
            clientId: state.clientID,
            accountId: account.id,
            providerId: account.providerID,
            accountEmail: account.email,
            clientState: state.clientState,
            authToken: state.authToken,
            subscriptionId: subscription?.id,
            expirationDateTime: subscription?.expirationDateTime
        )
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(adminToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await transport.data(for: request)
        try requireActive(generation)
        guard response.statusCode == 201 else {
            throw CourrierError.requestFailed(
                status: response.statusCode,
                message: ServerErrorParser.message(from: data)
            )
        }
    }

    private func connect(generation: UInt64) async throws {
        try requireActive(generation)
        guard let configuredBase = configuration.relayPublicURL,
              let components = URLComponents(
                  url: URL(
                      string: "/ws",
                      relativeTo: try RelayEndpointPolicy.webSocketBaseURL(
                          from: configuredBase
                      )
                  )!.absoluteURL,
                  resolvingAgainstBaseURL: false
              ) else {
            return
        }
        guard let url = components.url else {
            throw CourrierError.configuration("The relay WebSocket URL is invalid.")
        }
        let task = URLSession.shared.webSocketTask(with: url)
        try requireActive(generation)
        socket = task
        task.resume()
        try await send(
            RelayOutgoingMessage.register(
                .init(
                    clientId: state.clientID,
                    token: state.authToken,
                    lastEventId: state.lastEventID
                )
            ),
            through: task
        )
        do {
            try requireActive(generation)
        } catch {
            task.cancel(with: .goingAway, reason: nil)
            if socket === task {
                socket = nil
            }
            throw error
        }
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(task, generation: generation)
        }
    }

    private func receiveLoop(
        _ task: URLSessionWebSocketTask,
        generation: UInt64
    ) async {
        while !Task.isCancelled && isActive(generation) {
            do {
                let message = try await task.receive()
                guard isActive(generation) else { return }
                let data: Data
                switch message {
                case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: continue
                }
                try await handle(data, generation: generation, task: task)
            } catch {
                if isActive(generation) {
                    scheduleReconnect(generation: generation)
                }
                return
            }
        }
    }

    private func handle(
        _ data: Data,
        generation: UInt64,
        task: URLSessionWebSocketTask
    ) async throws {
        try requireActive(generation)
        let message = try JSONDecoder().decode(RelayIncomingMessage.self, from: data)
        switch message {
        case .ready:
            break
        case .error(let value):
            throw CourrierError.requestFailed(status: 0, message: value.message)
        case .mailChange(let value):
            try await recoverIfNeeded(for: value.event, generation: generation)
            try requireActive(generation)
            await onEvent(value.event)
            try requireActive(generation)
            state.lastEventID = value.event.id
            saveState()
            try await send(.ack(.init(eventId: value.event.id)), through: task)
        }
    }

    private func send(
        _ message: RelayOutgoingMessage,
        through task: URLSessionWebSocketTask
    ) async throws {
        let data = try JSONEncoder().encode(message)
        try await task.send(.data(data))
    }

    private func scheduleReconnect(generation: UInt64) {
        guard reconnectTask == nil, isActive(generation) else { return }
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self else { return }
            await self.reconnectNow(generation: generation)
        }
    }

    private func reconnectNow(generation: UInt64) async {
        reconnectTask = nil
        guard isActive(generation) else { return }
        do {
            try await registerWithRelay(generation: generation)
            try await connect(generation: generation)
        } catch {
            scheduleReconnect(generation: generation)
        }
    }

    private func ensureSubscription(
        relayURL: URL,
        generation: UInt64
    ) async throws -> MailPushSubscription {
        try requireActive(generation)
        let expiration = ISO8601DateFormatter().string(
            from: Date().addingTimeInterval(24 * 60 * 60)
        )
        if let subscriptionID = state.subscriptionID,
           let storedExpiration = state.expirationDateTime,
           (Self.date(from: storedExpiration) ?? .distantPast) > Date() {
            do {
                let renewed = try await provider.renewPushSubscription(
                    id: subscriptionID,
                    expirationDateTime: expiration
                )
                try requireActive(generation)
                updateState(with: renewed)
                return renewed
            } catch {
                try requireActive(generation)
                state.subscriptionID = nil
                state.expirationDateTime = nil
            }
        }

        let notificationPath = account.providerID == .microsoft
            ? "/graph/notifications"
            : "/google/pubsub"
        guard let notificationURL = URL(
            string: notificationPath,
            relativeTo: relayURL
        )?.absoluteURL else {
            throw CourrierError.configuration("The relay URL is invalid.")
        }
        let created = try await provider.createPushSubscription(
            clientState: state.clientState,
            expirationDateTime: expiration,
            notificationURL: notificationURL
        )
        do {
            try requireActive(generation)
        } catch {
            try? await provider.deletePushSubscription(id: created.id)
            throw error
        }
        updateState(with: created)
        return created
    }

    private func scheduleRenewal(generation: UInt64) {
        renewalTask?.cancel()
        guard isActive(generation),
              let expiration = subscription.flatMap({
                  Self.date(from: $0.expirationDateTime)
              }) else {
            return
        }
        let delay = max(expiration.timeIntervalSinceNow - 60 * 60, 60)
        renewalTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.renewSubscription(generation: generation)
        }
    }

    private func renewSubscription(generation: UInt64) async {
        guard isActive(generation),
              let configuredRelayURL = configuration.relayPublicURL,
              let relayURL = try? RelayEndpointPolicy.httpBaseURL(
                  from: configuredRelayURL
              ) else {
            return
        }
        do {
            let renewed = try await ensureSubscription(
                relayURL: relayURL,
                generation: generation
            )
            try requireActive(generation)
            subscription = renewed
            saveState()
            try await registerWithRelay(generation: generation)
            scheduleRenewal(generation: generation)
        } catch {
            guard isActive(generation) else { return }
            renewalTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await self?.renewSubscription(generation: generation)
            }
        }
    }

    private func recoverIfNeeded(
        for event: RelayChangeEvent,
        generation: UInt64
    ) async throws {
        try requireActive(generation)
        guard event.kind == .lifecycle,
              event.changeType == "subscriptionRemoved"
                || event.changeType == "reauthorizationRequired",
              let configuredRelayURL = configuration.relayPublicURL,
              let relayURL = try? RelayEndpointPolicy.httpBaseURL(
                  from: configuredRelayURL
              ) else {
            return
        }
        if event.changeType == "subscriptionRemoved" {
            state.subscriptionID = nil
            state.expirationDateTime = nil
            subscription = nil
        }
        let recovered = try await ensureSubscription(
            relayURL: relayURL,
            generation: generation
        )
        try requireActive(generation)
        subscription = recovered
        saveState()
        try await registerWithRelay(generation: generation)
        scheduleRenewal(generation: generation)
    }

    private func updateState(with subscription: MailPushSubscription) {
        state.subscriptionID = subscription.id
        state.expirationDateTime = subscription.expirationDateTime
    }

    private func saveState() {
        try? stateStore.save(state, accountID: account.id)
    }

    private func isActive(_ generation: UInt64) -> Bool {
        !stopped && generation == lifecycleGeneration
    }

    private func requireActive(_ generation: UInt64) throws {
        guard isActive(generation) else {
            throw CancellationError()
        }
    }

    private static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    fileprivate static func randomSecret() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private struct RelayPersistedState: Codable {
    var clientID: String
    var clientState: String
    var authToken: String
    var subscriptionID: String?
    var expirationDateTime: String?
    var lastEventID: String?

    static func initial() -> RelayPersistedState {
        RelayPersistedState(
            clientID: UUID().uuidString,
            clientState: RelayLiveUpdateClient.randomSecret(),
            authToken: RelayLiveUpdateClient.randomSecret()
        )
    }
}

private final class RelayStateStore: @unchecked Sendable {
    private let service = "dev.courrier.macos.relay"

    func load(accountID: String) throws -> RelayPersistedState? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw CourrierError.authentication("Courrier could not read relay state from Keychain.")
        }
        return try JSONDecoder().decode(RelayPersistedState.self, from: data)
    }

    func save(_ state: RelayPersistedState, accountID: String) throws {
        let data = try JSONEncoder().encode(state)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID,
        ]
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insertion = query
            update.forEach { insertion[$0.key] = $0.value }
            let addStatus = SecItemAdd(insertion as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw CourrierError.authentication("Courrier could not save relay state in Keychain.")
            }
        } else if status != errSecSuccess {
            throw CourrierError.authentication("Courrier could not update relay state in Keychain.")
        }
    }

    func delete(accountID: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CourrierError.authentication("Courrier could not clear relay state.")
        }
    }
}

private struct RelaySubscriptionRegistration: Encodable {
    let clientId: String
    let accountId: String?
    let providerId: ProviderID?
    let accountEmail: String?
    let clientState: String
    let authToken: String
    let subscriptionId: String?
    let expirationDateTime: String?
}

private enum RelayOutgoingMessage: Encodable {
    struct Registration: Encodable {
        let clientId: String
        let token: String
        let lastEventId: String?
    }

    struct Acknowledgement: Encodable {
        let eventId: String
    }

    case register(Registration)
    case ack(Acknowledgement)

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .register(let value):
            try container.encode("register", forKey: .type)
            try container.encode(value.clientId, forKey: .clientId)
            try container.encode(value.token, forKey: .token)
            try container.encodeIfPresent(value.lastEventId, forKey: .lastEventId)
        case .ack(let value):
            try container.encode("ack", forKey: .type)
            try container.encode(value.eventId, forKey: .eventId)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, clientId, token, lastEventId, eventId
    }
}

private enum RelayIncomingMessage: Decodable {
    struct Ready: Decodable {
        let clientId: String
    }

    struct ErrorMessage: Decodable {
        let message: String
    }

    struct Change: Decodable {
        let event: RelayChangeEvent
    }

    case ready(Ready)
    case error(ErrorMessage)
    case mailChange(Change)

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "ready":
            self = .ready(try Ready(from: decoder))
        case "error":
            self = .error(try ErrorMessage(from: decoder))
        case "mail-change":
            self = .mailChange(try Change(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown relay message type."
            )
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type
    }
}
